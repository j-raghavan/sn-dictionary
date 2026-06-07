// Pure, testable core of the base.db generator (scripts/buildBaseDb.mjs).
// Kept in TS (not the .mjs shell) so it reuses buildDict / decodeUtf8 /
// the schema DDL directly and is exercised by jest against the host
// better-sqlite3 adapter on a tiny synthetic WordNet triple. The .mjs
// is a thin I/O orchestrator over this core.
//
// Build order (TF3-FR1/FR2 + Designer flag 4): entries rows, THEN the
// key index, THEN the meta row LAST — so a power-loss mid-build leaves
// meta absent, which provisioning reads as "reprovision".

import {buildDict, type ParsedDict} from '../stardict/stardictDict';
import {decodeUtf8} from '../../../sdk/utf8';
import type {SqliteDb} from './db';
import {
  CREATE_ENTRIES_INDEX,
  CREATE_ENTRIES_TABLE,
  CREATE_META_TABLE,
  INSERT_META,
} from './schema';

// The schema version the generator stamps into the meta row. Bumped
// whenever the on-disk shape changes so a stale bundled DB is detected
// and re-copied at provision time. Single source of truth: provision.ts
// re-exports it as EXPECTED_SCHEMA_VERSION (the value provisioning
// compares against). Lives here because the GENERATOR is the writer.
export const SCHEMA_VERSION = 1;

export type BaseDbRow = {
  key: string;
  word: string;
  definition: string;
};

// Flatten a ParsedDict's index into base.db rows. The map key is
// already normalizeKey-folded by buildDict (and .syn aliases are
// merged into the same map), so the folded keys carry over verbatim —
// keys never diverge between the in-memory engine and the DB (IV-4).
// The definition body is read the same way lookupDict reads it:
// slice(offset, length) + decodeUtf8, so body parity is guaranteed.
export const entriesFromParsedDict = (parsed: ParsedDict): BaseDbRow[] => {
  const rows: BaseDbRow[] = [];
  for (const [key, entry] of parsed.index) {
    const slice = parsed.dictReader.slice(entry.offset, entry.length);
    rows.push({key, word: entry.word, definition: decodeUtf8(slice)});
  }
  return rows;
};

// Deterministic build timestamp: prefer the StarDict .ifo `date` field
// (stable across rebuilds of the same source) over Date.now(), so the
// generated DB is byte-reproducible (Designer flag: NOT Date.now).
// Falls back to a stable bookname+wordcount stamp when no date field.
export const deterministicBuiltAt = (parsed: ParsedDict): string => {
  const date = parsed.meta.rawFields.date;
  if (date !== undefined && date.length > 0) {
    return date;
  }
  return `${parsed.meta.bookname ?? 'base'}@${parsed.meta.wordcount}`;
};

export type PopulateResult = {
  insertedCount: number;
  expectedCount: number;
};

// Populate an open (empty) SqliteDb with the dictionary. WordNet base
// rows are tagged format='wordnet' so the popup parses senses. Writes
// happen inside one transaction (the dominant cost is the per-row
// INSERT). Returns the inserted vs expected counts so the caller can
// assert insertedCount === parsed.index.size (TF3-FR2 DoD).
export const populateBaseDb = async (
  db: SqliteDb,
  parsed: ParsedDict,
  schemaVersion: number,
): Promise<PopulateResult> => {
  const rows = entriesFromParsedDict(parsed);

  await db.run(CREATE_ENTRIES_TABLE);
  await db.transaction(async tx => {
    for (const row of rows) {
      await tx.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
        row.key,
        row.word,
        row.definition,
        'wordnet',
      ]);
    }
  });

  // Index AFTER the bulk load (cheaper than maintaining it per-insert).
  await db.run(CREATE_ENTRIES_INDEX);

  // Meta LAST (Designer flag 4) — a crash before this point leaves the
  // DB without a meta row, which provisioning treats as reprovision.
  await db.run(CREATE_META_TABLE);
  await db.run(INSERT_META, [schemaVersion, deterministicBuiltAt(parsed)]);

  return {insertedCount: rows.length, expectedCount: parsed.index.size};
};

// Convenience used by the .mjs shell: parse a StarDict triple and
// populate the DB in one call. Re-exported buildDict keeps the .mjs
// import surface to this module only.
export const buildBaseDbFromTriple = async (
  db: SqliteDb,
  ifo: Uint8Array,
  idx: Uint8Array,
  dict: Uint8Array,
  schemaVersion: number,
): Promise<PopulateResult> => {
  const parsed = await buildDict(ifo, idx, dict);
  return populateBaseDb(db, parsed, schemaVersion);
};
