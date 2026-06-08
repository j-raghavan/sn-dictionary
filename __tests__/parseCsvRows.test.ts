// BACKWARD-COMPAT ORACLE (M16 / ADR-0008). Every assertion here is
// ported VERBATIM from the v1.x master:__tests__/csvDictSource.test.ts —
// the old CSV parser is the contract and these must pass unchanged
// against the new parseCsvRows. The new parser is pure (bytes -> rows);
// to reproduce the old createCsvDictSource(...).lookup(...) end-to-end
// contract, `fromCsv`/`fromBytes` below chain parseCsvRows -> fold keys
// (normalizeKey, first-wins) -> the old lookupCsv mapping (word,
// definition NOT trimmed, format 'plain', phonetic only when present).
// The 10 MB cap is enforced here exactly as the old source did.

import {parseCsvRows, type CsvParseConfig} from '../src/core/dict/parseCsvRows';
import {normalizeKey} from '../src/core/dict/normalizeKey';
import {YIELD_PERIOD} from '../src/core/dict/yieldOften';
import type {DictEntry} from '../src/core/lookup';

const enc = (s: string) => new TextEncoder().encode(s).buffer;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

// Reproduces the old createCsvDictSource lookup contract over the new
// parser, so the ported assertions read identically.
const makeSource = (
  loadBytes: () => Promise<ArrayBuffer | null>,
  config: CsvParseConfig & {maxBytes?: number; logger?: {warn: (m: string) => void}} = {},
) => {
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
  let index: Map<string, DictEntry> | null = null;
  let absent = false;
  const ensure = async (): Promise<void> => {
    if (index !== null || absent) {
      return;
    }
    let buf: ArrayBuffer | null;
    try {
      buf = await loadBytes();
      if (buf === null) {
        absent = true;
        return;
      }
      if (buf.byteLength > maxBytes) {
        throw new Error(`file too large: ${buf.byteLength} bytes > ${maxBytes} cap`);
      }
      const rows = await parseCsvRows(new Uint8Array(buf), config);
      const map = new Map<string, DictEntry>();
      for (const r of rows) {
        const key = normalizeKey(r.word);
        if (key.length > 0 && !map.has(key)) {
          const e: DictEntry = {word: r.word, definition: r.definition, format: 'plain'};
          if (r.phonetic !== undefined) {
            e.phonetic = r.phonetic;
          }
          map.set(key, e);
        }
      }
      index = map;
    } catch (err) {
      config.logger?.warn((err as Error).message);
      // Mirror the lazy harness: a failed load leaves the source empty
      // (lookups return null) — matches the old createCsvDictSource.
      absent = true;
    }
  };
  return {
    async lookup(word: string): Promise<DictEntry | null> {
      const trimmed = word.trim();
      if (!trimmed) {
        return null;
      }
      await ensure();
      return index?.get(normalizeKey(trimmed)) ?? null;
    },
  };
};

const fromCsv = (csv: string, opts: {hasHeader?: boolean} = {}) =>
  makeSource(async () => enc(csv), {hasHeader: opts.hasHeader});

const fromBytes = (raw: Uint8Array, opts: {hasHeader?: boolean} = {}) =>
  makeSource(async () => raw.buffer.slice(0) as ArrayBuffer, {hasHeader: opts.hasHeader});

describe('parseCsvRows (backward-compat oracle, ported verbatim)', () => {
  test('basic two-column lookup, case-insensitive', async () => {
    const src = fromCsv('apple,a fruit\nBanana,a yellow fruit\n');
    expect(await src.lookup('apple')).toEqual({
      word: 'apple',
      definition: 'a fruit',
      format: 'plain',
    });
    expect(await src.lookup('banana')).toEqual({
      word: 'Banana',
      definition: 'a yellow fruit',
      format: 'plain',
    });
    expect(await src.lookup('BANANA')).toEqual({
      word: 'Banana',
      definition: 'a yellow fruit',
      format: 'plain',
    });
  });

  test('returns null for unknown word', async () => {
    const src = fromCsv('apple,fruit\n');
    expect(await src.lookup('grape')).toBeNull();
  });

  test('handles quoted fields with embedded commas', async () => {
    const src = fromCsv('apple,"a fruit, red or green"\n');
    expect((await src.lookup('apple'))?.definition).toBe('a fruit, red or green');
  });

  test('handles escaped quotes inside quoted fields', async () => {
    const src = fromCsv('apple,"she said ""hi"" then left"\n');
    expect((await src.lookup('apple'))?.definition).toBe('she said "hi" then left');
  });

  test('handles quoted fields containing newlines', async () => {
    const src = fromCsv('apple,"line1\nline2"\nbanana,yellow\n');
    expect((await src.lookup('apple'))?.definition).toBe('line1\nline2');
    expect((await src.lookup('banana'))?.definition).toBe('yellow');
  });

  test('handles \\r\\n row terminators', async () => {
    const src = fromCsv('apple,fruit\r\nbanana,yellow\r\n');
    expect((await src.lookup('apple'))?.definition).toBe('fruit');
    expect((await src.lookup('banana'))?.definition).toBe('yellow');
  });

  test('strips a UTF-8 BOM at the start of the file', async () => {
    const src = fromCsv('﻿apple,fruit\n');
    expect((await src.lookup('apple'))?.definition).toBe('fruit');
  });

  test('respects hasHeader: skips the first row', async () => {
    const src = fromCsv('word,definition\napple,fruit\n', {hasHeader: true});
    expect((await src.lookup('word'))?.definition).toBeUndefined();
    expect((await src.lookup('apple'))?.definition).toBe('fruit');
  });

  test('first occurrence wins when duplicates exist', async () => {
    const src = fromCsv('apple,first\napple,second\n');
    expect((await src.lookup('apple'))?.definition).toBe('first');
  });

  test('skips rows with empty headword', async () => {
    const src = fromCsv(',orphan\napple,fruit\n');
    expect((await src.lookup('apple'))?.definition).toBe('fruit');
  });

  test('configurable column indices', async () => {
    const src = makeSource(async () => enc('id,word,extra,definition\n1,apple,red,a fruit\n'), {
      headwordCol: 1,
      definitionCol: 3,
      hasHeader: true,
    });
    expect((await src.lookup('apple'))?.definition).toBe('a fruit');
  });

  test('missing definition column yields empty string', async () => {
    const src = fromCsv('apple\n');
    const hit = await src.lookup('apple');
    expect(hit).toEqual({word: 'apple', definition: '', format: 'plain'});
  });

  test('returns null on empty input', async () => {
    const src = fromCsv('   ');
    expect(await src.lookup('apple')).toBeNull();
  });

  test('refuses files larger than the size cap', async () => {
    const warn = jest.fn();
    const big = new ArrayBuffer(11 * 1024 * 1024);
    const src = makeSource(async () => big, {maxBytes: 10 * 1024 * 1024, logger: {warn}});
    expect(await src.lookup('apple')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/file too large/));
  });

  test('handles last row without a final newline', async () => {
    const src = fromCsv('apple,fruit\nbanana,yellow');
    expect((await src.lookup('banana'))?.definition).toBe('yellow');
  });

  test('handles lone \\r row terminators (legacy Mac)', async () => {
    const src = fromCsv('apple,fruit\rbanana,yellow\r');
    expect((await src.lookup('apple'))?.definition).toBe('fruit');
    expect((await src.lookup('banana'))?.definition).toBe('yellow');
  });

  test('headword column index beyond the row produces an empty key (skipped)', async () => {
    const src = makeSource(async () => enc('apple,fruit\n'), {headwordCol: 5, definitionCol: 1});
    expect(await src.lookup('apple')).toBeNull();
  });

  test('decodes Windows-1252 (CP1252) CSV exports from Excel', async () => {
    const cp1252 = new Uint8Array([
      0x41, 0x43, 0x48, 0x2c,
      0x6c, 0x65, 0x66, 0x74, 0x20,
      0x74, 0x75, 0x72, 0x6e, 0x3a, 0x20,
      0x61, 0x20, 0x77, 0x6f, 0x72, 0x6d, 0x20,
      0x73, 0x74, 0x65, 0x65, 0x72, 0x73, 0x6d, 0x61, 0x6e,
      0x92,
      0x73, 0x20, 0x63, 0x61, 0x6c, 0x6c, 0x2e,
      0x0d, 0x0a,
    ]);
    const src = fromBytes(cp1252);
    const hit = await src.lookup('ACH');
    expect(hit?.definition).toBe('left turn: a worm steersman’s call.');
  });

  test('decodes CP1252 with curly double quotes, em dash and ellipsis', async () => {
    const cp1252 = new Uint8Array([
      0x77, 0x6f, 0x72, 0x64, 0x2c,
      0x93, 0x68, 0x69, 0x94, 0x20,
      0x97, 0x20,
      0x69, 0x74, 0x92, 0x73, 0x20,
      0x65, 0x6e, 0x64, 0x85,
    ]);
    const src = fromBytes(cp1252);
    expect((await src.lookup('word'))?.definition).toBe('“hi” — it’s end…');
  });

  test("Muad'Dib regression: ASCII query matches CP1252 0x92 headword", async () => {
    const cp1252 = new Uint8Array([
      0x4d, 0x55, 0x41, 0x44, 0x92, 0x44, 0x49, 0x42, 0x2c,
      0x6b, 0x61, 0x6e, 0x67, 0x61, 0x72, 0x6f, 0x6f,
      0x0d, 0x0a,
    ]);
    const src = fromBytes(cp1252);
    expect((await src.lookup("Muad'Dib"))?.definition).toBe('kangaroo');
    expect((await src.lookup('muad’dib'))?.definition).toBe('kangaroo');
    expect((await src.lookup('MUAD’DIB'))?.definition).toBe('kangaroo');
    expect((await src.lookup("muad'dib"))?.word).toBe('MUAD’DIB');
  });

  test('decodes UTF-16 LE with BOM (Excel "Unicode Text" export)', async () => {
    const u16 = new Uint8Array([
      0xff, 0xfe,
      0x6b, 0x00,
      0x2c, 0x00,
      0x76, 0x00,
      0x0a, 0x00,
    ]);
    const src = fromBytes(u16);
    expect((await src.lookup('k'))?.definition).toBe('v');
  });

  test('decodes UTF-16 BE with BOM', async () => {
    const u16 = new Uint8Array([
      0xfe, 0xff,
      0x00, 0x6b,
      0x00, 0x2c,
      0x00, 0x76,
      0x00, 0x0a,
    ]);
    const src = fromBytes(u16);
    expect((await src.lookup('k'))?.definition).toBe('v');
  });

  test('phoneticCol: surfaces a third column as DictEntry.phonetic', async () => {
    const src = makeSource(async () => enc('ARRAKIS,the planet known as Dune,uh-RAK-is\n'), {
      phoneticCol: 2,
    });
    expect(await src.lookup('arrakis')).toEqual({
      word: 'ARRAKIS',
      definition: 'the planet known as Dune',
      format: 'plain',
      phonetic: 'uh-RAK-is',
    });
  });

  test('phoneticCol: omitted in entries with empty phonetic field', async () => {
    const src = makeSource(async () => enc('apple,fruit,\nbanana,yellow,buh-NAN-uh\n'), {
      phoneticCol: 2,
    });
    const apple = await src.lookup('apple');
    expect(apple).toEqual({word: 'apple', definition: 'fruit', format: 'plain'});
    expect(apple).not.toHaveProperty('phonetic');
    const banana = await src.lookup('banana');
    expect(banana?.phonetic).toBe('buh-NAN-uh');
  });

  test('phoneticCol: out-of-range column is treated as no phonetic, not a crash', async () => {
    const src = makeSource(async () => enc('apple,fruit\n'), {phoneticCol: 9});
    const hit = await src.lookup('apple');
    expect(hit).toEqual({word: 'apple', definition: 'fruit', format: 'plain'});
    expect(hit).not.toHaveProperty('phonetic');
  });

  test('phoneticCol omitted: no phonetic surfaces even if extra cols exist', async () => {
    const src = fromCsv('ARRAKIS,the planet,uh-RAK-is\n');
    const hit = await src.lookup('arrakis');
    expect(hit).not.toHaveProperty('phonetic');
  });

  test('yields cooperatively while parsing a large CSV (UI-blocking guard)', async () => {
    const total = YIELD_PERIOD + 5;
    const lines: string[] = [];
    for (let i = 0; i < total; i++) {
      lines.push(`w${i},def${i}`);
    }
    const csv = lines.join('\n') + '\n';

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    try {
      const src = fromCsv(csv);
      const hit = await src.lookup('w0');
      expect(hit?.definition).toBe('def0');
      const last = await src.lookup(`w${total - 1}`);
      expect(last?.definition).toBe(`def${total - 1}`);
      const zeroDelayCalls = setTimeoutSpy.mock.calls.filter(c => c[1] === 0);
      const expectedMin = 1 + Math.floor(total / YIELD_PERIOD);
      expect(zeroDelayCalls.length).toBeGreaterThanOrEqual(expectedMin);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  test('definition is NOT trimmed (leading/trailing whitespace preserved)', async () => {
    // The Dune contract: "ABA, loose robe…" -> definition " loose robe…".
    const src = fromCsv('ABA, loose robe worn by Fremen women\n');
    expect((await src.lookup('aba'))?.definition).toBe(' loose robe worn by Fremen women');
  });

  test('lazy: loader fires once across many lookups', async () => {
    const loadBytes = jest.fn(async () => enc('apple,fruit\n'));
    const src = makeSource(loadBytes);
    await src.lookup('apple');
    await src.lookup('banana');
    await src.lookup('grape');
    expect(loadBytes).toHaveBeenCalledTimes(1);
  });
});
