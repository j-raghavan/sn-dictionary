// DEVICE-UNVERIFIED. Wires ImportPorts to the on-device runtime:
// sn-plugin-lib NativeFileUtils for file existence / deletion / free
// space, react-native-sqlite-storage for the per-dict slug DB, and the
// project's existing byte/text readers (the fetch(file://...) path) for
// the StarDict triple + sidecar. Same posture as rnSqliteDb.ts /
// provisionRnPorts.ts — touches native modules unbound off the device,
// so excluded from the jest import graph and from coverage
// (jest.config.js). The pure pipeline it feeds (importStardict.ts) is
// host-tested with fakes; keep this THIN so the pipeline stays the
// faithful stand-in.

import type {SqliteDb} from './db';
import type {ImportPorts, SlugDbLifecycle, StardictSet} from './importStardict';

// Byte / text readers for the source files. M5 supplies the concrete
// fetch(file://...)-based implementations; injected here so this
// adapter stays free of the fetch plumbing.
type SourceReaders = {
  readBytes: (path: string) => Promise<Uint8Array>;
  readText: (path: string) => Promise<string>;
};

type FileUtils = {
  exists: (path: string) => Promise<boolean>;
  deleteFile: (path: string) => Promise<boolean>;
  getStorageAvailableSpace: () => Promise<number>;
};

export type RnImportConfig = {
  // Absolute paths of the source files (triple + optional .syn +
  // sidecar). Used for both reading and post-import deletion.
  ifoPath: string;
  idxPath: string;
  dictPath: string;
  synPath?: string;
  sidecarPath: string;
  fileUtils: FileUtils;
  readers: SourceReaders;
  // Slug-DB lifecycle keyed by FILENAME (e.g. 'wikdict-de.de.db'). The
  // runtime resolves these to openRnSqliteDb({name: filename, location:
  // 'plugins/<id>/'}) — the native side places the file under the host's
  // extracted plugin dir (getFilesDir()+location+name). No absolute
  // paths in JS.
  openSlugByName: (filename: string) => Promise<SqliteDb | null>;
  reopenSlugByName: (filename: string) => Promise<SqliteDb | null>;
  // Best-effort delete of a half-built slug DB (the runtime resolves the
  // filename to its on-disk location and deletes it).
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
    config.sidecarPath,
  ];

  const slugDb: SlugDbLifecycle = {
    async open(filename: string): Promise<SqliteDb> {
      const db = await config.openSlugByName(filename);
      if (db === null) {
        throw new Error(`[import] open slug db returned null: ${filename}`);
      }
      return db;
    },
    async reopenForVerify(filename: string): Promise<SqliteDb> {
      // Reopens the SAME {name, location} slug DB to read committed
      // state — verify reopens the actual DB just written.
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
    async readSet(): Promise<StardictSet> {
      const [ifo, idx, dict, sidecarText] = await Promise.all([
        config.readers.readBytes(config.ifoPath),
        config.readers.readBytes(config.idxPath),
        config.readers.readBytes(config.dictPath),
        config.readers.readText(config.sidecarPath),
      ]);
      const syn =
        config.synPath !== undefined
          ? await config.readers.readBytes(config.synPath)
          : undefined;
      return {ifo, idx, dict, syn, sidecarText};
    },
    async deleteFile(path: string): Promise<void> {
      await config.fileUtils.deleteFile(path);
    },
    sourcePaths,
    async getAvailableSpace(): Promise<number> {
      return config.fileUtils.getStorageAvailableSpace();
    },
    slugDb,
    audit: config.audit,
    now: config.now ?? (() => new Date().toISOString()),
  };
};
