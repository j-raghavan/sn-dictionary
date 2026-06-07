// DEVICE-UNVERIFIED. Wires ProvisionPorts to the on-device runtime:
// react-native-sqlite-storage's createFromLocation copy of the bundled
// base.db asset + sn-plugin-lib NativeFileUtils for the existence
// check. Same posture as rnSqliteDb.ts — it touches native modules
// that aren't bound off the device, so it is excluded from the jest
// import graph and from coverage (jest.config.js). The pure decision
// logic it feeds (provision.ts) is host-tested with fakes. Keep this
// THIN so provision.ts stays the faithful stand-in.
//
// getAvailableSpace is intentionally omitted: NativeFileUtils exposes
// no free-space probe, so the space guard simply doesn't run on-device
// (Designer flag 1 — the guard is a no-op when the probe is absent).
// If the SDK gains a free-space call later, wire it here only.

import type {OpenSqliteDb, SqliteDb} from './db';
import type {ProvisionPorts} from './provision';

type FileExists = {exists: (path: string) => Promise<boolean>};

export type RnProvisionConfig = {
  // Absolute path to the provisioned DB inside the plugin sandbox.
  dbPath: string;
  // Existence probe (sn-plugin-lib NativeFileUtils).
  fileUtils: FileExists;
  // Opens the DB at dbPath WITHOUT copying (already provisioned).
  openExisting: OpenSqliteDb;
  // Opens the DB triggering createFromLocation from the bundled asset
  // (the one-time first-run copy; near-instant for already-present DBs
  // is handled by openExisting, not here).
  openFromAsset: () => Promise<SqliteDb>;
};

export const createRnProvisionPorts = (
  config: RnProvisionConfig,
): ProvisionPorts => ({
  async exists(): Promise<boolean> {
    return config.fileUtils.exists(config.dbPath);
  },
  async copyFromAssetAndOpen(): Promise<SqliteDb> {
    return config.openFromAsset();
  },
  async open(): Promise<SqliteDb> {
    const db = await config.openExisting();
    if (db === null) {
      // openExisting resolving null means the file vanished between the
      // exists() check and the open — surface as a throw so provisioning
      // rejects rather than handing back a null handle.
      throw new Error('[provision] existing DB open returned null');
    }
    return db;
  },
});
