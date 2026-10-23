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
  // The .dict body size, for the space-guard estimate. An async port so
  // the size comes from the native side (no JS byte read) — never a
  // hardcoded 0 that would silently disable the guard.
  statDictBody(): Promise<DictBodySize>;
  // A source file's size in bytes (0 when missing), for the .idx and .syn
  // terms of the space-guard estimate.
  statFileSize(path: string): Promise<number>;
  // Delete a source file after a verified import.
  deleteFile(path: string): Promise<void>;
  // The source files to delete on success (triple + syn + sidecar).
  sourcePaths: string[];
  // The StarDict subfolder, removed (best-effort) once its files are
  // deleted so an empty dir isn't left behind (M17-FR3).
  sourceFolder?: string;
  deleteFolder?(path: string): Promise<boolean>;
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

// The .dict body as the native importer sees it (#44). `bytes` is the
// UNCOMPRESSED body size — for a .dict.dz the gzip ISIZE trailer, not the
// file size — and `inflated` says whether the import first inflates it to
// a temp file beside the slug DB (a .dz or gzip-magic body).
export type DictBodySize = {bytes: number; inflated: boolean};

// The source sizes the space guard reads: the .dict body plus the .idx
// and .syn file sizes (0 for a dict without a .syn).
export type ImportSourceSizes = {
  body: DictBodySize;
  idxBytes: number;
  synBytes: number;
};

const isByteCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;

// Estimate the on-disk bytes an import needs, at its peak:
//   - 2.5x the uncompressed body: the entries table's copy of every
//     definition plus deliberately generous headroom, so the guard errs
//     toward refusing a too-tight import rather than failing mid-write;
//   - the body again when it is inflated to a temp file, which lives for
//     the whole import;
//   - 4.5x the .syn: one aliases row per record plus idx_aliases_key.
//     Measured at 3.4x on fr-fr (60.5MB + 34.1MB from a 27.7MB .syn) and
//     ~3.8x for 2M short (~4-byte) synonyms, where per-row overhead
//     dominates; 4.5x keeps >= 1.2x headroom over both;
//   - 2x the .idx: each record's folded key and headword plus
//     idx_entries_key, beyond what the body term already covers.
// Measured peaks: reader-dict fr-fr 99MB temp + 232MB DB = 331MB (guard
// 492MB); JMdict 100MB temp + 136MB DB (guard >= 350MB). Sizing from the
// compressed .dz alone asked for 56MB for fr-fr.
//
// Validated here, at the native boundary: a non-finite, negative or
// mistyped size throws rather than silently passing the guard.
export const estimateImportBytes = (sizes: ImportSourceSizes): number => {
  const {body, idxBytes, synBytes} = sizes;
  if (
    !isByteCount(body?.bytes) ||
    typeof body.inflated !== 'boolean' ||
    !isByteCount(idxBytes) ||
    !isByteCount(synBytes)
  ) {
    throw new Error(`[import] invalid source sizes: ${JSON.stringify(sizes)}`);
  }
  return (
    Math.ceil(body.bytes * 2.5) +
    (body.inflated ? body.bytes : 0) +
    Math.ceil(synBytes * 4.5 + idxBytes * 2)
  );
};

// StarDict PRODUCE-STEP: run the native parse+insert into the resolved
// slug DB and resolve the committed count. This is the format-specific
// seam runImport calls; the `format` comes from the validated sidecar.
const produceStardictSlugDb = async (
  ports: ImportPorts,
  format: 'plain' | 'html' | 'wordnet' | undefined,
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

// Adapt the StarDict ImportPorts to the format-agnostic RunImportPorts —
// the native produce-step + the source-size-based space estimate. The
// host (index.js) calls THIS to build the run ports for a 'stardict'
// descriptor, then hands them straight to runImport.
export const stardictRunPorts = (ports: ImportPorts): RunImportPorts => {
  // The format handed to the native importer comes from the validated
  // sidecar ONLY when meta.json sets it explicitly. Otherwise leave it
  // `undefined` so the native importer derives it from the .ifo's
  // sametypesequence (h -> html, else plain) — NOT a hardcoded 'plain',
  // which would shadow an HTML StarDict's own type declaration and render
  // its `<i>/<ol>/<li>` markup as literal text. runImport's own parse is
  // the authoritative gate (a bad sidecar fails there before produceSlugDb).
  let format: 'plain' | 'html' | 'wordnet' | undefined;
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
      estimateImportBytes({
        body: await ports.statDictBody(),
        idxBytes: await ports.statFileSize(ports.idxPath),
        synBytes:
          ports.synPath === undefined ? 0 : await ports.statFileSize(ports.synPath),
      }),
    deleteFile: ports.deleteFile,
    sourcePaths: ports.sourcePaths,
    slugDb: ports.slugDb,
    audit: ports.audit,
    now: ports.now,
  };
  if (ports.getAvailableSpace !== undefined) {
    runPorts.getAvailableSpace = ports.getAvailableSpace;
  }
  // Pass the subfolder cleanup through only when BOTH are wired (the
  // spine no-ops otherwise).
  if (ports.sourceFolder !== undefined && ports.deleteFolder !== undefined) {
    runPorts.sourceFolder = ports.sourceFolder;
    runPorts.deleteFolder = ports.deleteFolder;
  }
  return runPorts;
};

export const importStardict = async (
  ports: ImportPorts,
  logger?: Logger,
): Promise<ImportResult> => runImport(stardictRunPorts(ports), logger);
