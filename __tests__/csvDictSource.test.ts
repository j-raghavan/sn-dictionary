import {createCsvDictSource} from '../src/core/dict/csvDictSource';
import {YIELD_PERIOD} from '../src/core/dict/yieldOften';

const enc = (s: string) => new TextEncoder().encode(s).buffer;

const fromCsv = (csv: string, opts: {hasHeader?: boolean} = {}) =>
  createCsvDictSource({
    name: 'test',
    loadBytes: async () => enc(csv),
    hasHeader: opts.hasHeader,
  });

const fromBytes = (raw: Uint8Array, opts: {hasHeader?: boolean} = {}) =>
  createCsvDictSource({
    name: 'test',
    loadBytes: async () => raw.buffer.slice(0) as ArrayBuffer,
    hasHeader: opts.hasHeader,
  });

describe('createCsvDictSource', () => {
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
    expect((await src.lookup('apple'))?.definition).toBe(
      'a fruit, red or green',
    );
  });

  test('handles escaped quotes inside quoted fields', async () => {
    const src = fromCsv('apple,"she said ""hi"" then left"\n');
    expect((await src.lookup('apple'))?.definition).toBe(
      'she said "hi" then left',
    );
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
    const src = createCsvDictSource({
      name: 'test',
      loadBytes: async () =>
        enc('id,word,extra,definition\n1,apple,red,a fruit\n'),
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
    const src = createCsvDictSource({
      name: 'test',
      loadBytes: async () => big,
      maxBytes: 10 * 1024 * 1024,
      logger: {warn},
    });
    expect(await src.lookup('apple')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/file too large/),
    );
  });

  test('exposes the configured name on the returned source', () => {
    const src = createCsvDictSource({
      name: 'medical-en',
      loadBytes: async () => enc('apple,fruit\n'),
    });
    expect(src.name).toBe('medical-en');
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
    const src = createCsvDictSource({
      name: 'test',
      loadBytes: async () => enc('apple,fruit\n'),
      // Out-of-range column: row[5] is undefined so the headword
      // resolves to '' and the row is skipped.
      headwordCol: 5,
      definitionCol: 1,
    });
    expect(await src.lookup('apple')).toBeNull();
  });

  // Regression: Dune.csv (a real user file from v1.0.4) was Excel-on-
  // Windows CP1252, not UTF-8. v1.0.4 silently replaced 0x92 / 0x93 /
  // 0x94 / 0x97 / 0x85 with U+FFFD, which the firmware font drew as a
  // black diamond with a question mark. The reader must now decode
  // CP1252 byte sequences correctly with no caller intervention.
  test('decodes Windows-1252 (CP1252) CSV exports from Excel', async () => {
    // "ACH,left turn: a worm steersman’s call." — verbatim line 2 of
    // the user's Dune.csv, where 0x92 is the CP1252 right single quote.
    const cp1252 = new Uint8Array([
      0x41, 0x43, 0x48, 0x2c, // "ACH,"
      0x6c, 0x65, 0x66, 0x74, 0x20, // "left "
      0x74, 0x75, 0x72, 0x6e, 0x3a, 0x20, // "turn: "
      0x61, 0x20, 0x77, 0x6f, 0x72, 0x6d, 0x20, // "a worm "
      0x73, 0x74, 0x65, 0x65, 0x72, 0x73, 0x6d, 0x61, 0x6e, // "steersman"
      0x92, // ’ in CP1252
      0x73, 0x20, 0x63, 0x61, 0x6c, 0x6c, 0x2e, // "s call."
      0x0d, 0x0a, // CRLF (Excel-on-Windows default)
    ]);
    const src = fromBytes(cp1252);
    const hit = await src.lookup('ACH');
    expect(hit?.definition).toBe('left turn: a worm steersman’s call.');
  });

  test('decodes CP1252 with curly double quotes, em dash and ellipsis', async () => {
    // Covers all five CP1252-only bytes from the bug fixture in one
    // row: 0x93, 0x94, 0x92, 0x97, 0x85.
    const cp1252 = new Uint8Array([
      0x77, 0x6f, 0x72, 0x64, 0x2c, // "word,"
      0x93, 0x68, 0x69, 0x94, 0x20, // “hi”
      0x97, 0x20, // — (em dash) + space
      0x69, 0x74, 0x92, 0x73, 0x20, // it’s
      0x65, 0x6e, 0x64, 0x85, // end…
    ]);
    const src = fromBytes(cp1252);
    expect((await src.lookup('word'))?.definition).toBe('“hi” — it’s end…');
  });

  // Regression: the Dune.csv user typed "Muad'Dib" (U+0027) but the
  // file stores "MUAD’DIB" with U+2019 (CP1252 0x92). After encoding
  // is corrected, the lookup still misses unless punctuation is
  // folded on both sides. Verify the *raw bytes* path: CP1252-encoded
  // headword + ASCII-typed query.
  test("Muad'Dib regression: ASCII query matches CP1252 0x92 headword", async () => {
    const cp1252 = new Uint8Array([
      0x4d, 0x55, 0x41, 0x44, 0x92, 0x44, 0x49, 0x42, 0x2c, // "MUAD’DIB,"
      0x6b, 0x61, 0x6e, 0x67, 0x61, 0x72, 0x6f, 0x6f, // "kangaroo"
      0x0d, 0x0a,
    ]);
    const src = fromBytes(cp1252);
    expect((await src.lookup("Muad'Dib"))?.definition).toBe('kangaroo');
    expect((await src.lookup('muad’dib'))?.definition).toBe('kangaroo');
    expect((await src.lookup('MUAD’DIB'))?.definition).toBe('kangaroo');
    // Canonical word stays as stored (with the curly quote).
    expect((await src.lookup("muad'dib"))?.word).toBe('MUAD’DIB');
  });

  test('decodes UTF-16 LE with BOM (Excel "Unicode Text" export)', async () => {
    // "k,v\n" in UTF-16 LE with FF FE BOM
    const u16 = new Uint8Array([
      0xff, 0xfe,
      0x6b, 0x00, // k
      0x2c, 0x00, // ,
      0x76, 0x00, // v
      0x0a, 0x00, // \n
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
    const src = createCsvDictSource({
      name: 'test',
      loadBytes: async () =>
        enc('ARRAKIS,the planet known as Dune,uh-RAK-is\n'),
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
    const src = createCsvDictSource({
      name: 'test',
      loadBytes: async () => enc('apple,fruit,\nbanana,yellow,buh-NAN-uh\n'),
      phoneticCol: 2,
    });
    const apple = await src.lookup('apple');
    // Empty third column means no phonetic — field is omitted, not ''.
    expect(apple).toEqual({word: 'apple', definition: 'fruit', format: 'plain'});
    expect(apple).not.toHaveProperty('phonetic');
    const banana = await src.lookup('banana');
    expect(banana?.phonetic).toBe('buh-NAN-uh');
  });

  test('phoneticCol: out-of-range column is treated as no phonetic, not a crash', async () => {
    const src = createCsvDictSource({
      name: 'test',
      loadBytes: async () => enc('apple,fruit\n'),
      phoneticCol: 9, // row only has 2 cells
    });
    const hit = await src.lookup('apple');
    expect(hit).toEqual({word: 'apple', definition: 'fruit', format: 'plain'});
    expect(hit).not.toHaveProperty('phonetic');
  });

  test('phoneticCol omitted: no phonetic surfaces even if extra cols exist', async () => {
    // Backwards-compatibility: a CSV that happens to have a third
    // column shouldn't accidentally leak it as phonetic when the
    // caller never asked for one.
    const src = fromCsv('ARRAKIS,the planet,uh-RAK-is\n');
    const hit = await src.lookup('arrakis');
    expect(hit).not.toHaveProperty('phonetic');
  });

  test('yields cooperatively while parsing a large CSV (UI-blocking guard)', async () => {
    // Generate YIELD_PERIOD + a few rows so the parser hits at least
    // one in-loop yield boundary. Without yielding, this loop would
    // block input on Hermes for several seconds on multi-MB user
    // CSVs — exactly the freeze users reported.
    const total = YIELD_PERIOD + 5;
    const lines: string[] = [];
    for (let i = 0; i < total; i++) {
      lines.push(`w${i},def${i}`);
    }
    const csv = lines.join('\n') + '\n';

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    try {
      const src = fromCsv(csv);
      // Trigger parse via a lookup (the harness lazy-loads).
      const hit = await src.lookup('w0');
      expect(hit?.definition).toBe('def0');
      // Last row also kept — the loop yielded but resumed correctly.
      const last = await src.lookup(`w${total - 1}`);
      expect(last?.definition).toBe(`def${total - 1}`);
      // Minimum yield budget: one after decodeText (boundary
      // between native TextDecoder and JS iteration), plus one per
      // YIELD_PERIOD rows during iteration. For total = period + 5
      // that's 1 + 1 = 2. Asserting the floor catches a regression
      // that drops EITHER the boundary yield or the in-loop yield —
      // ≥1 would only catch the all-or-nothing case.
      const zeroDelayCalls = setTimeoutSpy.mock.calls.filter(
        c => c[1] === 0,
      );
      const expectedMin = 1 + Math.floor(total / YIELD_PERIOD);
      expect(zeroDelayCalls.length).toBeGreaterThanOrEqual(expectedMin);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  test('lazy: loader fires once across many lookups', async () => {
    const loadBytes = jest.fn(async () => enc('apple,fruit\n'));
    const src = createCsvDictSource({name: 'test', loadBytes});
    await src.lookup('apple');
    await src.lookup('banana');
    await src.lookup('grape');
    expect(loadBytes).toHaveBeenCalledTimes(1);
  });
});
