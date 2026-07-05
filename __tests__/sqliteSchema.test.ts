// The entries schema is the build/import/query source of truth, so
// pin its shape: the table + index DDL apply cleanly, the SELECT is
// LIMIT-1 first-row-wins and projects exactly {word, definition,
// format} (key bound, not selected), and DEFINITION_FORMATS matches
// the DefinitionFormat union the popup renders.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  ALTER_IMPORTS_ADD_IMPORTER_VERSION,
  CREATE_ENTRIES_INDEX,
  CREATE_ENTRIES_TABLE,
  CREATE_IMPORTS_IDENTITY_INDEX,
  CREATE_IMPORTS_TABLE,
  CREATE_META_TABLE,
  DEFINITION_FORMATS,
  DELETE_IMPORTS_DUPLICATES,
  IMPORTER_VERSION,
  INSERT_META,
  SELECT_ENTRY_BY_KEY,
  SELECT_IMPORT_BY_NAME_LANG,
  UPSERT_IMPORT,
  SELECT_META_VERSION,
  CREATE_THESAURUS_INDEX,
  CREATE_THESAURUS_TABLE,
  INSERT_THESAURUS,
  SELECT_THESAURUS_BY_KEY_LANG,
  THESAURUS_RELATIONS,
} from '../src/core/dict/sqlite/schema';

describe('entries schema', () => {
  it('creates the table and index without error', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run(CREATE_ENTRIES_INDEX);
    });
    // Both DDL statements are idempotent (IF NOT EXISTS) — re-running
    // them is a no-op rather than a duplicate-object error.
    await db.run(CREATE_ENTRIES_TABLE);
    await db.run(CREATE_ENTRIES_INDEX);

    const idx = await db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
      ['idx_entries_key'],
    );
    expect(idx).toEqual([{name: 'idx_entries_key'}]);
    await db.close();
  });

  it('SELECT_ENTRY_BY_KEY projects {word, definition, format, phonetic} and binds the key', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
        'hello',
        'Hello',
        'a greeting',
        'plain',
      ]);
    });
    const rows = await db.query(SELECT_ENTRY_BY_KEY, ['hello']);
    // v3: phonetic projected (null when not written by a 4-col INSERT).
    expect(rows).toEqual([
      {word: 'Hello', definition: 'a greeting', format: 'plain', phonetic: null},
    ]);
    // key is bound, not part of the projection.
    expect(Object.keys(rows[0] as object)).not.toContain('key');
    await db.close();
  });

  it('SELECT_ENTRY_BY_KEY returns at most one row (LIMIT 1, first-row-wins)', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
        'dup',
        'First',
        'first def',
        'plain',
      ]);
      await d.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
        'dup',
        'Second',
        'second def',
        'html',
      ]);
    });
    const rows = await db.query(SELECT_ENTRY_BY_KEY, ['dup']);
    expect(rows).toHaveLength(1);
    await db.close();
  });

  it('DEFINITION_FORMATS lists exactly the renderable formats', () => {
    expect([...DEFINITION_FORMATS].sort()).toEqual(['html', 'plain', 'wordnet']);
  });
});

describe('meta schema (TF3-FR3)', () => {
  it('creates the meta table and round-trips a single version row', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_META_TABLE);
      await d.run(INSERT_META, [3, '2024-01-01T00:00:00Z']);
    });
    // Idempotent re-create is a no-op.
    await db.run(CREATE_META_TABLE);

    const rows = await db.query<{schema_version: number}>(SELECT_META_VERSION);
    expect(rows).toEqual([{schema_version: 3}]);
    await db.close();
  });

  it('SELECT_META_VERSION returns zero rows when meta is absent', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_META_TABLE);
    });
    const rows = await db.query(SELECT_META_VERSION);
    expect(rows).toEqual([]);
    await db.close();
  });

  it('SELECT_META_VERSION returns at most one row (LIMIT 1)', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_META_TABLE);
      await d.run(INSERT_META, [1, 'a']);
      await d.run(INSERT_META, [2, 'b']);
    });
    expect(await db.query(SELECT_META_VERSION)).toHaveLength(1);
    await db.close();
  });

  it('preserves schema_version 0 as a valid stamped value', async () => {
    // 0 is falsy but a legitimate version — provisioning must compare
    // === EXPECTED, never `if (version)`.
    const db = await createSeededDb(async d => {
      await d.run(CREATE_META_TABLE);
      await d.run(INSERT_META, [0, 'zero']);
    });
    const rows = await db.query<{schema_version: number}>(SELECT_META_VERSION);
    expect(rows[0].schema_version).toBe(0);
    await db.close();
  });
});

describe('imports schema (TF5-FR5) — importer_version stamping', () => {
  it('CREATE_IMPORTS_TABLE carries importer_version INTEGER NOT NULL DEFAULT 0', () => {
    expect(CREATE_IMPORTS_TABLE).toContain(
      'importer_version INTEGER NOT NULL DEFAULT 0',
    );
  });

  it('the ALTER literal adds importer_version with the same default (existing DBs)', () => {
    expect(ALTER_IMPORTS_ADD_IMPORTER_VERSION).toBe(
      'ALTER TABLE imports ADD COLUMN importer_version INTEGER NOT NULL DEFAULT 0',
    );
  });

  it('a fresh CREATE defaults a 5-value insert to importer_version 0', async () => {
    // A row inserted with the legacy 5-value shape (no explicit stamp) reads
    // back 0 — the pre-versioning "stale by definition" value.
    const db = await createSeededDb(async d => {
      await d.run(CREATE_IMPORTS_TABLE);
      await d.run(
        'INSERT INTO imports (name, lang, entry_count, imported_at, filename) VALUES (?, ?, ?, ?, ?)',
        ['A', 'en', 1, 't', 'a.en.db'],
      );
    });
    const rows = await db.query<{importer_version: number}>(
      SELECT_IMPORT_BY_NAME_LANG,
      ['A', 'en'],
    );
    expect(rows[0].importer_version).toBe(0);
    await db.close();
  });

  it('UPSERT_IMPORT binds six values (name, lang, count, at, filename, version)', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_IMPORTS_TABLE);
      await d.run(UPSERT_IMPORT, ['A', 'en', 1, 't', 'a.en.db', 3]);
    });
    const rows = await db.query<{importer_version: number}>(
      SELECT_IMPORT_BY_NAME_LANG,
      ['A', 'en'],
    );
    expect(rows[0].importer_version).toBe(3);
    await db.close();
  });

  it('UPSERT_IMPORT is a single-statement atomic swap over the UNIQUE (name, lang) index', async () => {
    // With the UNIQUE index present, INSERT OR REPLACE keeps exactly ONE row
    // per identity, updating its values in place — no delete+insert transaction.
    const db = await createSeededDb(async d => {
      await d.run(CREATE_IMPORTS_TABLE);
      await d.run(CREATE_IMPORTS_IDENTITY_INDEX);
      await d.run(UPSERT_IMPORT, ['A', 'en', 1, 't1', 'a.en.db', 1]);
      await d.run(UPSERT_IMPORT, ['A', 'en', 9, 't2', 'a.en.alt.db', 2]);
    });
    const rows = await db.query<{
      entry_count: number;
      filename: string;
      importer_version: number;
    }>(SELECT_IMPORT_BY_NAME_LANG, ['A', 'en']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entry_count: 9,
      filename: 'a.en.alt.db',
      importer_version: 2,
    });
    await db.close();
  });

  it('CREATE_IMPORTS_IDENTITY_INDEX is a UNIQUE index on (name, lang)', () => {
    expect(CREATE_IMPORTS_IDENTITY_INDEX).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_name_lang ON imports(name, lang)',
    );
  });

  it('DELETE_IMPORTS_DUPLICATES keeps the NEWEST row per (name, lang)', async () => {
    // Simulate a pre-index table holding duplicate identities; the dedupe keeps
    // the max-rowid (newest) row so CREATE UNIQUE INDEX can then be built.
    const db = await createSeededDb(async d => {
      await d.run(CREATE_IMPORTS_TABLE);
      await d.run(UPSERT_IMPORT, ['A', 'en', 1, 'old', 'a.en.db', 0]);
      // A raw second insert (no unique index yet) creates a duplicate identity.
      await d.run(
        'INSERT INTO imports (name, lang, entry_count, imported_at, filename, importer_version) VALUES (?, ?, ?, ?, ?, ?)',
        ['A', 'en', 2, 'new', 'a.en.alt.db', 1],
      );
    });
    await db.run(DELETE_IMPORTS_DUPLICATES);
    const rows = await db.query<{imported_at: string}>(SELECT_IMPORT_BY_NAME_LANG, [
      'A',
      'en',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].imported_at).toBe('new');
    await db.close();
  });

  it('IMPORTER_VERSION is a positive integer (>= 1)', () => {
    expect(Number.isInteger(IMPORTER_VERSION)).toBe(true);
    expect(IMPORTER_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe('thesaurus schema (TF4-FR1)', () => {
  it('creates the thesaurus table and (key, lang) index without error', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_THESAURUS_TABLE);
      await d.run(CREATE_THESAURUS_INDEX);
    });
    // Idempotent re-create is a no-op.
    await db.run(CREATE_THESAURUS_TABLE);
    await db.run(CREATE_THESAURUS_INDEX);

    const idx = await db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
      ['idx_thes_key'],
    );
    expect(idx).toEqual([{name: 'idx_thes_key'}]);
    await db.close();
  });

  it('SELECT_THESAURUS_BY_KEY_LANG projects {rel, target} filtered by key+lang', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_THESAURUS_TABLE);
      await d.run(INSERT_THESAURUS, ['happy', 'en', 'synonym', 'glad']);
      await d.run(INSERT_THESAURUS, ['happy', 'en', 'antonym', 'sad']);
      await d.run(INSERT_THESAURUS, ['happy', 'de', 'synonym', 'froh']);
    });
    const rows = await db.query(SELECT_THESAURUS_BY_KEY_LANG, ['happy', 'en']);
    expect(rows).toEqual([
      {rel: 'synonym', target: 'glad'},
      {rel: 'antonym', target: 'sad'},
    ]);
    await db.close();
  });

  it('THESAURUS_RELATIONS lists exactly synonym + antonym', () => {
    expect([...THESAURUS_RELATIONS]).toEqual(['synonym', 'antonym']);
  });
});
