import {createCsvDictSource} from '../src/core/dict/csvDictSource';

const enc = (s: string) => new TextEncoder().encode(s).buffer;

const fromCsv = (csv: string, opts: {hasHeader?: boolean} = {}) =>
  createCsvDictSource({
    name: 'test',
    loadBytes: async () => enc(csv),
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

  test('lazy: loader fires once across many lookups', async () => {
    const loadBytes = jest.fn(async () => enc('apple,fruit\n'));
    const src = createCsvDictSource({name: 'test', loadBytes});
    await src.lookup('apple');
    await src.lookup('banana');
    await src.lookup('grape');
    expect(loadBytes).toHaveBeenCalledTimes(1);
  });
});
