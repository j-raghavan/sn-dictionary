// OMW thesaurus build core (TF4-FR1). parseOmwTsv validation + key
// re-folding, and populateThesaurus round-trip against the host
// better-sqlite3 adapter on a synthetic TSV.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {buildOmwTsv, SAMPLE_OMW_TSV} from './_helpers/omwFixture';
import {parseOmwTsv, populateThesaurus} from '../src/core/dict/sqlite/buildThesaurus';
import {SELECT_THESAURUS_BY_KEY_LANG} from '../src/core/dict/sqlite/schema';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const emptyDb = (): Promise<SqliteDb> => createSeededDb(async () => undefined);

describe('parseOmwTsv', () => {
  it('parses well-formed rows into validated OmwRows', () => {
    const rows = parseOmwTsv(SAMPLE_OMW_TSV);
    expect(rows).toEqual([
      {key: 'happy', lang: 'en', rel: 'synonym', target: 'glad'},
      {key: 'happy', lang: 'en', rel: 'synonym', target: 'joyful'},
      {key: 'happy', lang: 'en', rel: 'antonym', target: 'sad'},
      {key: 'froh', lang: 'de', rel: 'synonym', target: 'glücklich'},
    ]);
  });

  it('re-folds the key with normalizeKey (case + curly quote)', () => {
    const tsv = buildOmwTsv([
      {key: 'HAPPY', lang: 'EN', rel: 'synonym', target: 'Glad'},
      {key: 'Muad’Dib', lang: 'en', rel: 'synonym', target: 'Usul'},
    ]);
    const rows = parseOmwTsv(tsv);
    expect(rows[0]).toEqual({key: 'happy', lang: 'en', rel: 'synonym', target: 'Glad'});
    // lang is lowercased; curly quote folds to straight in the key.
    expect(rows[1].key).toBe("muad'dib");
    // target keeps display casing.
    expect(rows[1].target).toBe('Usul');
  });

  it('skips blank lines', () => {
    const tsv = '\nhappy\ten\tsynonym\tglad\n\n';
    expect(parseOmwTsv(tsv)).toHaveLength(1);
  });

  it('skips malformed lines (wrong column count)', () => {
    const tsv = ['happy\ten\tsynonym', 'a\tb\tc\td\te', 'ok\ten\tsynonym\tfine'].join('\n');
    const rows = parseOmwTsv(tsv);
    expect(rows).toEqual([{key: 'ok', lang: 'en', rel: 'synonym', target: 'fine'}]);
  });

  it('skips rows with an empty key, lang, or target', () => {
    const tsv = [
      '\ten\tsynonym\tx', // empty key
      'k\t\tsynonym\tx', // empty lang
      'k\ten\tsynonym\t', // empty target
      'good\ten\tsynonym\tfine',
    ].join('\n');
    expect(parseOmwTsv(tsv)).toEqual([
      {key: 'good', lang: 'en', rel: 'synonym', target: 'fine'},
    ]);
  });

  it('drops rows whose rel is not in THESAURUS_RELATIONS', () => {
    const tsv = buildOmwTsv([
      {key: 'a', lang: 'en', rel: 'hypernym', target: 'x'},
      {key: 'b', lang: 'en', rel: 'synonym', target: 'y'},
      {key: 'c', lang: 'en', rel: '', target: 'z'},
    ]);
    expect(parseOmwTsv(tsv)).toEqual([
      {key: 'b', lang: 'en', rel: 'synonym', target: 'y'},
    ]);
  });
});

describe('populateThesaurus', () => {
  it('round-trips parsed rows into the thesaurus table', async () => {
    const db = await emptyDb();
    const rows = parseOmwTsv(SAMPLE_OMW_TSV);
    const {insertedCount} = await populateThesaurus(db, rows);
    expect(insertedCount).toBe(4);

    const en = await db.query(SELECT_THESAURUS_BY_KEY_LANG, ['happy', 'en']);
    expect(en).toEqual([
      {rel: 'synonym', target: 'glad'},
      {rel: 'synonym', target: 'joyful'},
      {rel: 'antonym', target: 'sad'},
    ]);
    const de = await db.query(SELECT_THESAURUS_BY_KEY_LANG, ['froh', 'de']);
    expect(de).toEqual([{rel: 'synonym', target: 'glücklich'}]);
    await db.close();
  });

  it('handles an empty row set (no inserts, table + index still created)', async () => {
    const db = await emptyDb();
    const {insertedCount} = await populateThesaurus(db, []);
    expect(insertedCount).toBe(0);
    const idx = await db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
      ['idx_thes_key'],
    );
    expect(idx).toEqual([{name: 'idx_thes_key'}]);
    await db.close();
  });
});
