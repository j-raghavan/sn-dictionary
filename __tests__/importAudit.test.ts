// Imports audit logic (TF5-FR5): table create, find, atomic upsert,
// and slug-collision resolution. Driven against the host better-sqlite3
// adapter (the user.db stand-in).

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  ensureImportsTable,
  findImportByFilename,
  findImportByNameLang,
  resolveSlugCollision,
  upsertImport,
} from '../src/core/dict/sqlite/importAudit';
import {SELECT_IMPORT_BY_NAME_LANG} from '../src/core/dict/sqlite/schema';
import type {ImportRow} from '../src/core/dict/sqlite/schema';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  name: 'Dune',
  lang: 'en',
  entry_count: 10,
  imported_at: '2026-01-01T00:00:00Z',
  filename: 'dune.en.db',
  ...over,
});

const auditDb = (): Promise<SqliteDb> =>
  createSeededDb(async d => {
    await ensureImportsTable(d);
  });

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
});

describe('upsertImport + find', () => {
  it('inserts a new row', async () => {
    const db = await auditDb();
    await upsertImport(db, row());
    expect(await findImportByNameLang(db, 'Dune', 'en')).toEqual(row());
    await db.close();
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
});
