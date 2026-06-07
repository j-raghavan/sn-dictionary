// TF8-FR2 (host-side slice): parity between the SQLite engine and the
// JS StarDict engine on DEFINITION LOOKUP and .syn ALIAS KEYS — the
// two things the spec scopes for this parity check (OMW thesaurus
// relations are out of scope; covered by separate TF4 tests).
//
// Both engines are driven from the SAME headword -> definition data so
// any divergence is the engine's, not the fixture's. The SQLite side
// is built by folding each headword with normalizeKey into the
// entries table — exactly what buildBaseDb / importStardict do at
// build/import time — and aliases are merged in as extra rows keyed by
// the alias's folded key pointing at the canonical definition (the
// ".syn merged into entries" semantics, TF8-FR2 / TF5-FR3).

import {createSeededDb} from './_helpers/betterSqliteDb';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';
import {CREATE_ENTRIES_TABLE} from '../src/core/dict/sqlite/schema';
import {createSqliteDictSource} from '../src/core/dict/sqlite/sqliteDictSource';
import {createStardictLookup} from '../src/core/dict/stardictLookup';
import {normalizeKey} from '../src/core/dict/normalizeKey';
import type {DictSource} from '../src/core/lookup';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

// Shared sample data. Includes a mixed-case headword and a curly-quote
// headword so normalizeKey folding is exercised on both sides.
const DEFS: Record<string, string> = {
  apple: 'a round fruit',
  banana: 'a long yellow fruit',
  Cherry: 'a small red stone fruit',
  'Muad’Dib': 'a desert mouse',
};

// Alias -> canonical headword (what a .syn file encodes). Both forms
// must resolve to the canonical definition.
const ALIASES: Record<string, string> = {
  apples: 'apple',
  pomme: 'apple',
};

const buildSqliteSource = async (): Promise<{
  source: DictSource;
  db: SqliteDb;
}> => {
  const db = await createSeededDb(async d => {
    await d.run(CREATE_ENTRIES_TABLE);
    for (const [word, def] of Object.entries(DEFS)) {
      await d.run('INSERT INTO entries VALUES (?, ?, ?, ?)', [
        normalizeKey(word),
        word,
        def,
        'plain',
      ]);
    }
    // .syn aliases merged into entries: alias's folded key -> the
    // canonical word + its definition.
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      await d.run('INSERT INTO entries VALUES (?, ?, ?, ?)', [
        normalizeKey(alias),
        canonical,
        DEFS[canonical],
        'plain',
      ]);
    }
  });
  const source = createSqliteDictSource({name: 'Sqlite', openDb: async () => db});
  return {source, db};
};

const stardictSource = (): DictSource =>
  createStardictLookup({
    name: 'StarDict',
    loadBase: async () => buildSyntheticStarDict(DEFS),
  });

describe('SQLite vs StarDict parity (TF8-FR2)', () => {
  it('returns the same definition for every headword (incl. case/punct folding)', async () => {
    const {source: sqlite, db} = await buildSqliteSource();
    const stardict = stardictSource();

    for (const word of Object.keys(DEFS)) {
      const [sq, sd] = await Promise.all([
        sqlite.lookup(word),
        stardict.lookup(word),
      ]);
      // Definitions match across engines.
      expect(sq?.definition).toBe(DEFS[word]);
      expect(sd?.definition).toBe(DEFS[word]);
      expect(sq?.definition).toBe(sd?.definition);
    }
    await db.close();
  });

  it('folds query variants to the same row on both engines', async () => {
    const {source: sqlite, db} = await buildSqliteSource();
    const stardict = stardictSource();

    // Mixed case + a straight apostrophe query against a curly-quote
    // headword — both must hit on both engines.
    for (const q of ['APPLE', 'cherry', "Muad'Dib"]) {
      const [sq, sd] = await Promise.all([
        sqlite.lookup(q),
        stardict.lookup(q),
      ]);
      expect(sq?.definition).toBeDefined();
      expect(sq?.definition).toBe(sd?.definition);
    }
    await db.close();
  });

  it('resolves .syn alias keys to the canonical definition (SQLite engine)', async () => {
    const {source: sqlite, db} = await buildSqliteSource();
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      const hit = await sqlite.lookup(alias);
      expect(hit?.definition).toBe(DEFS[canonical]);
    }
    await db.close();
  });

  it('agrees on misses', async () => {
    const {source: sqlite, db} = await buildSqliteSource();
    const stardict = stardictSource();
    expect(await sqlite.lookup('nonexistent')).toBeNull();
    expect(await stardict.lookup('nonexistent')).toBeNull();
    await db.close();
  });
});
