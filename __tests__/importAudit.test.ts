// Imports audit logic (TF5-FR5): table create, find, atomic upsert,
// and slug-collision resolution. Driven against the host better-sqlite3
// adapter (the user.db stand-in).

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  ensureImportsTable,
  findImportByFilename,
  findImportByNameLang,
  removeImport,
  resolveSlugCollision,
  upsertImport,
} from '../src/core/dict/sqlite/importAudit';
import {refreshTargetFilename} from '../src/core/dict/sqlite/importSidecar';
import {SELECT_IMPORT_BY_NAME_LANG} from '../src/core/dict/sqlite/schema';
import type {ImportRow} from '../src/core/dict/sqlite/schema';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  name: 'Dune',
  lang: 'en',
  entry_count: 10,
  imported_at: '2026-01-01T00:00:00Z',
  filename: 'dune.en.db',
  importer_version: 1,
  ...over,
});

const auditDb = (): Promise<SqliteDb> =>
  createSeededDb(async d => {
    await ensureImportsTable(d);
  });

// The pre-versioning 5-col imports DDL (before importer_version was added).
// Seeds an OLD user.db so the additive migration in ensureImportsTable can
// be exercised (CREATE ... IF NOT EXISTS never alters an existing table).
const LEGACY_IMPORTS_DDL =
  'CREATE TABLE imports (' +
  'name TEXT NOT NULL, ' +
  'lang TEXT NOT NULL, ' +
  'entry_count INTEGER NOT NULL, ' +
  'imported_at TEXT NOT NULL, ' +
  'filename TEXT NOT NULL)';

describe('ensureImportsTable', () => {
  it('is idempotent (re-run is a no-op)', async () => {
    const db = await auditDb();
    await ensureImportsTable(db);
    await ensureImportsTable(db);
    const tbl = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      ['imports'],
    );
    expect(tbl).toEqual([{name: 'imports'}]);
    await db.close();
  });

  it('migrates a legacy 5-col imports table: adds importer_version (defaults 0)', async () => {
    // An old user.db with the pre-versioning table + a row from before the
    // stamp existed. ensureImportsTable ALTERs the column in; the pre-migration
    // row reads back importer_version 0 (stale by definition).
    const db = await createSeededDb(async d => {
      await d.run(LEGACY_IMPORTS_DDL);
      await d.run(
        'INSERT INTO imports (name, lang, entry_count, imported_at, filename) VALUES (?, ?, ?, ?, ?)',
        ['Old', 'en', 5, 't', 'old.en.db'],
      );
    });
    await ensureImportsTable(db);
    const cols = await db.query<{name: string}>('PRAGMA table_info(imports)');
    expect(cols.map(c => c.name)).toContain('importer_version');
    expect(await findImportByNameLang(db, 'Old', 'en')).toEqual(
      row({name: 'Old', lang: 'en', entry_count: 5, imported_at: 't', filename: 'old.en.db', importer_version: 0}),
    );
    await db.close();
  });

  it('is idempotent over the migration: re-running keeps ONE importer_version column', async () => {
    const db = await createSeededDb(async d => {
      await d.run(LEGACY_IMPORTS_DDL);
    });
    await ensureImportsTable(db);
    await ensureImportsTable(db);
    const cols = await db.query<{name: string}>('PRAGMA table_info(imports)');
    expect(cols.filter(c => c.name === 'importer_version')).toHaveLength(1);
    await db.close();
  });

  it('creates the UNIQUE (name, lang) identity index (the atomic-swap enabler)', async () => {
    const db = await auditDb();
    const idx = await db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
      ['idx_imports_name_lang'],
    );
    expect(idx).toEqual([{name: 'idx_imports_name_lang'}]);
    await db.close();
  });

  it('dedupes duplicate (name, lang) rows to the NEWEST before building the UNIQUE index', async () => {
    // A pre-index legacy table can hold two rows for one identity; ensureImports
    // Table must collapse them (keeping newest) or CREATE UNIQUE INDEX throws.
    const db = await createSeededDb(async d => {
      await d.run(LEGACY_IMPORTS_DDL);
      await d.run(
        'INSERT INTO imports (name, lang, entry_count, imported_at, filename) VALUES (?, ?, ?, ?, ?)',
        ['Dup', 'en', 1, 'old', 'dup.en.db'],
      );
      await d.run(
        'INSERT INTO imports (name, lang, entry_count, imported_at, filename) VALUES (?, ?, ?, ?, ?)',
        ['Dup', 'en', 2, 'new', 'dup.en.alt.db'],
      );
    });
    await ensureImportsTable(db); // must not throw despite the duplicate
    const rows = await db.query<{imported_at: string}>(SELECT_IMPORT_BY_NAME_LANG, [
      'Dup',
      'en',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].imported_at).toBe('new');
    await db.close();
  });

  it('re-throws a NON-"duplicate column" ALTER error (a real failure is not swallowed)', async () => {
    // Only the idempotent "duplicate column name" case is swallowed; any other
    // ALTER failure (e.g. disk I/O) must propagate so the caller degrades.
    const db = await auditDb();
    const realRun = db.run.bind(db);
    db.run = ((sql: string, params?: unknown[]) =>
      /ALTER TABLE imports ADD COLUMN importer_version/i.test(sql)
        ? Promise.reject(new Error('disk I/O error'))
        : realRun(sql, params as never)) as typeof db.run;
    await expect(ensureImportsTable(db)).rejects.toThrow('disk I/O error');
    await db.close();
  });
});

describe('upsertImport + find', () => {
  it('inserts a new row', async () => {
    const db = await auditDb();
    await upsertImport(db, row());
    expect(await findImportByNameLang(db, 'Dune', 'en')).toEqual(row());
    await db.close();
  });

  it('round-trips importer_version (the stamp bootstrap reads for staleness)', async () => {
    const db = await auditDb();
    await upsertImport(db, row({importer_version: 7}));
    expect(await findImportByNameLang(db, 'Dune', 'en')).toMatchObject({
      importer_version: 7,
    });
    await db.close();
  });

  it('issues exactly ONE run() and ZERO transaction() — single-statement atomic swap', async () => {
    // On device every statement autocommits; the atomicity MUST live in one
    // INSERT OR REPLACE, never a BEGIN. A recording fake proves upsertImport
    // never opens a transaction and runs exactly one statement.
    const runSql: string[] = [];
    let txCount = 0;
    const rec: SqliteDb = {
      query: async () => [],
      run: async (sql: string) => {
        runSql.push(sql);
        return {changes: 1};
      },
      transaction: async fn => {
        txCount += 1;
        await fn(rec);
      },
      close: async () => undefined,
    };
    await upsertImport(rec, row());
    expect(txCount).toBe(0);
    expect(runSql).toHaveLength(1);
    expect(runSql[0]).toMatch(/INSERT OR REPLACE INTO imports/i);
  });

  it('replaces an existing (name, lang) row atomically (one row remains)', async () => {
    const db = await auditDb();
    await upsertImport(db, row({entry_count: 10, filename: 'dune.en.db'}));
    await upsertImport(db, row({entry_count: 20, filename: 'dune.en.db'}));
    const all = await db.query<ImportRow>(SELECT_IMPORT_BY_NAME_LANG, ['Dune', 'en']);
    expect(all).toHaveLength(1);
    expect(all[0].entry_count).toBe(20);
    await db.close();
  });

  it('lets a different (name, lang) coexist', async () => {
    const db = await auditDb();
    await upsertImport(db, row({name: 'Dune', lang: 'en'}));
    await upsertImport(db, row({name: 'Atlas', lang: 'de', filename: 'atlas.de.db'}));
    expect(await findImportByNameLang(db, 'Dune', 'en')).not.toBeNull();
    expect(await findImportByNameLang(db, 'Atlas', 'de')).not.toBeNull();
    await db.close();
  });

  it('returns null for an unknown name/lang or filename', async () => {
    const db = await auditDb();
    expect(await findImportByNameLang(db, 'Nope', 'en')).toBeNull();
    expect(await findImportByFilename(db, 'nope.en.db')).toBeNull();
    await db.close();
  });
});

describe('resolveSlugCollision', () => {
  it('returns the base filename when free', async () => {
    const db = await auditDb();
    expect(await resolveSlugCollision('dune.en.db', 'Dune', 'en', db)).toBe(
      'dune.en.db',
    );
    await db.close();
  });

  it('returns the base filename when owned by the SAME name+lang (re-import)', async () => {
    const db = await auditDb();
    await upsertImport(db, row({name: 'Dune', lang: 'en', filename: 'dune.en.db'}));
    expect(await resolveSlugCollision('dune.en.db', 'Dune', 'en', db)).toBe(
      'dune.en.db',
    );
    await db.close();
  });

  it('suffixes -2 when a DIFFERENT dict already owns the base name', async () => {
    const db = await auditDb();
    await upsertImport(db, row({name: 'Dune One', lang: 'en', filename: 'dune.en.db'}));
    expect(await resolveSlugCollision('dune.en.db', 'Dune Two', 'en', db)).toBe(
      'dune-2.en.db',
    );
    await db.close();
  });

  it('walks -2, -3 … past consecutive collisions', async () => {
    const db = await auditDb();
    await upsertImport(db, row({name: 'A', lang: 'en', filename: 'dune.en.db'}));
    await upsertImport(db, row({name: 'B', lang: 'en', filename: 'dune-2.en.db'}));
    expect(await resolveSlugCollision('dune.en.db', 'C', 'en', db)).toBe(
      'dune-3.en.db',
    );
    await db.close();
  });

  it('suffixes a base filename that lacks the .<lang>.db tail (defensive)', async () => {
    const db = await auditDb();
    // baseFilename does NOT end in .en.db -> stem === whole filename.
    await upsertImport(db, row({name: 'A', lang: 'en', filename: 'odd-name'}));
    expect(await resolveSlugCollision('odd-name', 'B', 'en', db)).toBe(
      'odd-name-2.en.db',
    );
    await db.close();
  });

  it('reuses a suffixed slot owned by the same name+lang', async () => {
    const db = await auditDb();
    await upsertImport(db, row({name: 'A', lang: 'en', filename: 'dune.en.db'}));
    await upsertImport(db, row({name: 'C', lang: 'en', filename: 'dune-2.en.db'}));
    // Re-importing C resolves back to its own -2 slot.
    expect(await resolveSlugCollision('dune.en.db', 'C', 'en', db)).toBe(
      'dune-2.en.db',
    );
    await db.close();
  });

  it('a candidate whose ALT slot is owned by a DIFFERENT dict advances to -2 (NEW-1)', async () => {
    const db = await auditDb();
    // A foreign dict's refresh lives in the sibling of the base candidate, so
    // the base pair is not free even though the base filename itself is.
    await upsertImport(
      db,
      row({name: 'Other', lang: 'en', filename: refreshTargetFilename('dune.en.db')}),
    );
    expect(await resolveSlugCollision('dune.en.db', 'Dune', 'en', db)).toBe(
      'dune-2.en.db',
    );
    await db.close();
  });

  it('an ALT-slot row owned by the SAME name+lang leaves the base reusable (NEW-1)', async () => {
    const db = await auditDb();
    // The dict's own sibling slot doesn't block reclaiming its base slot.
    await upsertImport(
      db,
      row({name: 'Dune', lang: 'en', filename: refreshTargetFilename('dune.en.db')}),
    );
    expect(await resolveSlugCollision('dune.en.db', 'Dune', 'en', db)).toBe(
      'dune.en.db',
    );
    await db.close();
  });
});

describe('removeImport (F7)', () => {
  it('deletes the (name, lang) row and reports one change', async () => {
    const db = await auditDb();
    await upsertImport(db, row({name: 'Dune', lang: 'en'}));
    await upsertImport(db, row({name: 'Dune', lang: 'de', filename: 'dune.de.db'}));
    const res = await removeImport(db, 'Dune', 'en');
    expect(res.changes).toBe(1);
    // The en row is gone; the de row (same name, different lang) is untouched.
    expect(await findImportByNameLang(db, 'Dune', 'en')).toBeNull();
    expect(await findImportByNameLang(db, 'Dune', 'de')).not.toBeNull();
    await db.close();
  });

  it('is idempotent: removing an absent row is a no-op (changes:0)', async () => {
    const db = await auditDb();
    const res = await removeImport(db, 'Ghost', 'en');
    expect(res.changes).toBe(0);
    await db.close();
  });
});
