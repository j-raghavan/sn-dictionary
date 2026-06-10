import {writeStarDict} from '../src/core/dict/stardict/writeStardict';
import {buildDict, lookupDict} from '../src/core/dict/stardict/stardictDict';
import {decodeUtf8} from '../src/sdk/utf8';

const ifoText = (ifo: Uint8Array): string => decodeUtf8(ifo);

describe('writeStarDict', () => {
  test('round-trips through buildDict + lookupDict with no options', async () => {
    // Calling without an options argument exercises the default-empty
    // options parameter, which the test helper always provides.
    const {ifo, idx, dict} = writeStarDict({
      apple: 'a fruit',
      banana: 'a yellow fruit',
    });
    const parsed = await buildDict(ifo, idx, dict);
    expect(parsed.meta.bookname).toBe('Base');
    expect(lookupDict(parsed, 'apple')?.definition).toBe('a fruit');
    expect(lookupDict(parsed, 'banana')?.definition).toBe('a yellow fruit');
  });

  test('round-trips through gzip when gzipDict=true', async () => {
    const {ifo, idx, dict} = writeStarDict(
      {apple: 'a fruit'},
      {gzipDict: true, bookname: 'Compressed'},
    );
    expect(dict[0]).toBe(0x1f);
    expect(dict[1]).toBe(0x8b);
    const parsed = await buildDict(ifo, idx, dict);
    expect(parsed.meta.bookname).toBe('Compressed');
    expect(lookupDict(parsed, 'apple')?.definition).toBe('a fruit');
  });

  describe('sametypesequence-absent layout (issue #28)', () => {
    test('default path stays byte-identical (sametypesequence=m line, raw payloads)', () => {
      const a = writeStarDict({apple: 'a fruit', banana: 'a yellow fruit'});
      // .ifo carries the sametypesequence=m line; .dict is the bare
      // concatenated payloads with no type prefix and no terminators.
      expect(ifoText(a.ifo)).toContain('sametypesequence=m\n');
      expect(Array.from(a.dict)).toEqual(
        Array.from(decodeUtf8Bytes('a fruit' + 'a yellow fruit')),
      );
    });

    test('omitSametypesequence drops the .ifo line and prefixes each payload with a type byte', () => {
      const {ifo, dict} = writeStarDict(
        {apple: 'a fruit', banana: 'a yellow fruit'},
        {omitSametypesequence: true},
      );
      // No sametypesequence line at all.
      expect(ifoText(ifo)).not.toContain('sametypesequence');
      // Layout: 'm' + "a fruit" + 0x00 + 'm' + "a yellow fruit" (no
      // trailing 0x00 after the LAST entry).
      const expected = [
        ...decodeUtf8Bytes('m'),
        ...decodeUtf8Bytes('a fruit'),
        0x00,
        ...decodeUtf8Bytes('m'),
        ...decodeUtf8Bytes('a yellow fruit'),
      ];
      expect(Array.from(dict)).toEqual(expected);
    });

    test('perEntryType sets the per-word type char (default m); .idx lengths cover prefix + terminator', async () => {
      const {ifo, idx, dict} = writeStarDict(
        {alpha: '<b>A</b>', beta: 'plain B'},
        {omitSametypesequence: true, perEntryType: {alpha: 'h'}},
      );
      // alpha (sorts first): 'h' + "<b>A</b>" + 0x00; beta: 'm' + "plain B".
      const alphaPayload = decodeUtf8Bytes('<b>A</b>');
      const expected = [
        ...decodeUtf8Bytes('h'),
        ...alphaPayload,
        0x00,
        ...decodeUtf8Bytes('m'),
        ...decodeUtf8Bytes('plain B'),
      ];
      expect(Array.from(dict)).toEqual(expected);
      // The .idx record for alpha must span 'h' + payload + the 0x00.
      const parsed = await buildDict(ifo, idx, dict);
      const entry = parsed.index.get('alpha')!;
      expect(entry.length).toBe(1 + alphaPayload.length + 1);
    });
  });
});

const decodeUtf8Bytes = (s: string): Uint8Array =>
  new TextEncoder().encode(s);
