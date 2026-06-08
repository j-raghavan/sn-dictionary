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
      await d.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
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

// --- phonetic column (schema v3, M16) ------------------------------

describe('selectByKey — phonetic (v3)', () => {
  const insertCsv =
    'INSERT INTO entries (key, word, definition, format, phonetic) VALUES (?, ?, ?, ?, ?)';

  it('maps a non-null/non-empty phonetic to DictEntry.phonetic', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE); // v3: has phonetic
      await d.run(insertCsv, ['arrakis', 'ARRAKIS', 'the planet', 'plain', 'uh-RAK-is']);
    });
    expect(await selectByKey(db, 'arrakis')).toEqual({
      word: 'ARRAKIS',
      definition: 'the planet',
      format: 'plain',
      phonetic: 'uh-RAK-is',
    });
    await db.close();
  });

  it('OMITS phonetic when the column is NULL', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      // 4-col INSERT -> phonetic NULL.
      await d.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
        'apple',
        'apple',
        'a fruit',
        'plain',
      ]);
    });
    const hit = await selectByKey(db, 'apple');
    expect(hit).toEqual({word: 'apple', definition: 'a fruit', format: 'plain'});
    expect(hit).not.toHaveProperty('phonetic');
    await db.close();
  });

  it("OMITS phonetic when the column is the empty string ''", async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run(insertCsv, ['apple', 'apple', 'a fruit', 'plain', '']);
    });
    const hit = await selectByKey(db, 'apple');
    expect(hit).not.toHaveProperty('phonetic');
    await db.close();
  });

  it('tolerates an OLD slug DB whose entries has NO phonetic column (no crash)', async () => {
    // A pre-v3 4-col `entries` table — the schema probe picks the 4-col
    // SELECT, so no "no such column" query is ever issued (M17-FR2).
    const db = await createSeededDb(async d => {
      await d.run(
        'CREATE TABLE entries (key TEXT NOT NULL, word TEXT NOT NULL, definition TEXT NOT NULL, format TEXT NOT NULL)',
      );
      await d.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
        'apple',
        'apple',
        'a fruit',
        'plain',
      ]);
    });
    const hit = await selectByKey(db, 'apple');
    expect(hit).toEqual({word: 'apple', definition: 'a fruit', format: 'plain'});
    expect(hit).not.toHaveProperty('phonetic');
    await db.close();
  });

  it('tolerates a pre-v3 6-col user.db entries (lang+created_at, no phonetic)', async () => {
    // The exact on-device shape that logged "no such column: phonetic":
    // the OLD user.db table before the FR2 ALTER migration.
    const db = await createSeededDb(async d => {
      await d.run(
        'CREATE TABLE entries (key TEXT NOT NULL, word TEXT NOT NULL, definition TEXT NOT NULL, ' +
          "format TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'und', created_at TEXT NOT NULL)",
      );
      await d.run(
        'INSERT INTO entries (key, word, definition, format, lang, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['note', 'note', 'a user word', 'plain', 'und', 't'],
      );
    });
    const hit = await selectByKey(db, 'note');
    expect(hit).toEqual({word: 'note', definition: 'a user word', format: 'plain'});
    expect(hit).not.toHaveProperty('phonetic');
    await db.close();
  });

  it('probes the schema ONCE per DB handle and caches it (no re-PRAGMA per lookup)', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run(insertCsv, ['a', 'A', 'd', 'plain', 'AY']);
      await d.run(insertCsv, ['b', 'B', 'd', 'plain', 'BEE']);
    });
    // Spy on query to count PRAGMA table_info calls across several lookups.
    const realQuery = db.query.bind(db);
    let pragmaCount = 0;
    db.query = ((sql: string, params?: unknown[]) => {
      if (/PRAGMA table_info/i.test(sql)) {
        pragmaCount++;
      }
      return realQuery(sql, params as never);
    }) as typeof db.query;

    await selectByKey(db, 'a');
    await selectByKey(db, 'b');
    await selectByKey(db, 'a');
    // One probe for the handle, cached thereafter.
    expect(pragmaCount).toBe(1);
    await db.close();
  });
});
