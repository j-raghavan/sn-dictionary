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
  SELECT_ENTRY_BY_KEY_NO_PHONETIC,
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

// Schema-aware SELECT, NOT try/catch (M17-FR2). The old approach ran the
// v3 SELECT and caught the failure for a pre-v3 table — but every miss
// LOGGED a native `SQLiteException: no such column: phonetic` (red log
// noise on every user.db / old-slug lookup) AND wasted a round-trip on
// the retry. Instead probe `entries` ONCE per DB handle (PRAGMA
// table_info), cache the boolean, and ALWAYS run the correct SELECT — so
// we never issue a query that throws.
//
// Cache is keyed by the DB handle (a WeakMap, GC'd with the handle) and
// stores the in-flight PROMISE so concurrent first-lookups share the one
// probe instead of racing N PRAGMAs.
const phoneticSupport = new WeakMap<SqliteDb, Promise<boolean>>();

const probeHasPhonetic = async (db: SqliteDb): Promise<boolean> => {
  const cols = await db.query<{name: string}>('PRAGMA table_info(entries)');
  return cols.some(c => c.name === 'phonetic');
};

const hasPhonetic = (db: SqliteDb): Promise<boolean> => {
  let probe = phoneticSupport.get(db);
  if (probe === undefined) {
    // Probe failures (e.g. no `entries` table yet) resolve false rather
    // than rejecting — the phonetic-less SELECT is the safe default and
    // surfaces the real "no such table" error itself if it persists.
    probe = probeHasPhonetic(db).catch(() => false);
    phoneticSupport.set(db, probe);
  }
  return probe;
};

// Read the row for a folded key. First row wins (the SELECT carries
// LIMIT 1); no row -> null. Picks the v3 (phonetic) or 4-col SELECT from
// the cached schema probe so a pre-v3 `entries` (user.db / old slug)
// never throws "no such column".
const queryEntryRow = async (
  db: SqliteDb,
  foldedKey: string,
): Promise<EntryRow[]> => {
  const sql = (await hasPhonetic(db))
    ? SELECT_ENTRY_BY_KEY
    : SELECT_ENTRY_BY_KEY_NO_PHONETIC;
  return db.query<EntryRow>(sql, [foldedKey]);
};

export const selectByKey = async (
  db: SqliteDb,
  foldedKey: string,
  formatOverride?: DefinitionFormat,
): Promise<DictEntry | null> => {
  const rows = await queryEntryRow(db, foldedKey);
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  const entry: DictEntry = {
    word: row.word,
    definition: row.definition,
    format: formatOverride ?? coerceFormat(row.format),
  };
  // Map phonetic ONLY when present + non-empty (exact old lookupCsv
  // contract); a null/'' column is omitted, not surfaced as ''.
  const phonetic = row.phonetic;
  if (phonetic !== undefined && phonetic !== null && phonetic !== '') {
    entry.phonetic = phonetic;
  }
  return entry;
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
