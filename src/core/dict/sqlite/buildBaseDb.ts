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
import {splitDictEntry, sanitizeDefinition} from '../stardict/dictEntry';
import {decodeUtf8} from '../../../sdk/utf8';
import type {DefinitionFormat} from '../../lookup';
import type {SqliteDb} from './db';
import {
  CREATE_ENTRIES_INDEX,
  CREATE_ENTRIES_TABLE,
  CREATE_META_TABLE,
  INSERT_META,
} from './schema';
import {populateThesaurus, type OmwRow} from './buildThesaurus';

// The schema version the generator stamps into the meta row. Bumped
// whenever the on-disk shape changes so a stale bundled DB is detected
// and re-copied at provision time. Single source of truth: provision.ts
// re-exports it as EXPECTED_SCHEMA_VERSION (the value provisioning
// compares against). Lives here because the GENERATOR is the writer.
//
// v1 -> v2: added the thesaurus table (TF4). v2 -> v3: added the
// nullable `phonetic` column to `entries` (M16/CSV). The generator's
// entries INSERT stays 4-col (SQLite fills phonetic NULL); the column
// exists so CSV slug DBs and base.db share one v3 shape.
export const SCHEMA_VERSION = 3;

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
    // Same split as lookupDict so the persisted body == the looked-up
    // body (issue #28). No-op for sts-present dicts like WordNet, so
    // base.db stays byte-identical.
    const {payload} = splitDictEntry(parsed.meta.sametypesequence ?? null, slice);
    // Same edge-U+FFFD sanitize as lookupDict so the persisted body ==
    // the looked-up body on a corrupt dict; interior U+FFFD preserved.
    rows.push({key, word: entry.word, definition: sanitizeDefinition(decodeUtf8(payload))});
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
//
// entryFormat (TF5-FR3): the `format` column stamped on every entries
// row. Defaults to 'wordnet' so the bundled base build is unchanged;
// the StarDict importer passes the sidecar/.ifo-derived format so an
// imported HTML dict renders correctly.
//
// omwRows (TF4-FR1, additive): when supplied, the OMW thesaurus is
// populated BETWEEN the entries index and the meta row, so meta stays
// LAST (the crash-safety invariant). Omitting it is byte-identical to
// the M2 entries-only behaviour.
export const populateBaseDb = async (
  db: SqliteDb,
  parsed: ParsedDict,
  schemaVersion: number,
  entryFormat: DefinitionFormat = 'wordnet',
  omwRows?: OmwRow[],
): Promise<PopulateResult> => {
  const rows = entriesFromParsedDict(parsed);

  await db.run(CREATE_ENTRIES_TABLE);
  await db.transaction(async tx => {
    for (const row of rows) {
      await tx.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
        row.key,
        row.word,
        row.definition,
        entryFormat,
      ]);
    }
  });

  // Index AFTER the bulk load (cheaper than maintaining it per-insert).
  await db.run(CREATE_ENTRIES_INDEX);

  // ALWAYS create the thesaurus table + index, BEFORE meta — even with no
  // OMW rows. base.db then always HAS a thesaurus table (possibly empty),
  // so lookupThesaurus returns empty cleanly instead of hitting the
  // native "no such table: thesaurus" error. populateThesaurus inserts
  // rows only when present.
  await populateThesaurus(db, omwRows ?? []);

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
  omwRows?: OmwRow[],
): Promise<PopulateResult> => {
  const parsed = await buildDict(ifo, idx, dict);
  // Base build keeps the default 'wordnet' entry format; thesaurus rows
  // (if any) come after.
  return populateBaseDb(db, parsed, schemaVersion, 'wordnet', omwRows);
};
