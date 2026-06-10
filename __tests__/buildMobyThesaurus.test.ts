// Moby thesaurus build core (issue #26). Exercises parseMobyBlock /
// cleanMobyCluster / buildMobyRows against synthetic Moby `.dict`
// blocks — the cluster union, [POS]/(Category)/{marker}/<annotation>/*
// stripping, headword exclusion, case-insensitive dedup, the 10-cap,
// and the OmwRow row shape. No IO; mirrors the real block format
// (sametypesequence=m, blank-line-separated clusters).

import {
  cleanMobyCluster,
  parseMobyBlock,
  buildMobyRows,
  MOBY_LANG,
  MOBY_REL,
  MOBY_SYNONYM_CAP,
} from '../src/core/dict/sqlite/buildMobyThesaurus';

describe('cleanMobyCluster', () => {
  it('strips the [POS] tag and (Category): prefix', () => {
    expect(cleanMobyCluster('[ADJ] (Occasion):  opportune, timely, lucky')).toEqual([
      'opportune',
      'timely',
      'lucky',
    ]);
  });

  it('strips a leading {submarker}: and a trailing period', () => {
    expect(
      cleanMobyCluster('[N] (Morning):  {noon}: noon, midday, noontide.'),
    ).toEqual(['noon', 'midday', 'noontide']);
  });

  it('strips inline {markers}, <annotations>, and * slang flags', () => {
    expect(
      cleanMobyCluster(
        '[V] (X):  electrolyze{Chem}, go the whole nine yards* <US>, meet <Archaic>.',
      ),
    ).toEqual(['electrolyze', 'go the whole nine yards', 'meet']);
  });

  it('strips a category paren that itself carries a {sub} or [bracket]', () => {
    expect(
      cleanMobyCluster('[ADV] (Superiority {Supremacy}):  eminently, supremely'),
    ).toEqual(['eminently', 'supremely']);
  });

  it('drops a token that still carries an unbalanced bracket (malformed block)', () => {
    // A category paren that never closes on this line leaks structure
    // into the first token — that token must be dropped, not shipped.
    // (Here the trailing clean term survives; the polluted lead drops.)
    expect(
      cleanMobyCluster('[ADV] (Generality [ANTONYM: 79]  generally, always'),
    ).toEqual(['always']);
  });

  it('returns [] for an empty post-strip body', () => {
    expect(cleanMobyCluster('[ADJ] (Empty): ')).toEqual([]);
  });
});

describe('parseMobyBlock', () => {
  const HAPPY_BLOCK = [
    '[ADJ] (Agreement):  agreeing, suiting, happy, felicitous, meet <Archaic>.',
    '',
    '[ADJ] (Occasion):  opportune, timely, happy, favorable.',
  ].join('\n');

  it('unions synonyms across multiple clusters, excluding the headword', () => {
    // Explicit high cap so the full cross-cluster union is visible (the
    // default cap is exercised separately) — 'opportune'+ come from the
    // SECOND cluster, proving the union spans clusters.
    expect(parseMobyBlock('happy', HAPPY_BLOCK, 10)).toEqual([
      'agreeing',
      'suiting',
      'felicitous',
      'meet',
      'opportune',
      'timely',
      'favorable',
    ]);
  });

  it('excludes the headword case-insensitively (normalizeKey)', () => {
    const block = '[N] (X):  Glad, HAPPY, joyful, happy';
    expect(parseMobyBlock('Happy', block)).toEqual(['Glad', 'joyful']);
  });

  it('dedups case-insensitively, preserving the first display casing', () => {
    const block = '[N] (X):  Glad, glad, GLAD, joyful';
    expect(parseMobyBlock('zzz', block)).toEqual(['Glad', 'joyful']);
  });

  it('caps the synonym list at the default cap', () => {
    const terms = Array.from({length: 20}, (_, i) => `w${i}`).join(', ');
    const block = `[N] (X):  ${terms}`;
    const out = parseMobyBlock('head', block);
    expect(out).toHaveLength(MOBY_SYNONYM_CAP);
    expect(out[0]).toBe('w0');
    // Last kept term is at index cap-1, in source order.
    expect(out[MOBY_SYNONYM_CAP - 1]).toBe(`w${MOBY_SYNONYM_CAP - 1}`);
  });

  it('honours a custom cap and stops at the boundary mid-cluster', () => {
    const block = '[N] (X):  a, b, c, d, e';
    expect(parseMobyBlock('head', block, 3)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for an empty block', () => {
    expect(parseMobyBlock('head', '')).toEqual([]);
    expect(parseMobyBlock('head', '\n\n  \n\n')).toEqual([]);
  });

  it('returns [] when every cluster term is the headword', () => {
    expect(parseMobyBlock('happy', '[ADJ] (X):  happy, Happy, HAPPY.')).toEqual([]);
  });

  it('tolerates clusters separated by blank lines with stray whitespace', () => {
    const block = '[N] (A):  one, two\n   \n[V] (B):  three';
    expect(parseMobyBlock('head', block)).toEqual(['one', 'two', 'three']);
  });
});

describe('buildMobyRows', () => {
  it('maps {word, block} entries to OmwRow[] with the fixed lang/rel', () => {
    const rows = buildMobyRows([
      {word: 'happy', block: '[ADJ] (X):  glad, joyful'},
    ]);
    expect(rows).toEqual([
      {key: 'happy', lang: MOBY_LANG, rel: MOBY_REL, target: 'glad'},
      {key: 'happy', lang: MOBY_LANG, rel: MOBY_REL, target: 'joyful'},
    ]);
    expect(MOBY_LANG).toBe('en');
    expect(MOBY_REL).toBe('synonym');
  });

  it('folds the key with normalizeKey (case + curly apostrophe)', () => {
    const rows = buildMobyRows([
      {word: 'Muad’Dib', block: '[N] (X):  Usul, Kwisatz'},
    ]);
    expect(rows[0].key).toBe("muad'dib");
    // target keeps display casing.
    expect(rows[0].target).toBe('Usul');
  });

  it('skips headwords whose block yields no synonyms (no empty rows)', () => {
    const rows = buildMobyRows([
      {word: 'happy', block: '[ADJ] (X):  happy.'}, // only the headword
      {word: 'glad', block: '[ADJ] (X):  pleased, content'},
    ]);
    expect(rows).toEqual([
      {key: 'glad', lang: 'en', rel: 'synonym', target: 'pleased'},
      {key: 'glad', lang: 'en', rel: 'synonym', target: 'content'},
    ]);
  });

  it('skips entries whose headword normalizes to an empty key', () => {
    expect(buildMobyRows([{word: '   ', block: '[N] (X):  a, b'}])).toEqual([]);
  });

  it('honours a custom cap', () => {
    const block = '[N] (X):  a, b, c, d';
    const rows = buildMobyRows([{word: 'head', block}], 2);
    expect(rows.map(r => r.target)).toEqual(['a', 'b']);
  });
});
