// assembleThesaurus pure merge (TF4-FR5/FR6). Verifies the EN
// WordNet+OMW union with dedup + headword exclusion via the single
// normalizeKey comparator, first-seen-casing union order, the explicit
// format === 'wordnet' discriminator (html/plain = OMW-only), and that
// antonyms come from OMW only (WordNetSense has no antonyms field).

import {
  assembleThesaurus,
  SYNONYM_DISPLAY_CAP,
} from '../src/core/dict/sqlite/thesaurusLookup';
import type {WordNetSense} from '../src/ui/wordnetFormatter';

const sense = (synonyms: string[]): WordNetSense => ({
  index: 1,
  definition: 'def',
  examples: [],
  synonyms,
});

describe('assembleThesaurus', () => {
  it('caps the displayed synonym list at SYNONYM_DISPLAY_CAP (antonyms uncapped)', () => {
    // 20 distinct OMW synonyms + 3 antonyms — synonyms must truncate to
    // the cap (first-seen order preserved); antonyms pass through.
    const manySyn = Array.from({length: 20}, (_, i) => `s${i}`);
    const res = assembleThesaurus('w', 'wordnet', [], {
      synonyms: manySyn,
      antonyms: ['a0', 'a1', 'a2'],
    });
    expect(res.synonyms).toHaveLength(SYNONYM_DISPLAY_CAP);
    expect(res.synonyms[0]).toBe('s0');
    expect(res.synonyms[SYNONYM_DISPLAY_CAP - 1]).toBe(
      `s${SYNONYM_DISPLAY_CAP - 1}`,
    );
    expect(res.antonyms).toEqual(['a0', 'a1', 'a2']);
  });

  it("EN ('wordnet'): unions sense synonyms THEN OMW, deduped", () => {
    const res = assembleThesaurus(
      'happy',
      'wordnet',
      [sense(['glad', 'joyful'])],
      {synonyms: ['cheerful'], antonyms: ['sad']},
    );
    expect(res).toEqual({
      synonyms: ['glad', 'joyful', 'cheerful'],
      antonyms: ['sad'],
    });
  });

  it('union order is WordNet-first then OMW (deterministic)', () => {
    const res = assembleThesaurus(
      'happy',
      'wordnet',
      [sense(['b']), sense(['a'])], // sense order preserved
      {synonyms: ['c'], antonyms: []},
    );
    expect(res.synonyms).toEqual(['b', 'a', 'c']);
  });

  it('excludes the headword via normalizeKey (Happy vs headword happy)', () => {
    const res = assembleThesaurus(
      'happy',
      'wordnet',
      [sense(['Happy', 'glad'])], // "Happy" must not leak past "happy"
      {synonyms: ['HAPPY', 'merry'], antonyms: ['Happy']},
    );
    expect(res.synonyms).toEqual(['glad', 'merry']);
    expect(res.antonyms).toEqual([]); // "Happy" antonym == headword -> excluded
  });

  it('dedups by normalizeKey keeping FIRST-SEEN casing', () => {
    const res = assembleThesaurus(
      'x',
      'wordnet',
      [sense(['Glad', '  glad  '])], // whitespace + case variants of one key
      {synonyms: ['GLAD'], antonyms: []},
    );
    expect(res.synonyms).toEqual(['Glad']); // first-seen casing wins
  });

  it("non-EN 'plain': OMW synonyms only (ignores any senses)", () => {
    const res = assembleThesaurus(
      'froh',
      'plain',
      [sense(['shouldBeIgnored'])],
      {synonyms: ['glücklich'], antonyms: ['traurig']},
    );
    expect(res).toEqual({synonyms: ['glücklich'], antonyms: ['traurig']});
  });

  it("'html' format: OMW synonyms only (the html -> OMW-only branch)", () => {
    const res = assembleThesaurus(
      'casa',
      'html',
      [sense(['ignored'])],
      {synonyms: ['hogar'], antonyms: []},
    );
    expect(res.synonyms).toEqual(['hogar']);
  });

  it('antonyms always come from OMW only (WordNetSense has no antonyms)', () => {
    // Even with rich senses, antonyms are sourced from omw.antonyms.
    const res = assembleThesaurus(
      'up',
      'wordnet',
      [sense(['upward'])],
      {synonyms: [], antonyms: ['down', 'down']}, // dup collapses
    );
    expect(res.antonyms).toEqual(['down']);
  });

  it('handles empty inputs', () => {
    expect(
      assembleThesaurus('w', 'wordnet', [], {synonyms: [], antonyms: []}),
    ).toEqual({synonyms: [], antonyms: []});
    expect(
      assembleThesaurus('w', 'plain', [], {synonyms: [], antonyms: []}),
    ).toEqual({synonyms: [], antonyms: []});
  });

  it('drops empty-string candidates (normalizeKey length 0)', () => {
    const res = assembleThesaurus(
      'w',
      'wordnet',
      [sense(['', '  '])],
      {synonyms: ['real'], antonyms: []},
    );
    expect(res.synonyms).toEqual(['real']);
  });
});
