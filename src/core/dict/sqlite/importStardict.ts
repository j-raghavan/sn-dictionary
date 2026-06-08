// StarDict sideload import (TF5 + ADR-0006), refactored (M16) onto the
// shared runImport spine. The parse+insert runs NATIVELY (Kotlin, off
// the Hermes thread) into a per-dict slug DB; this module is now just
// the StarDict PRODUCE-STEP (produceStardictSlugDb) plus a thin adapter
// (importStardict) that injects it into runImport. All verify-then-
// delete / audit / data-safety logic lives in runImport and is shared
// verbatim with the CSV path.
//
// All environment effects stay behind ImportPorts (host-testable with a
// fake runNativeImport that seeds a better-sqlite3 slug DB). The audit
// handle is the WRITABLE user.db (Designer flag 4) — base.db is never
// touched here.

import {
  runImport,
  importInsufficientSpaceMessage,
  type ImportResult,
  type RunImportPorts,
  type SlugDbLifecycle,
} from './runImport';
import type {RunNativeImport} from './nativeImport';
import {parseSidecar} from './importSidecar';
import type {SqliteDb} from './db';

// Re-exported so existing callers/tests keep their import paths.
export type {SlugDbLifecycle, ImportResult};
export {importInsufficientSpaceMessage};

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
  // The .dict file size in bytes, for the space-guard estimate. An async
  // port so the size comes from a real native stat (no JS byte read) —
  // never a hardcoded 0 that would silently disable the guard.
  statDictSize(): Promise<number>;
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

type Logger = {warn: (msg: string) => void; log?: (msg: string) => void};

// Estimate the on-disk bytes an import needs. The dominant cost is the
// SQLite copy of the .dict body plus index overhead; ~2.5x the .dict
// length is a deliberately generous headroom factor so the guard errs
// toward refusing a too-tight import rather than failing mid-write.
export const estimateImportBytes = (dictByteLength: number): number =>
  Math.ceil(dictByteLength * 2.5);

// StarDict PRODUCE-STEP: run the native parse+insert into the resolved
// slug DB and resolve the committed count. This is the format-specific
// seam runImport calls; the `format` comes from the validated sidecar.
const produceStardictSlugDb = async (
  ports: ImportPorts,
  format: 'plain' | 'html' | 'wordnet',
  filename: string,
): Promise<{entryCount: number}> =>
  ports.runNativeImport({
    ifoPath: ports.ifoPath,
    idxPath: ports.idxPath,
    dictPath: ports.dictPath,
    synPath: ports.synPath,
    dbPath: ports.resolveSlugDbPath(filename),
    format,
  });

export const importStardict = async (
  ports: ImportPorts,
  logger?: Logger,
): Promise<ImportResult> => {
  // The space estimate needs the validated sidecar format; the sidecar
  // is re-validated inside runImport, but the format the native importer
  // is handed must come from the SAME parse. Parse once here for the
  // format; runImport's own parse is the authoritative gate (a bad
  // sidecar fails there before produceSlugDb is ever called).
  let format: 'plain' | 'html' | 'wordnet' = 'plain';
  try {
    const parsed = parseSidecar(JSON.parse(ports.sidecarText));
    if (parsed.ok && parsed.sidecar.format !== undefined) {
      format = parsed.sidecar.format;
    }
  } catch {
    // A malformed sidecar falls through to runImport, which rejects it
    // before produceSlugDb runs — `format` is never consulted.
  }

  const runPorts: RunImportPorts = {
    sidecarText: ports.sidecarText,
    produceSlugDb: filename => produceStardictSlugDb(ports, format, filename),
    estimateRequiredBytes: async () =>
      estimateImportBytes(await ports.statDictSize()),
    deleteFile: ports.deleteFile,
    sourcePaths: ports.sourcePaths,
    slugDb: ports.slugDb,
    audit: ports.audit,
    now: ports.now,
  };
  if (ports.getAvailableSpace !== undefined) {
    runPorts.getAvailableSpace = ports.getAvailableSpace;
  }
  return runImport(runPorts, logger);
};
