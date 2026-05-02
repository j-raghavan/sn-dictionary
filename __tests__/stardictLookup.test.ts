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

  describe('persistent index cache integration', () => {
    // Lets us explicitly observe whether a cached envelope was hit.
    const memoryCache = (): {
      store: Map<string, string>;
      getItem: jest.Mock;
      setItem: jest.Mock;
    } => {
      const store = new Map<string, string>();
      return {
        store,
        getItem: jest.fn(async (k: string) => store.get(k) ?? null),
        setItem: jest.fn(async (k: string, v: string) => {
          store.set(k, v);
        }),
      };
    };

    // Drains the microtask + setTimeout-0 queue so the
    // fire-and-forget cache write resolves before assertions.
    const flushAsync = async (): Promise<void> => {
      await new Promise(r => setTimeout(r, 0));
    };

    test('first lookup parses and writes the cache; second lookup hydrates from cache without re-parsing', async () => {
      const cache = memoryCache();
      const loadFn = jest.fn(baseBytes);

      const a = createStardictLookup({
        name: 'WordNet',
        loadBase: loadFn,
        cache,
      });
      const hit1 = await a.lookup('apple');
      expect(hit1?.definition).toBe('a fruit (base)');
      // Drain the fire-and-forget setItem.
      await flushAsync();
      expect(cache.setItem).toHaveBeenCalledTimes(1);

      // New source instance with the same cache. Memoised parsed
      // state lives on the source, so we need a fresh source to
      // exercise the cache-read path. The loader is also reset so we
      // can assert it ran a second time (load is bridge I/O, not the
      // expensive parse — caching only skips parseIdx + parseSyn).
      const b = createStardictLookup({
        name: 'WordNet',
        loadBase: loadFn,
        cache,
      });
      const hit2 = await b.lookup('apple');
      expect(hit2?.definition).toBe('a fruit (base)');
      // Still loaded again (bytes need to be in memory to slice
      // .dict for the lookup), but cache.getItem confirms we tried
      // the cache path on the second source.
      expect(cache.getItem).toHaveBeenCalledTimes(2); // once per source's first lookup
    });

    test('cache miss (different fingerprint) falls through to live parse', async () => {
      const cache = memoryCache();
      // Pre-seed the cache with a stale envelope under the right key
      // but with a fingerprint that won't match the live idx bytes.
      cache.store.set(
        '@sndict_index:WordNet',
        JSON.stringify({
          version: 1,
          idxFingerprint: 'stale-fingerprint',
          synFingerprint: null,
          meta: {
            bookname: 'Old',
            wordcount: 0,
            idxoffsetbits: 32,
            sametypesequence: 'm',
          },
          entries: [],
        }),
      );
      const source = createStardictLookup({
        name: 'WordNet',
        loadBase: baseBytes,
        cache,
      });
      const hit = await source.lookup('apple');
      // The stale cache is rejected, live parse runs, the apple
      // entry resolves correctly.
      expect(hit?.definition).toBe('a fruit (base)');
      await flushAsync();
      // Stale cache was overwritten with a fresh envelope.
      const replaced = cache.store.get('@sndict_index:WordNet');
      expect(replaced).not.toBeNull();
      expect(replaced).not.toContain('stale-fingerprint');
    });

    test('cache.getItem throwing is logged and live parse runs', async () => {
      const warn = jest.fn();
      const cache = {
        getItem: jest.fn(async () => {
          throw new Error('disk gone');
        }),
        setItem: jest.fn(async () => undefined),
      };
      const source = createStardictLookup({
        name: 'WordNet',
        loadBase: baseBytes,
        cache,
        logger: {warn},
      });
      const hit = await source.lookup('apple');
      expect(hit?.definition).toBe('a fruit (base)');
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/cache.getItem threw: disk gone/),
      );
    });

    test('cache.setItem throwing is logged and does NOT break the lookup', async () => {
      const warn = jest.fn();
      const cache = {
        getItem: jest.fn(async () => null),
        setItem: jest.fn(async () => {
          throw new Error('quota exceeded');
        }),
      };
      const source = createStardictLookup({
        name: 'WordNet',
        loadBase: baseBytes,
        cache,
        logger: {warn},
      });
      const hit = await source.lookup('apple');
      expect(hit?.definition).toBe('a fruit (base)');
      // The fire-and-forget write hasn't resolved yet; flush it.
      await new Promise(r => setTimeout(r, 0));
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/cache write threw: quota exceeded/),
      );
    });

    test('no cache provided: falls back to live parse on every load (legacy behaviour)', async () => {
      const source = createStardictLookup({
        name: 'WordNet',
        loadBase: baseBytes,
      });
      const hit = await source.lookup('apple');
      expect(hit?.definition).toBe('a fruit (base)');
    });

    test('hydrate emits a log line so on-device logcat can confirm cache hits', async () => {
      const cache = memoryCache();
      const log = jest.fn();
      const a = createStardictLookup({
        name: 'WordNet',
        loadBase: baseBytes,
        cache,
        logger: {warn: jest.fn(), log},
      });
      await a.lookup('apple');
      await new Promise(r => setTimeout(r, 0));

      const b = createStardictLookup({
        name: 'WordNet',
        loadBase: baseBytes,
        cache,
        logger: {warn: jest.fn(), log},
      });
      log.mockClear();
      await b.lookup('apple');
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/hydrated from cache/),
      );
    });
  });
});
