// The base.db generator core (TF3-FR1/FR2). Driven on a tiny synthetic
// WordNet triple through the real buildDict + the host better-sqlite3
// adapter, so the assertions exercise the same code path the build
// script runs. Verifies: row count == index size, normalizeKey folding
// carries over, format is 'wordnet', body parity vs lookupDict, and
// the meta row is written LAST (entries/index first) with a
// deterministic built_at.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';
import {buildDict, lookupDict} from '../src/core/dict/stardict/stardictDict';
import {
  buildBaseDbFromTriple,
  deterministicBuiltAt,
  entriesFromParsedDict,
  populateBaseDb,
  SCHEMA_VERSION,
} from '../src/core/dict/sqlite/buildBaseDb';
import {
  SELECT_ENTRY_BY_KEY,
  SELECT_META_VERSION,
  SELECT_THESAURUS_BY_KEY_LANG,
} from '../src/core/dict/sqlite/schema';
import type {OmwRow} from '../src/core/dict/sqlite/buildThesaurus';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const DEFS: Record<string, string> = {
  apple: 'a round fruit',
  Banana: 'a long yellow fruit',
  'Muad’Dib': 'a desert mouse',
};

const triple = () => buildSyntheticStarDict(DEFS);
const emptyDb = (): Promise<SqliteDb> => createSeededDb(async () => undefined);

describe('entriesFromParsedDict', () => {
  it('flattens every index entry to a folded-key row', async () => {
    const t = triple();
    const parsed = await buildDict(t.ifo, t.idx, t.dict);
    const rows = entriesFromParsedDict(parsed);

    expect(rows).toHaveLength(parsed.index.size);
    // Keys are normalizeKey-folded: lowercased, curly quote -> straight.
    const keys = rows.map(r => r.key).sort();
    expect(keys).toEqual(['apple', 'banana', "muad'dib"]);
    // Canonical word preserved (original casing/punctuation).
    const banana = rows.find(r => r.key === 'banana');
    expect(banana?.word).toBe('Banana');
    expect(banana?.definition).toBe('a long yellow fruit');
  });

  it('reads the body identically to lookupDict (parity)', async () => {
    const t = triple();
    const parsed = await buildDict(t.ifo, t.idx, t.dict);
    for (const row of entriesFromParsedDict(parsed)) {
      expect(row.definition).toBe(lookupDict(parsed, row.word)?.definition);
    }
  });

  // Regression byte-equality guard (issue #28): the sametypesequence
  // split must NOT shift the body for sts-PRESENT dicts. base.db is
  // built from WordNet, which sets sametypesequence=m, so persisted
  // bodies must remain byte-identical to the raw payload for both the
  // common 'm' (plain) and 'h' (html) single-char sts values.
  it.each(['m', 'h'])(
    'sts-present (=%s): persisted definitions equal the raw payload (no prefix/NUL shift)',
    async sts => {
      const t = buildSyntheticStarDict(DEFS, {sametypesequence: sts});
      const parsed = await buildDict(t.ifo, t.idx, t.dict);
      const rows = entriesFromParsedDict(parsed);
      const byKey = new Map(rows.map(r => [r.key, r.definition]));
      // The raw payload IS the definition verbatim when sts is present.
      expect(byKey.get('apple')).toBe('a round fruit');
      expect(byKey.get('banana')).toBe('a long yellow fruit');
      expect(byKey.get("muad'dib")).toBe('a desert mouse');
      // And it stays equal to what lookupDict returns.
      for (const row of rows) {
        expect(row.definition).toBe(lookupDict(parsed, row.word)?.definition);
      }
    },
  );

  it('sts-absent dict: persisted body == looked-up body (prefix/NUL stripped)', async () => {
    const t = buildSyntheticStarDict(DEFS, {omitSametypesequence: true});
    const parsed = await buildDict(t.ifo, t.idx, t.dict);
    for (const row of entriesFromParsedDict(parsed)) {
      expect(row.definition).toBe(lookupDict(parsed, row.word)?.definition);
    }
    const byKey = new Map(
      entriesFromParsedDict(parsed).map(r => [r.key, r.definition]),
    );
    // No leading type byte, no trailing NUL leaked into the stored body.
    expect(byKey.get('apple')).toBe('a round fruit');
  });
});

describe('deterministicBuiltAt', () => {
  it('uses the .ifo date field when present', async () => {
    const t = triple();
    const parsed = await buildDict(t.ifo, t.idx, t.dict);
    parsed.meta.rawFields.date = '2024-06-01';
    expect(deterministicBuiltAt(parsed)).toBe('2024-06-01');
  });

  it('falls back to a stable bookname@wordcount stamp (never Date.now)', async () => {
    const t = triple();
    const parsed = await buildDict(t.ifo, t.idx, t.dict);
    delete parsed.meta.rawFields.date;
    const a = deterministicBuiltAt(parsed);
    const b = deterministicBuiltAt(parsed);
    expect(a).toBe(b);
    expect(a).toContain('@');
  });

  it('treats an empty-string date as absent and falls back', async () => {
    const t = triple();
    const parsed = await buildDict(t.ifo, t.idx, t.dict);
    parsed.meta.rawFields.date = '';
    expect(deterministicBuiltAt(parsed)).toContain('@');
  });

  it('uses "base" in the stamp when bookname is absent', async () => {
    const t = triple();
    const parsed = await buildDict(t.ifo, t.idx, t.dict);
    delete parsed.meta.rawFields.date;
    parsed.meta.bookname = undefined;
    expect(deterministicBuiltAt(parsed)).toBe(`base@${parsed.meta.wordcount}`);
  });
});

describe('populateBaseDb / buildBaseDbFromTriple', () => {
  it('inserts every entry with format=wordnet and returns matching counts', async () => {
    const db = await emptyDb();
    const t = triple();
    const {insertedCount, expectedCount} = await buildBaseDbFromTriple(
      db,
      t.ifo,
      t.idx,
      t.dict,
      SCHEMA_VERSION,
    );
    expect(insertedCount).toBe(expectedCount);
    expect(insertedCount).toBe(3);

    const all = await db.query<{format: string}>('SELECT format FROM entries');
    expect(all.every(r => r.format === 'wordnet')).toBe(true);
    await db.close();
  });

  it('produces rows queryable by folded key (end-to-end)', async () => {
    const db = await emptyDb();
    const t = triple();
    await buildBaseDbFromTriple(db, t.ifo, t.idx, t.dict, SCHEMA_VERSION);

    // Straight apostrophe query hits the curly-quote headword's folded row.
    const rows = await db.query<{word: string; definition: string}>(
      SELECT_ENTRY_BY_KEY,
      ["muad'dib"],
    );
    expect(rows[0]).toEqual({word: 'Muad’Dib', definition: 'a desert mouse', format: 'wordnet', phonetic: null} as never);
    await db.close();
  });

  it('stamps the meta row with the schema version and built_at', async () => {
    const db = await emptyDb();
    const t = triple();
    await buildBaseDbFromTriple(db, t.ifo, t.idx, t.dict, SCHEMA_VERSION);
    const meta = await db.query<{schema_version: number}>(SELECT_META_VERSION);
    expect(meta).toEqual([{schema_version: SCHEMA_VERSION}]);
    await db.close();
  });

  it('writes meta LAST: entries + index exist before the meta row (crash-safety order)', async () => {
    // Drive populateBaseDb against a parsed dict and record the order in
    // which the meta table is created relative to entries — by spying on
    // run() we assert CREATE_META_TABLE comes after the entries insert.
    const t = triple();
    const parsed = await buildDict(t.ifo, t.idx, t.dict);
    const order: string[] = [];
    const raw = await emptyDb();
    const spy: SqliteDb = {
      query: raw.query.bind(raw),
      run: async (sql, params) => {
        order.push(sql.split(' ').slice(0, 3).join(' '));
        return raw.run(sql, params);
      },
      transaction: async fn => {
        order.push('TRANSACTION entries');
        return raw.transaction(fn);
      },
      close: raw.close.bind(raw),
    };
    await populateBaseDb(spy, parsed, SCHEMA_VERSION);

    const entriesIdx = order.findIndex(s => s.startsWith('TRANSACTION'));
    const metaIdx = order.findIndex(s => s.startsWith('INSERT INTO meta'));
    expect(entriesIdx).toBeGreaterThanOrEqual(0);
    expect(metaIdx).toBeGreaterThan(entriesIdx);
    await raw.close();
  });
});

describe('populateBaseDb with omwRows (TF4-FR1)', () => {
  const OMW: OmwRow[] = [
    {key: 'apple', lang: 'en', rel: 'synonym', target: 'orchard apple tree'},
    {key: 'apple', lang: 'en', rel: 'antonym', target: 'nonfruit'},
  ];

  it('ALWAYS creates an (empty) thesaurus table when omwRows is omitted (M9 fix 3)', async () => {
    const db = await emptyDb();
    const t = triple();
    await buildBaseDbFromTriple(db, t.ifo, t.idx, t.dict, SCHEMA_VERSION);
    // The thesaurus table EXISTS (so lookupThesaurus won't hit
    // "no such table"), and is empty.
    const tbl = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      ['thesaurus'],
    );
    expect(tbl).toEqual([{name: 'thesaurus'}]);
    const count = await db.query<{n: number}>('SELECT count(*) AS n FROM thesaurus');
    expect(count[0].n).toBe(0);
    await db.close();
  });

  it('populates the thesaurus when omwRows is supplied', async () => {
    const db = await emptyDb();
    const t = triple();
    await buildBaseDbFromTriple(db, t.ifo, t.idx, t.dict, SCHEMA_VERSION, OMW);
    const rows = await db.query(SELECT_THESAURUS_BY_KEY_LANG, ['apple', 'en']);
    expect(rows).toEqual([
      {rel: 'synonym', target: 'orchard apple tree'},
      {rel: 'antonym', target: 'nonfruit'},
    ]);
    await db.close();
  });

  it('keeps meta LAST: thesaurus is written BETWEEN entries-index and meta', async () => {
    const t = triple();
    const parsed = await buildDict(t.ifo, t.idx, t.dict);
    const order: string[] = [];
    const raw = await emptyDb();
    const spy: SqliteDb = {
      query: raw.query.bind(raw),
      run: async (sql, params) => {
        if (sql.startsWith('CREATE INDEX IF NOT EXISTS idx_entries')) {
          order.push('ENTRIES_INDEX');
        } else if (sql.startsWith('CREATE TABLE IF NOT EXISTS thesaurus')) {
          order.push('THESAURUS_TABLE');
        } else if (sql.startsWith('INSERT INTO meta')) {
          order.push('META');
        }
        return raw.run(sql, params);
      },
      transaction: raw.transaction.bind(raw),
      close: raw.close.bind(raw),
    };
    await populateBaseDb(spy, parsed, SCHEMA_VERSION, 'wordnet', OMW);

    const ei = order.indexOf('ENTRIES_INDEX');
    const ti = order.indexOf('THESAURUS_TABLE');
    const mi = order.indexOf('META');
    expect(ei).toBeGreaterThanOrEqual(0);
    expect(ti).toBeGreaterThan(ei); // thesaurus after entries index
    expect(mi).toBeGreaterThan(ti); // meta after thesaurus -> still LAST
    await raw.close();
  });
});
