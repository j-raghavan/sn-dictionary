// The indexed lookup primitive (selectByKey) + format coercion. These
// assert the query-level contract: first-row-wins (merge-all for a
// StarDict slug with aliases, #46), null-on-miss,
// format validation with 'plain' fallback, and that the key reaches
// SQLite as a bound parameter (a quote/DROP payload is inert).

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  CREATE_ALIASES_INDEX,
  CREATE_ALIASES_TABLE,
  CREATE_ENTRIES_INDEX,
  CREATE_ENTRIES_TABLE,
  INSERT_ALIAS,
  INSERT_STARDICT_ENTRY,
  SELECT_ENTRIES_BY_KEY_WITH_ALIASES,
  SELECT_ENTRY_BY_KEY,
} from '../src/core/dict/sqlite/schema';
import {
  coerceFormat,
  createSqliteDictSource,
  selectByKey,
} from '../src/core/dict/sqlite/sqliteDictSource';
import {buildBaseDbFromTriple, SCHEMA_VERSION} from '../src/core/dict/sqlite/buildBaseDb';
import {parseWordNetEntry} from '../src/ui/wordnetFormatter';
import type {SqliteDb} from '../src/core/dict/sqlite/db';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';

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

// --- StarDict aliases (#44) ------------------------------------------

describe('selectByKey — StarDict slug with aliases (#44)', () => {
  type Alias = {key: string; entryRowid: number; word: string};

  // The layout StarDictImporter.kt writes: entries in .idx order (rowid =
  // ordinal + 1, no dedup), aliases in .syn order pointing at a rowid.
  const keyedDb = (entries: Seed[], aliases: Alias[]): Promise<SqliteDb> =>
    createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run(CREATE_ALIASES_TABLE);
      for (const [i, r] of entries.entries()) {
        await d.run(INSERT_STARDICT_ENTRY, [i + 1, r.key, r.word, r.definition, r.format]);
      }
      for (const a of aliases) {
        await d.run(INSERT_ALIAS, [a.key, a.entryRowid, a.word]);
      }
      await d.run(CREATE_ENTRIES_INDEX);
      await d.run(CREATE_ALIASES_INDEX);
    });

  const ENTRIES: Seed[] = [
    {key: 'chat', word: 'chat', definition: 'cat', format: 'html'},
    {key: 'chien', word: 'chien', definition: 'dog', format: 'html'},
    {key: 'chat', word: 'Chat', definition: 'a surname', format: 'plain'},
  ];

  it('returns the canonical row for a headword', async () => {
    const db = await keyedDb(ENTRIES, []);
    expect(await selectByKey(db, 'chien')).toEqual({
      word: 'chien',
      definition: 'dog',
      format: 'html',
    });
    await db.close();
  });

  it("resolves an alias-only key to its target's headword and definition", async () => {
    const db = await keyedDb(ENTRIES, [{key: 'chiens', entryRowid: 2, word: 'chiens'}]);
    expect(await selectByKey(db, 'chiens')).toEqual({
      word: 'chien',
      definition: 'dog',
      format: 'html',
    });
    await db.close();
  });

  // The entry a merged lookup returns: the first part's fields, plus every
  // part when the key reached more than one distinct entry (#46).
  type Part = {word: string; definition: string; format: string};
  const merged = (...parts: Part[]) => ({...parts[0], parts});

  it('puts a canonical row before an alias on the same key', async () => {
    // The alias targets a LOWER rowid than the canonical row, so only the
    // source rank (canonical before alias) can make the canonical win.
    const db = await keyedDb(
      [
        {key: 'aaa', word: 'aaa', definition: 'alias target', format: 'plain'},
        {key: 'chiens', word: 'Chiens', definition: 'canonical', format: 'plain'},
      ],
      [{key: 'chiens', entryRowid: 1, word: 'chiens'}],
    );
    expect(await selectByKey(db, 'chiens')).toEqual(
      merged(
        {word: 'Chiens', definition: 'canonical', format: 'plain'},
        {word: 'aaa', definition: 'alias target', format: 'plain'},
      ),
    );
    await db.close();
  });

  it('returns every .idx record that folds to the key, each in its own format (#46)', async () => {
    // chat (html) + Chat (plain): nothing is joined or escaped.
    const db = await keyedDb(ENTRIES, []);
    expect(await selectByKey(db, 'chat')).toEqual(
      merged(
        {word: 'chat', definition: 'cat', format: 'html'},
        {word: 'Chat', definition: 'a surname', format: 'plain'},
      ),
    );
    await db.close();
  });

  it('orders aliases by .syn order, not target rowid order (#46)', async () => {
    const db = await keyedDb(ENTRIES, [
      {key: 'minou', entryRowid: 3, word: 'Minou'},
      {key: 'minou', entryRowid: 1, word: 'minou'},
    ]);
    expect(await selectByKey(db, 'minou')).toEqual(
      merged(
        {word: 'Chat', definition: 'a surname', format: 'plain'},
        {word: 'chat', definition: 'cat', format: 'html'},
      ),
    );
    await db.close();
  });

  it('lists an entry reached by both its headword and an alias once, canonical first (#46)', async () => {
    // fr-fr: "affranchies" is a .syn form of both affranchi and affranchir.
    const db = await keyedDb(
      [
        {key: 'affranchi', word: 'affranchi', definition: 'freed', format: 'plain'},
        {key: 'affranchir', word: 'affranchir', definition: 'to free', format: 'plain'},
      ],
      [
        {key: 'affranchies', entryRowid: 1, word: 'affranchies'},
        {key: 'affranchies', entryRowid: 2, word: 'affranchies'},
        {key: 'affranchi', entryRowid: 1, word: 'Affranchi'},
        {key: 'affranchi', entryRowid: 2, word: 'affranchi'},
      ],
    );
    const both = merged(
      {word: 'affranchi', definition: 'freed', format: 'plain'},
      {word: 'affranchir', definition: 'to free', format: 'plain'},
    );
    expect(await selectByKey(db, 'affranchies')).toEqual(both);
    expect(await selectByKey(db, 'affranchi')).toEqual(both);
    await db.close();
  });

  it('carries no parts when the key reaches one distinct body (#46)', async () => {
    // Two rows, same format and definition: distinctParts keeps one.
    const db = await keyedDb(
      [
        {key: 'colour', word: 'colour', definition: 'hue', format: 'plain'},
        {key: 'colour', word: 'Colour', definition: 'hue', format: 'plain'},
      ],
      [],
    );
    expect(await selectByKey(db, 'colour')).toEqual({
      word: 'colour',
      definition: 'hue',
      format: 'plain',
    });
    await db.close();
  });

  it('shows the matched alias as the headword of an entry with an empty one (JMdict, #46)', async () => {
    // JMdict: every .idx word is empty; 紙 and 神 share the reading かみ.
    // Every part takes the alias that matched, so no part differs from the
    // headword and none is labelled.
    const db = await keyedDb(
      [
        {key: '', word: '', definition: '<p>paper</p>', format: 'html'},
        {key: '', word: '', definition: '<p>god</p>', format: 'html'},
      ],
      [
        {key: '紙', entryRowid: 1, word: '紙'},
        {key: 'かみ', entryRowid: 1, word: 'かみ'},
        {key: '神', entryRowid: 2, word: '神'},
        {key: 'かみ', entryRowid: 2, word: 'かみ'},
      ],
    );
    expect(await selectByKey(db, '神')).toEqual({
      word: '神',
      definition: '<p>god</p>',
      format: 'html',
    });
    expect(await selectByKey(db, 'かみ')).toEqual(
      merged(
        {word: 'かみ', definition: '<p>paper</p>', format: 'html'},
        {word: 'かみ', definition: '<p>god</p>', format: 'html'},
      ),
    );
    await db.close();
  });

  it('applies the format override to every part', async () => {
    const db = await keyedDb(ENTRIES, []);
    expect(await selectByKey(db, 'chat', 'plain')).toEqual(
      merged(
        {word: 'chat', definition: 'cat', format: 'plain'},
        {word: 'Chat', definition: 'a surname', format: 'plain'},
      ),
    );
    await db.close();
  });

  it("keeps a 'wordnet' slug's entries as parts that each parse as one WordNet entry", async () => {
    // A sidecar-typed slug stores 'wordnet' in the format column; bootstrap
    // passes no override. Parts are never joined, so each body is still a
    // whole entry for parseWordNetEntry.
    const db = await keyedDb(
      [
        {key: 'afghan', word: 'Afghan', definition: 'Afghan\n     adj : of Afghanistan', format: 'wordnet'},
        {key: 'afghan', word: 'afghan', definition: 'afghan\n     n : a knitted blanket', format: 'wordnet'},
      ],
      [],
    );
    const entry = await selectByKey(db, 'afghan');
    expect(entry?.format).toBe('wordnet');
    expect(entry?.parts?.map(p => parseWordNetEntry(p.definition).senses.map(x => x.definition))).toEqual([
      ['of Afghanistan'],
      ['a knitted blanket'],
    ]);
    await db.close();
  });

  it('skips empty-definition rows: an only-empty key misses, else the next row wins', async () => {
    // Empty rows are .idx records that overran a corrupt .dict body.
    const db = await keyedDb(
      [
        {key: 'x', word: 'X', definition: '', format: 'plain'},
        {key: 'k', word: 'K', definition: '', format: 'plain'},
        {key: 'k', word: 'k', definition: 'real', format: 'plain'},
      ],
      [
        {key: 'xs', entryRowid: 1, word: 'xs'},
        // Merged (#46): an empty row reached first is neither a part nor
        // the headword; the real row alone is the result.
        {key: 'm', entryRowid: 1, word: 'm-empty'},
        {key: 'm', entryRowid: 3, word: 'm-real'},
      ],
    );
    expect(await selectByKey(db, 'x')).toBeNull();
    expect(await selectByKey(db, 'xs')).toBeNull();
    expect(await selectByKey(db, 'k')).toEqual({word: 'k', definition: 'real', format: 'plain'});
    expect(await selectByKey(db, 'm')).toEqual({word: 'k', definition: 'real', format: 'plain'});
    await db.close();
  });

  it('returns null when neither entries nor aliases match', async () => {
    const db = await keyedDb(ENTRIES, [{key: 'chiens', entryRowid: 2, word: 'chiens'}]);
    expect(await selectByKey(db, 'oiseau')).toBeNull();
    await db.close();
  });

  // Spy on the SQL each lookup issues (PRAGMA/sqlite_master probes aside).
  const lookupSql = (db: SqliteDb): string[] => {
    const seen: string[] = [];
    const realQuery = db.query.bind(db);
    db.query = ((sql: string, params?: unknown[]) => {
      if (!/PRAGMA|sqlite_master/.test(sql)) {
        seen.push(sql);
      }
      return realQuery(sql, params as never);
    }) as typeof db.query;
    return seen;
  };

  it('uses the keyed SELECT only when the aliases table exists', async () => {
    const keyed = await keyedDb(ENTRIES, []);
    const keyedSql = lookupSql(keyed);
    await selectByKey(keyed, 'chat');
    expect(keyedSql).toEqual([SELECT_ENTRIES_BY_KEY_WITH_ALIASES]);
    await keyed.close();

    // base.db, user.db, CSV slugs and v2 StarDict slugs have no aliases
    // table and keep the plain LIMIT-1 SELECT.
    // Same rows, but the first one wins: nothing is merged.
    const plain = await dbWith(ENTRIES);
    const plainSql = lookupSql(plain);
    expect(await selectByKey(plain, 'chat')).toEqual({
      word: 'chat',
      definition: 'cat',
      format: 'html',
    });
    expect(plainSql).toEqual([SELECT_ENTRY_BY_KEY]);
    await plain.close();
  });

  it('re-probes after a failed probe instead of caching the plain shape', async () => {
    const db = await keyedDb(ENTRIES, [{key: 'chiens', entryRowid: 2, word: 'chiens'}]);
    const realQuery = db.query.bind(db);
    let failNext = true;
    db.query = ((sql: string, params?: unknown[]) => {
      if (/sqlite_master/.test(sql) && failNext) {
        failNext = false;
        return Promise.reject(new Error('timeout'));
      }
      return realQuery(sql, params as never);
    }) as typeof db.query;
    // First lookup: the probe fails, so this call takes the plain SELECT
    // and misses the alias...
    expect(await selectByKey(db, 'chiens')).toBeNull();
    // ...but the failure is not cached: the next lookup re-probes and
    // resolves the alias.
    expect((await selectByKey(db, 'chiens'))?.word).toBe('chien');
    await db.close();
  });

  it('falls back to the plain shape when the probe itself fails', async () => {
    const db = await dbWith(ENTRIES);
    const realQuery = db.query.bind(db);
    db.query = ((sql: string, params?: unknown[]) =>
      /sqlite_master/.test(sql)
        ? Promise.reject(new Error('probe failed'))
        : realQuery(sql, params as never)) as typeof db.query;
    expect((await selectByKey(db, 'chat'))?.word).toBe('chat');
    await db.close();
  });
});

// PR #45 merged base.db too, and the bundled WordNet has 216 folded keys
// with more than one entry. The merged body folded the next headword into
// the last sense ("…Afghanistan or its people afghan"). base.db has no
// aliases table, so its lookup stays single-entry.
describe('selectByKey — bundled WordNet base.db stays single-entry (#46)', () => {
  // The real dict/wordnet bodies, in full, for the two records that fold
  // to 'afghan'.
  const AFGHAN_ADJ =
    'Afghan\n     adj : of or relating to or characteristic of Afghanistan or its\n' +
    '           people [syn: {Afghani}, {Afghanistani}]';
  const AFGHAN_NOUN =
    'afghan\n     n 1: a blanket knitted or crocheted in strips or squares;\n' +
    '          sometimes used as a shawl\n' +
    '     2: a native or inhabitant of Afghanistan [syn: {Afghanistani}]\n' +
    '     3: an Iranian language spoken in Afghanistan and Pakistan; the\n' +
    '        official language of Afghanistan [syn: {Pashto}, {Pashtu},\n' +
    '         {Paxto}, {Afghani}]\n' +
    '     4: a coat made of sheepskin [syn: {sheepskin coat}]\n' +
    '     5: tall graceful breed of hound with a long silky coat; native\n' +
    '        to the Near East [syn: {Afghan hound}]';

  // base.db stores 'wordnet' in the format column. The bundled source
  // also passes it as an override; check the lookup both ways.
  it.each([
    ['the format override', 'wordnet' as const],
    ['the format column alone', undefined],
  ])(
    'returns only the first Afghan/afghan entry, which parses as one WordNet entry (%s)',
    async (_how, format) => {
      const db = await createSeededDb(async () => undefined);
      const t = buildSyntheticStarDict({Afghan: AFGHAN_ADJ, afghan: AFGHAN_NOUN});
      await buildBaseDbFromTriple(db, t.ifo, t.idx, t.dict, SCHEMA_VERSION);
      const source = createSqliteDictSource({
        name: 'WordNet',
        openDb: async () => db,
        format,
      });
      const entry = await source.lookup('afghan');
      expect(entry).toEqual({word: 'Afghan', definition: AFGHAN_ADJ, format: 'wordnet'});
      const parsed = parseWordNetEntry(entry!.definition);
      expect(parsed.word).toBe('Afghan');
      expect(parsed.senses).toHaveLength(1);
      expect(parsed.senses[0].definition).toBe(
        'of or relating to or characteristic of Afghanistan or its people',
      );
      await db.close();
    },
  );
});
