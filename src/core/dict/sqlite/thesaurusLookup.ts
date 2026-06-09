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

import type {DefinitionFormat} from '../../lookup';
import type {WordNetSense} from '../../../ui/wordnetFormatter';
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

// Dedup a candidate list by normalizeKey, excluding the headword,
// keeping the FIRST-SEEN casing for each distinct key (TF4-FR5 /
// Designer flag 3 + 4). One comparator — normalizeKey — drives both
// headword exclusion and dedup, so "Happy" can't leak past headword
// "happy" and "Glad"/"glad" collapse to one entry.
const dedupExcludingHeadword = (
  candidates: string[],
  headwordKey: string,
): string[] => {
  const seen = new Set<string>([headwordKey]);
  const out: string[] = [];
  for (const candidate of candidates) {
    const key = normalizeKey(candidate);
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(candidate);
  }
  return out;
};

// Pure merge of WordNet sense synonyms with OMW relations into the
// final thesaurus view (TF4-FR5/FR6). DB-import-free by design
// (Designer ruling 2).
//
//   - synonyms: for an English WordNet entry (format === 'wordnet',
//     Designer ruling 1 — the EXPLICIT discriminator, not
//     senses.length which parseFailed makes a false proxy), union the
//     per-sense [syn:] lists (in sense order) THEN the OMW synonyms;
//     for any other format ('html' / 'plain' — non-EN or custom),
//     OMW synonyms only. Union order is WordNet-first then OMW, deduped
//     keeping first-seen casing.
//   - antonyms: ALWAYS OMW only — WordNetSense carries no antonyms
//     field (Designer flag 2), so EN antonyms come solely from
//     omw.antonyms.
//
// Both lists exclude the headword and dedup via the one normalizeKey
// comparator.
// Cap the displayed synonym list. The thesaurus table can hold up to
// ~10 OMW + ~5 Moby synonyms per key, plus WordNet's inline [syn:] sense
// lists — the union can run long. Cap the on-screen list (synonyms only;
// antonyms are OMW-only and few) so it stays scannable on e-ink.
export const SYNONYM_DISPLAY_CAP = 12;

export const assembleThesaurus = (
  headword: string,
  format: DefinitionFormat,
  senses: WordNetSense[],
  omw: ThesaurusResult,
): ThesaurusResult => {
  const headwordKey = normalizeKey(headword);

  const synonymCandidates =
    format === 'wordnet'
      ? [...senses.flatMap(s => s.synonyms), ...omw.synonyms]
      : [...omw.synonyms];

  return {
    synonyms: dedupExcludingHeadword(synonymCandidates, headwordKey).slice(
      0,
      SYNONYM_DISPLAY_CAP,
    ),
    antonyms: dedupExcludingHeadword(omw.antonyms, headwordKey),
  };
};
