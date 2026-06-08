// SqliteDb port behaviour, exercised through the host better-sqlite3
// adapter. These assertions are the contract every adapter (host or
// device) must honour: parameterized read/write, transactional
// commit/rollback, nullable open (-> 'absent'), and close.

import {openBetterSqliteDb, createSeededDb} from './_helpers/betterSqliteDb';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const seedTable = async (db: SqliteDb): Promise<void> => {
  await db.run('CREATE TABLE t (k TEXT NOT NULL, v TEXT NOT NULL)');
};

describe('SqliteDb port (better-sqlite3 adapter)', () => {
  it('opens an in-memory db and round-trips a parameterized write/read', async () => {
    const db = await createSeededDb(seedTable);

    const res = await db.run('INSERT INTO t (k, v) VALUES (?, ?)', [
      'hello',
      'world',
    ]);
    expect(res.changes).toBe(1);

    const rows = await db.query<{k: string; v: string}>(
      'SELECT k, v FROM t WHERE k = ?',
      ['hello'],
    );
    expect(rows).toEqual([{k: 'hello', v: 'world'}]);

    await db.close();
  });

  it('returns an empty array for a query with no matches', async () => {
    const db = await createSeededDb(seedTable);
    const rows = await db.query('SELECT k, v FROM t WHERE k = ?', ['missing']);
    expect(rows).toEqual([]);
    await db.close();
  });

  it('binds values as data, never SQL — a quote/DROP payload is inert', async () => {
    const db = await createSeededDb(seedTable);
    const payload = "x'); DROP TABLE t; --";
    await db.run('INSERT INTO t (k, v) VALUES (?, ?)', [payload, 'safe']);

    // The table still exists and holds the literal payload as a key.
    const rows = await db.query<{k: string; v: string}>(
      'SELECT k, v FROM t WHERE k = ?',
      [payload],
    );
    expect(rows).toEqual([{k: payload, v: 'safe'}]);
    await db.close();
  });

  it('binds numeric and null params', async () => {
    const db = await createSeededDb(async d => {
      await d.run('CREATE TABLE n (id INTEGER, label TEXT)');
    });
    await db.run('INSERT INTO n (id, label) VALUES (?, ?)', [7, null]);
    const rows = await db.query<{id: number; label: string | null}>(
      'SELECT id, label FROM n WHERE id = ?',
      [7],
    );
    expect(rows).toEqual([{id: 7, label: null}]);
    await db.close();
  });

  describe('transaction', () => {
    it('commits all writes when the body resolves', async () => {
      const db = await createSeededDb(seedTable);
      await db.transaction(async tx => {
        await tx.run('INSERT INTO t (k, v) VALUES (?, ?)', ['a', '1']);
        await tx.run('INSERT INTO t (k, v) VALUES (?, ?)', ['b', '2']);
      });
      const rows = await db.query('SELECT k FROM t ORDER BY k');
      expect(rows).toEqual([{k: 'a'}, {k: 'b'}]);
      await db.close();
    });

    it('rolls back every write when the body rejects, and rethrows', async () => {
      const db = await createSeededDb(seedTable);
      const boom = new Error('boom');
      await expect(
        db.transaction(async tx => {
          await tx.run('INSERT INTO t (k, v) VALUES (?, ?)', ['a', '1']);
          throw boom;
        }),
      ).rejects.toBe(boom);

      const rows = await db.query('SELECT k FROM t');
      expect(rows).toEqual([]);
      await db.close();
    });
  });

  describe('openBetterSqliteDb factory', () => {
    it('resolves a working handle for a real path (":memory:")', async () => {
      const open = openBetterSqliteDb(':memory:');
      const db = await open();
      expect(db).not.toBeNull();
      await db!.run('CREATE TABLE z (a TEXT)');
      await db!.run('INSERT INTO z VALUES (?)', ['ok']);
      expect(await db!.query('SELECT a FROM z')).toEqual([{a: 'ok'}]);
      await db!.close();
    });

    it('resolves null when the path is null (the absent branch)', async () => {
      const open = openBetterSqliteDb(null);
      await expect(open()).resolves.toBeNull();
    });
  });
});
