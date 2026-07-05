// Imports audit (TF5-FR5). Reads/writes the `imports` table in the
// WRITABLE user.db (Designer flag 4 — never base.db). The audit is the
// only persistent record of a sideloaded dict after its source files
// are deleted, so it must stay consistent: a re-import of the same
// (name, lang) REPLACES the prior row atomically (Designer flag 3).

import {runAdditiveColumnMigration, type SqliteDb} from './db';
import {refreshTargetFilename} from './importSidecar';
import {
  ALTER_IMPORTS_ADD_IMPORTER_VERSION,
  CREATE_IMPORTS_IDENTITY_INDEX,
  CREATE_IMPORTS_TABLE,
  DELETE_IMPORTS_DUPLICATES,
  DELETE_IMPORT_BY_NAME_LANG,
  SELECT_IMPORT_BY_FILENAME,
  SELECT_IMPORT_BY_NAME_LANG,
  UPSERT_IMPORT,
  type ImportRow,
} from './schema';

// Idempotent table create + the migration chain that ends in the UNIQUE
// (name, lang) index UPSERT_IMPORT depends on. Order matters:
//   1. CREATE table (fresh installs already carry importer_version + no dupes);
//   2. additive importer_version ALTER for an EXISTING pre-versioning table
//      (runAdditiveColumnMigration swallows the idempotent "duplicate column");
//   3. dedupe to newest-per-identity (an old pre-index table may hold duplicate
//      (name, lang) rows, which would make step 4 fail);
//   4. CREATE UNIQUE INDEX — the atomic-swap enabler.
export const ensureImportsTable = async (db: SqliteDb): Promise<void> => {
  await db.run(CREATE_IMPORTS_TABLE);
  await runAdditiveColumnMigration(db, ALTER_IMPORTS_ADD_IMPORTER_VERSION);
  await db.run(DELETE_IMPORTS_DUPLICATES);
  await db.run(CREATE_IMPORTS_IDENTITY_INDEX);
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

// Replace any existing (name, lang) row with the new one in ONE statement
// (Designer flag 3). INSERT OR REPLACE against the UNIQUE (name, lang) index is
// an atomic delete+insert — so on device, where each statement is its own
// autocommit and no multi-statement transaction survives, the audit row is
// repointed to the new slug in a single indivisible step. Deliberately NO
// transaction() wrapper: the atomicity lives in the statement, not a BEGIN.
export const upsertImport = async (
  db: SqliteDb,
  row: ImportRow,
): Promise<void> => {
  await db.run(UPSERT_IMPORT, [
    row.name,
    row.lang,
    row.entry_count,
    row.imported_at,
    row.filename,
    row.importer_version,
  ]);
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

// Resolve a slug-DB filename collision. A candidate `<slug>.<lang>.db` is
// usable only when NEITHER it NOR its A/B sibling (refreshTargetFilename) is
// owned by a DIFFERENT (name, lang) — a refresh of a foreign dict may be
// living in the sibling slot, so claiming the base would let two dicts share a
// pair. Both slots free, or owned by the SAME (name, lang), makes the candidate
// usable (a re-import overwrites its own pair). Otherwise try `<slug>-2`, `-3`,
// … inserting the suffix BEFORE the `.<lang>.db` tail.
export const resolveSlugCollision = async (
  baseFilename: string,
  name: string,
  lang: string,
  db: SqliteDb,
): Promise<string> => {
  const ownsSelfOrFree = (row: ImportRow | null): boolean =>
    row === null || (row.name === name && row.lang === lang);
  const usableFor = async (candidate: string): Promise<boolean> => {
    // Both lookups run in parallel — every SqliteDb adapter serializes access
    // to its single connection internally, so concurrent reads are safe.
    const [own, altOwn] = await Promise.all([
      findImportByFilename(db, candidate),
      findImportByFilename(db, refreshTargetFilename(candidate)),
    ]);
    return ownsSelfOrFree(own) && ownsSelfOrFree(altOwn);
  };

  if (await usableFor(baseFilename)) {
    return baseFilename;
  }
  // Split `<slug>.<lang>.db` into stem `<slug>` and tail `.<lang>.db`.
  const tail = `.${lang}.db`;
  const stem = baseFilename.endsWith(tail)
    ? baseFilename.slice(0, -tail.length)
    : baseFilename;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${tail}`;
    if (await usableFor(candidate)) {
      return candidate;
    }
  }
};
