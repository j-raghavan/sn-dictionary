// SQLite-backed DictSource. The whole point of the engine: a lookup
// is a single indexed query against `entries`, with no parse and no
// in-memory Map build (contrast the StarDict path's per-reload
// parseIdx + 150k× normalizeKey). The folded key the query binds is
// produced by the same normalizeKey used at build/import time, so
// lookup semantics match the in-memory engine exactly (IV-4).

import type {DefinitionFormat, DictEntry, DictSource} from '../../lookup';
import {normalizeKey} from '../normalizeKey';
import {createLazyAsyncSource} from '../lazyAsyncSource';
import type {OpenSqliteDb, SqliteDb} from './db';
import {
  DEFINITION_FORMATS,
  SELECT_ENTRY_BY_KEY,
  type EntryRow,
} from './schema';

export type SqliteDictSourceDeps = {
  name: string;
  // Open the DB. Resolving null marks the source sticky-'absent'
  // (file/asset missing); throwing is a transient open failure that
  // the lazy harness retries on the next attempt.
  openDb: OpenSqliteDb;
  // Explicit format override (mirrors StardictLookupDeps): the bundled
  // WordNet base passes 'wordnet'. When omitted, each row's stored
  // `format` column decides.
  format?: DefinitionFormat;
  logger?: {warn: (msg: string) => void; log?: (msg: string) => void};
};

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

// Compose the DictSource onto createLazyAsyncSource. The harness owns
// the prime()/status() state machine and the memoised open, so for a
// SQLite source:
//   - load   = openDb (null -> sticky 'absent'; throw -> 'failed'/retry)
//   - parse  = identity (a DB has nothing to parse — open is the whole
//              cost; this is the TF2-FR7 "no parse step" property)
//   - lookup = fold the word with normalizeKey, then run selectByKey
// The harness already trims and rejects empty/whitespace words before
// reaching `lookup`, so no DB round-trip happens for blank input.
// prime() = "ensure the handle is open"; status() returns 'loading'
// while opening, 'ready' once open, 'absent' if openDb resolved null.
export const createSqliteDictSource = (
  deps: SqliteDictSourceDeps,
): DictSource =>
  createLazyAsyncSource<SqliteDb, SqliteDb>({
    name: deps.name,
    logTag: `sqlite:${deps.name}`,
    load: deps.openDb,
    parse: db => db,
    lookup: (db, word) => selectByKey(db, normalizeKey(word), deps.format),
    logger: deps.logger,
  });
