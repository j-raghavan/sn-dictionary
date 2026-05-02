import {parseIdx} from '../src/core/dict/stardict/parseIdx';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';
import {YIELD_PERIOD} from '../src/core/dict/stardict/yieldOften';

describe('parseIdx', () => {
  test('parses a synthetic 32-bit index back into ordered (word, offset, length)', async () => {
    const {idx} = buildSyntheticStarDict({
      apple: 'a fruit',
      banana: 'another fruit',
      cherry: 'small red fruit',
    });
    const entries = await parseIdx(idx, 32);
    expect(entries).toEqual([
      {word: 'apple', offset: 0, length: 7},
      {word: 'banana', offset: 7, length: 13},
      {word: 'cherry', offset: 20, length: 15},
    ]);
  });

  test('handles UTF-8 multibyte words', async () => {
    const {idx} = buildSyntheticStarDict({
      café: 'noun',
      naïve: 'adjective',
      日本: 'Japan',
    });
    const entries = await parseIdx(idx, 32);
    const words = entries.map(e => e.word);
    expect(words).toContain('café');
    expect(words).toContain('naïve');
    expect(words).toContain('日本');
  });

  test('handles 64-bit offsets', async () => {
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
    const entries = await parseIdx(bytes, 64);
    expect(entries).toEqual([{word: 'x', offset: 1, length: 5}]);
  });

  test('throws on a truncated record after the word terminator', async () => {
    // word "ab" \0 + only 3 trailer bytes (need 8)
    const bytes = new Uint8Array([0x61, 0x62, 0x00, 0, 0, 0]);
    await expect(parseIdx(bytes, 32)).rejects.toThrow(/truncated record/);
  });

  test('throws on an empty word', async () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1]);
    await expect(parseIdx(bytes, 32)).rejects.toThrow(/empty word/);
  });

  test('throws when the buffer ends without a null terminator', async () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]); // "abc" no \0
    await expect(parseIdx(bytes, 32)).rejects.toThrow(/unterminated word/);
  });

  test('returns an empty array for an empty buffer', async () => {
    expect(await parseIdx(new Uint8Array(0), 32)).toEqual([]);
  });

  test('yields cooperatively while parsing a large buffer (UI-blocking guard)', async () => {
    // Build YIELD_PERIOD + 5 entries so the parser hits at least one
    // yield. Each record: 5-byte word + \0 + 4-byte offset + 4-byte
    // length = 14 bytes. We craft them by hand to keep the fixture
    // tiny relative to the 16k yield period.
    const total = YIELD_PERIOD + 5;
    const recordSize = 5 + 1 + 4 + 4;
    const buf = new Uint8Array(total * recordSize);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < total; i++) {
      const start = i * recordSize;
      // Word "wXXXX" where XXXX is the index right-padded to 4 chars
      // so each record is exactly 5 bytes long.
      const w = `w${String(i).padStart(4, '0')}`.slice(0, 5);
      for (let j = 0; j < 5; j++) {
        buf[start + j] = w.charCodeAt(j);
      }
      buf[start + 5] = 0;
      view.setUint32(start + 6, i, false); // offset
      view.setUint32(start + 10, 1, false); // length
    }

    // Spy on setTimeout to confirm the parser yielded at least once
    // during the run (it should fire at the YIELD_PERIOD boundary).
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    try {
      const entries = await parseIdx(buf, 32);
      expect(entries.length).toBe(total);
      // setTimeout was invoked at least once with delay 0 — the
      // cooperative-yield helper.
      const zeroDelayCalls = setTimeoutSpy.mock.calls.filter(
        c => c[1] === 0,
      );
      expect(zeroDelayCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
