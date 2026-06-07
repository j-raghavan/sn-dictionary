// The indexed lookup primitive (selectByKey) + format coercion. These
// assert the query-level contract: first-row-wins, null-on-miss,
// format validation with 'plain' fallback, and that the key reaches
// SQLite as a bound parameter (a quote/DROP payload is inert).

import {createSeededDb} from './_helpers/betterSqliteDb';
import {CREATE_ENTRIES_TABLE} from '../src/core/dict/sqlite/schema';
import {
  coerceFormat,
  selectByKey,
} from '../src/core/dict/sqlite/sqliteDictSource';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

type Seed = {key: string; word: string; definition: string; format: string};

const dbWith = (rows: Seed[]): Promise<SqliteDb> =>
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

describe('coerceFormat (boundary validation)', () => {
  it.each(['wordnet', 'html', 'plain'])(
    'passes the known format %s through unchanged',
    raw => {
      expect(coerceFormat(raw)).toBe(raw);
    },
  );

  it.each(['', 'HTML', 'markdown', 'x', 'unknown'])(
    'falls back to plain for the unknown format %p',
    raw => {
      expect(coerceFormat(raw)).toBe('plain');
    },
  );
});

describe('selectByKey', () => {
  it('returns null when no row matches (AC2)', async () => {
    const db = await dbWith([
      {key: 'hello', word: 'Hello', definition: 'hi', format: 'plain'},
    ]);
    expect(await selectByKey(db, 'absent-key')).toBeNull();
    await db.close();
  });

  it('returns {word, definition, format} for a hit', async () => {
    const db = await dbWith([
      {key: 'hello', word: 'Hello', definition: 'a greeting', format: 'html'},
    ]);
    expect(await selectByKey(db, 'hello')).toEqual({
      word: 'Hello',
      definition: 'a greeting',
      format: 'html',
    });
    await db.close();
  });

  it('maps each stored format and coerces an unknown one to plain', async () => {
    const db = await dbWith([
      {key: 'w', word: 'W', definition: 'd', format: 'wordnet'},
      {key: 'h', word: 'H', definition: 'd', format: 'html'},
      {key: 'p', word: 'P', definition: 'd', format: 'plain'},
      {key: 'b', word: 'B', definition: 'd', format: 'bogus'},
    ]);
    expect((await selectByKey(db, 'w'))?.format).toBe('wordnet');
    expect((await selectByKey(db, 'h'))?.format).toBe('html');
    expect((await selectByKey(db, 'p'))?.format).toBe('plain');
    expect((await selectByKey(db, 'b'))?.format).toBe('plain');
    await db.close();
  });

  it('lets formatOverride win over the stored column', async () => {
    const db = await dbWith([
      {key: 'k', word: 'K', definition: 'd', format: 'plain'},
    ]);
    expect((await selectByKey(db, 'k', 'wordnet'))?.format).toBe('wordnet');
    await db.close();
  });

  it('returns the first row when duplicate keys exist (LIMIT 1)', async () => {
    const db = await dbWith([
      {key: 'dup', word: 'First', definition: 'first', format: 'plain'},
      {key: 'dup', word: 'Second', definition: 'second', format: 'html'},
    ]);
    expect((await selectByKey(db, 'dup'))?.word).toBe('First');
    await db.close();
  });

  it('binds the key as data — a SQL-injection payload is inert', async () => {
    const payload = "k'); DROP TABLE entries; --";
    const db = await dbWith([
      {key: payload, word: 'Safe', definition: 'd', format: 'plain'},
      {key: 'survivor', word: 'Survivor', definition: 'd', format: 'plain'},
    ]);
    // The malicious-looking key matches its own row...
    expect((await selectByKey(db, payload))?.word).toBe('Safe');
    // ...and the table was never dropped.
    expect((await selectByKey(db, 'survivor'))?.word).toBe('Survivor');
    await db.close();
  });
});
