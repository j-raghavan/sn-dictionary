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
  SELECT_ENTRY_BY_KEY_WITH_ALIASES,
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
// the retry. Instead probe the DB's shape ONCE per handle, cache it, and
// ALWAYS run the correct SELECT — so we never issue a query that throws.
// The shape is whether `entries` has the v3 phonetic column and whether
// the DB carries a StarDict `aliases` table (#44).
//
// Cache is keyed by the DB handle (a WeakMap, GC'd with the handle) and
// stores the in-flight PROMISE so concurrent first-lookups share the one
// probe instead of racing N probes. A FAILED probe is not cached: one
// transient error (e.g. a bridge timeout) must not disable synonym lookups
// for the rest of the session, so the next lookup probes again.
type DbShape = {phonetic: boolean; aliases: boolean};

const shapes = new WeakMap<SqliteDb, Promise<DbShape>>();

const probeShape = async (db: SqliteDb): Promise<DbShape> => {
  const cols = await db.query<{name: string}>('PRAGMA table_info(entries)');
  const aliases = await db.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'aliases'",
  );
  return {
    phonetic: cols.some(c => c.name === 'phonetic'),
    aliases: aliases.length > 0,
  };
};

const dbShape = (db: SqliteDb): Promise<DbShape> => {
  let probe = shapes.get(db);
  if (probe === undefined) {
    // A probe failure (e.g. no `entries` table yet) resolves to the plain
    // shape for THIS lookup rather than rejecting — the phonetic-less
    // SELECT is the safe default and surfaces the real "no such table"
    // error itself if it persists — and is evicted so the next lookup
    // re-probes.
    probe = probeShape(db).catch(() => {
      shapes.delete(db);
      return {phonetic: false, aliases: false};
    });
    shapes.set(db, probe);
  }
  return probe;
};

// Read the row for a folded key. First row wins (every SELECT carries
// LIMIT 1); no row -> null. A StarDict slug with an aliases table also
// matches synonyms; otherwise the v3 (phonetic) or 4-col SELECT is picked
// from the cached probe so a pre-v3 `entries` (user.db / old slug) never
// throws "no such column".
const queryEntryRow = async (
  db: SqliteDb,
  foldedKey: string,
): Promise<EntryRow[]> => {
  const shape = await dbShape(db);
  // aliases => a native v3 StarDict slug => the phonetic column is present.
  if (shape.aliases) {
    return db.query<EntryRow>(SELECT_ENTRY_BY_KEY_WITH_ALIASES, [foldedKey, foldedKey]);
  }
  const sql = shape.phonetic
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
