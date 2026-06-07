// Thesaurus query + assembly (TF4-FR2/FR3/FR5/FR6). Co-located by
// design (Designer ruling 2): lookupThesaurus reads the DB,
// assembleThesaurus is a pure merge — kept in one module so callers
// import a single thesaurus surface, but assembleThesaurus stays
// import-clean of SqliteDb (no DB type leaks into the pure function).
//
// The thesaurus is a SEPARATE lazy query held in popup-local state,
// never a DictSource/LookupResult field (IV-1). It NEVER throws into
// the caller: a faulty DB, an empty word, or an undetermined language
// all resolve to an empty result so the popup simply shows no
// thesaurus section.

import {normalizeKey} from '../normalizeKey';
import type {SqliteDb} from './db';
import {
  SELECT_THESAURUS_BY_KEY_LANG,
  THESAURUS_RELATIONS,
  type ThesaurusRow,
} from './schema';

export type ThesaurusResult = {
  synonyms: string[];
  antonyms: string[];
};

type Logger = {warn: (msg: string) => void; log?: (msg: string) => void};

const empty = (): ThesaurusResult => ({synonyms: [], antonyms: []});

// 'und' is the BCP-47 "undetermined" language tag used when a source's
// language can't be resolved. There is no thesaurus to fetch for it,
// so short-circuit WITHOUT touching the DB (TF4-FR3a).
const UNDETERMINED_LANG = 'und';

// Query the thesaurus for a word in a language. Buckets rows into
// synonyms / antonyms, validating each rel against THESAURUS_RELATIONS
// (an unknown rel — e.g. a future relation written by a newer build —
// is dropped). Returns empty (never throws) for: lang 'und' (no
// query), empty/whitespace word, or any DB error (logged).
export const lookupThesaurus = async (
  db: SqliteDb,
  word: string,
  lang: string,
  logger?: Logger,
): Promise<ThesaurusResult> => {
  if (lang === UNDETERMINED_LANG) {
    return empty();
  }
  const key = normalizeKey(word);
  if (key.length === 0) {
    return empty();
  }
  try {
    const rows = await db.query<ThesaurusRow>(SELECT_THESAURUS_BY_KEY_LANG, [
      key,
      lang,
    ]);
    const result = empty();
    for (const row of rows) {
      if (row.rel === THESAURUS_RELATIONS[0]) {
        result.synonyms.push(row.target);
      } else if (row.rel === THESAURUS_RELATIONS[1]) {
        result.antonyms.push(row.target);
      }
      // Any other rel is dropped (defence in depth — also filtered at
      // build time by parseOmwTsv).
    }
    return result;
  } catch (e) {
    logger?.warn(
      `[thesaurus] lookup "${word}" (${lang}) threw: ${(e as Error).message} — returning empty`,
    );
    return empty();
  }
};
