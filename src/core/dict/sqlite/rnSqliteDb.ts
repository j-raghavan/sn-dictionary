// DEVICE-UNVERIFIED. On-device SqliteDb adapter over
// `react-native-sqlite-storage`. This module imports a native module
// that is only bound inside the Supernote plugin host (the same
// situation documented for AsyncStorage in indexCacheStorage.ts and
// for the firmware quirks in src/sdk/*.ts): it cannot run under jest,
// so it is excluded from the jest import graph and from coverage
// (see jest.config.js coveragePathIgnorePatterns). Its behaviour is
// mirrored by the host better-sqlite3 adapter that the sqlite test
// suites exercise against the same SqliteDb port — keep this adapter
// THIN so the host adapter remains a faithful stand-in.
//
// Shape mirrors the sticker demo's promise-wrapped `src/db/index.js`:
// `openDatabase` -> `transaction` -> `executeSql` -> `rows.raw()`.
// react-native-sqlite-storage's callback API is wrapped into the
// promise-based SqliteDb port. Parameterized only — every value is
// bound through a `?` placeholder; there is no raw-exec path.

import type {OpenSqliteDb, SqlParam, SqliteDb} from './db';

// Minimal structural typings for the slice of
// react-native-sqlite-storage we use, so this file type-checks
// without depending on @types for the native package.
type RnResultSet = {
  rows: {
    length: number;
    raw: () => Record<string, unknown>[];
  };
  rowsAffected: number;
};

type RnDatabase = {
  executeSql: (sql: string, params?: SqlParam[]) => Promise<RnResultSet[]>;
  transaction: (fn: (tx: RnTransaction) => void) => Promise<void>;
  close: () => Promise<void>;
};

type RnTransaction = {
  executeSql: (sql: string, params?: SqlParam[]) => void;
};

type RnSqliteStorage = {
  enablePromise: (enable: boolean) => void;
  openDatabase: (config: {
    name: string;
    location?: string;
  }) => Promise<RnDatabase>;
};

const wrap = (db: RnDatabase): SqliteDb => ({
  async query<T = Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = [],
  ): Promise<T[]> {
    const [result] = await db.executeSql(sql, params);
    return result.rows.raw() as T[];
  },
  async run(sql: string, params: SqlParam[] = []): Promise<{changes: number}> {
    const [result] = await db.executeSql(sql, params);
    return {changes: result.rowsAffected};
  },
  async transaction(fn: (tx: SqliteDb) => Promise<void>): Promise<void> {
    // react-native-sqlite-storage's transaction body is synchronous —
    // it queues executeSql calls and commits when the body returns.
    // We adapt the async port `fn` by running it against a SqliteDb
    // that delegates each query/run to the queued tx.executeSql, and
    // awaiting it before the native transaction resolves.
    // Capture any error thrown by the async body and RETHROW it after
    // the native transaction settles. Swallowing it (the prior
    // `.catch(() => undefined)`) would resolve a failed transaction as a
    // success and hide a rollback — the importer would then proceed as
    // though the populate committed. The native callback is synchronous,
    // so the queued body runs concurrently; we surface its failure here.
    let bodyErr: unknown;
    await db.transaction(tx => {
      const txDb: SqliteDb = {
        async query<T = Record<string, unknown>>(
          sql: string,
          params: SqlParam[] = [],
        ): Promise<T[]> {
          // Reads inside an RN transaction are rare for the import
          // pipeline (writes only); delegate to a fresh executeSql so
          // the port stays complete.
          const [result] = await db.executeSql(sql, params);
          return result.rows.raw() as T[];
        },
        async run(sql: string, params: SqlParam[] = []) {
          tx.executeSql(sql, params);
          return {changes: 0};
        },
        transaction: async inner => inner(txDb),
        close: async () => undefined,
      };
      fn(txDb).catch(e => {
        bodyErr = e;
      });
    });
    if (bodyErr) {
      throw bodyErr;
    }
  },
  async close(): Promise<void> {
    await db.close();
  },
});

// Lazily require the native package so merely importing this module
// (e.g. by the runtime wiring in index.js) doesn't blow up if the
// dep is somehow absent — same defensive posture as
// indexCacheStorage's tryLoadAsyncStorage.
const loadStorage = (): RnSqliteStorage => {
  const mod = require('react-native-sqlite-storage');
  return (mod?.default ?? mod) as RnSqliteStorage;
};

// Open a DB by {name, location} — the proven sticker-demo pattern
// (src/db/index.js: openDatabase({name, location: 'plugins/<id>/'})).
// The native side resolves the file as getFilesDir() + location + name
// (SQLitePlugin.java:392-395), i.e. the plugin host's extracted
// plugins/<pluginID>/ directory. There is deliberately NO
// createFromLocation / createFromAsset: the .snplg ships base.db and
// the host extracts it into place, so no asset copy is needed (the
// spike proved createFromLocation can't read app.npk assets in a
// dynamically-loaded plugin). openDatabase REJECTS via the promise on
// the native error callback — we do NOT swallow it into an empty DB
// (that empty-DB fall-through is exactly what masked the failure).
export const openRnSqliteDb = (config: {
  name: string;
  location: string;
}): OpenSqliteDb => {
  return async (): Promise<SqliteDb | null> => {
    const storage = loadStorage();
    storage.enablePromise(true);
    const db = await storage.openDatabase({
      name: config.name,
      location: config.location,
    });
    return wrap(db);
  };
};
