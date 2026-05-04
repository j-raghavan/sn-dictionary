import {parseSyn} from '../src/core/dict/stardict/parseSyn';
import {YIELD_PERIOD} from '../src/core/dict/yieldOften';

const enc = (s: string) => new TextEncoder().encode(s);

const buildSyn = (entries: {word: string; index: number}[]): Uint8Array => {
  /* eslint-disable no-bitwise */
  const parts: number[] = [];
  for (const {word, index} of entries) {
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

describe('parseSyn', () => {
  test('parses a simple sequence of synonym -> idx-index records', async () => {
    const bytes = buildSyn([
      {word: 'namaste', index: 5},
      {word: 'dhanyavad', index: 12},
      {word: 'paani', index: 200},
    ]);
    expect(await parseSyn(bytes)).toEqual([
      {word: 'namaste', originalWordIndex: 5},
      {word: 'dhanyavad', originalWordIndex: 12},
      {word: 'paani', originalWordIndex: 200},
    ]);
  });

  test('decodes UTF-8 multi-byte words', async () => {
    const bytes = buildSyn([
      {word: 'нет', index: 1}, // Cyrillic
      {word: 'नमस्ते', index: 2}, // Devanagari
    ]);
    expect(await parseSyn(bytes)).toEqual([
      {word: 'нет', originalWordIndex: 1},
      {word: 'नमस्ते', originalWordIndex: 2},
    ]);
  });

  test('handles a large 32-bit big-endian index', async () => {
    const bytes = buildSyn([{word: 'big', index: 0x01020304}]);
    expect((await parseSyn(bytes))[0].originalWordIndex).toBe(0x01020304);
  });

  test('returns [] for empty input', async () => {
    expect(await parseSyn(new Uint8Array(0))).toEqual([]);
  });

  test('throws on a record with an empty word', async () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 0]); // \0 + 4 zero index bytes
    await expect(parseSyn(bytes)).rejects.toThrow(/empty word/);
  });

  test('throws on an unterminated word at end of buffer', async () => {
    const bytes = new Uint8Array([0x66, 0x6f, 0x6f]); // "foo" with no \0
    await expect(parseSyn(bytes)).rejects.toThrow(/unterminated word/);
  });

  test('throws on a truncated index (less than 4 bytes after \\0)', async () => {
    const bytes = new Uint8Array([0x66, 0x6f, 0x6f, 0, 0, 0]); // "foo\0" + only 2 bytes
    await expect(parseSyn(bytes)).rejects.toThrow(/truncated record/);
  });

  test('yields cooperatively while parsing a large buffer', async () => {
    const entries = Array.from({length: YIELD_PERIOD + 5}, (_, i) => ({
      word: `s${String(i).padStart(4, '0')}`,
      index: i,
    }));
    const bytes = buildSyn(entries);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    try {
      const out = await parseSyn(bytes);
      expect(out.length).toBe(entries.length);
      const zeroDelayCalls = setTimeoutSpy.mock.calls.filter(
        c => c[1] === 0,
      );
      expect(zeroDelayCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
