// DEVICE-UNVERIFIED. Bridge to the native StarDict importer
// (SnDictImportModule.kt, ADR-0006). The entire parse+insert runs in
// Kotlin off the Hermes thread; JS only orchestrates verify-then-delete
// + audit (importStardict.ts). Coverage-excluded like rnSqliteDb.ts —
// it touches NativeModules which aren't bound off the device; the
// importStardict orchestration it feeds is host-tested with a fake.

export type NativeImportParams = {
  ifoPath: string;
  idxPath: string;
  dictPath: string;
  synPath?: string;
  dbPath: string;
  format?: string;
};

// Resolves the inserted entry count from the native side.
export type RunNativeImport = (
  p: NativeImportParams,
) => Promise<{entryCount: number}>;

// Real implementation over the native module. Lazily require react-native
// so importing this module off-device (e.g. a stray import) doesn't blow
// up before the native module is bound.
export const runNativeImport: RunNativeImport = async params => {
  const {NativeModules} = require('react-native');
  const mod = NativeModules.SnDictImport;
  if (mod === undefined || typeof mod.importStardict !== 'function') {
    throw new Error('[import] native SnDictImport module is unavailable');
  }
  const entryCount: number = await mod.importStardict(
    params.ifoPath,
    params.idxPath,
    params.dictPath,
    params.synPath ?? null,
    params.dbPath,
    params.format ?? null,
  );
  return {entryCount};
};

// File size in bytes (for the import space guard). Resolves 0 when the
// file is missing — the guard then estimates from 0 (a no-op pass).
export const getFileSize = async (path: string): Promise<number> => {
  const {NativeModules} = require('react-native');
  const mod = NativeModules.SnDictImport;
  if (mod === undefined || typeof mod.fileSize !== 'function') {
    throw new Error('[import] native SnDictImport module is unavailable');
  }
  return mod.fileSize(path);
};

// Copy a plugin DB across the filesDir<->external boundary in EITHER
// direction — the native copyResolved resolves BOTH ends (absolute as-is;
// relative under filesDir). The F5 export passes src=relative/dest=absolute;
// the F8 restore passes src=absolute(backup)/dest=relative(live). Uses our
// native byte-copy, NOT FileUtils.copyFile (a rename that can't cross the
// boundary). The (src, dest) contract is unchanged — only the resolution
// of `dest` is now symmetric with `src`.
export const copyPluginFile = async (
  srcPath: string,
  destPath: string,
): Promise<boolean> => {
  const {NativeModules} = require('react-native');
  const mod = NativeModules.SnDictImport;
  if (mod === undefined || typeof mod.copyResolved !== 'function') {
    throw new Error('[copy] native SnDictImport.copyResolved is unavailable');
  }
  return mod.copyResolved(srcPath, destPath);
};

// Delete a plugin file (relative path resolved under filesDir, e.g. a slug
// DB) — F7 delete. FileUtils.deleteFile can't reach the relative path.
export const deletePluginFile = async (path: string): Promise<boolean> => {
  const {NativeModules} = require('react-native');
  const mod = NativeModules.SnDictImport;
  if (mod === undefined || typeof mod.deleteResolved !== 'function') {
    throw new Error('[delete] native SnDictImport.deleteResolved is unavailable');
  }
  return mod.deleteResolved(path);
};
