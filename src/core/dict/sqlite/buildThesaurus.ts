// Pure, testable core of the OMW thesaurus build (TF4-FR1). Parses a
// tab-separated OMW relations file into rows and populates the
// thesaurus table. Mirrors buildBaseDb.ts's structure (one transaction
// + index, NO meta write — meta stays a buildBaseDb invariant) so the
// build script and the unit tests run identical logic.
//
// TSV shape (one relation per line):
//   key <TAB> lang <TAB> rel <TAB> target
// `key` is re-folded with normalizeKey so build-time keys can never
// diverge from query-time keys (IV-4 / IV-6), regardless of how the
// upstream OMW extraction cased/normalised them. Lines that are
// malformed (wrong column count, empty key/target) or carry an
// unknown rel are skipped silently — a few bad rows must not fail the
// whole build.

import {normalizeKey} from '../normalizeKey';
import type {SqliteDb} from './db';
import {
  CREATE_THESAURUS_INDEX,
  CREATE_THESAURUS_TABLE,
  INSERT_THESAURUS,
  THESAURUS_RELATIONS,
  type ThesaurusRelation,
} from './schema';

export type OmwRow = {
  key: string;
  lang: string;
  rel: ThesaurusRelation;
  target: string;
};

const isRelation = (raw: string): raw is ThesaurusRelation =>
  (THESAURUS_RELATIONS as readonly string[]).includes(raw);

// Parse a TSV blob into validated OMW rows. Skips malformed / bad-rel
// lines. The key is re-folded with normalizeKey; lang is lowercased
// and trimmed; target keeps its display casing.
export const parseOmwTsv = (text: string): OmwRow[] => {
  const rows: OmwRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }
    const cols = line.split('\t');
    if (cols.length !== 4) {
      continue;
    }
    const rawKey = cols[0];
    const lang = cols[1].trim().toLowerCase();
    const rel = cols[2].trim();
    const target = cols[3].trim();
    const key = normalizeKey(rawKey);
    if (key.length === 0 || lang.length === 0 || target.length === 0) {
      continue;
    }
    if (!isRelation(rel)) {
      continue;
    }
    rows.push({key, lang, rel, target});
  }
  return rows;
};

export type PopulateThesaurusResult = {insertedCount: number};

// Populate the thesaurus table from parsed rows. One transaction for
// the bulk insert, index after the load. Deliberately writes NO meta
// row — meta-LAST is owned by buildBaseDb.populateBaseDb so the
// crash-safety invariant lives in one place.
export const populateThesaurus = async (
  db: SqliteDb,
  rows: OmwRow[],
): Promise<PopulateThesaurusResult> => {
  await db.run(CREATE_THESAURUS_TABLE);
  await db.transaction(async tx => {
    for (const row of rows) {
      await tx.run(INSERT_THESAURUS, [row.key, row.lang, row.rel, row.target]);
    }
  });
  await db.run(CREATE_THESAURUS_INDEX);
  return {insertedCount: rows.length};
};
