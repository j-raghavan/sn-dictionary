import {parseIdx} from '../src/core/dict/stardict/parseIdx';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';

describe('parseIdx', () => {
  test('parses a synthetic 32-bit index back into ordered (word, offset, length)', () => {
    const {idx} = buildSyntheticStarDict({
      apple: 'a fruit',
      banana: 'another fruit',
      cherry: 'small red fruit',
    });
    const entries = parseIdx(idx, 32);
    expect(entries).toEqual([
      {word: 'apple', offset: 0, length: 7},
      {word: 'banana', offset: 7, length: 13},
      {word: 'cherry', offset: 20, length: 15},
    ]);
  });

  test('handles UTF-8 multibyte words', () => {
    const {idx} = buildSyntheticStarDict({
      café: 'noun',
      naïve: 'adjective',
      日本: 'Japan',
    });
    const entries = parseIdx(idx, 32);
    const words = entries.map(e => e.word);
    expect(words).toContain('café');
    expect(words).toContain('naïve');
    expect(words).toContain('日本');
  });

  test('handles 64-bit offsets', () => {
    // Manually build: word "x"(0x78) \0 + 8-byte offset 1 + 4-byte length 5
    const bytes = new Uint8Array([
      0x78,
      0x00,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1, // offset = 1
      0,
      0,
      0,
      5, // length = 5
    ]);
    const entries = parseIdx(bytes, 64);
    expect(entries).toEqual([{word: 'x', offset: 1, length: 5}]);
  });

  test('throws on a truncated record after the word terminator', () => {
    // word "ab" \0 + only 3 trailer bytes (need 8)
    const bytes = new Uint8Array([0x61, 0x62, 0x00, 0, 0, 0]);
    expect(() => parseIdx(bytes, 32)).toThrow(/truncated record/);
  });

  test('throws on an empty word', () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(() => parseIdx(bytes, 32)).toThrow(/empty word/);
  });

  test('throws when the buffer ends without a null terminator', () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]); // "abc" no \0
    expect(() => parseIdx(bytes, 32)).toThrow(/unterminated word/);
  });

  test('returns an empty array for an empty buffer', () => {
    expect(parseIdx(new Uint8Array(0), 32)).toEqual([]);
  });
});
