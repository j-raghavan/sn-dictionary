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

// Reject if a native call never settles. A wedged executeSql (observed
// on a bad/locked DB) otherwise hangs forever, which left the handlers'
// reentrancy guard held -> the "pipeline already running" hang. A
// timeout turns that into a rejection so the handler's finally releases
// the guard and the user can retry.
const QUERY_TIMEOUT_MS = 10000;

const withTimeout = <T>(p: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[sqlite] ${label} timed out after ${QUERY_TIMEOUT_MS}ms`)),
      QUERY_TIMEOUT_MS,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
};

// Force a commit to be DURABLE on disk immediately. The plugin's user.db is
// WAL-mode, and a plugin reload (onHostResume recreates the JS context) opens
// a FRESH user.db BEFORE the un-checkpointed WAL is merged into the main file —
// so "committed" settings/audit writes vanished on reopen (verified on-device:
// `save committed` then a reload read all defaults back). TRUNCATE merges the
// WAL into the main DB file (and zeroes the WAL) so the next open sees them.
// Best-effort: a checkpoint failure must NOT fail the write (and it's a no-op
// when the DB isn't in WAL mode).
const checkpoint = async (db: RnDatabase): Promise<void> => {
  try {
    await withTimeout(
      db.executeSql('PRAGMA wal_checkpoint(TRUNCATE)', []),
      'checkpoint',
    );
  } catch {
    // Durability hardening only — never surface a checkpoint error.
  }
};

// Exported for the transaction-sequencing regression test (the native
// module is lazy-required in loadStorage, so wrap itself is jest-safe).
export const wrap = (db: RnDatabase): SqliteDb => ({
  async query<T = Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = [],
  ): Promise<T[]> {
    const [result] = await withTimeout(db.executeSql(sql, params), 'query');
    return result.rows.raw() as T[];
  },
  async run(sql: string, params: SqlParam[] = []): Promise<{changes: number}> {
    const [result] = await withTimeout(db.executeSql(sql, params), 'run');
    // Single-statement writes (addUserEntry, removeImport, …) must survive a
    // plugin reload too — checkpoint the WAL to the main file.
    await checkpoint(db);
    return {changes: result.rowsAffected};
  },
  async transaction(fn: (tx: SqliteDb) => Promise<void>): Promise<void> {
    // react-native-sqlite-storage's native transaction(fn) only captures
    // executeSql calls issued SYNCHRONOUSLY inside fn and commits when the
    // (synchronous) callback returns. Our bodies are ASYNC (awaited loops),
    // so the OLD code's fn returned a pending promise at the FIRST `await` —
    // the native transaction committed with only the statement queued before
    // it, dropping every write after an `await`. That persisted only the
    // DELETE of each settings DELETE+INSERT pair (dict prefs / keep-sources
    // reverting on reopen) and dropped every audit/CSV row past the first.
    //
    // The native transaction itself DOES commit (the old code's first
    // statement always landed). So keep using it — but first RUN the async
    // body against a recorder that just COLLECTS each statement (its run()
    // resolves immediately, so the awaited loop completes and we capture
    // EVERY statement, in order), THEN replay them SYNCHRONOUSLY inside the
    // native transaction so it commits all of them atomically. No raw
    // BEGIN/COMMIT (Android's pooled SQLiteDatabase can mishandle those).
    // A body error aborts BEFORE any replay — nothing is committed.
    const statements: Array<[string, SqlParam[]]> = [];
    const recorder: SqliteDb = {
      async query<T = Record<string, unknown>>(): Promise<T[]> {
        // Transaction bodies are WRITE-ONLY (every caller verified). Because
        // statements are collected and only replayed AFTER the body returns, a
        // mid-tx read could not see the pending writes — it would read stale
        // committed state and silently drive a wrong write. Make that invariant
        // an assertion: fail loud the instant a future read-then-write body is
        // added, rather than papering over it.
        throw new Error(
          '[sqlite] reads inside a transaction are not supported ' +
            '(collect-then-replay is write-only)',
        );
      },
      async run(sql: string, params: SqlParam[] = []) {
        statements.push([sql, params]);
        return {changes: 0};
      },
      transaction: async inner => inner(recorder),
      close: async () => undefined,
    };
    await fn(recorder); // collect every statement (the async body fully resolves)
    await db.transaction(tx => {
      for (const [sql, params] of statements) {
        tx.executeSql(sql, params);
      }
    });
    // Make the committed batch durable before a reload can drop the WAL.
    await checkpoint(db);
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
