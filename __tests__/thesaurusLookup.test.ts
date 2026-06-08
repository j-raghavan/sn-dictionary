// lookupThesaurus over base.db (TF4-FR2/FR3/FR3a). Covers rel
// bucketing, the 'und' short-circuit (asserted to make ZERO query
// calls), the empty-word guard, unknown-rel dropping, and DB-error
// isolation (empty + warn, never throws).

import {createSeededDb} from './_helpers/betterSqliteDb';
import {buildOmwTsv} from './_helpers/omwFixture';
import {parseOmwTsv, populateThesaurus} from '../src/core/dict/sqlite/buildThesaurus';
import {lookupThesaurus} from '../src/core/dict/sqlite/thesaurusLookup';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const dbWith = async (tsv: string): Promise<SqliteDb> => {
  const db = await createSeededDb(async () => undefined);
  await populateThesaurus(db, parseOmwTsv(tsv));
  return db;
};

const SAMPLE = buildOmwTsv([
  {key: 'happy', lang: 'en', rel: 'synonym', target: 'glad'},
  {key: 'happy', lang: 'en', rel: 'synonym', target: 'joyful'},
  {key: 'happy', lang: 'en', rel: 'antonym', target: 'sad'},
  {key: 'froh', lang: 'de', rel: 'synonym', target: 'glücklich'},
]);

describe('lookupThesaurus', () => {
  it('buckets rows into synonyms and antonyms', async () => {
    const db = await dbWith(SAMPLE);
    const res = await lookupThesaurus(db, 'happy', 'en');
    expect(res).toEqual({synonyms: ['glad', 'joyful'], antonyms: ['sad']});
    await db.close();
  });

  it('returns empty (no error) against an EMPTY-but-present thesaurus table (M9 fix 3)', async () => {
    // A base.db built with no OMW rows still HAS a thesaurus table (fix 3),
    // so the query runs and returns empty rather than throwing
    // "no such table: thesaurus".
    const db = await createSeededDb(async () => undefined);
    await populateThesaurus(db, []); // creates the table + index, 0 rows
    const res = await lookupThesaurus(db, 'happy', 'en');
    expect(res).toEqual({synonyms: [], antonyms: []});
    await db.close();
  });

  it('folds the query word with normalizeKey', async () => {
    const db = await dbWith(SAMPLE);
    // Mixed case query hits the folded 'happy' key.
    const res = await lookupThesaurus(db, 'HAPPY', 'en');
    expect(res.synonyms).toEqual(['glad', 'joyful']);
    await db.close();
  });

  it('scopes results by language', async () => {
    const db = await dbWith(SAMPLE);
    const de = await lookupThesaurus(db, 'froh', 'de');
    expect(de).toEqual({synonyms: ['glücklich'], antonyms: []});
    // 'froh' has no EN rows.
    expect(await lookupThesaurus(db, 'froh', 'en')).toEqual({
      synonyms: [],
      antonyms: [],
    });
    await db.close();
  });

  it('returns empty for a word with no relations', async () => {
    const db = await dbWith(SAMPLE);
    expect(await lookupThesaurus(db, 'nonexistent', 'en')).toEqual({
      synonyms: [],
      antonyms: [],
    });
    await db.close();
  });

  describe("'und' language short-circuit (TF4-FR3a)", () => {
    it('returns empty WITHOUT querying the DB', async () => {
      const query = jest.fn();
      const spy = {query} as unknown as SqliteDb;
      const res = await lookupThesaurus(spy, 'happy', 'und');
      expect(res).toEqual({synonyms: [], antonyms: []});
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('empty / whitespace word guard', () => {
    it('returns empty without querying for blank input', async () => {
      const query = jest.fn();
      const spy = {query} as unknown as SqliteDb;
      expect(await lookupThesaurus(spy, '', 'en')).toEqual({
        synonyms: [],
        antonyms: [],
      });
      expect(await lookupThesaurus(spy, '   ', 'en')).toEqual({
        synonyms: [],
        antonyms: [],
      });
      expect(query).not.toHaveBeenCalled();
    });
  });

  it('drops rows whose rel is neither synonym nor antonym', async () => {
    // Insert a stray rel directly (bypassing parseOmwTsv's filter) to
    // prove lookup also filters — defence in depth.
    const db = await createSeededDb(async d => {
      await d.run(
        'CREATE TABLE IF NOT EXISTS thesaurus (key TEXT NOT NULL, lang TEXT NOT NULL, rel TEXT NOT NULL, target TEXT NOT NULL)',
      );
      await d.run('INSERT INTO thesaurus VALUES (?, ?, ?, ?)', ['x', 'en', 'synonym', 's']);
      await d.run('INSERT INTO thesaurus VALUES (?, ?, ?, ?)', ['x', 'en', 'hypernym', 'h']);
    });
    const res = await lookupThesaurus(db, 'x', 'en');
    expect(res).toEqual({synonyms: ['s'], antonyms: []});
    await db.close();
  });

  describe('DB-error isolation', () => {
    it('returns empty and warns when query throws (never throws)', async () => {
      const warn = jest.fn();
      const faulty = {
        query: async () => {
          throw new Error('database disk image is malformed');
        },
      } as unknown as SqliteDb;
      const res = await lookupThesaurus(faulty, 'happy', 'en', {warn});
      expect(res).toEqual({synonyms: [], antonyms: []});
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[thesaurus] lookup "happy" (en) threw'),
      );
    });

    it('swallows the error silently when no logger is supplied', async () => {
      const faulty = {
        query: async () => {
          throw new Error('boom');
        },
      } as unknown as SqliteDb;
      await expect(lookupThesaurus(faulty, 'happy', 'en')).resolves.toEqual({
        synonyms: [],
        antonyms: [],
      });
    });
  });
});
