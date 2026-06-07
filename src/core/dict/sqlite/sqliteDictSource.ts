// SQLite-backed DictSource. The whole point of the engine: a lookup
// is a single indexed query against `entries`, with no parse and no
// in-memory Map build (contrast the StarDict path's per-reload
// parseIdx + 150k× normalizeKey). The folded key the query binds is
// produced by the same normalizeKey used at build/import time, so
// lookup semantics match the in-memory engine exactly (IV-4).

import type {DefinitionFormat, DictEntry} from '../../lookup';
import type {SqliteDb} from './db';
import {
  DEFINITION_FORMATS,
  SELECT_ENTRY_BY_KEY,
  type EntryRow,
} from './schema';

// Validate the raw format string off a row at the data boundary. A
// value outside the known set (corrupt DB, a future/foreign writer)
// degrades to 'plain' so the body still renders — never a blind cast.
export const coerceFormat = (raw: string): DefinitionFormat =>
  (DEFINITION_FORMATS as readonly string[]).includes(raw)
    ? (raw as DefinitionFormat)
    : 'plain';

// Run the one indexed query for an already-folded key. First row wins
// (the SELECT carries LIMIT 1); no row -> null. When `formatOverride`
// is set it wins over the stored column (the bundled WordNet base
// pins 'wordnet').
export const selectByKey = async (
  db: SqliteDb,
  foldedKey: string,
  formatOverride?: DefinitionFormat,
): Promise<DictEntry | null> => {
  const rows = await db.query<EntryRow>(SELECT_ENTRY_BY_KEY, [foldedKey]);
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return {
    word: row.word,
    definition: row.definition,
    format: formatOverride ?? coerceFormat(row.format),
  };
};
