// DEVICE-UNVERIFIED. Wires ImportPorts to the on-device runtime
// (ADR-0006: native parse+insert). sn-plugin-lib NativeFileUtils for
// deletion / free space; react-native-sqlite-storage for the verify
// reopen; the native SnDictImport module does the parse+insert (no JS
// byte reads). Same posture as rnSqliteDb.ts / provisionRnPorts.ts —
// touches native modules unbound off the device, so coverage-excluded
// (jest.config.js). The pure pipeline it feeds (importStardict.ts) is
// host-tested with a fake runNativeImport; keep this THIN.

import type {SqliteDb} from './db';
import type {ImportPorts, SlugDbLifecycle} from './importStardict';
import type {RunNativeImport} from './nativeImport';

type FileUtils = {
  deleteFile: (path: string) => Promise<boolean>;
  getStorageAvailableSpace: () => Promise<number>;
  // Remove a directory (best-effort empty-folder cleanup, M17-FR3).
  deleteDir: (path: string) => Promise<boolean>;
};

export type RnImportConfig = {
  // Source-file paths handed straight to the native importer (no JS byte
  // read) and used for post-import deletion.
  ifoPath: string;
  idxPath: string;
  dictPath: string;
  synPath?: string;
  // The StarDict subfolder (descriptor.setPath) — removed best-effort
  // after the files are deleted, so an empty dir isn't left behind.
  setPath: string;
  // Absent when the folder ships no meta.json — then no sidecar file is
  // deleted (sidecarText is the discovery default, synthesized below).
  sidecarPath?: string;
  // The resolved sidecar text (meta.json contents, or the serialized
  // discovery default for a no-meta dict).
  sidecarText: string;
  // Real .dict file size in bytes (native stat), for the space-guard
  // estimate. Async so the size is never a hardcoded 0.
  statDictSize: () => Promise<number>;
  fileUtils: FileUtils;
  // Run the native StarDict import into an absolute dbPath.
  runNativeImport: RunNativeImport;
  // Resolve a slug filename to the absolute DB path the native side
  // writes (under the plugin's extracted dir).
  resolveSlugDbPath: (filename: string) => string;
  // Reopen the committed slug DB by FILENAME (the verify handle).
  reopenSlugByName: (filename: string) => Promise<SqliteDb | null>;
  // Best-effort delete of a half-built slug DB.
  discardSlugByName: (filename: string) => Promise<void>;
  // The writable user.db handle the audit row goes into.
  audit: SqliteDb;
  // Timestamp source (default: ISO now).
  now?: () => string;
};

export const createRnImportPorts = (config: RnImportConfig): ImportPorts => {
  const sourcePaths = [
    config.ifoPath,
    config.idxPath,
    config.dictPath,
    ...(config.synPath !== undefined ? [config.synPath] : []),
    // Only delete the sidecar file if there actually is one.
    ...(config.sidecarPath !== undefined ? [config.sidecarPath] : []),
  ];

  const slugDb: SlugDbLifecycle = {
    async reopenForVerify(filename: string): Promise<SqliteDb> {
      // Reopens the committed slug DB the native import just wrote.
      const db = await config.reopenSlugByName(filename);
      if (db === null) {
        throw new Error(`[import] reopen for verify returned null: ${filename}`);
      }
      return db;
    },
    async discard(filename: string): Promise<void> {
      await config.discardSlugByName(filename);
    },
  };

  return {
    runNativeImport: config.runNativeImport,
    resolveSlugDbPath: config.resolveSlugDbPath,
    sidecarText: config.sidecarText,
    ifoPath: config.ifoPath,
    idxPath: config.idxPath,
    dictPath: config.dictPath,
    synPath: config.synPath,
    statDictSize: config.statDictSize,
    async deleteFile(path: string): Promise<void> {
      await config.fileUtils.deleteFile(path);
    },
    sourcePaths,
    // The now-empty StarDict subfolder is removed best-effort after the
    // files; runImport isolates any failure (FR3).
    sourceFolder: config.setPath,
    deleteFolder: (path: string): Promise<boolean> =>
      config.fileUtils.deleteDir(path),
    async getAvailableSpace(): Promise<number> {
      return config.fileUtils.getStorageAvailableSpace();
    },
    slugDb,
    audit: config.audit,
    now: config.now ?? (() => new Date().toISOString()),
  };
};
