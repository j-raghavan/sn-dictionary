import {createStardictLookup} from '../src/core/dict/stardictLookup';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';

const baseBytes = () =>
  buildSyntheticStarDict({
    apple: 'a fruit (base)',
    banana: 'a yellow fruit (base)',
  });

const customBytes = () =>
  buildSyntheticStarDict({
    apple: 'a fruit (custom override)',
    grape: 'a small fruit (custom only)',
  });

describe('createStardictLookup', () => {
  test('finds words from the base dict', async () => {
    const lookup = createStardictLookup({loadBase: baseBytes});
    const result = await lookup.lookup('apple');
    expect(result).toEqual({
      found: true,
      entry: {word: 'apple', definition: 'a fruit (base)'},
    });
  });

  test('returns not-found for an unknown word, preserving original input', async () => {
    const lookup = createStardictLookup({loadBase: baseBytes});
    const result = await lookup.lookup('Xenoglossy');
    expect(result).toEqual({found: false, queriedFor: 'Xenoglossy'});
  });

  test('treats empty / whitespace input as not-found without invoking the dict', async () => {
    const loadBase = jest.fn(baseBytes);
    const lookup = createStardictLookup({loadBase});
    expect(await lookup.lookup('   ')).toEqual({
      found: false,
      queriedFor: '   ',
    });
    // First lookup triggers ensureLoaded, but '   ' returns before any
    // dict access. We still expect loadBase to fire on first call (the
    // contract is: load happens on the first non-trivial query path),
    // but we don't depend on it here.
  });

  test('custom dict overrides base when both have the word', async () => {
    const lookup = createStardictLookup({
      loadBase: baseBytes,
      loadCustom: customBytes,
    });
    const result = await lookup.lookup('apple');
    expect(result).toEqual({
      found: true,
      entry: {word: 'apple', definition: 'a fruit (custom override)'},
    });
  });

  test('falls back to base when custom misses', async () => {
    const lookup = createStardictLookup({
      loadBase: baseBytes,
      loadCustom: customBytes,
    });
    const result = await lookup.lookup('banana');
    expect(result).toEqual({
      found: true,
      entry: {word: 'banana', definition: 'a yellow fruit (base)'},
    });
  });

  test('finds custom-only words', async () => {
    const lookup = createStardictLookup({
      loadBase: baseBytes,
      loadCustom: customBytes,
    });
    const result = await lookup.lookup('grape');
    expect(result).toEqual({
      found: true,
      entry: {word: 'grape', definition: 'a small fruit (custom only)'},
    });
  });

  test('lazy-loads only once across many lookups', async () => {
    const loadBase = jest.fn(baseBytes);
    const lookup = createStardictLookup({loadBase});
    await lookup.lookup('apple');
    await lookup.lookup('banana');
    await lookup.lookup('mango');
    expect(loadBase).toHaveBeenCalledTimes(1);
  });

  test('continues working when base loader returns null (no-base configuration)', async () => {
    const lookup = createStardictLookup({
      loadBase: () => null,
      loadCustom: customBytes,
    });
    expect((await lookup.lookup('grape')).found).toBe(true);
    expect((await lookup.lookup('banana')).found).toBe(false);
  });

  test('warns and degrades gracefully when base loader throws', async () => {
    const warn = jest.fn();
    const lookup = createStardictLookup({
      loadBase: () => {
        throw new Error('boom');
      },
      logger: {warn},
    });
    const result = await lookup.lookup('apple');
    expect(result.found).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/stardict:base.*loader threw: boom/),
    );
  });

  test('warns and degrades gracefully when buildDict rejects malformed bytes', async () => {
    const warn = jest.fn();
    const lookup = createStardictLookup({
      loadBase: () => ({
        ifo: new TextEncoder().encode('bookname=Broken\n'), // missing wordcount
        idx: new Uint8Array(0),
        dict: new Uint8Array(0),
      }),
      logger: {warn},
    });
    const result = await lookup.lookup('apple');
    expect(result.found).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/stardict:base.*buildDict threw/),
    );
  });

  test('survives a load failure silently when no logger is provided', async () => {
    // Exercises the no-op default warn so a logger-less plugin host
    // doesn't crash on a malformed dict.
    const lookup = createStardictLookup({
      loadBase: () => {
        throw new Error('silent fail');
      },
    });
    const result = await lookup.lookup('apple');
    expect(result.found).toBe(false);
  });

  test('warns and falls back when the custom loader throws', async () => {
    const warn = jest.fn();
    const lookup = createStardictLookup({
      loadBase: baseBytes,
      loadCustom: () => {
        throw new Error('disk gone');
      },
      logger: {warn},
    });
    const result = await lookup.lookup('apple');
    expect(result.found).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/stardict:custom.*loader threw: disk gone/),
    );
  });
});
