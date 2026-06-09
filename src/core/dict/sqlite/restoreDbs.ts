// DB restore orchestration (F8) — the inverse of the F5 export. Copy the
// DBs from a user-chosen backup folder BACK over the live ones in the
// plugin's private filesDir, so a user can recover their saved words +
// settings + imported dictionaries from an exported backup. HOST-TESTABLE:
// every device touchpoint is an injected port (RestorePorts); the real
// NativeFileUtils + native-copy wiring lives in index.js (DEVICE-UNVERIFIED,
// coverage-excluded). This module owns the SAFETY RAILS — base.db is NEVER
// restored (schema-mismatch risk; it ships in the .snplg), the writable live
// handles are CLOSED before any overwrite (overwriting an open SQLite file
// corrupts its in-memory view), and per-file partial failures are reported —
// so they are exercised off-device.
//
// Apply model (owner decision): close the writable handles, copy the backup
// DBs over the live ones, then the UI prompts "reopen the plugin to finish".
// There is NO auto re-bootstrap here — the JS context re-bootstraps on the
// next note-open and opens the restored DBs.

import type {RestoreSummary} from './settings';
import {BASE_DB_FILENAME, joinPath} from './exportDbs';

// One DB to restore: the backup basename, which is also the live filename it
// overwrites (the backup keeps the exact on-disk names the export wrote).
export type RestorableDb = {
  filename: string;
};

// The device seam the restore drives. All async. `listBackup` returns the
// `.db` basenames found in the backup folder; `copyInto(absSrc, relDest)`
// copies a backup DB (absolute external path) over the live one (relative
// PLUGIN_LOCATION path) via the both-resolving native copy — true on
// success, false/throw is a per-file failure; `resolveLivePath(filename)`
// maps a backup basename to its relative live PLUGIN_LOCATION path;
// `closeWritable()` closes the writable live handles BEFORE any overwrite.
export type RestorePorts = {
  listBackup(dir: string): Promise<string[]>;
  copyInto(absSrc: string, relDest: string): Promise<boolean>;
  resolveLivePath(filename: string): string;
  closeWritable(): Promise<void>;
  // Pre-restore safety snapshot: copy the CURRENT live DBs out to a recovery
  // folder so a bad restore is undoable. Runs while the handles are still
  // open (reads the live files; the host checkpoints user.db first). A throw
  // ABORTS the restore (never overwrite without a net) — nothing is closed or
  // copied and the live DBs are left untouched.
  snapshot(): Promise<void>;
};

export type RestoreReasons = {
  // Shown (as the summary) when the chosen folder holds no restorable DBs.
  noBackup: string;
  // Shown when the pre-restore safety snapshot failed and the restore was
  // aborted (nothing changed).
  snapshotFailed: string;
};

export type RestoreLogger = {warn: (msg: string) => void; log?: (msg: string) => void};

// PURE (F8). From the `.db` basenames found in the backup folder, the set to
// restore: user.db (if present) + every OTHER `*.db` EXCEPT base.db (the
// imported slugs). base.db is NEVER restorable — it ships in the .snplg and a
// backup's base.db could be a different schema version; restoring it risks a
// schema mismatch. A non-`.db` name is ignored (defensive — listBackup should
// already filter, but the build helper is the single source of truth).
export const buildRestorableDbs = (
  backupFilenames: string[],
): RestorableDb[] => {
  const dbs: RestorableDb[] = [];
  for (const filename of backupFilenames) {
    // Keep only `.db` files, and NEVER base.db (schema-mismatch risk). The
    // result preserves listing order — purely cosmetic for the summary;
    // correctness doesn't depend on it.
    if (filename.endsWith('.db') && filename !== BASE_DB_FILENAME) {
      dbs.push({filename});
    }
  }
  return dbs;
};

// Restore all restorable DBs from `backupDir` over the live ones. The
// orchestration, in order:
//   (1) LIST the backup folder's `.db` files, then build the restorable set
//       (user.db + slugs, NEVER base.db). When EMPTY, return a no-op summary
//       carrying the no-backup reason — NOTHING is closed or copied.
//   (2) SNAPSHOT the current live DBs to a recovery folder. If it fails, ABORT
//       (nothing closed or copied) — never overwrite without a safety net.
//   (3) CLOSE the writable live handles (user.db + imported slugs) so the copy
//       isn't overwriting open SQLite files (close-before-copy).
//   (4) COPY each restorable from <backupDir>/<filename> over its live path;
//       collect per-file success/failure (partial failures reported, not
//       dropped). A false/throw is a failure for THAT file only.
// Returns the summary the UI renders. NEVER copies base.db (the build helper
// excludes it). The snapshot + closeWritable each run exactly once, BEFORE
// any copyInto.
export const restoreDbs = async (
  backupDir: string,
  ports: RestorePorts,
  reasons: RestoreReasons,
  logger?: RestoreLogger,
): Promise<RestoreSummary> => {
  // (1) List the backup folder + build the restorable set. A throwing/empty
  //     listing yields an empty set -> the no-backup no-op (nothing to do).
  let backupFilenames: string[] = [];
  try {
    backupFilenames = await ports.listBackup(backupDir);
  } catch (e) {
    logger?.warn(
      `[restore] listBackup "${backupDir}" threw: ${(e as Error).message} — nothing to restore`,
    );
  }
  const restorable = buildRestorableDbs(backupFilenames);
  if (restorable.length === 0) {
    logger?.warn(
      `[restore] no restorable DBs in "${backupDir}" — nothing closed or copied`,
    );
    return {restored: [], failed: [{file: backupDir, reason: reasons.noBackup}], backupDir};
  }

  // (2) PRE-RESTORE SAFETY SNAPSHOT — copy the CURRENT live DBs out to a
  //     recovery folder BEFORE overwriting them, so a bad restore is undoable
  //     (the user can restore FROM that folder to revert). Runs while the
  //     handles are still open. If it FAILS we ABORT — never overwrite without
  //     a safety net — leaving the live DBs untouched (nothing closed/copied).
  try {
    await ports.snapshot();
  } catch (e) {
    logger?.warn(
      `[restore] pre-restore snapshot failed: ${(e as Error).message} — aborting (nothing changed)`,
    );
    return {
      restored: [],
      failed: [{file: '(safety backup)', reason: reasons.snapshotFailed}],
      backupDir,
    };
  }

  // (3) CLOSE the writable handles BEFORE any copy (overwriting an open
  //     SQLite file corrupts its in-memory view). Best-effort: a throw here
  //     is logged but the copies still proceed (the user reopens the plugin,
  //     which reopens everything over the restored files).
  try {
    await ports.closeWritable();
  } catch (e) {
    logger?.warn(
      `[restore] closeWritable threw: ${(e as Error).message} — proceeding with copy`,
    );
  }

  // (4) Copy each restorable over its live path; collect per-file outcome.
  const restored: string[] = [];
  const failed: {file: string; reason: string}[] = [];
  for (const db of restorable) {
    const src = joinPath(backupDir, db.filename);
    const dest = ports.resolveLivePath(db.filename);
    try {
      const ok = await ports.copyInto(src, dest);
      if (ok) {
        restored.push(db.filename);
      } else {
        failed.push({file: db.filename, reason: 'copy returned false'});
      }
    } catch (e) {
      failed.push({file: db.filename, reason: (e as Error).message});
    }
  }

  return {restored, failed, backupDir};
};
