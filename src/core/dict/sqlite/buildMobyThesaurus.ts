// Pure, testable core of the Moby English Thesaurus build (issue #26).
// Parses the Moby StarDict `.dict` blocks (sametypesequence=m, plain
// UTF-8) into the SAME {key, lang:'en', rel:'synonym', target} rows
// that OMW emits, so Moby synonyms merge into the existing `thesaurus`
// table and surface in the Definition/Thesaurus toggle alongside OMW
// (ADR-0004). NO IO and NO runtime-code change — this is build-time
// data shaping only, exercised by buildMobyThesaurus.test.ts against
// synthetic blocks. The .mjs build shell (scripts/buildBaseDb.mjs)
// reads the staged StarDict triple and feeds {word, block} pairs here.
//
// Moby block format (Grady Ward's Moby Thesaurus, public domain; tabo's
// StarDict packaging). Each headword's block is one or more clusters
// separated by a blank line:
//
//   [ADJ] (Agreement):  agreeing, suiting, ... happy, meet <Archaic>.
//
//   [ADJ] (Occasion):  opportune, timely, ...
//
// The synonym list for a headword is the UNION across ALL its clusters.
// Per cluster:
//   - strip the leading `[POS]` tag ([N] / [ADJ] / [ADV] / [V] / ...),
//   - strip the leading `(Category...):` prefix (the category paren may
//     itself contain a `{...}` or `[...]` sub-annotation),
//   - strip every inline `{marker}` (e.g. a leading `{noon}:` submarker,
//     a `{Chem}` in-term marker, or a `{to a small degree}` gloss),
//   - strip every `<annotation>` (e.g. `<Archaic>`, `<US>`, `<Latin>`),
//   - strip `*` slang markers,
//   - split the remainder on commas; trim each; drop a trailing `.`/`:`,
//   - drop any token that still carries an unbalanced bracket char
//     (a leftover from the handful of malformed source blocks whose
//     category paren spans a hard line break),
//   - exclude the headword itself (compared via normalizeKey),
//   - dedup case-insensitively (normalizeKey), preserving the first
//     display casing seen,
//   - cap at `cap` (default 10) synonyms per headword.

import {normalizeKey} from '../normalizeKey';
import type {OmwRow} from './buildThesaurus';

export const MOBY_LANG = 'en';
export const MOBY_REL = 'synonym';
// Cap Moby synonyms stored per headword. Kept tight (5) to bound the
// base.db size — Moby's Roget-style clusters are large, and the popup
// merges these with OMW and applies its own display cap anyway.
export const MOBY_SYNONYM_CAP = 5;

// Editorial-markup strippers, applied to the post-[POS] remainder of a
// cluster. Order matters only in that the leading [POS] + (Category)
// are removed first (anchored), then the inline groups are removed
// globally regardless of position.
const LEADING_POS = /^\s*\[[^\]]*\]\s*/;
const LEADING_CATEGORY = /^\s*\([^)]*\)\s*:?/;
const BRACE_GROUP = /\{[^}]*\}/g; // {noon}, {Chem}, {to a small degree}
const ANGLE_GROUP = /<[^>]*>/g; // <Archaic>, <US>, <Latin>
const BRACKET_GROUP = /\[[^\]]*\]/g; // stray [prefix], [ANTONYM: NN]
const STAR = /\*/g; // slang marker
const EDGE_PUNCT = /^[.:\s]+|[.:\s]+$/g; // trailing/leading . : and space
const RESIDUAL_BRACKET = /[[\]{}<>()]/; // any leftover bracket → drop term

// Clean ONE cluster into its ordered list of display synonyms. The
// headword is NOT excluded here (callers do that across the union so
// the same headword in a later cluster is still skipped).
export const cleanMobyCluster = (cluster: string): string[] => {
  let body = cluster.replace(LEADING_POS, '');
  body = body.replace(LEADING_CATEGORY, '');
  body = body
    .replace(BRACE_GROUP, ' ')
    .replace(ANGLE_GROUP, ' ')
    .replace(BRACKET_GROUP, ' ')
    .replace(STAR, '');
  const out: string[] = [];
  for (const raw of body.split(',')) {
    const term = raw.replace(EDGE_PUNCT, '').replace(/\s+/g, ' ');
    if (term.length === 0) {
      continue;
    }
    // A residual bracket means an unbalanced/malformed source block
    // leaked structure into the term — drop it rather than ship garbage.
    if (RESIDUAL_BRACKET.test(term)) {
      continue;
    }
    out.push(term);
  }
  return out;
};

// Parse one headword's raw `.dict` block into its cleaned, deduped,
// headword-excluded, capped synonym list (display casing preserved).
// Clusters are blank-line separated.
export const parseMobyBlock = (
  headword: string,
  block: string,
  cap: number = MOBY_SYNONYM_CAP,
): string[] => {
  const headKey = normalizeKey(headword);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cluster of block.split(/\n\s*\n/)) {
    if (cluster.trim().length === 0) {
      continue;
    }
    for (const term of cleanMobyCluster(cluster)) {
      const key = normalizeKey(term);
      if (key.length === 0 || key === headKey || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(term);
      if (out.length >= cap) {
        return out;
      }
    }
  }
  return out;
};

// Map staged Moby {word, block} entries to OmwRow[] — the same row
// shape OMW produces, so the rows concatenate straight into the
// thesaurus build (scripts/buildBaseDb.mjs). Headwords whose block
// yields no synonyms are skipped (no empty rows). The key is folded
// with normalizeKey so build-time keys can never diverge from
// query-time keys (IV-4 / IV-6), exactly like parseOmwTsv.
export const buildMobyRows = (
  entries: Array<{word: string; block: string}>,
  cap: number = MOBY_SYNONYM_CAP,
): OmwRow[] => {
  const rows: OmwRow[] = [];
  for (const {word, block} of entries) {
    const key = normalizeKey(word);
    if (key.length === 0) {
      continue;
    }
    for (const target of parseMobyBlock(word, block, cap)) {
      rows.push({key, lang: MOBY_LANG, rel: MOBY_REL, target});
    }
  }
  return rows;
};
