// The `entries` table schema and the one read query the dictionary
// engine runs. Centralised so build-time generation (buildBaseDb),
// the import pipeline (TF5), and the runtime engine (sqliteDictSource)
// all agree on column names, types, and the indexed-key contract —
// keys must never diverge across build / import / query (IV-4 /
// IV-6).
//
// Column contract (TF2-FR3):
//   key        TEXT NOT NULL  — the normalizeKey-folded lookup key
//                               (NFC + punctuation fold + lowercase),
//                               identical to today's in-memory index
//                               key, so lookup semantics carry over.
//                               Bind-only: never projected back out.
//   word       TEXT NOT NULL  — the canonical headword to display.
//   definition TEXT NOT NULL  — the rendered body.
//   format     TEXT NOT NULL  — one of DEFINITION_FORMATS; tells the
//                               popup which renderer to use.

import type {DefinitionFormat} from '../../lookup';

// schema v3 (M16): `phonetic TEXT` is a NULLABLE last column so CSV
// imports can carry a pronunciation (rendered under the headword by the
// popup). base.db/StarDict INSERTs stay 4-col — SQLite fills phonetic
// NULL. selectByKey maps it to DictEntry.phonetic only when non-null &
// non-empty, and tolerates an old slug DB whose `entries` lacks the
// column (defensive — see sqliteDictSource).
export const CREATE_ENTRIES_TABLE =
  'CREATE TABLE IF NOT EXISTS entries (' +
  'key TEXT NOT NULL, ' +
  'word TEXT NOT NULL, ' +
  'definition TEXT NOT NULL, ' +
  'format TEXT NOT NULL, ' +
  'phonetic TEXT)';

// Index on the folded lookup key — this is what turns the lookup into
// a single indexed probe instead of a table scan (the whole point of
// TF2: no parse, no Map build, just an indexed query).
export const CREATE_ENTRIES_INDEX =
  'CREATE INDEX IF NOT EXISTS idx_entries_key ON entries(key)';

// --- user.db entries (TF7) ------------------------------------------
// user.db carries the SAME 'entries' table name as base.db (Designer
// ruling 3) so the user source reuses createSqliteDictSource +
// SELECT_ENTRY_BY_KEY verbatim — but as a column SUPERSET: lang +
// created_at for user-added words. The extra columns default so the
// shared 4-col SELECT (word, definition, format) keeps working. This
// 7-col CREATE runs ONLY against user.db (base.db/imports keep the
// 4-col CREATE_ENTRIES_TABLE). The v3 `phonetic` column is a NULLABLE
// last column so the shared v3 SELECT_ENTRY_BY_KEY (which projects
// phonetic) runs against user.db WITHOUT throwing "no such column"
// (M17-FR2). An EXISTING on-device user.db gets the column via the
// additive ALTER migration in bootstrap (IF NOT EXISTS won't alter it).
export const CREATE_USER_ENTRIES_TABLE =
  'CREATE TABLE IF NOT EXISTS entries (' +
  'key TEXT NOT NULL, ' +
  'word TEXT NOT NULL, ' +
  'definition TEXT NOT NULL, ' +
  'format TEXT NOT NULL, ' +
  "lang TEXT NOT NULL DEFAULT 'und', " +
  'created_at TEXT NOT NULL, ' +
  'phonetic TEXT)';

// Additive migration to bring an EXISTING (pre-v3) user.db's entries
// table up to the 7-col shape. Idempotent: on a fresh 7-col table SQLite
// raises "duplicate column name: phonetic", which the caller swallows.
export const ALTER_USER_ENTRIES_ADD_PHONETIC =
  'ALTER TABLE entries ADD COLUMN phonetic TEXT';

export const CREATE_USER_ENTRIES_INDEX =
  'CREATE INDEX IF NOT EXISTS idx_user_key ON entries(key)';

export const INSERT_USER_ENTRY =
  'INSERT INTO entries (key, word, definition, format, lang, created_at) ' +
  'VALUES (?, ?, ?, ?, ?, ?)';

// First row wins (TF2-FR4): LIMIT 1 so a duplicate-key table returns
// one deterministic row. `key` is bound, never selected. Projects the
// v3 `phonetic` column; selectByKey falls back to the 4-col SELECT for
// an old DB that lacks it.
export const SELECT_ENTRY_BY_KEY =
  'SELECT word, definition, format, phonetic FROM entries WHERE key = ? LIMIT 1';

// The 4-col fallback for a pre-v3 `entries` (no phonetic column) —
// e.g. user.db's 6-col table or an old StarDict slug.
export const SELECT_ENTRY_BY_KEY_NO_PHONETIC =
  'SELECT word, definition, format FROM entries WHERE key = ? LIMIT 1';

// Insert a CSV entry (5-col, with phonetic — bound NULL when absent).
export const INSERT_CSV_ENTRY =
  'INSERT INTO entries (key, word, definition, format, phonetic) ' +
  'VALUES (?, ?, ?, ?, ?)';

// The projected shape of SELECT_ENTRY_BY_KEY. `format` is the raw
// string off the row; the engine validates it against
// DEFINITION_FORMATS before trusting it as a DefinitionFormat.
// `phonetic` is null when the column is absent-by-value (StarDict/base).
export interface EntryRow {
  word: string;
  definition: string;
  format: string;
  phonetic?: string | null;
}

// The valid `format` values (mirrors DefinitionFormat in lookup.ts).
// Used for boundary validation: a row whose format isn't in this set
// (corrupt DB, a future writer, a hand-edited file) falls back to
// 'plain' rather than being blindly cast — the body still renders,
// just without structured parsing.
export const DEFINITION_FORMATS: readonly DefinitionFormat[] = [
  'wordnet',
  'html',
  'plain',
];

// --- meta table (TF3-FR3) -------------------------------------------
// A single-row table stamping each generated DB with its schema
// version (so provisioning can detect a stale bundled DB and re-copy)
// and a deterministic build timestamp (audit trail). The GENERATOR is
// the ONLY writer (INSERT_META); provisioning reads SELECT_META_VERSION
// and NEVER writes the read-only base.db (IV-2). The generator writes
// this row LAST (after entries + index) so a power-loss mid-build
// leaves meta absent, which provisioning treats as "reprovision".

export const CREATE_META_TABLE =
  'CREATE TABLE IF NOT EXISTS meta (' +
  'schema_version INTEGER NOT NULL, ' +
  'built_at TEXT NOT NULL)';

// Read the stamped schema version. LIMIT 1: the table holds exactly
// one row. Returns zero rows when meta is absent (mid-build crash /
// pre-meta DB) — the caller treats rows.length === 0 as reprovision.
export const SELECT_META_VERSION = 'SELECT schema_version FROM meta LIMIT 1';

// Generator-only write (IV-2). Never called by provision.ts.
export const INSERT_META =
  'INSERT INTO meta (schema_version, built_at) VALUES (?, ?)';

// Projected shape of SELECT_META_VERSION.
export interface MetaRow {
  schema_version: number;
}

// --- thesaurus table (TF4-FR1) --------------------------------------
// OMW (Open Multilingual Wordnet) relations, keyed the same way as
// entries (normalizeKey-folded key) plus a language tag so one DB holds
// every language's relations. `rel` is one of THESAURUS_RELATIONS;
// `target` is the related headword (display casing preserved). The
// thesaurus is a SEPARATE lazy query held in popup-local state — never
// a DictSource/LookupResult field (IV-1).

export const CREATE_THESAURUS_TABLE =
  'CREATE TABLE IF NOT EXISTS thesaurus (' +
  'key TEXT NOT NULL, ' +
  'lang TEXT NOT NULL, ' +
  'rel TEXT NOT NULL, ' +
  'target TEXT NOT NULL)';

// Composite index on (key, lang): every lookup binds both, so the
// query is a single indexed probe.
export const CREATE_THESAURUS_INDEX =
  'CREATE INDEX IF NOT EXISTS idx_thes_key ON thesaurus(key, lang)';

export const SELECT_THESAURUS_BY_KEY_LANG =
  'SELECT rel, target FROM thesaurus WHERE key = ? AND lang = ?';

export const INSERT_THESAURUS =
  'INSERT INTO thesaurus (key, lang, rel, target) VALUES (?, ?, ?, ?)';

// The relation kinds the thesaurus stores. A row whose rel is outside
// this set is dropped at build time (parseOmwTsv) and again at query
// time (lookupThesaurus) — defence in depth at both boundaries.
export const THESAURUS_RELATIONS = ['synonym', 'antonym'] as const;
export type ThesaurusRelation = (typeof THESAURUS_RELATIONS)[number];

// Projected shape of SELECT_THESAURUS_BY_KEY_LANG.
export interface ThesaurusRow {
  rel: string;
  target: string;
}

// --- imports audit table (TF5-FR5) ----------------------------------
// Records every sideloaded StarDict import. Lives in the WRITABLE
// user.db (NEVER base.db, Designer flag 4) — it is the only persistent
// record of an import after the verify-then-delete pipeline removes the
// source files. (name, lang) is the logical identity: re-importing the
// same name+lang replaces the prior row (upsertImport). filename is the
// per-dict DB file the rows were written into.

// The import PIPELINE version — bump +1 on any import- or render-affecting
// change in the TS import path (importCsvRows, splitDictEntry/formatFrom
// TypeChar, produce-step) OR the Kotlin StarDictImporter.kt, so a stale
// user-dict DB built by an older pipeline is re-imported at bootstrap.
// DISTINCT from SCHEMA_VERSION (which stamps table SHAPE): a DB can have
// the current table shape yet stale CONTENT (e.g. HTML stored as raw tags
// because an old app forced format='plain'). 0 is reserved for
// pre-versioning rows — always stale by definition, so they re-import.
//
// v1 -> v2: the importer now strips edge U+FFFD from definitions
// (sanitizeDefinition) on a .idx-overrun corrupt dict. A slug DB built by
// v1 stored the mis-decoded edges; bumping marks it stale so it auto
// re-imports clean at bootstrap.
export const IMPORTER_VERSION = 2;

export const CREATE_IMPORTS_TABLE =
  'CREATE TABLE IF NOT EXISTS imports (' +
  'name TEXT NOT NULL, ' +
  'lang TEXT NOT NULL, ' +
  'entry_count INTEGER NOT NULL, ' +
  'imported_at TEXT NOT NULL, ' +
  'filename TEXT NOT NULL, ' +
  'importer_version INTEGER NOT NULL DEFAULT 0)';

// Additive migration to bring an EXISTING (pre-versioning) imports table
// up to the current shape. CREATE ... IF NOT EXISTS never alters an
// existing table, so an old user.db keeps the 5-col imports table and its
// rows default to importer_version 0 (stale). Idempotent: on a table that
// already has the column SQLite raises "duplicate column name", which the
// caller swallows (mirrors ALTER_USER_ENTRIES_ADD_PHONETIC).
export const ALTER_IMPORTS_ADD_IMPORTER_VERSION =
  'ALTER TABLE imports ADD COLUMN importer_version INTEGER NOT NULL DEFAULT 0';

// UNIQUE index on the logical identity (name, lang). It is what makes
// UPSERT_IMPORT's INSERT OR REPLACE a single-statement delete+insert atomic
// swap — essential on device, where every statement is its own autocommit (no
// wrapping transaction survives). Created AFTER the dedupe below (a UNIQUE
// index fails to build over duplicate rows).
export const CREATE_IMPORTS_IDENTITY_INDEX =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_name_lang ON imports(name, lang)';

// Collapse any pre-existing duplicate (name, lang) rows to the NEWEST (max
// rowid) before the UNIQUE index is created — an old on-device table may hold
// duplicates from the pre-index era, which would make CREATE UNIQUE INDEX
// throw. No-op on a clean table.
export const DELETE_IMPORTS_DUPLICATES =
  'DELETE FROM imports WHERE rowid NOT IN ' +
  '(SELECT MAX(rowid) FROM imports GROUP BY name, lang)';

// All audit rows — read at bootstrap to reconcile against on-disk
// descriptors.
export const SELECT_IMPORT_ALL =
  'SELECT name, lang, entry_count, imported_at, filename, importer_version FROM imports';

export const SELECT_IMPORT_BY_NAME_LANG =
  'SELECT name, lang, entry_count, imported_at, filename, importer_version ' +
  'FROM imports WHERE name = ? AND lang = ?';

export const SELECT_IMPORT_BY_FILENAME =
  'SELECT name, lang, entry_count, imported_at, filename, importer_version ' +
  'FROM imports WHERE filename = ?';

export const DELETE_IMPORT_BY_NAME_LANG =
  'DELETE FROM imports WHERE name = ? AND lang = ?';

// The atomic audit swap. With the UNIQUE (name, lang) index present, INSERT OR
// REPLACE is a delete-then-insert executed as ONE statement — so on device,
// where each statement autocommits independently, the audit row is repointed
// to the new slug in a single indivisible step (never a torn "deleted, not yet
// inserted" window). This is why upsertImport needs no transaction().
export const UPSERT_IMPORT =
  'INSERT OR REPLACE INTO imports (name, lang, entry_count, imported_at, filename, importer_version) ' +
  'VALUES (?, ?, ?, ?, ?, ?)';

// Projected shape of the SELECT_IMPORT_* queries.
export interface ImportRow {
  name: string;
  lang: string;
  entry_count: number;
  imported_at: string;
  filename: string;
  // The IMPORTER_VERSION that produced this slug DB. ALWAYS populated: the
  // column is NOT NULL DEFAULT 0, and ensureImportsTable (CREATE + additive
  // ALTER) runs before any imports SELECT, so a row read from the table never
  // carries this undefined. Callers compare it directly (isStaleImport) with
  // no `?? 0` guard — the honest invariant, not a defensive fallback.
  importer_version: number;
}

// A slug DB is stale when it was produced by an importer OLDER than the current
// pipeline (its content may be behind — e.g. HTML stored as raw tags by an app
// that forced format='plain'). Version 0 (a pre-versioning row) is stale by
// definition. Lives here beside IMPORTER_VERSION + ImportRow (the invariant it
// relies on); relies on importer_version always being populated, so it compares
// directly with no `?? 0` guard.
export const isStaleImport = (row: ImportRow): boolean =>
  row.importer_version < IMPORTER_VERSION;

// --- settings tables (F1, ADR-0009) — user.db only ------------------
// All Settings-Panel preferences persist in the WRITABLE user.db via
// additive tables (never base.db, never a native key-value store — see
// ADR-0009). dict_prefs holds per-source enablement + ordering; the
// pref_key is the source's identity (identityKey(name,lang) for imports,
// bare name for the built-in User + WordNet sources). app_settings is a
// generic string key/value store (e.g. keepSourcesAfterImport, exportDir,
// consumed by later features). user_meta is a forward-migration anchor
// (user.db has no version meta today; these tables self-heal via
// CREATE ... IF NOT EXISTS like the imports table).
export const CREATE_DICT_PREFS_TABLE =
  'CREATE TABLE IF NOT EXISTS dict_prefs (' +
  'pref_key TEXT PRIMARY KEY, name TEXT NOT NULL, ' +
  'enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL)';
export const SELECT_DICT_PREFS_ALL =
  'SELECT pref_key, name, enabled, sort_order FROM dict_prefs ORDER BY sort_order';
export const DELETE_DICT_PREF = 'DELETE FROM dict_prefs WHERE pref_key = ?';
// Single-statement upsert: dict_prefs.pref_key is a TEXT PRIMARY KEY (since F1),
// so INSERT OR REPLACE is an atomic delete+insert in ONE statement — no
// transaction needed (device statements autocommit independently).
export const UPSERT_DICT_PREF =
  'INSERT OR REPLACE INTO dict_prefs (pref_key, name, enabled, sort_order) VALUES (?, ?, ?, ?)';
export const CREATE_APP_SETTINGS_TABLE =
  'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)';
export const SELECT_APP_SETTING =
  'SELECT value FROM app_settings WHERE key = ? LIMIT 1';
// Single-statement upsert over app_settings.key (TEXT PRIMARY KEY since F1).
export const UPSERT_APP_SETTING =
  'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)';
export const CREATE_USER_META_TABLE =
  'CREATE TABLE IF NOT EXISTS user_meta (schema_version INTEGER NOT NULL)';

// Projected shape of SELECT_DICT_PREFS_ALL (enabled is 0/1, mapped to a
// boolean by readDictPrefs).
export interface DictPrefRow {
  pref_key: string;
  name: string;
  enabled: number;
  sort_order: number;
}

// Projected shape of SELECT_APP_SETTING.
export interface AppSettingRow {
  value: string;
}
