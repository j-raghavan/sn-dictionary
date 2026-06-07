// Per-source error isolation (TF2-FR6 / IV-5). A faulty SQLite source
// — open throws (corrupt/locked file), or query throws (corrupt
// table) — must surface as "no hit" and be logged, never propagate
// into the multiDict fan-out. A sibling healthy source must still
// resolve its hit. These tests drive the real createMultiDictLookup
// so the contract is asserted at the seam the popup actually consumes.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {CREATE_ENTRIES_TABLE} from '../src/core/dict/sqlite/schema';
import {createSqliteDictSource} from '../src/core/dict/sqlite/sqliteDictSource';
import {createMultiDictLookup} from '../src/core/dict/multiDictLookup';
import type {SqliteDb} from '../src/core/dict/sqlite/db';
import type {DictSource} from '../src/core/lookup';

const healthyDb = (): Promise<SqliteDb> =>
  createSeededDb(async d => {
    await d.run(CREATE_ENTRIES_TABLE);
    await d.run('INSERT INTO entries VALUES (?, ?, ?, ?)', [
      'hello',
      'Hello',
      'a greeting',
      'plain',
    ]);
  });

// A SqliteDb whose query always rejects — models a corrupt table that
// opened fine but errors on read.
const queryThrowingDb = (): SqliteDb => ({
  query: async () => {
    throw new Error('database disk image is malformed');
  },
  run: async () => ({changes: 0}),
  transaction: async () => undefined,
  close: async () => undefined,
});

const healthySource = async (): Promise<DictSource> => {
  const db = await healthyDb();
  return createSqliteDictSource({name: 'Base', openDb: async () => db});
};

describe('SQLite source error isolation (TF2-FR6)', () => {
  it('a source whose open throws is logged and contributes no hit; sibling survives', async () => {
    const warn = jest.fn();
    const broken = createSqliteDictSource({
      name: 'Corrupt',
      openDb: async () => {
        throw new Error('unable to open database file');
      },
      logger: {warn},
    });
    const lookup = createMultiDictLookup(
      [broken, await healthySource()],
      {warn},
    );

    const result = await lookup.lookup('hello');
    expect(result.hits).toEqual([
      {source: 'Base', entry: {word: 'Hello', definition: 'a greeting', format: 'plain'}},
    ]);
    // The open failure was logged by the lazy harness.
    expect(warn).toHaveBeenCalled();
  });

  it('a source whose query throws is isolated by the fan-out; sibling survives', async () => {
    const warn = jest.fn();
    const broken = createSqliteDictSource({
      name: 'Corrupt',
      openDb: async () => queryThrowingDb(),
    });
    const lookup = createMultiDictLookup(
      [broken, await healthySource()],
      {warn},
    );

    const result = await lookup.lookup('hello');
    expect(result.hits).toEqual([
      {source: 'Base', entry: {word: 'Hello', definition: 'a greeting', format: 'plain'}},
    ]);
    // multiDict logs the thrown source rather than rejecting the run.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('source "Corrupt" threw'),
    );
  });

  it('the whole fan-out never rejects even when a source throws', async () => {
    const broken = createSqliteDictSource({
      name: 'Corrupt',
      openDb: async () => queryThrowingDb(),
    });
    const lookup = createMultiDictLookup([broken]);
    // No sibling — the only source throws on query. Result resolves
    // with zero hits instead of rejecting.
    await expect(lookup.lookup('hello')).resolves.toEqual({
      queriedFor: 'hello',
      hits: [],
      loading: [],
    });
  });
});
