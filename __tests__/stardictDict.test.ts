import {
  buildDict,
  lookupDict,
} from '../src/core/dict/stardict/stardictDict';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';

describe('stardictDict', () => {
  test('builds and looks up an entry from raw .dict bytes', () => {
    const {ifo, idx, dict} = buildSyntheticStarDict({
      apple: 'a fruit',
      banana: 'a yellow fruit',
      cherry: 'a small red fruit',
    });
    const parsed = buildDict(ifo, idx, dict);
    expect(parsed.meta.wordcount).toBe(3);
    const hit = lookupDict(parsed, 'banana');
    expect(hit).toEqual({
      canonicalWord: 'banana',
      definition: 'a yellow fruit',
    });
  });

  test('builds and looks up from gzip-wrapped .dict.dz', () => {
    const {ifo, idx, dict} = buildSyntheticStarDict(
      {apple: 'a fruit', banana: 'a yellow fruit'},
      {gzipDict: true},
    );
    const parsed = buildDict(ifo, idx, dict);
    expect(lookupDict(parsed, 'apple')).toEqual({
      canonicalWord: 'apple',
      definition: 'a fruit',
    });
    expect(lookupDict(parsed, 'banana')).toEqual({
      canonicalWord: 'banana',
      definition: 'a yellow fruit',
    });
  });

  test('lookup is case-insensitive and trims whitespace', () => {
    const {ifo, idx, dict} = buildSyntheticStarDict({Apple: 'a fruit'});
    const parsed = buildDict(ifo, idx, dict);
    expect(lookupDict(parsed, 'APPLE')?.canonicalWord).toBe('Apple');
    expect(lookupDict(parsed, '  Apple   ')?.canonicalWord).toBe('Apple');
    expect(lookupDict(parsed, 'apple')?.canonicalWord).toBe('Apple');
  });

  test('returns null for an unknown word', () => {
    const {ifo, idx, dict} = buildSyntheticStarDict({apple: 'a fruit'});
    const parsed = buildDict(ifo, idx, dict);
    expect(lookupDict(parsed, 'banana')).toBeNull();
  });

  test('returns null for an empty / whitespace-only query', () => {
    const {ifo, idx, dict} = buildSyntheticStarDict({apple: 'a fruit'});
    const parsed = buildDict(ifo, idx, dict);
    expect(lookupDict(parsed, '')).toBeNull();
    expect(lookupDict(parsed, '   ')).toBeNull();
  });

  test('decodes UTF-8 multibyte definitions correctly', () => {
    const {ifo, idx, dict} = buildSyntheticStarDict({
      café: '咖啡 (coffee)',
      日本: 'Japan • 日本国',
    });
    const parsed = buildDict(ifo, idx, dict);
    expect(lookupDict(parsed, 'café')?.definition).toBe('咖啡 (coffee)');
    expect(lookupDict(parsed, '日本')?.definition).toBe('Japan • 日本国');
  });

  test('case-collision: first entry in .idx wins for the lowercased key', () => {
    // .idx is sorted by case-sensitive byte order, so 'Apple' (0x41)
    // sorts before 'apple' (0x61). The orchestrator should keep the
    // first occurrence to be deterministic.
    const {ifo, idx, dict} = buildSyntheticStarDict({
      Apple: 'capitalised',
      apple: 'lowercase',
    });
    const parsed = buildDict(ifo, idx, dict);
    expect(lookupDict(parsed, 'apple')?.canonicalWord).toBe('Apple');
  });

  describe('synonym (.syn) merge', () => {
    // Synonym index format: word \0 + index_u32_be (0-based into the
    // sorted .idx entries array). Hand-build small .syn buffers to
    // verify the merge logic without relying on a real dict.
    const enc = (s: string) => new TextEncoder().encode(s);
    const buildSyn = (
      pairs: {word: string; index: number}[],
    ): Uint8Array => {
      /* eslint-disable no-bitwise */
      const parts: number[] = [];
      for (const {word, index} of pairs) {
        for (const b of enc(word)) {
          parts.push(b);
        }
        parts.push(0);
        parts.push((index >>> 24) & 0xff);
        parts.push((index >>> 16) & 0xff);
        parts.push((index >>> 8) & 0xff);
        parts.push(index & 0xff);
      }
      return new Uint8Array(parts);
      /* eslint-enable no-bitwise */
    };

    test('synonym lookup resolves to the canonical .idx entry', () => {
      // Real-world case: Devanagari-only .idx + Latin transliterations
      // in .syn. The synthetic builder uses Latin keys but the
      // mechanics are identical — synonym maps to entry by index.
      // Entries sort byte-wise: apple (0), banana (1), cherry (2).
      const {ifo, idx, dict} = buildSyntheticStarDict({
        apple: 'a fruit',
        banana: 'a yellow fruit',
        cherry: 'a small red fruit',
      });
      const syn = buildSyn([
        {word: 'malum', index: 0}, // alias for apple
        {word: 'pomum', index: 0}, // another alias for apple
        {word: 'cerasus', index: 2}, // alias for cherry
      ]);
      const parsed = buildDict(ifo, idx, dict, syn);
      // Synonym lookups resolve to the canonical entry.
      expect(lookupDict(parsed, 'malum')).toEqual({
        canonicalWord: 'apple',
        definition: 'a fruit',
      });
      expect(lookupDict(parsed, 'pomum')).toEqual({
        canonicalWord: 'apple',
        definition: 'a fruit',
      });
      expect(lookupDict(parsed, 'cerasus')).toEqual({
        canonicalWord: 'cherry',
        definition: 'a small red fruit',
      });
      // The original .idx entries still work.
      expect(lookupDict(parsed, 'apple')?.definition).toBe('a fruit');
    });

    test('synonym lookup is case-insensitive', () => {
      const {ifo, idx, dict} = buildSyntheticStarDict({apple: 'a fruit'});
      const syn = buildSyn([{word: 'MALUM', index: 0}]);
      const parsed = buildDict(ifo, idx, dict, syn);
      expect(lookupDict(parsed, 'malum')?.definition).toBe('a fruit');
      expect(lookupDict(parsed, 'Malum')?.definition).toBe('a fruit');
    });

    test('synonyms do not shadow existing .idx entries (idx wins)', () => {
      // If a synonym happens to match an existing headword, the .idx
      // entry already in the map keeps its place. Otherwise a bad
      // .syn could silently swap definitions.
      const {ifo, idx, dict} = buildSyntheticStarDict({
        apple: 'real apple',
        cherry: 'real cherry',
      });
      // Synonym "apple" attempting to point at cherry's index. Should
      // be ignored — apple already maps to its own entry.
      const syn = buildSyn([{word: 'apple', index: 1}]);
      const parsed = buildDict(ifo, idx, dict, syn);
      expect(lookupDict(parsed, 'apple')?.definition).toBe('real apple');
    });

    test('out-of-range synonym index is skipped silently', () => {
      const {ifo, idx, dict} = buildSyntheticStarDict({apple: 'a fruit'});
      // index 99 doesn't exist (we have only entry 0).
      const syn = buildSyn([{word: 'badref', index: 99}]);
      const parsed = buildDict(ifo, idx, dict, syn);
      expect(lookupDict(parsed, 'badref')).toBeNull();
      // The good entries still work.
      expect(lookupDict(parsed, 'apple')?.definition).toBe('a fruit');
    });

    test('empty .syn buffer is treated as no synonyms', () => {
      const {ifo, idx, dict} = buildSyntheticStarDict({apple: 'a fruit'});
      const parsed = buildDict(ifo, idx, dict, new Uint8Array(0));
      expect(lookupDict(parsed, 'apple')?.definition).toBe('a fruit');
    });

    test('omitted .syn parameter is equivalent to no synonym index', () => {
      const {ifo, idx, dict} = buildSyntheticStarDict({apple: 'a fruit'});
      const parsed = buildDict(ifo, idx, dict);
      expect(lookupDict(parsed, 'apple')?.definition).toBe('a fruit');
    });

    test('multi-byte synonym word (Devanagari) resolves correctly', () => {
      // Real Wiktionary case: native script in .idx, Latin in .syn.
      // Here the synthetic dict has Latin in .idx and Devanagari in
      // .syn — same mechanics, just inverted scripts.
      const {ifo, idx, dict} = buildSyntheticStarDict({
        namaste: 'a Hindi greeting',
      });
      const syn = buildSyn([{word: 'नमस्ते', index: 0}]);
      const parsed = buildDict(ifo, idx, dict, syn);
      expect(lookupDict(parsed, 'नमस्ते')).toEqual({
        canonicalWord: 'namaste',
        definition: 'a Hindi greeting',
      });
    });
  });
});
