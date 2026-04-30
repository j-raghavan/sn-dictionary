import {createJsonDictSource} from '../src/core/dict/jsonDictSource';

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
    });
    expect(await src.lookup('banana')).toEqual({
      word: 'banana',
      definition: 'a yellow fruit',
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

  test('lazy: loader fires once across many lookups', async () => {
    const loadBytes = jest.fn(async () => enc(JSON.stringify({apple: 'fruit'})));
    const src = createJsonDictSource({name: 'test', loadBytes});
    await src.lookup('apple');
    await src.lookup('banana');
    await src.lookup('grape');
    expect(loadBytes).toHaveBeenCalledTimes(1);
  });
});
