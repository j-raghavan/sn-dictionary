// Regression guard for the on-device SqliteDb transaction wrapper
// (rnSqliteDb.ts). react-native-sqlite-storage's native transaction(fn)
// only captures executeSql calls issued SYNCHRONOUSLY in fn and commits
// when the (sync) callback returns — so an ASYNC body (awaited loop) had
// every statement after the first `await` silently dropped. That persisted
// only the DELETE of each settings DELETE+INSERT pair (the disabled-dict /
// keep-sources revert the user hit on-device) and dropped audit/CSV rows
// past the first. The fix RUNS the async body first against a recorder that
// collects every statement, then replays them SYNCHRONOUSLY inside the
// native transaction (which is proven to commit) — NOT raw BEGIN/COMMIT,
// which Android's pooled SQLiteDatabase can mishandle. These tests lock that
// against a fake RnDatabase (the real native module is lazy-required only in
// openRnSqliteDb, so importing `wrap` is jest-safe).

import {wrap} from '../src/core/dict/sqlite/rnSqliteDb';

// A fake react-native-sqlite-storage database. `replayed` records statements
// run inside the native transaction (the whole point — order + completeness);
// `direct` records standalone executeSql (reads / NOT transaction control).
const fakeDb = () => {
  const replayed: string[] = [];
  const direct: string[] = [];
  let nativeTxCount = 0;
  const tx = {
    executeSql: (sql: string) => {
      replayed.push(sql);
    },
  };
  return {
    replayed,
    direct,
    nativeTxCount: () => nativeTxCount,
    db: {
      executeSql: async (sql: string) => {
        direct.push(sql);
        return [{rows: {length: 0, raw: () => []}, rowsAffected: 1}];
      },
      transaction: async (fn: (t: typeof tx) => void) => {
        nativeTxCount += 1;
        fn(tx); // synchronous body — exactly what the lib commits on return
      },
      close: async () => undefined,
    },
  };
};

describe('rnSqliteDb wrap.transaction — multi-statement async body (device regression)', () => {
  test('replays EVERY statement of an awaited loop, in order, in ONE native transaction', async () => {
    const f = fakeDb();
    await wrap(f.db).transaction(async tx => {
      // The exact shape setDictPrefs / the import audit use: a DELETE+INSERT
      // per item, each awaited. The old wrapper dropped everything after the
      // first await — here all four must land.
      for (const key of ['k1', 'k2']) {
        await tx.run('DELETE FROM dict_prefs WHERE pref_key = ?', [key]);
        await tx.run('INSERT INTO dict_prefs VALUES (?)', [key]);
      }
    });
    expect(f.replayed).toEqual([
      'DELETE FROM dict_prefs WHERE pref_key = ?',
      'INSERT INTO dict_prefs VALUES (?)',
      'DELETE FROM dict_prefs WHERE pref_key = ?',
      'INSERT INTO dict_prefs VALUES (?)',
    ]);
    // Exactly one native transaction; no raw BEGIN/COMMIT/ROLLBACK (Android
    // pooled-connection hazard) leaked to a standalone executeSql.
    expect(f.nativeTxCount()).toBe(1);
    expect(f.direct).not.toContain('BEGIN');
    expect(f.direct).not.toContain('COMMIT');
    // The commit is checkpointed to disk so a plugin reload can't drop the WAL.
    expect(f.direct).toContain('PRAGMA wal_checkpoint(TRUNCATE)');
  });

  test('a body error aborts BEFORE the native transaction — nothing replayed', async () => {
    const f = fakeDb();
    const boom = new Error('build failed');
    await expect(
      wrap(f.db).transaction(async tx => {
        await tx.run('INSERT INTO t VALUES (1)');
        throw boom; // e.g. a populate-step validation failure
      }),
    ).rejects.toBe(boom);
    // The native transaction was never entered, so nothing committed.
    expect(f.nativeTxCount()).toBe(0);
    expect(f.replayed).toEqual([]);
  });

  test('a READ inside a transaction throws (write-only invariant, not a silent stale read)', async () => {
    const f = fakeDb();
    await expect(
      wrap(f.db).transaction(async tx => {
        await tx.query('SELECT 1');
      }),
    ).rejects.toThrow('reads inside a transaction are not supported');
    // The body threw before collection finished → native tx never entered.
    expect(f.nativeTxCount()).toBe(0);
  });

  test('a nested transaction collects into the SAME single native transaction', async () => {
    const f = fakeDb();
    await wrap(f.db).transaction(async tx => {
      await tx.run('A');
      await tx.transaction(async inner => {
        await inner.run('B');
      });
    });
    expect(f.replayed).toEqual(['A', 'B']);
    expect(f.nativeTxCount()).toBe(1);
  });
});
