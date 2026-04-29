import {writeStarDict} from '../src/core/dict/stardict/writeStardict';
import {buildDict, lookupDict} from '../src/core/dict/stardict/stardictDict';

describe('writeStarDict', () => {
  test('round-trips through buildDict + lookupDict with no options', () => {
    // Calling without an options argument exercises the default-empty
    // options parameter, which the test helper always provides.
    const {ifo, idx, dict} = writeStarDict({
      apple: 'a fruit',
      banana: 'a yellow fruit',
    });
    const parsed = buildDict(ifo, idx, dict);
    expect(parsed.meta.bookname).toBe('Base');
    expect(lookupDict(parsed, 'apple')?.definition).toBe('a fruit');
    expect(lookupDict(parsed, 'banana')?.definition).toBe('a yellow fruit');
  });

  test('round-trips through gzip when gzipDict=true', () => {
    const {ifo, idx, dict} = writeStarDict(
      {apple: 'a fruit'},
      {gzipDict: true, bookname: 'Compressed'},
    );
    expect(dict[0]).toBe(0x1f);
    expect(dict[1]).toBe(0x8b);
    const parsed = buildDict(ifo, idx, dict);
    expect(parsed.meta.bookname).toBe('Compressed');
    expect(lookupDict(parsed, 'apple')?.definition).toBe('a fruit');
  });
});
