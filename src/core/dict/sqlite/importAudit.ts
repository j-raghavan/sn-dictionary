// Imports audit (TF5-FR5). Reads/writes the `imports` table in the
// WRITABLE user.db (Designer flag 4 — never base.db). The audit is the
// only persistent record of a sideloaded dict after its source files
// are deleted, so it must stay consistent: a re-import of the same
// (name, lang) REPLACES the prior row atomically (Designer flag 3).

import type {SqliteDb} from './db';
import {
  CREATE_IMPORTS_TABLE,
  DELETE_IMPORT_BY_NAME_LANG,
  INSERT_IMPORT,
  SELECT_IMPORT_BY_FILENAME,
  SELECT_IMPORT_BY_NAME_LANG,
  type ImportRow,
} from './schema';

// Idempotent table create on the user.db handle.
export const ensureImportsTable = async (db: SqliteDb): Promise<void> => {
  await db.run(CREATE_IMPORTS_TABLE);
};

export const findImportByNameLang = async (
  db: SqliteDb,
  name: string,
  lang: string,
): Promise<ImportRow | null> => {
  const rows = await db.query<ImportRow>(SELECT_IMPORT_BY_NAME_LANG, [name, lang]);
  return rows.length > 0 ? rows[0] : null;
};

export const findImportByFilename = async (
  db: SqliteDb,
  filename: string,
): Promise<ImportRow | null> => {
  const rows = await db.query<ImportRow>(SELECT_IMPORT_BY_FILENAME, [filename]);
  return rows.length > 0 ? rows[0] : null;
};

// Replace any existing (name, lang) row with the new one in a SINGLE
// transaction (Designer flag 3) so a re-import never leaves either zero
// rows or two rows for the same logical dict.
export const upsertImport = async (
  db: SqliteDb,
  row: ImportRow,
): Promise<void> => {
  await db.transaction(async tx => {
    await tx.run(DELETE_IMPORT_BY_NAME_LANG, [row.name, row.lang]);
    await tx.run(INSERT_IMPORT, [
      row.name,
      row.lang,
      row.entry_count,
      row.imported_at,
      row.filename,
    ]);
  });
};

// F7 — delete the audit row for one imported dict, keyed by its logical
// identity (name, lang). Reuses DELETE_IMPORT_BY_NAME_LANG (the same SQL
// upsertImport's replace uses). Idempotent: deleting an absent row is a
// no-op (changes:0), so a half-deleted dict (audit already gone) cleans
// without error (F7-FR5). Resolves the rows-changed count so the caller
// can report whether a row was actually removed.
export const removeImport = async (
  db: SqliteDb,
  name: string,
  lang: string,
): Promise<{changes: number}> =>
  db.run(DELETE_IMPORT_BY_NAME_LANG, [name, lang]);

// Resolve a slug-DB filename collision. `baseFilename` is
// `<slug>.<lang>.db`. It is usable as-is when free, OR when the file it
// names is already owned by the SAME (name, lang) (a re-import
// overwrites its own file). Otherwise a different dict slugged to the
// same name: try `<slug>-2.<lang>.db`, `-3`, … inserting the suffix
// BEFORE the `.<lang>.db` tail.
export const resolveSlugCollision = async (
  baseFilename: string,
  name: string,
  lang: string,
  db: SqliteDb,
): Promise<string> => {
  const owner = await findImportByFilename(db, baseFilename);
  if (owner === null || (owner.name === name && owner.lang === lang)) {
    return baseFilename;
  }
  // Split `<slug>.<lang>.db` into stem `<slug>` and tail `.<lang>.db`.
  const tail = `.${lang}.db`;
  const stem = baseFilename.endsWith(tail)
    ? baseFilename.slice(0, -tail.length)
    : baseFilename;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${tail}`;
    const taken = await findImportByFilename(db, candidate);
    if (taken === null || (taken.name === name && taken.lang === lang)) {
      return candidate;
    }
  }
};
