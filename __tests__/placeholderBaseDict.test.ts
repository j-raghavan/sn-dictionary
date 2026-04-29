import {loadPlaceholderBaseDict} from '../src/core/dict/data/placeholderBaseDict';
import {buildDict, lookupDict} from '../src/core/dict/stardict/stardictDict';

describe('placeholderBaseDict', () => {
  test('produces valid StarDict bytes that the reader can parse', () => {
    const {ifo, idx, dict} = loadPlaceholderBaseDict();
    expect(ifo.length).toBeGreaterThan(0);
    expect(idx.length).toBeGreaterThan(0);
    expect(dict.length).toBeGreaterThan(0);
    const parsed = buildDict(ifo, idx, dict);
    expect(parsed.meta.wordcount).toBeGreaterThanOrEqual(20);
  });

  test('contains anatomy, the user-reported test word', () => {
    const {ifo, idx, dict} = loadPlaceholderBaseDict();
    const parsed = buildDict(ifo, idx, dict);
    const hit = lookupDict(parsed, 'anatomy');
    expect(hit?.canonicalWord).toBe('anatomy');
    expect(hit?.definition).toMatch(/biology|structure/i);
  });

  test('lookup is case-insensitive end-to-end', () => {
    const {ifo, idx, dict} = loadPlaceholderBaseDict();
    const parsed = buildDict(ifo, idx, dict);
    expect(lookupDict(parsed, 'ANATOMY')?.canonicalWord).toBe('anatomy');
  });

  test('returns the same cached bytes across multiple loads', () => {
    const a = loadPlaceholderBaseDict();
    const b = loadPlaceholderBaseDict();
    expect(a).toBe(b);
  });
});
