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
});
