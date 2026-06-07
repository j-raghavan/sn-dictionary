// createSqliteDictSource — DictSource conformance over the lazy
// harness (TF2-FR1/FR7): the status() state machine (idle -> loading
// -> ready / absent, absent sticky), prime() memoisation (concurrent
// primes share one open), empty/whitespace input short-circuits with
// no DB round-trip, normalizeKey parity end-to-end, and the no-parse
// property (open is the whole cost).

import {createSeededDb} from './_helpers/betterSqliteDb';
import {CREATE_ENTRIES_TABLE} from '../src/core/dict/sqlite/schema';
import {createSqliteDictSource} from '../src/core/dict/sqlite/sqliteDictSource';
import type {OpenSqliteDb, SqliteDb} from '../src/core/dict/sqlite/db';

type Seed = {key: string; word: string; definition: string; format: string};

const seededDb = (rows: Seed[]): Promise<SqliteDb> =>
  createSeededDb(async d => {
    await d.run(CREATE_ENTRIES_TABLE);
    for (const r of rows) {
      await d.run('INSERT INTO entries VALUES (?, ?, ?, ?)', [
        r.key,
        r.word,
        r.definition,
        r.format,
      ]);
    }
  });

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
};

describe('createSqliteDictSource — DictSource conformance', () => {
  it('exposes the source name', () => {
    const src = createSqliteDictSource({
      name: 'Base',
      openDb: async () => null,
    });
    expect(src.name).toBe('Base');
  });

  it('looks up a word through the full source (open -> query)', async () => {
    const db = await seededDb([
      {key: 'hello', word: 'Hello', definition: 'a greeting', format: 'html'},
    ]);
    const src = createSqliteDictSource({name: 'Base', openDb: async () => db});
    expect(await src.lookup('hello')).toEqual({
      word: 'Hello',
      definition: 'a greeting',
      format: 'html',
    });
  });

  it('returns null for a word with no entry (AC2)', async () => {
    const db = await seededDb([
      {key: 'hello', word: 'Hello', definition: 'hi', format: 'plain'},
    ]);
    const src = createSqliteDictSource({name: 'Base', openDb: async () => db});
    expect(await src.lookup('nope')).toBeNull();
  });

  describe('normalizeKey parity', () => {
    it('matches the same row for case and punctuation variants', async () => {
      const db = await seededDb([
        // key stored already folded by normalizeKey at build time.
        {key: 'hello', word: 'Hello', definition: 'hi', format: 'plain'},
        {key: "muad'dib", word: 'Muad’Dib', definition: 'a name', format: 'plain'},
      ]);
      const src = createSqliteDictSource({name: 'Base', openDb: async () => db});

      expect((await src.lookup('Hello'))?.word).toBe('Hello');
      expect((await src.lookup('HELLO'))?.word).toBe('Hello');
      // Straight apostrophe (U+0027) and curly (U+2019) fold to the
      // same key, so both queries hit the one stored row.
      expect((await src.lookup("Muad'Dib"))?.word).toBe('Muad’Dib');
      expect((await src.lookup('Muad’Dib'))?.word).toBe('Muad’Dib');
    });
  });

  describe('empty / whitespace input', () => {
    it('returns null without opening or querying the DB', async () => {
      const openDb = jest.fn<ReturnType<OpenSqliteDb>, []>(async () => {
        throw new Error('openDb must not be called for blank input');
      });
      const src = createSqliteDictSource({name: 'Base', openDb});
      expect(await src.lookup('')).toBeNull();
      expect(await src.lookup('   ')).toBeNull();
      expect(openDb).not.toHaveBeenCalled();
    });
  });

  describe('status() state machine', () => {
    it('starts idle, goes loading while opening, lands ready', async () => {
      const gate = deferred<SqliteDb>();
      const src = createSqliteDictSource({
        name: 'Base',
        openDb: () => gate.promise,
      });

      expect(src.status?.()).toBe('idle');
      const primed = src.prime!();
      expect(src.status?.()).toBe('loading');

      gate.resolve(await seededDb([]));
      await primed;
      expect(src.status?.()).toBe('ready');
    });

    it('lands absent (sticky) when openDb resolves null', async () => {
      const openDb = jest.fn<ReturnType<OpenSqliteDb>, []>(async () => null);
      const src = createSqliteDictSource({name: 'Base', openDb});

      await src.prime!();
      expect(src.status?.()).toBe('absent');

      // Sticky: a lookup after 'absent' returns null and never re-opens.
      expect(await src.lookup('x')).toBeNull();
      expect(openDb).toHaveBeenCalledTimes(1);
    });
  });

  describe('prime() memoisation', () => {
    it('opens once for concurrent primes', async () => {
      const gate = deferred<SqliteDb>();
      const openDb = jest.fn<ReturnType<OpenSqliteDb>, []>(() => gate.promise);
      const src = createSqliteDictSource({name: 'Base', openDb});

      const a = src.prime!();
      const b = src.prime!();
      gate.resolve(await seededDb([]));
      await Promise.all([a, b]);

      expect(openDb).toHaveBeenCalledTimes(1);
    });

    it('does not re-open on a lookup after a successful prime', async () => {
      const db = await seededDb([
        {key: 'k', word: 'K', definition: 'd', format: 'plain'},
      ]);
      const openDb = jest.fn<ReturnType<OpenSqliteDb>, []>(async () => db);
      const src = createSqliteDictSource({name: 'Base', openDb});

      await src.prime!();
      await src.lookup('k');
      await src.lookup('k');
      expect(openDb).toHaveBeenCalledTimes(1);
    });
  });
});
