// DB export orchestration (F5). Copy every on-device DB — bundled
// `base.db`, writable `user.db`, and each imported slug DB — to a
// user-chosen folder (default MyStyle/SnDict). HOST-TESTABLE: every
// device touchpoint is an injected port (ExportPorts); the real
// NativeFileUtils wiring lives in index.js (DEVICE-UNVERIFIED,
// coverage-excluded). This module owns the SAFETY RAILS — the
// plugin-dir guard, the free-space pre-check, the user.db checkpoint,
// and the per-file partial-failure reporting — so they are exercised
// off-device.
//
// READ-ONLY w.r.t. the live DBs (F5-FR6): export only ever copies,
// never moves/renames the originals, and the running sources are
// untouched. Overwrite policy (F5-FR7): a target file is overwritten
// (a backup replaces a prior backup) — copyFile does that, no probe.

import type {DbFile, ExportSummary} from './settings';
import type {FileUtilsLike} from '../userDictDiscovery';
import {DEFAULT_USER_DICT_ROOT} from '../userDictDiscovery';
import type {ImportRow} from './schema';

// One source DB to copy: its absolute on-device path + the basename it
// keeps in the target folder. `label` rides along for diagnostics only.
export type ExportableDb = {
  label: string;
  filename: string;
  srcPath: string;
};

// The device seam the orchestration drives. All async; all best-effort
// at the copy step (a throw/false is captured per-file, never rethrown).
// `sizeOf` returns a source DB's byte size (0 when unknown — the guard
// then can't over-count, it just under-estimates the requirement, which
// is the safe direction: a real out-of-space copyFile still fails and is
// reported). `checkpointUserDb` flushes the WAL of the OPEN user.db
// handle before its file is copied (resolution #9); best-effort.
export type ExportPorts = {
  // Resolve the export set (base.db, user.db, each imported slug) with
  // absolute source paths. F5-FR1.
  listDbs(): Promise<ExportableDb[]>;
  // Free space on the destination volume, in bytes. F5-FR3.
  availableSpace(): Promise<number>;
  // Byte size of one source DB (0 if unknowable). Summed for the guard.
  sizeOf(srcPath: string): Promise<number>;
  // Copy src -> dest, overwriting. Resolves true on success; a false
  // resolution OR a throw is treated as a per-file failure.
  copyFile(srcPath: string, destPath: string): Promise<boolean>;
  // Ensure the target dir exists (idempotent makeDir). Resolves true on
  // success/already-present; a throw/false aborts the export (can't copy
  // into a folder that doesn't exist). F5-FR2 default-folder creation.
  ensureDir(dir: string): Promise<boolean>;
  // Flush the open user.db so its on-disk file is WAL-consistent before
  // the raw copy (resolution #9 / F5-FR8). Best-effort: a throw is
  // logged and copy proceeds (the host better-sqlite3 adapter may no-op).
  checkpointUserDb(): Promise<void>;
};

export type ExportLogger = {warn: (msg: string) => void; log?: (msg: string) => void};

// Free-space safety margin over the summed source sizes: copying needs a
// little headroom (filesystem slack, the WAL truncate, a concurrent
// write). 8 MiB is generous next to a few-MB user.db and small slugs and
// negligible against base.db. F5-FR3 ("with margin").
export const EXPORT_SPACE_MARGIN_BYTES = 8 * 1024 * 1024;

// Filename of the writable user DB (the one that needs a checkpoint).
const USER_DB_FILENAME = 'user.db';

// Join a dir and a basename with exactly one slash (the device paths are
// POSIX). Trailing slash on the dir is tolerated.
export const joinPath = (dir: string, name: string): string =>
  dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;

// Normalise a path for the plugin-dir containment check: strip a single
// trailing slash so `…/plugin` and `…/plugin/` compare equal, and so a
// prefix test can't be fooled by a sibling like `…/plugin-backup`.
const stripTrailingSlash = (p: string): string =>
  p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;

// True when `target` is the plugin dir itself or any path inside it
// (F5-FR4): exporting there would alias the LIVE DBs (copyFile onto an
// open file). A sibling whose name merely starts with the plugin-dir
// string (`…/plugin-backup`) is NOT inside it — guard on a `/`-delimited
// segment boundary, not a bare string prefix.
export const isInsidePluginDir = (
  target: string,
  pluginDir: string,
): boolean => {
  const t = stripTrailingSlash(target);
  const p = stripTrailingSlash(pluginDir);
  return t === p || t.startsWith(`${p}/`);
};

// Map the export set to the DbFile labels the UI summary shows (F5-FR1 /
// F5-FR5). The filename (not the absolute path) is the user-facing copy.
export const toDbFiles = (dbs: ExportableDb[]): DbFile[] =>
  dbs.map(db => ({label: db.label, filename: db.filename}));

// Export all DBs to `targetDir`. The orchestration, in order:
//   (0) GUARD — reject a target equal to or inside PLUGIN_LOCATION
//       (F5-FR4): copying there would alias the live DBs. Nothing copied.
//   (1) Resolve the export set + ensure the target dir exists (F5-FR2).
//   (2) SPACE PRE-CHECK (F5-FR3) — summed source sizes + margin must fit
//       in the free space; else abort with the no-space reason, COPY
//       NOTHING.
//   (3) CHECKPOINT user.db (F5-FR8 / resolution #9) BEFORE its copy so
//       the on-disk image is WAL-consistent. Best-effort.
//   (4) COPY each DB (F5-FR7 overwrite); collect per-file success/failure
//       (F5-FR5 — partial failures reported, not dropped).
// Returns the summary index.js renders via showRattaDialog. Throws ONLY
// for the two abort conditions (plugin-dir guard, no space) carrying the
// localised reason — caught by the caller, which shows it. Read-only
// w.r.t. the live DBs throughout (F5-FR6): copy, never move.
export const exportDbs = async (
  targetDir: string,
  ports: ExportPorts,
  // `pluginDir` is the PATH the guard compares against; `pluginDirMessage` is
  // the localized reason surfaced to the user when the guard fires (kept
  // separate so the user never sees the raw `plugins/<id>/` path). `noSpace`
  // is the localized abort reason for the space / dir-creation failures.
  reasons: {pluginDir: string; pluginDirMessage: string; noSpace: string},
  logger?: ExportLogger,
): Promise<ExportSummary> => {
  // (0) Plugin-dir guard — FIRST, before any I/O, so a bad target can't
  //     touch the live DBs (F5-FR4 / F5-AC5).
  if (isInsidePluginDir(targetDir, reasons.pluginDir)) {
    throw new Error(reasons.pluginDirMessage);
  }

  const dbs = await ports.listDbs();

  // (1) Ensure the destination exists (default-folder creation, F5-FR2 /
  //     F5-AC3). A failure here is fatal — copyFile into a missing dir
  //     would just fail every file; surface it as the no-space-class
  //     abort message so the user gets a single clear failure, not N.
  const dirOk = await ports.ensureDir(targetDir).catch(() => false);
  if (!dirOk) {
    throw new Error(reasons.noSpace);
  }

  // (2) Space pre-check (F5-FR3 / F5-AC2). Sum source sizes (+ margin);
  //     abort and COPY NOTHING when the free space can't hold them.
  let required = EXPORT_SPACE_MARGIN_BYTES;
  for (const db of dbs) {
    try {
      required += await ports.sizeOf(db.srcPath);
    } catch (e) {
      // An unknowable size doesn't block the export — under-counting is
      // the safe direction (a real shortfall still fails copyFile and is
      // reported per-file). Log and treat as 0.
      logger?.warn(
        `[export] sizeOf "${db.srcPath}" threw: ${(e as Error).message} — counting 0`,
      );
    }
  }
  const free = await ports.availableSpace().catch(() => 0);
  if (free < required) {
    logger?.warn(
      `[export] insufficient space: need ~${required} bytes, ${free} free — nothing copied`,
    );
    throw new Error(reasons.noSpace);
  }

  // (3) Checkpoint user.db BEFORE copying it (F5-FR8 / resolution #9) so
  //     the raw copy captures a WAL-consistent image. Only when user.db
  //     is in the set; best-effort (host adapter may no-op).
  if (dbs.some(db => db.filename === USER_DB_FILENAME)) {
    try {
      await ports.checkpointUserDb();
    } catch (e) {
      logger?.warn(
        `[export] user.db checkpoint threw: ${(e as Error).message} — copying as-is`,
      );
    }
  }

  // (4) Copy each DB; collect per-file outcome (F5-FR5). A false/throw is
  //     a failure for THAT file only — the others still copy (F5-AC4).
  const copied: string[] = [];
  const failed: {file: string; reason: string}[] = [];
  for (const db of dbs) {
    const dest = joinPath(targetDir, db.filename);
    try {
      const ok = await ports.copyFile(db.srcPath, dest);
      if (ok) {
        copied.push(db.filename);
      } else {
        failed.push({file: db.filename, reason: 'copy returned false'});
      }
    } catch (e) {
      failed.push({file: db.filename, reason: (e as Error).message});
    }
  }

  return {copied, failed, targetDir};
};

// --- folder chooser (F5-FR2) ----------------------------------------
//
// The SDK has NO folder picker (NativeFileSelector is file-oriented), so
// F5 builds a minimal in-panel chooser over the SAME type-tagged
// FileUtils.listFiles the discovery layer uses (resolution #4 / review
// fix 4) — NOT a separate NativeFileUtils string probe. listFolders
// returns the SUBDIRECTORY paths under `parent` (type===0); createFolder
// wraps makeDir.

// The folder root the chooser opens at: the MyStyle directory (the
// PARENT of DEFAULT_USER_DICT_ROOT). The host derives this from
// getExternalDirPath; we expose the discovery-layer default so the
// host has one fallback. e.g. '/storage/emulated/0/MyStyle'.
export const exportRootParent = (): string => {
  const root = DEFAULT_USER_DICT_ROOT;
  const slash = root.lastIndexOf('/');
  return slash > 0 ? root.slice(0, slash) : root;
};

// The default export target: MyStyle/SnDict (the discovery root).
export const DEFAULT_EXPORT_DIR = DEFAULT_USER_DICT_ROOT;

// Subdirectory paths under `parent`, in listing order. Reuses the
// discovery FileUtilsLike.listFiles (type-tagged FileEntry[]); keeps only
// type===0 entries (review fix 4). A null/undefined/throwing list yields
// [] (an unreadable folder is just an empty chooser, never a crash).
export const listFolders = async (
  fileUtils: FileUtilsLike,
  parent: string,
): Promise<string[]> => {
  let entries;
  try {
    entries = await fileUtils.listFiles(parent);
  } catch {
    return [];
  }
  if (!entries) {
    return [];
  }
  return entries.filter(e => e.type === 0).map(e => e.path);
};

// --- exportable-DB enumeration (F5-FR1) -----------------------------
//
// The set to copy: base.db (label "WordNet", if provisioned), user.db
// (label "User", if present), and each imported slug DB (label = source
// name) from the imports audit table. PURE — the caller (index.js)
// resolves absolute paths via `resolvePath(filename)` (= PLUGIN_LOCATION
// + filename, the same mapping the import/delete paths use) and supplies
// the audit rows + base/user presence flags. base.db/user.db keep their
// fixed filenames; imports carry `filename` from their audit row.
export type ExportableDbInputs = {
  // base.db is provisioned (always true in practice — base gates
  // bootstrap — but kept explicit so the enumeration is total).
  hasBase: boolean;
  // user.db opened (false on a degraded user.db — then it's not exported,
  // and nothing to checkpoint).
  hasUser: boolean;
  // imports audit rows (name + filename per imported slug).
  imports: ImportRow[];
  // filename -> absolute on-device path (PLUGIN_LOCATION + filename).
  resolvePath(filename: string): string;
};

export const BASE_DB_FILENAME = 'base.db';

export const buildExportableDbs = (
  inputs: ExportableDbInputs,
): ExportableDb[] => {
  const dbs: ExportableDb[] = [];
  if (inputs.hasBase) {
    dbs.push({
      label: 'WordNet',
      filename: BASE_DB_FILENAME,
      srcPath: inputs.resolvePath(BASE_DB_FILENAME),
    });
  }
  if (inputs.hasUser) {
    dbs.push({
      label: 'User',
      filename: USER_DB_FILENAME,
      srcPath: inputs.resolvePath(USER_DB_FILENAME),
    });
  }
  for (const row of inputs.imports) {
    dbs.push({
      label: row.name,
      filename: row.filename,
      srcPath: inputs.resolvePath(row.filename),
    });
  }
  return dbs;
};
