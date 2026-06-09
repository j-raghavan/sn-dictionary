// Format-agnostic import spine (M16, refactored out of importStardict).
// Every sideload format (StarDict, CSV, ...) shares ONE verify-then-
// delete pipeline; the ONLY format-specific seam is `produceSlugDb`,
// which parses the source and writes a per-dict slug DB, resolving the
// committed row count. Everything else — sidecar validation, the
// optional space guard, slug-name collision resolution, COMMITTED-state
// verify, and the audit-then-delete data-safety ordering — is identical
// across formats and lives here once.
//
// Data-safety contracts (unchanged from the StarDict-only era):
//   - invalid sidecar / space shortfall -> {ok:false}, nothing written
//     or deleted (sources stay, registry untouched);
//   - verify mismatch -> discard the half-built slug DB, LEAVE sources;
//   - any throw BEFORE the audit row -> discard + leave sources (the
//     import is always retryable);
//   - AUDIT FIRST, then delete sources; once committedAndAudited is set
//     the slug DB is durably recorded and a later deleteFile failure
//     must NOT discard it (a stale audit row pointing at still-present
//     sources self-heals on the next discovery).
//   - F4: the final delete step is CONDITIONAL on keepSources (default
//     keep). When keeping, the audit row + slug DB are still written but
//     the sources stay on disk; reconcile then sends the kept+healthy set
//     to 'open' (not a re-import) so the keep doesn't loop. The verify ->
//     audit -> (conditional) delete ORDERING is unchanged.

import type {SqliteDb} from './db';
import {parseSidecar, slugDbFilename} from './importSidecar';
import {ensureImportsTable, resolveSlugCollision, upsertImport} from './importAudit';

// Lifecycle of the per-dict slug DB. produceSlugDb WRITES it; JS reopens
// a DISTINCT handle to verify committed state and discards a failed one.
export interface SlugDbLifecycle {
  // Reopen a DISTINCT handle to read COMMITTED state (verify-after-
  // commit, against the DB produceSlugDb just wrote).
  reopenForVerify(filename: string): Promise<SqliteDb>;
  // Delete the slug DB file (used to discard a failed import).
  discard(filename: string): Promise<void>;
}

export interface RunImportPorts {
  // The sidecar text (read from meta.json, or synthesized from the
  // discovery default when there is no meta.json).
  sidecarText: string;
  // The ONE format-specific seam: parse the source into the resolved
  // slug DB (`filename`) and resolve the committed entry count. Throwing
  // is a failed import (discard + leave sources).
  produceSlugDb(filename: string): Promise<{entryCount: number}>;
  // Optional free-space probe (bytes) + the estimated bytes the import
  // needs. When BOTH are present the import is space-gated; otherwise the
  // guard is a no-op (e.g. CSV, capped at 10 MB, skips it).
  getAvailableSpace?(): Promise<number>;
  estimateRequiredBytes?(): Promise<number>;
  // F4-FR2: keep the source files after a verified import (the new
  // DEFAULT, opt-IN to delete). When true, the audit row + slug DB are
  // still written, but deleteFile / deleteFolder are SKIPPED — leaving the
  // sources on disk for an idempotent re-open on the next bootstrap
  // (reconcile sends a kept+healthy set to 'open', not 'import' — F4-FR3).
  // Optional so legacy callers default to today's delete behaviour.
  keepSources?: boolean;
  // Delete a source file after a verified import.
  deleteFile(path: string): Promise<void>;
  // The source files to delete on success (data files + sidecar).
  sourcePaths: string[];
  // Optional containing folder to remove once the sources are deleted
  // (StarDict lives in its own subfolder; CSV is a loose root file and
  // sets none). Best-effort: a non-empty/failed rmdir is logged + ignored
  // and NEVER fails the import.
  sourceFolder?: string;
  // Remove the (now-empty) source folder. Only called when sourceFolder
  // is set. Resolving false / throwing is tolerated.
  deleteFolder?(path: string): Promise<boolean>;
  // F4-FR9: after a successful refresh import (a `.refresh` sentinel
  // forced a re-import of a kept set), delete the sentinel so it doesn't
  // loop on the next bootstrap. Best-effort + ISOLATED — a failure never
  // fails the verified+audited import. Called AFTER the audit row commits,
  // regardless of keepSources (the sentinel itself is never "kept").
  deleteRefreshSentinel?(path: string): Promise<void>;
  // The `.refresh` sentinel path (set only when this is a refresh import).
  refreshPath?: string;
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

// Tagged so the failure is distinguishable from the provision guard's
// '[provision]' message (both share the verify-before-write contract).
export const importInsufficientSpaceMessage = (
  requiredBytes: number,
  available: number,
): string =>
  `[import] insufficient space: need ${requiredBytes}, have ${available}`;

// Returns a reason string when the guard fails, else null. No-op unless
// BOTH the probe and the estimate are present.
const checkSpace = async (
  ports: RunImportPorts,
  logger?: Logger,
): Promise<string | null> => {
  if (
    ports.getAvailableSpace === undefined ||
    ports.estimateRequiredBytes === undefined
  ) {
    return null;
  }
  const requiredBytes = await ports.estimateRequiredBytes();
  const available = await ports.getAvailableSpace();
  if (available < requiredBytes) {
    const msg = importInsufficientSpaceMessage(requiredBytes, available);
    logger?.warn(msg);
    return msg;
  }
  return null;
};

export const runImport = async (
  ports: RunImportPorts,
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

  // 2. Space guard — shortfall fails WITHOUT producing/deleting anything.
  const spaceReason = await checkSpace(ports, logger);
  if (spaceReason !== null) {
    return {ok: false, reason: spaceReason};
  }

  // 3. Produce the slug DB (the format-specific parse+insert).
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

    const {entryCount} = await ports.produceSlugDb(filename);

    // 4. Verify against COMMITTED state via a distinct reopened handle —
    //    the count JS reads must match the count produceSlugDb reports.
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

    // 5. MATCH — AUDIT THEN DELETE (data-safety ordering). The audit row
    //    is the only durable record of the verified slug DB; write it
    //    FIRST so a failure here can still discard the (not-yet-recorded)
    //    DB and leave the sources for a clean retry. Only AFTER the audit
    //    commits do we delete the sources — and from that point a failure
    //    must NOT discard the DB.
    await upsertImport(ports.audit, {
      name,
      lang,
      entry_count: expected,
      imported_at: ports.now(),
      filename,
    });
    committedAndAudited = true;

    // F4-FR2: with keepSources, SKIP the source deletion entirely — the
    // audit row + slug DB above are already durably written, and leaving
    // the sources on disk is the new default. The ordering (audit-FIRST,
    // then the conditional delete) is unchanged (F4-FR6); only whether the
    // final delete runs is gated.
    if (ports.keepSources !== true) {
      for (const path of ports.sourcePaths) {
        await ports.deleteFile(path);
      }

      // Best-effort: remove the now-empty source folder (StarDict's
      // subfolder; CSV sets none). ISOLATED so a non-empty/failed rmdir
      // NEVER flips the verified+audited import to a failure or discards
      // the DB — the worst case is an empty folder left on disk.
      if (ports.sourceFolder !== undefined && ports.deleteFolder !== undefined) {
        try {
          await ports.deleteFolder(ports.sourceFolder);
        } catch (e) {
          logger?.warn(
            `[import] could not remove source folder "${ports.sourceFolder}": ${(e as Error).message} — left in place`,
          );
        }
      }
    }

    // F4-FR9: a refresh import's `.refresh` sentinel is always removed
    // (even with keepSources) so the same set doesn't re-import forever.
    // ISOLATED: a delete failure never fails the verified+audited import.
    if (
      ports.refreshPath !== undefined &&
      ports.deleteRefreshSentinel !== undefined
    ) {
      try {
        await ports.deleteRefreshSentinel(ports.refreshPath);
      } catch (e) {
        logger?.warn(
          `[import] could not remove refresh sentinel "${ports.refreshPath}": ${(e as Error).message} — left in place`,
        );
      }
    }

    logger?.log?.(
      `[import] "${name}" (${lang}) -> ${filename} (${expected} entries)`,
    );
    return {ok: true, filename, entryCount: expected, name, lang};
  } catch (e) {
    // Any throw BEFORE the audit row is committed: discard the half-built
    // DB (if it got a name) and LEAVE the sources in place. Once
    // committedAndAudited is set, the DB is durably recorded — a later
    // deleteFile failure must NOT discard it (that would be the data-loss
    // bug this ordering fixes); the leftover sources self-heal next scan.
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
