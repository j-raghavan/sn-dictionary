// DEVICE-UNVERIFIED. Wires the CSV produce-step (produceCsvSlugDb) into
// the format-agnostic runImport spine for the on-device runtime. The CSV
// parse+insert runs in JS (the file is <=10 MB), unlike StarDict's native
// importer — so this adapter supplies a fetch-backed loadBytes + a
// writable rn-sqlite slug handle, and the produce-step does the rest.
// Same posture as importRnPorts.ts: touches native modules unbound off
// the device, so coverage-excluded (jest.config.js). The pure pipeline
// (importCsvRows.ts + runImport.ts) is host-tested; keep this THIN.

import type {CsvColumnConfig} from './importSidecar';
import type {RunImportPorts, SlugDbLifecycle} from './runImport';
import {produceCsvSlugDb} from './importCsvRows';
import type {SqliteDb} from './db';

type FileUtils = {
  deleteFile: (path: string) => Promise<boolean>;
};

export type RnCsvImportConfig = {
  // The .csv file path (fetched for bytes + deleted post-import).
  csvPath: string;
  // Optional per-file or shared sidecar path — deleted with the CSV.
  sidecarPath?: string;
  // The resolved sidecar text (meta.json contents, or the serialized
  // discovery default for a no-meta CSV). runImport validates it.
  sidecarText: string;
  // The resolved CSV column config (from the descriptor).
  csvConfig: CsvColumnConfig;
  fileUtils: FileUtils;
  // Fetch the CSV bytes (file:// via the runtime fetch).
  loadBytes: () => Promise<ArrayBuffer | null>;
  // Resolve a slug filename to the absolute DB path under the plugin dir.
  resolveSlugDbPath: (filename: string) => string;
  // Open a WRITABLE rn-sqlite handle at the resolved slug path.
  openWritableSlug: (filename: string) => Promise<SqliteDb>;
  // Reopen the committed slug DB by FILENAME (the verify handle).
  reopenSlugByName: (filename: string) => Promise<SqliteDb | null>;
  // Best-effort delete of a half-built slug DB.
  discardSlugByName: (filename: string) => Promise<void>;
  // The writable user.db handle the audit row goes into.
  audit: SqliteDb;
  // Timestamp source (default: ISO now).
  now?: () => string;
};

export const createRnCsvImportPorts = (
  config: RnCsvImportConfig,
): RunImportPorts => {
  const sourcePaths = [
    config.csvPath,
    ...(config.sidecarPath !== undefined ? [config.sidecarPath] : []),
  ];

  const slugDb: SlugDbLifecycle = {
    async reopenForVerify(filename: string): Promise<SqliteDb> {
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
    sidecarText: config.sidecarText,
    // The CSV produce-step: parse the fetched bytes + insert into a fresh
    // writable slug handle, resolving the committed count. No space guard
    // (a CSV is capped at 10 MB inside the produce-step).
    produceSlugDb: filename =>
      produceCsvSlugDb(
        {
          loadBytes: config.loadBytes,
          openWritableSlug: config.openWritableSlug,
        },
        config.csvConfig,
        filename,
      ),
    async deleteFile(path: string): Promise<void> {
      await config.fileUtils.deleteFile(path);
    },
    sourcePaths,
    slugDb,
    audit: config.audit,
    now: config.now ?? (() => new Date().toISOString()),
  };
};
