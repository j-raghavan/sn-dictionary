// StarDict sideload import pipeline (TF5-FR3/FR4/FR6 + ADR-0006). The
// parse+insert now runs NATIVELY (Kotlin, off the Hermes thread); JS
// orchestrates: validate the sidecar, gate on free space, run the
// native import into a per-dict slug DB, then VERIFY-then-delete — reopen
// the slug DB, COUNT the committed rows, and ONLY on a match delete the
// source files and write the audit row. Any mismatch or throw discards
// the half-built DB and LEAVES the sources in place, so a failed import
// is always retryable and never loses the user's files. The verify +
// audit-then-delete safety is unchanged from the JS-import era — only
// the parse+insert moved to native.
//
// All environment effects are behind ImportPorts (host-testable with a
// fake runNativeImport that seeds a better-sqlite3 slug DB). The audit
// handle is the WRITABLE user.db (Designer flag 4) — base.db is never
// touched here.

import type {SqliteDb} from './db';
import {parseSidecar, slugDbFilename} from './importSidecar';
import {ensureImportsTable, resolveSlugCollision, upsertImport} from './importAudit';
import type {RunNativeImport} from './nativeImport';

// Retained for the device adapter's now-dead readSet (removed in the
// next commit). Kept here so importRnPorts.ts keeps compiling in the
// interim — no longer used by the orchestration below.
export type StardictSet = {
  ifo: Uint8Array;
  idx: Uint8Array;
  dict: Uint8Array;
  syn?: Uint8Array;
  sidecarText: string;
};

// Lifecycle of the per-dict slug DB. The native importer WRITES it
// (importStardict no longer opens a writable handle); JS only reopens a
// DISTINCT handle to verify committed state and discards a failed import.
export interface SlugDbLifecycle {
  // Reopen a DISTINCT handle to read COMMITTED state (Designer flag 5 —
  // verify-after-commit, against the DB the native side just wrote).
  reopenForVerify(filename: string): Promise<SqliteDb>;
  // Delete the slug DB file (used to discard a failed import).
  discard(filename: string): Promise<void>;
}

export interface ImportPorts {
  // Run the native StarDict import into `dbPath`, resolving the count.
  runNativeImport: RunNativeImport;
  // Resolve a slug filename to the absolute DB path the native side
  // writes (under the plugin's extracted dir).
  resolveSlugDbPath(filename: string): string;
  // The sidecar text (read from meta.json, or synthesized from the
  // discovery default when there is no meta.json).
  sidecarText: string;
  // Source paths handed straight to the native importer (no JS byte read).
  ifoPath: string;
  idxPath: string;
  dictPath: string;
  synPath?: string;
  // The .dict file size in bytes, for the space-guard estimate (no JS
  // byte read needed).
  dictByteLength: number;
  // Delete a source file after a verified import.
  deleteFile(path: string): Promise<void>;
  // The source files to delete on success (triple + syn + sidecar).
  sourcePaths: string[];
  // Optional free-space probe (bytes). With the estimate it gates the
  // import (TF5-FR6).
  getAvailableSpace?(): Promise<number>;
  slugDb: SlugDbLifecycle;
  // The WRITABLE user.db handle the audit row is written to.
  audit: SqliteDb;
  // Deterministic timestamp source (imported_at).
  now(): string;
}

export type ImportResult =
  | {ok: true; filename: string; entryCount: number; name: string; lang: string}
  | {ok: false; reason: string};

type Logger = {warn: (msg: string) => void; log?: (msg: string) => void};

// Estimate the on-disk bytes an import needs. The dominant cost is the
// SQLite copy of the .dict body plus index overhead; ~2.5x the .dict
// length is a deliberately generous headroom factor so the guard errs
// toward refusing a too-tight import rather than failing mid-write.
export const estimateImportBytes = (dictByteLength: number): number =>
  Math.ceil(dictByteLength * 2.5);

// Tagged so the failure is distinguishable from the provision guard's
// '[provision]' message (both share the verify-before-write contract).
export const importInsufficientSpaceMessage = (
  requiredBytes: number,
  available: number,
): string =>
  `[import] insufficient space: need ${requiredBytes}, have ${available}`;

// Returns a reason string when the guard fails, else null. No-op when
// either the probe or the requirement is absent (matches provision's
// assertSpace contract).
const checkSpace = async (
  ports: ImportPorts,
  requiredBytes: number,
  logger?: Logger,
): Promise<string | null> => {
  if (ports.getAvailableSpace === undefined) {
    return null;
  }
  const available = await ports.getAvailableSpace();
  if (available < requiredBytes) {
    const msg = importInsufficientSpaceMessage(requiredBytes, available);
    logger?.warn(msg);
    return msg;
  }
  return null;
};

export const importStardict = async (
  ports: ImportPorts,
  logger?: Logger,
): Promise<ImportResult> => {
  // 1. Sidecar — invalid sidecar fails WITHOUT deleting anything.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(ports.sidecarText);
  } catch (e) {
    return {ok: false, reason: `sidecar is not valid JSON: ${(e as Error).message}`};
  }
  const sidecarResult = parseSidecar(parsedJson);
  if (!sidecarResult.ok) {
    return {ok: false, reason: sidecarResult.reason};
  }
  const {name, language: lang} = sidecarResult.sidecar;

  // 2. Space guard — shortfall fails WITHOUT importing/deleting anything.
  const spaceReason = await checkSpace(
    ports,
    estimateImportBytes(ports.dictByteLength),
    logger,
  );
  if (spaceReason !== null) {
    return {ok: false, reason: spaceReason};
  }

  // 3. Run the NATIVE parse+insert into the resolved slug DB.
  let filename: string | null = null;
  // Flips true once the audit row is written — past that the slug DB is
  // durably recorded and the catch must never discard it (data-safety).
  let committedAndAudited = false;
  try {
    await ensureImportsTable(ports.audit);
    filename = await resolveSlugCollision(
      slugDbFilename(name, lang),
      name,
      lang,
      ports.audit,
    );

    const {entryCount} = await ports.runNativeImport({
      ifoPath: ports.ifoPath,
      idxPath: ports.idxPath,
      dictPath: ports.dictPath,
      synPath: ports.synPath,
      dbPath: ports.resolveSlugDbPath(filename),
      format: sidecarResult.sidecar.format,
    });

    // 4. Verify against COMMITTED state via a distinct reopened handle —
    //    the count the JS side reads must match the count native reports.
    const verifyDb = await ports.slugDb.reopenForVerify(filename);
    const countRows = await verifyDb.query<{n: number}>(
      'SELECT COUNT(*) AS n FROM entries',
    );
    const committed = countRows.length > 0 ? countRows[0].n : -1;
    const expected = entryCount;

    if (committed !== expected) {
      await ports.slugDb.discard(filename);
      return {
        ok: false,
        reason: `verify failed: committed ${committed} rows, expected ${expected}`,
      };
    }

    // 5. MATCH — AUDIT THEN DELETE (data-safety ordering). Write the
    //    audit row FIRST: it is the only durable record of the verified
    //    slug DB. If the audit write throws, the catch can still discard
    //    the (not-yet-recorded) slug DB and the sources remain for a
    //    clean retry. Only AFTER the audit is committed do we delete the
    //    sources — and from that point a failure must NOT discard the
    //    DB (the inverse order could destroy a verified DB whose sources
    //    are already gone). A stale audit row pointing at still-present
    //    sources is self-healing: next discovery sees audit-hit +
    //    files-present and re-adds/replaces.
    await upsertImport(ports.audit, {
      name,
      lang,
      entry_count: expected,
      imported_at: ports.now(),
      filename,
    });
    // Past this point the import is durably recorded — never discard.
    committedAndAudited = true;

    for (const path of ports.sourcePaths) {
      await ports.deleteFile(path);
    }

    logger?.log?.(
      `[import] "${name}" (${lang}) -> ${filename} (${expected} entries)`,
    );
    return {ok: true, filename, entryCount: expected, name, lang};
  } catch (e) {
    // Any throw BEFORE the audit row is committed: discard the half-built
    // DB (if it got a name) and LEAVE the sources in place so the import
    // is retryable. Once committedAndAudited is set, the DB is durably
    // recorded — a later deleteFile failure must NOT discard it (that
    // would be the data-loss bug this ordering fixes); the leftover
    // sources self-heal on the next discovery.
    if (filename !== null && !committedAndAudited) {
      try {
        await ports.slugDb.discard(filename);
      } catch {
        // Best-effort cleanup; the original error is what matters.
      }
    }
    const reason = `import failed: ${(e as Error).message}`;
    logger?.warn(`[import] ${reason}`);
    return {ok: false, reason};
  }
};
