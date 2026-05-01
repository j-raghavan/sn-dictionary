import {createStardictLookup} from '../src/core/dict/stardictLookup';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';

const baseBytes = async () =>
  buildSyntheticStarDict({
    apple: 'a fruit (base)',
    banana: 'a yellow fruit (base)',
  });

describe('createStardictLookup (DictSource)', () => {
  test('exposes the configured name on the returned source', () => {
    const source = createStardictLookup({name: 'WordNet', loadBase: baseBytes});
    expect(source.name).toBe('WordNet');
  });

  test('finds words from the loaded dict (returns DictEntry)', async () => {
    const source = createStardictLookup({name: 'WordNet', loadBase: baseBytes});
    const entry = await source.lookup('apple');
    expect(entry).toEqual({
      word: 'apple',
      definition: 'a fruit (base)',
      format: 'plain',
    });
  });

  test('returns null for an unknown word', async () => {
    const source = createStardictLookup({name: 'WordNet', loadBase: baseBytes});
    expect(await source.lookup('Xenoglossy')).toBeNull();
  });

  test('returns null for empty / whitespace input', async () => {
    const source = createStardictLookup({name: 'WordNet', loadBase: baseBytes});
    expect(await source.lookup('   ')).toBeNull();
  });

  test('lazy-loads only once across many lookups', async () => {
    const loadBase = jest.fn(baseBytes);
    const source = createStardictLookup({name: 'WordNet', loadBase});
    await source.lookup('apple');
    await source.lookup('banana');
    await source.lookup('mango');
    expect(loadBase).toHaveBeenCalledTimes(1);
  });

  test('returns null when the loader returns null (no-dict slot)', async () => {
    const source = createStardictLookup({
      name: 'WordNet',
      loadBase: async () => null,
    });
    expect(await source.lookup('apple')).toBeNull();
  });

  test('warns and degrades when the loader throws', async () => {
    const warn = jest.fn();
    const source = createStardictLookup({
      name: 'WordNet',
      loadBase: async () => {
        throw new Error('boom');
      },
      logger: {warn},
    });
    expect(await source.lookup('apple')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/stardict:WordNet.*loader threw: boom/),
    );
  });

  test('warns and degrades when buildDict rejects malformed bytes', async () => {
    const warn = jest.fn();
    const source = createStardictLookup({
      name: 'WordNet',
      loadBase: async () => ({
        ifo: new TextEncoder().encode('bookname=Broken\n'), // missing wordcount
        idx: new Uint8Array(0),
        dict: new Uint8Array(0),
      }),
      logger: {warn},
    });
    expect(await source.lookup('apple')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/stardict:WordNet.*parse threw/),
    );
  });

  test('survives a load failure silently when no logger is provided', async () => {
    const source = createStardictLookup({
      name: 'WordNet',
      loadBase: async () => {
        throw new Error('silent fail');
      },
    });
    expect(await source.lookup('apple')).toBeNull();
  });

  test('retries the loader on next lookup if the first attempt threw', async () => {
    let calls = 0;
    const flaky = jest.fn(async () => {
      calls++;
      if (calls === 1) {
        throw new Error('flaky-once');
      }
      return baseBytes();
    });
    const source = createStardictLookup({name: 'WordNet', loadBase: flaky});

    expect(await source.lookup('apple')).toBeNull();
    expect(flaky).toHaveBeenCalledTimes(1);
    expect(await source.lookup('apple')).toEqual({
      word: 'apple',
      definition: 'a fruit (base)',
      format: 'plain',
    });
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  test('retries when buildDict throws on the first attempt', async () => {
    let calls = 0;
    const flaky = jest.fn(async () => {
      calls++;
      if (calls === 1) {
        return {
          ifo: new TextEncoder().encode('bookname=Broken\n'),
          idx: new Uint8Array(0),
          dict: new Uint8Array(0),
        };
      }
      return baseBytes();
    });
    const source = createStardictLookup({name: 'WordNet', loadBase: flaky});
    expect(await source.lookup('apple')).toBeNull();
    expect(await source.lookup('apple')).not.toBeNull();
  });

  test('concurrent first lookups share one underlying load+parse pass', async () => {
    let calls = 0;
    const slow = jest.fn(async () => {
      calls++;
      await new Promise(r => setTimeout(r, 10));
      return baseBytes();
    });
    const source = createStardictLookup({name: 'WordNet', loadBase: slow});
    const [a, b, c] = await Promise.all([
      source.lookup('apple'),
      source.lookup('banana'),
      source.lookup('apple'),
    ]);
    expect(a?.definition).toBe('a fruit (base)');
    expect(b?.definition).toBe('a yellow fruit (base)');
    expect(c?.definition).toBe('a fruit (base)');
    expect(calls).toBe(1);
  });

  test('derives format=html from .ifo sametypesequence=h', async () => {
    const htmlBytes = async () =>
      buildSyntheticStarDict(
        {apple: '<i>n</i> a fruit'},
        {sametypesequence: 'h'},
      );
    const source = createStardictLookup({
      name: 'WordNet',
      loadBase: htmlBytes,
    });
    const entry = await source.lookup('apple');
    expect(entry).toEqual({
      word: 'apple',
      definition: '<i>n</i> a fruit',
      format: 'html',
    });
  });

  test('explicit format option overrides the auto-derived one', async () => {
    // The bundled WordNet base uses this so the popup runs the
    // structured-sense renderer regardless of what the .ifo says.
    const source = createStardictLookup({
      name: 'WordNet',
      loadBase: baseBytes,
      format: 'wordnet',
    });
    const entry = await source.lookup('apple');
    expect(entry?.format).toBe('wordnet');
  });

  test('does NOT retry when the loader intentionally returns null', async () => {
    const loader = jest.fn(async () => null);
    const source = createStardictLookup({name: 'WordNet', loadBase: loader});
    await source.lookup('apple');
    await source.lookup('banana');
    await source.lookup('cherry');
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
