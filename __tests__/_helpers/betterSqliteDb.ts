// Host SqliteDb adapter over better-sqlite3, for unit / integration
// tests and (later) build-time base.db generation. Lives under
// __tests__/_helpers/ which jest excludes from coverage — this is a
// test driver, not shipped code.
//
// better-sqlite3 is synchronous; we wrap each call in a resolved
// Promise so it satisfies the async SqliteDb port. Transactions use
// explicit BEGIN/COMMIT/ROLLBACK rather than better-sqlite3's native
// db.transaction(), because the port's `fn` is async (the import
// pipeline yields between batches) and the native helper only wraps
// synchronous bodies.

import Database from 'better-sqlite3';
import type {OpenSqliteDb, SqlParam, SqliteDb} from '../../src/core/dict/sqlite/db';

type RawDb = Database.Database;

const wrap = (db: RawDb): SqliteDb => ({
  async query<T = Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = [],
  ): Promise<T[]> {
    return db.prepare(sql).all(...params) as T[];
  },
  async run(sql: string, params: SqlParam[] = []): Promise<{changes: number}> {
    const info = db.prepare(sql).run(...params);
    return {changes: Number(info.changes)};
  },
  async transaction(fn: (tx: SqliteDb) => Promise<void>): Promise<void> {
    // DEVICE-FAITHFUL: react-native-sqlite-storage autocommits every statement
    // independently on its single connection — no multi-statement BEGIN/COMMIT
    // survives across awaits. So this fake runs the body sequentially with NO
    // BEGIN/COMMIT/ROLLBACK: statements commit as they execute, and a
    // mid-transaction failure does NOT roll back earlier ones. Code that needs
    // atomicity must achieve it in a SINGLE statement (e.g. upsertImport's
    // INSERT OR REPLACE), never by relying on transactional rollback.
    await fn(wrap(db));
  },
  async close(): Promise<void> {
    db.close();
  },
});

// Open a better-sqlite3 handle. Pass ':memory:' for an ephemeral DB
// or a filesystem path. Returns null when `path` is null so tests can
// exercise the 'absent' branch of the lazy harness through the real
// OpenSqliteDb signature.
export const openBetterSqliteDb = (path: string | null): OpenSqliteDb => {
  return async (): Promise<SqliteDb | null> => {
    if (path === null) {
      return null;
    }
    return wrap(new Database(path));
  };
};

// Build an in-memory DB pre-seeded by `seed`, returned as an open
// SqliteDb handle. Convenience for tests that want a populated DB
// without going through the open factory twice.
export const createSeededDb = async (
  seed: (db: SqliteDb) => Promise<void>,
): Promise<SqliteDb> => {
  const db = wrap(new Database(':memory:'));
  await seed(db);
  return db;
};
