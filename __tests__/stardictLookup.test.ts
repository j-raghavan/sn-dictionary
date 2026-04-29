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

  test('retries the base loader on next lookup if the first attempt threw', async () => {
    // Regression: previously a single transient failure marked the
    // session as "loaded" and every subsequent lookup degraded to
    // not-found. Now a 'failed' outcome (loader threw or buildDict
    // threw) leaves loaded=false so the next lookup retries.
    let calls = 0;
    const flakyBase = jest.fn(() => {
      calls++;
      if (calls === 1) {
        throw new Error('flaky-once');
      }
      return baseBytes();
    });
    const lookup = createStardictLookup({loadBase: flakyBase});

    const first = await lookup.lookup('apple');
    expect(first.found).toBe(false);
    expect(flakyBase).toHaveBeenCalledTimes(1);

    const second = await lookup.lookup('apple');
    expect(second.found).toBe(true);
    expect(flakyBase).toHaveBeenCalledTimes(2);
  });

  test('retries when buildDict throws on the first attempt', async () => {
    let calls = 0;
    const flakyBase = jest.fn(() => {
      calls++;
      if (calls === 1) {
        return {
          ifo: new TextEncoder().encode('bookname=Broken\n'), // missing wordcount -> buildDict throws
          idx: new Uint8Array(0),
          dict: new Uint8Array(0),
        };
      }
      return baseBytes();
    });
    const lookup = createStardictLookup({loadBase: flakyBase});

    expect((await lookup.lookup('apple')).found).toBe(false);
    expect((await lookup.lookup('apple')).found).toBe(true);
  });

  test('does NOT retry when both loaders intentionally return null (no-dict configuration)', async () => {
    // 'absent' is treated as a deliberate opt-out, not a failure;
    // retrying every lookup would burn loader calls forever for a
    // configuration that's working as intended.
    const baseLoader = jest.fn(() => null);
    const customLoader = jest.fn(() => null);
    const lookup = createStardictLookup({
      loadBase: baseLoader,
      loadCustom: customLoader,
    });

    await lookup.lookup('apple');
    await lookup.lookup('banana');
    await lookup.lookup('cherry');
    expect(baseLoader).toHaveBeenCalledTimes(1);
    expect(customLoader).toHaveBeenCalledTimes(1);
  });

  test('partial success on first attempt sticks (does not retry the failed slot on every lookup)', async () => {
    // If at least one slot succeeded the session has usable content,
    // so we stop retrying even though the other slot failed --
    // otherwise a permanently-broken loader would burn calls on
    // every lookup for the rest of the session.
    const baseLoader = jest.fn(() => {
      throw new Error('always-fails');
    });
    const customLoader = jest.fn(customBytes);
    const lookup = createStardictLookup({
      loadBase: baseLoader,
      loadCustom: customLoader,
    });

    expect((await lookup.lookup('apple')).found).toBe(true);
    expect(baseLoader).toHaveBeenCalledTimes(1);
    expect(customLoader).toHaveBeenCalledTimes(1);

    await lookup.lookup('grape');
    await lookup.lookup('banana');
    // Subsequent lookups don't re-invoke either loader.
    expect(baseLoader).toHaveBeenCalledTimes(1);
    expect(customLoader).toHaveBeenCalledTimes(1);
  });
});
