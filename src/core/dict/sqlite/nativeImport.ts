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
