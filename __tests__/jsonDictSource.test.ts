import {createJsonDictSource} from '../src/core/dict/jsonDictSource';
import {YIELD_PERIOD} from '../src/core/dict/yieldOften';

const enc = (s: string) => new TextEncoder().encode(s).buffer;

const fromJson = (json: string) =>
  createJsonDictSource({name: 'test', loadBytes: async () => enc(json)});

describe('createJsonDictSource', () => {
  test('object-map shape: {word: definition}', async () => {
    const src = fromJson(
      JSON.stringify({apple: 'a fruit', banana: 'a yellow fruit'}),
    );
    expect(await src.lookup('apple')).toEqual({
      word: 'apple',
      definition: 'a fruit',
      format: 'plain',
    });
    expect(await src.lookup('banana')).toEqual({
      word: 'banana',
      definition: 'a yellow fruit',
      format: 'plain',
    });
  });

  test('array-of-objects shape: [{word, definition}]', async () => {
    const src = fromJson(
      JSON.stringify([
        {word: 'apple', definition: 'a fruit'},
        {word: 'banana', definition: 'a yellow fruit'},
      ]),
    );
    expect((await src.lookup('apple'))?.definition).toBe('a fruit');
    expect((await src.lookup('banana'))?.definition).toBe('a yellow fruit');
  });

  test('array-of-objects accepts headword/def aliases', async () => {
    const src = fromJson(
      JSON.stringify([
        {headword: 'apple', def: 'a fruit'},
        {term: 'banana', meaning: 'a yellow fruit'},
        {key: 'grape', value: 'a small fruit'},
      ]),
    );
    expect((await src.lookup('apple'))?.definition).toBe('a fruit');
    expect((await src.lookup('banana'))?.definition).toBe('a yellow fruit');
    expect((await src.lookup('grape'))?.definition).toBe('a small fruit');
  });

  test('case-insensitive lookup; preserves canonical case', async () => {
    const src = fromJson(JSON.stringify({Banana: 'a yellow fruit'}));
    expect(await src.lookup('banana')).toEqual({
      word: 'Banana',
      definition: 'a yellow fruit',
      format: 'plain',
    });
  });

  test('returns null for unknown word', async () => {
    const src = fromJson(JSON.stringify({apple: 'fruit'}));
    expect(await src.lookup('grape')).toBeNull();
  });

  test('strips a UTF-8 BOM at the start of the file', async () => {
    const src = fromJson('﻿' + JSON.stringify({apple: 'fruit'}));
    expect((await src.lookup('apple'))?.definition).toBe('fruit');
  });

  test('first occurrence wins when duplicate keys exist (array shape)', async () => {
    const src = fromJson(
      JSON.stringify([
        {word: 'apple', definition: 'first'},
        {word: 'apple', definition: 'second'},
      ]),
    );
    expect((await src.lookup('apple'))?.definition).toBe('first');
  });

  test('skips malformed array entries (not an object, missing fields, wrong types)', async () => {
    const src = fromJson(
      JSON.stringify([
        'a string row',
        null,
        {word: 'apple'}, // missing def
        {definition: 'orphan'}, // missing word
        {word: 'good', definition: 'kept'},
        {word: 12, definition: 'wrong type'},
      ]),
    );
    expect((await src.lookup('good'))?.definition).toBe('kept');
    expect(await src.lookup('apple')).toBeNull();
  });

  test('skips object-map entries whose value is not a string', async () => {
    const src = fromJson(
      JSON.stringify({apple: 'fruit', bad: 42, also: null, banana: 'yellow'}),
    );
    expect((await src.lookup('apple'))?.definition).toBe('fruit');
    expect((await src.lookup('banana'))?.definition).toBe('yellow');
    expect(await src.lookup('bad')).toBeNull();
    expect(await src.lookup('also')).toBeNull();
  });

  test('skips entries with empty headword', async () => {
    const src = fromJson(JSON.stringify({'   ': 'orphan', apple: 'fruit'}));
    expect((await src.lookup('apple'))?.definition).toBe('fruit');
  });

  test('rejects scalar root with a parse error (warned via lazyAsyncSource)', async () => {
    const warn = jest.fn();
    const src = createJsonDictSource({
      name: 'test',
      loadBytes: async () => enc('"not a dict"'),
      logger: {warn},
    });
    expect(await src.lookup('apple')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/JSON root must be an object map or an array/),
    );
  });

  test('rejects malformed JSON input (warned)', async () => {
    const warn = jest.fn();
    const src = createJsonDictSource({
      name: 'test',
      loadBytes: async () => enc('{invalid'),
      logger: {warn},
    });
    expect(await src.lookup('apple')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/parse threw/),
    );
  });

  test('refuses files larger than the size cap', async () => {
    const warn = jest.fn();
    const big = new ArrayBuffer(11 * 1024 * 1024);
    const src = createJsonDictSource({
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
    const src = createJsonDictSource({
      name: 'my-glossary',
      loadBytes: async () => enc('{}'),
    });
    expect(src.name).toBe('my-glossary');
  });

  test('decodes Windows-1252 JSON exports', async () => {
    // {"apple":"a fruit, it’s red"} where ’ is CP1252 0x92.
    const cp1252 = new Uint8Array([
      0x7b, 0x22, 0x61, 0x70, 0x70, 0x6c, 0x65, 0x22, 0x3a, // {"apple":
      0x22, 0x61, 0x20, 0x66, 0x72, 0x75, 0x69, 0x74, 0x2c, 0x20, // "a fruit,
      0x69, 0x74, 0x92, 0x73, 0x20, 0x72, 0x65, 0x64, 0x22, 0x7d, // it’s red"}
    ]);
    const src = createJsonDictSource({
      name: 'test',
      loadBytes: async () => cp1252.buffer.slice(0) as ArrayBuffer,
    });
    expect((await src.lookup('apple'))?.definition).toBe('a fruit, it’s red');
  });

  test('array shape: surfaces phonetic field on the entry', async () => {
    const src = fromJson(
      JSON.stringify([
        {word: 'arrakis', definition: 'the planet', phonetic: 'uh-RAK-is'},
      ]),
    );
    expect(await src.lookup('arrakis')).toEqual({
      word: 'arrakis',
      definition: 'the planet',
      format: 'plain',
      phonetic: 'uh-RAK-is',
    });
  });

  test('array shape: accepts pronunciation/ipa as phonetic aliases', async () => {
    const src = fromJson(
      JSON.stringify([
        {word: 'a', definition: 'd', pronunciation: 'AY'},
        {word: 'b', definition: 'd', ipa: 'biː'},
        {word: 'c', definition: 'd', phon: 'see'},
      ]),
    );
    expect((await src.lookup('a'))?.phonetic).toBe('AY');
    expect((await src.lookup('b'))?.phonetic).toBe('biː');
    expect((await src.lookup('c'))?.phonetic).toBe('see');
  });

  test('array shape: blank/whitespace phonetic is treated as absent', async () => {
    const src = fromJson(
      JSON.stringify([
        {word: 'a', definition: 'd', phonetic: '   '},
        {word: 'b', definition: 'd', phonetic: ''},
      ]),
    );
    expect(await src.lookup('a')).not.toHaveProperty('phonetic');
    expect(await src.lookup('b')).not.toHaveProperty('phonetic');
  });

  test('array shape: non-string phonetic is ignored', async () => {
    const src = fromJson(
      JSON.stringify([{word: 'a', definition: 'd', phonetic: 42}]),
    );
    expect(await src.lookup('a')).not.toHaveProperty('phonetic');
  });

  test('object-map shape: never produces a phonetic (no place to put it)', async () => {
    const src = fromJson(JSON.stringify({apple: 'fruit'}));
    const hit = await src.lookup('apple');
    expect(hit).toEqual({word: 'apple', definition: 'fruit', format: 'plain'});
    expect(hit).not.toHaveProperty('phonetic');
  });

  test('array shape: yields cooperatively over a large array (UI-blocking guard)', async () => {
    const total = YIELD_PERIOD + 5;
    const arr: Array<{word: string; definition: string}> = [];
    for (let i = 0; i < total; i++) {
      arr.push({word: `w${i}`, definition: `def${i}`});
    }
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    try {
      const src = fromJson(JSON.stringify(arr));
      expect((await src.lookup('w0'))?.definition).toBe('def0');
      expect((await src.lookup(`w${total - 1}`))?.definition).toBe(
        `def${total - 1}`,
      );
      // Minimum yield budget for the array shape:
      //   1 after decodeText
      // + 1 after JSON.parse
      // + ⌊total / YIELD_PERIOD⌋ during iteration
      // = 3 for total = period + 5.
      const zeroDelayCalls = setTimeoutSpy.mock.calls.filter(
        c => c[1] === 0,
      );
      const expectedMin = 2 + Math.floor(total / YIELD_PERIOD);
      expect(zeroDelayCalls.length).toBeGreaterThanOrEqual(expectedMin);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  test('object-map shape: yields cooperatively over a large map (UI-blocking guard)', async () => {
    const obj: Record<string, string> = {};
    const total = YIELD_PERIOD + 5;
    for (let i = 0; i < total; i++) {
      obj[`w${i}`] = `def${i}`;
    }
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    try {
      const src = fromJson(JSON.stringify(obj));
      expect((await src.lookup('w0'))?.definition).toBe('def0');
      // Minimum yield budget for the object-map shape:
      //   1 after decodeText
      // + 1 after JSON.parse
      // + 1 after Object.keys (the only remaining non-yieldable
      //   allocation — explicitly bounded so a regression that
      //   drops it shows up here)
      // + ⌊total / YIELD_PERIOD⌋ during iteration
      // = 4 for total = period + 5.
      const zeroDelayCalls = setTimeoutSpy.mock.calls.filter(
        c => c[1] === 0,
      );
      const expectedMin = 3 + Math.floor(total / YIELD_PERIOD);
      expect(zeroDelayCalls.length).toBeGreaterThanOrEqual(expectedMin);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  test('lazy: loader fires once across many lookups', async () => {
    const loadBytes = jest.fn(async () => enc(JSON.stringify({apple: 'fruit'})));
    const src = createJsonDictSource({name: 'test', loadBytes});
    await src.lookup('apple');
    await src.lookup('banana');
    await src.lookup('grape');
    expect(loadBytes).toHaveBeenCalledTimes(1);
  });
});
