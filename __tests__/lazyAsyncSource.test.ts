import {createLazyAsyncSource} from '../src/core/dict/lazyAsyncSource';
import type {DictEntry} from '../src/core/lookup';

const enc = (s: string) => new TextEncoder().encode(s);

const decodeMap = (bytes: Uint8Array): Map<string, string> => {
  const m = new Map<string, string>();
  new TextDecoder().decode(bytes).split('\n').forEach(line => {
    const [w, d] = line.split('|');
    if (w && d) {
      m.set(w.toLowerCase(), d);
    }
  });
  return m;
};

const buildDeps = (overrides: {
  load?: () => Promise<Uint8Array | null>;
  parse?: (bytes: Uint8Array) => Map<string, string> | Promise<Map<string, string>>;
  lookup?: (parsed: Map<string, string>, word: string) => DictEntry | null;
  logTag?: string;
  logger?: {warn: jest.Mock};
} = {}) => {
  const logger = overrides.logger ?? {warn: jest.fn()};
  return {
    name: 'test',
    logTag: overrides.logTag,
    load: overrides.load ?? (async () => enc('apple|fruit\nbanana|yellow')),
    parse: overrides.parse ?? decodeMap,
    lookup:
      overrides.lookup ??
      ((parsed: Map<string, string>, word: string) => {
        const def = parsed.get(word.toLowerCase());
        return def ? {word, definition: def} : null;
      }),
    logger,
  };
};

describe('createLazyAsyncSource', () => {
  test('lazy-loads on first lookup; further lookups reuse the parsed dict', async () => {
    const deps = buildDeps();
    const loadSpy = jest.spyOn(deps, 'load');
    const source = createLazyAsyncSource(deps);
    expect(loadSpy).not.toHaveBeenCalled();
    const a = await source.lookup('apple');
    const b = await source.lookup('banana');
    expect(a).toEqual({word: 'apple', definition: 'fruit'});
    expect(b).toEqual({word: 'banana', definition: 'yellow'});
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  test('returns null for empty / whitespace input without invoking the loader', async () => {
    const deps = buildDeps();
    const loadSpy = jest.spyOn(deps, 'load');
    const source = createLazyAsyncSource(deps);
    expect(await source.lookup('  ')).toBeNull();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  test('null loader return = absent (sticky, no retry, returns null)', async () => {
    let calls = 0;
    const source = createLazyAsyncSource(
      buildDeps({
        load: async () => {
          calls++;
          return null;
        },
      }),
    );
    expect(await source.lookup('apple')).toBeNull();
    expect(await source.lookup('banana')).toBeNull();
    expect(calls).toBe(1);
  });

  test('loader throwing leaves loaded=false; next lookup retries and may succeed', async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) {
        throw new Error('flaky');
      }
      return enc('apple|fruit');
    };
    const warn = jest.fn();
    const source = createLazyAsyncSource(
      buildDeps({load: flaky, logger: {warn}}),
    );
    expect(await source.lookup('apple')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('loader threw: flaky'));
    expect(await source.lookup('apple')).toEqual({word: 'apple', definition: 'fruit'});
    expect(calls).toBe(2);
  });

  test('parse throwing leaves loaded=false; warns and lets next lookup retry', async () => {
    let calls = 0;
    const parse = jest.fn(() => {
      calls++;
      if (calls === 1) {
        throw new Error('parse-fail');
      }
      const m = new Map<string, string>();
      m.set('apple', 'fruit');
      return m;
    });
    const warn = jest.fn();
    const source = createLazyAsyncSource(
      buildDeps({parse, logger: {warn}}),
    );
    expect(await source.lookup('apple')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('parse threw: parse-fail'));
    expect(await source.lookup('apple')).toEqual({word: 'apple', definition: 'fruit'});
  });

  test('logTag overrides the default name in warn messages', async () => {
    const warn = jest.fn();
    const source = createLazyAsyncSource(
      buildDeps({
        load: async () => {
          throw new Error('boom');
        },
        logTag: 'stardict:WordNet',
        logger: {warn},
      }),
    );
    await source.lookup('apple');
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[stardict:WordNet] loader threw/),
    );
  });

  test('default tag falls back to the source name', async () => {
    const warn = jest.fn();
    const source = createLazyAsyncSource(
      buildDeps({
        load: async () => {
          throw new Error('boom');
        },
        logger: {warn},
      }),
    );
    await source.lookup('apple');
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[test] loader threw/),
    );
  });

  test('concurrent first lookups share one underlying load+parse pass', async () => {
    let parseCalls = 0;
    const parse = (bytes: Uint8Array) => {
      parseCalls++;
      return decodeMap(bytes);
    };
    let loadCalls = 0;
    const load = async () => {
      loadCalls++;
      return enc('apple|fruit\nbanana|yellow');
    };
    const source = createLazyAsyncSource(buildDeps({load, parse}));
    const [a, b, c] = await Promise.all([
      source.lookup('apple'),
      source.lookup('banana'),
      source.lookup('apple'),
    ]);
    expect(a?.definition).toBe('fruit');
    expect(b?.definition).toBe('yellow');
    expect(c?.definition).toBe('fruit');
    expect(loadCalls).toBe(1);
    expect(parseCalls).toBe(1);
  });

  test('survives without a logger when the loader throws', async () => {
    const source = createLazyAsyncSource(
      buildDeps({
        load: async () => {
          throw new Error('silent');
        },
        logger: undefined,
      }),
    );
    expect(await source.lookup('apple')).toBeNull();
  });

  test('works with a non-byte TLoaded (e.g. a struct of buffers like StarDict)', async () => {
    // Verifies the helper is truly generic over TLoaded — the
    // primary motivation for the unification refactor.
    type Triple = {a: Uint8Array; b: Uint8Array};
    const source = createLazyAsyncSource<Triple, Map<string, string>>({
      name: 'composite',
      load: async () => ({
        a: enc('apple|fruit'),
        b: enc('banana|yellow'),
      }),
      parse: triple => {
        const merged = new Map<string, string>();
        for (const part of [triple.a, triple.b]) {
          for (const [k, v] of decodeMap(part)) {
            merged.set(k, v);
          }
        }
        return merged;
      },
      lookup: (parsed, word) => {
        const def = parsed.get(word.toLowerCase());
        return def ? {word, definition: def} : null;
      },
    });
    expect((await source.lookup('apple'))?.definition).toBe('fruit');
    expect((await source.lookup('banana'))?.definition).toBe('yellow');
  });

  test('async parse: parser may return a Promise<TParsed> (StarDict path)', async () => {
    // The StarDict parser is async because it yields cooperatively
    // during large index builds. Verify the harness awaits it.
    const parse = jest.fn(async (bytes: Uint8Array) => {
      // Simulate work that resolves on a later microtask.
      await Promise.resolve();
      return decodeMap(bytes);
    });
    const source = createLazyAsyncSource(buildDeps({parse}));
    expect((await source.lookup('apple'))?.definition).toBe('fruit');
    expect(parse).toHaveBeenCalledTimes(1);
  });

  test('prime() warms up without invoking lookup, status flips ready', async () => {
    const deps = buildDeps();
    const source = createLazyAsyncSource(deps);
    expect(source.status?.()).toBe('idle');
    await source.prime?.();
    expect(source.status?.()).toBe('ready');
    // A subsequent lookup must NOT re-load — prime did it once.
    const loadSpy = jest.spyOn(deps, 'load');
    await source.lookup('apple');
    expect(loadSpy).not.toHaveBeenCalled();
  });

  test('prime() and concurrent lookup share a single load+parse', async () => {
    let loadCalls = 0;
    const load = jest.fn(async () => {
      loadCalls++;
      await new Promise(r => setTimeout(r, 5));
      return enc('apple|fruit');
    });
    const source = createLazyAsyncSource(buildDeps({load}));
    const [, hit] = await Promise.all([source.prime?.(), source.lookup('apple')]);
    expect(hit?.definition).toBe('fruit');
    expect(loadCalls).toBe(1);
  });

  test('prime() never throws even when the loader fails', async () => {
    const source = createLazyAsyncSource(
      buildDeps({
        load: async () => {
          throw new Error('disk gone');
        },
      }),
    );
    await expect(source.prime?.()).resolves.toBeUndefined();
    expect(source.status?.()).toBe('failed');
  });

  test('status reports loading mid-flight then settles', async () => {
    let resolveLoad!: (b: Uint8Array) => void;
    const load = () =>
      new Promise<Uint8Array>(resolve => {
        resolveLoad = resolve;
      });
    const source = createLazyAsyncSource(buildDeps({load}));
    const primePromise = source.prime?.();
    expect(source.status?.()).toBe('loading');
    resolveLoad(enc('apple|fruit'));
    await primePromise;
    expect(source.status?.()).toBe('ready');
  });

  test('status reports absent when the loader returns null', async () => {
    const source = createLazyAsyncSource(buildDeps({load: async () => null}));
    await source.prime?.();
    expect(source.status?.()).toBe('absent');
  });

  test('failed status flips back to idle on the next attempt then to ready', async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) {
        throw new Error('flaky');
      }
      return enc('apple|fruit');
    };
    const source = createLazyAsyncSource(buildDeps({load: flaky}));
    await source.prime?.();
    expect(source.status?.()).toBe('failed');
    // Next attempt: status transitions failed -> loading -> ready.
    const second = source.prime?.();
    expect(source.status?.()).toBe('loading');
    await second;
    expect(source.status?.()).toBe('ready');
  });
});
