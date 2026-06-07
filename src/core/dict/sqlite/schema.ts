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

export const CREATE_ENTRIES_TABLE =
  'CREATE TABLE IF NOT EXISTS entries (' +
  'key TEXT NOT NULL, ' +
  'word TEXT NOT NULL, ' +
  'definition TEXT NOT NULL, ' +
  'format TEXT NOT NULL)';

// Index on the folded lookup key — this is what turns the lookup into
// a single indexed probe instead of a table scan (the whole point of
// TF2: no parse, no Map build, just an indexed query).
export const CREATE_ENTRIES_INDEX =
  'CREATE INDEX IF NOT EXISTS idx_entries_key ON entries(key)';

// First row wins (TF2-FR4): LIMIT 1 so a duplicate-key table returns
// one deterministic row. `key` is bound, never selected.
export const SELECT_ENTRY_BY_KEY =
  'SELECT word, definition, format FROM entries WHERE key = ? LIMIT 1';

// The projected shape of SELECT_ENTRY_BY_KEY. `format` is the raw
// string off the row; the engine validates it against
// DEFINITION_FORMATS before trusting it as a DefinitionFormat.
export interface EntryRow {
  word: string;
  definition: string;
  format: string;
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
