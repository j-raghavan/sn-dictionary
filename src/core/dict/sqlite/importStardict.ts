// StarDict sideload import pipeline (TF5-FR3/FR4/FR6). Verify-then-
// delete: parse the StarDict triple into a per-dict SQLite DB, reopen
// it and COUNT the committed rows, and ONLY on a match delete the
// source files and write the audit row. Any mismatch or throw discards
// the half-built DB and LEAVES the sources in place, so a failed import
// is always retryable and never loses the user's files.
//
// All environment effects are behind ImportPorts (host-testable with
// fakes / better-sqlite3). The audit handle is the WRITABLE user.db
// (Designer flag 4) — base.db is never touched here.

import {buildDict} from '../stardict/stardictDict';
import {formatFromSametypesequence} from '../stardict/formatFromIfo';
import type {SqliteDb} from './db';
import {SCHEMA_VERSION, populateBaseDb} from './buildBaseDb';
import {parseSidecar, slugDbFilename} from './importSidecar';
import {ensureImportsTable, resolveSlugCollision, upsertImport} from './importAudit';

export type StardictSet = {
  ifo: Uint8Array;
  idx: Uint8Array;
  dict: Uint8Array;
  syn?: Uint8Array;
  sidecarText: string;
};

// Lifecycle of the per-dict slug DB, grouped (Designer ruling 3) so the
// open / verify-reopen / discard handles travel together.
export interface SlugDbLifecycle {
  // Open (create) the slug DB for writing.
  open(filename: string): Promise<SqliteDb>;
  // Reopen a DISTINCT handle to read COMMITTED state (Designer flag 5 —
  // verify-after-commit, not a cached uncommitted handle).
  reopenForVerify(filename: string): Promise<SqliteDb>;
  // Delete the slug DB file (used to discard a failed import).
  discard(filename: string): Promise<void>;
}

export interface ImportPorts {
  // Read the StarDict triple (+ optional .syn) and the sidecar text.
  readSet(): Promise<StardictSet>;
  // Delete a source file after a verified import.
  deleteFile(path: string): Promise<void>;
  // The source files to delete on success (triple + syn + sidecar).
  sourcePaths: string[];
  // Optional free-space probe (bytes). With requiredBytes it gates the
  // write (TF5-FR6).
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
  const set = await ports.readSet();

  // 1. Sidecar — invalid sidecar fails WITHOUT deleting anything.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(set.sidecarText);
  } catch (e) {
    return {ok: false, reason: `sidecar is not valid JSON: ${(e as Error).message}`};
  }
  const sidecarResult = parseSidecar(parsedJson);
  if (!sidecarResult.ok) {
    return {ok: false, reason: sidecarResult.reason};
  }
  const {name, language: lang} = sidecarResult.sidecar;

  // 2. Space guard — shortfall fails WITHOUT deleting anything.
  const spaceReason = await checkSpace(
    ports,
    estimateImportBytes(set.dict.length),
    logger,
  );
  if (spaceReason !== null) {
    return {ok: false, reason: spaceReason};
  }

  // 3. Parse + populate into the slug DB.
  let filename: string | null = null;
  // Flips true once the audit row is written — past that the slug DB is
  // durably recorded and the catch must never discard it (data-safety).
  let committedAndAudited = false;
  try {
    const parsed = await buildDict(set.ifo, set.idx, set.dict, set.syn);
    const entryFormat =
      sidecarResult.sidecar.format ?? formatFromSametypesequence(parsed.meta);

    await ensureImportsTable(ports.audit);
    filename = await resolveSlugCollision(
      slugDbFilename(name, lang),
      name,
      lang,
      ports.audit,
    );

    const slugDb = await ports.slugDb.open(filename);
    await populateBaseDb(slugDb, parsed, SCHEMA_VERSION, entryFormat);

    // 4. Verify against COMMITTED state via a distinct reopened handle.
    const verifyDb = await ports.slugDb.reopenForVerify(filename);
    const countRows = await verifyDb.query<{n: number}>(
      'SELECT COUNT(*) AS n FROM entries',
    );
    const committed = countRows.length > 0 ? countRows[0].n : -1;
    const expected = parsed.index.size;

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
