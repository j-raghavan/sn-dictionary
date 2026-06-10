// Regression guard for the on-device SqliteDb transaction wrapper
// (rnSqliteDb.ts). On the Supernote's react-native-sqlite-storage build the
// native db.transaction(fn) RESOLVES WITHOUT PERSISTING — verified on-device:
// a "committed" dict_prefs transaction was invisible to a later read on the
// SAME connection, while single autocommit writes (addUserEntry's db.run) DO
// survive a reload. So the wrapper runs the async body one statement at a time
// against real AWAITED executeSql (the autocommit path that works), NOT a
// native transaction. These tests lock that against a fake RnDatabase (the
// real native module is lazy-required only in openRnSqliteDb, so importing
// `wrap` is jest-safe).

import {wrap} from '../src/core/dict/sqlite/rnSqliteDb';

// A fake react-native-sqlite-storage database. `executed` records every
// executeSql in order (the autocommit path — the whole point). The native
// db.transaction must NEVER be used (it doesn't persist on-device), so it
// throws loudly if the wrapper ever calls it again.
const fakeDb = (rows: Record<string, unknown>[] = []) => {
  const executed: string[] = [];
  return {
    executed,
    db: {
      executeSql: async (sql: string) => {
        executed.push(sql);
        return [{rows: {length: rows.length, raw: () => rows}, rowsAffected: 1}];
      },
      transaction: () => {
        throw new Error('native transaction() must not be used (it does not persist on-device)');
      },
      close: async () => undefined,
    },
  };
};

describe('rnSqliteDb wrap.transaction — sequential autocommit (device persistence)', () => {
  test('executes EVERY statement of an awaited loop, in order, via autocommit (no native tx)', async () => {
    const f = fakeDb();
    await wrap(f.db).transaction(async tx => {
      // The exact shape setDictPrefs / the import audit use — a DELETE+INSERT
      // per item. The native-transaction version committed without persisting;
      // here every statement is a real autocommit write.
      for (const key of ['k1', 'k2']) {
        await tx.run('DELETE FROM dict_prefs WHERE pref_key = ?', [key]);
        await tx.run('INSERT INTO dict_prefs VALUES (?)', [key]);
      }
    });
    expect(f.executed).toEqual([
      'DELETE FROM dict_prefs WHERE pref_key = ?',
      'INSERT INTO dict_prefs VALUES (?)',
      'DELETE FROM dict_prefs WHERE pref_key = ?',
      'INSERT INTO dict_prefs VALUES (?)',
      // Durability: the batch is checkpointed into the main DB file ONCE, after
      // the body resolves, so a plugin reload can't drop the un-merged WAL.
      'PRAGMA wal_checkpoint(TRUNCATE)',
    ]);
  });

  test('a tx run reports the real rowsAffected from the autocommit write', async () => {
    const f = fakeDb();
    let changes = -1;
    await wrap(f.db).transaction(async tx => {
      ({changes} = await tx.run('INSERT INTO t VALUES (1)'));
    });
    expect(changes).toBe(1);
  });

  test('a read inside the transaction works (committed-state autocommit path)', async () => {
    const f = fakeDb([{pref_key: 'k1', enabled: 0}]);
    let got: unknown;
    await wrap(f.db).transaction(async tx => {
      got = await tx.query('SELECT * FROM dict_prefs');
    });
    expect(got).toEqual([{pref_key: 'k1', enabled: 0}]);
  });

  test('a body error propagates; writes before it already committed (autocommit, not atomic)', async () => {
    const f = fakeDb();
    const boom = new Error('insert failed');
    await expect(
      wrap(f.db).transaction(async tx => {
        await tx.run('INSERT INTO t VALUES (1)');
        throw boom;
      }),
    ).rejects.toBe(boom);
    // The first write already executed (autocommit) — atomicity is the
    // deliberate trade for durability on this device. A thrown body short-
    // circuits BEFORE the end-of-transaction checkpoint, so no PRAGMA fires.
    expect(f.executed).toEqual(['INSERT INTO t VALUES (1)']);
  });

  test('a nested transaction runs against the same connection', async () => {
    const f = fakeDb();
    await wrap(f.db).transaction(async tx => {
      await tx.run('A');
      await tx.transaction(async inner => {
        await inner.run('B');
      });
    });
    // The nested tx shares the connection and does NOT checkpoint on its own;
    // the single end-of-transaction checkpoint at the OUTER boundary covers the
    // whole batch.
    expect(f.executed).toEqual(['A', 'B', 'PRAGMA wal_checkpoint(TRUNCATE)']);
  });

  test('a single autocommit run() checkpoints the WAL so it survives a reload', async () => {
    const f = fakeDb();
    await wrap(f.db).run('INSERT INTO entries VALUES (?)', ['hi']);
    expect(f.executed).toEqual([
      'INSERT INTO entries VALUES (?)',
      'PRAGMA wal_checkpoint(TRUNCATE)',
    ]);
  });

  test('a read does NOT checkpoint (no commit to make durable)', async () => {
    const f = fakeDb([{word: 'hi'}]);
    await wrap(f.db).query('SELECT * FROM entries');
    expect(f.executed).toEqual(['SELECT * FROM entries']);
  });
});
