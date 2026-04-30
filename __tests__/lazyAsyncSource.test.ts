import {createLazyAsyncSource} from '../src/core/dict/lazyAsyncSource';
import type {DictEntry} from '../src/core/lookup';

const enc = (s: string) => new TextEncoder().encode(s).buffer;

const buildDeps = (overrides: {
  loadBytes?: () => Promise<ArrayBuffer | null>;
  parse?: (bytes: Uint8Array) => Map<string, string>;
  lookup?: (parsed: Map<string, string>, word: string) => DictEntry | null;
  maxBytes?: number;
  logger?: {warn: jest.Mock};
} = {}) => {
  const logger = overrides.logger ?? {warn: jest.fn()};
  return {
    name: 'test',
    loadBytes: overrides.loadBytes ?? (async () => enc('apple|fruit\nbanana|yellow')),
    parse:
      overrides.parse ??
      ((bytes: Uint8Array) => {
        const m = new Map<string, string>();
        new TextDecoder().decode(bytes).split('\n').forEach(line => {
          const [w, d] = line.split('|');
          if (w && d) {
            m.set(w.toLowerCase(), d);
          }
        });
        return m;
      }),
    lookup:
      overrides.lookup ??
      ((parsed: Map<string, string>, word: string) => {
        const def = parsed.get(word.toLowerCase());
        return def ? {word, definition: def} : null;
      }),
    maxBytes: overrides.maxBytes,
    logger,
  };
};

describe('createLazyAsyncSource', () => {
  test('lazy-loads on first lookup; further lookups reuse the parsed dict', async () => {
    const deps = buildDeps();
    const loadSpy = jest.spyOn(deps, 'loadBytes');
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
    const loadSpy = jest.spyOn(deps, 'loadBytes');
    const source = createLazyAsyncSource(deps);
    expect(await source.lookup('  ')).toBeNull();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  test('null loader return = absent (sticky, no retry, returns null)', async () => {
    let calls = 0;
    const source = createLazyAsyncSource(
      buildDeps({
        loadBytes: async () => {
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
    const source = createLazyAsyncSource(buildDeps({loadBytes: flaky, logger: {warn}}));
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

  test('refuses files larger than maxBytes (warns, returns null)', async () => {
    const warn = jest.fn();
    const source = createLazyAsyncSource(
      buildDeps({
        loadBytes: async () => new ArrayBuffer(100),
        maxBytes: 50,
        logger: {warn},
      }),
    );
    expect(await source.lookup('apple')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/file too large: 100 bytes > 50 cap/),
    );
  });

  test('concurrent first lookups share one underlying load+parse pass', async () => {
    let parseCalls = 0;
    const parse = (bytes: Uint8Array) => {
      parseCalls++;
      const m = new Map<string, string>();
      new TextDecoder().decode(bytes).split('\n').forEach(line => {
        const [w, d] = line.split('|');
        if (w && d) {
          m.set(w.toLowerCase(), d);
        }
      });
      return m;
    };
    let loadCalls = 0;
    const loadBytes = async () => {
      loadCalls++;
      return enc('apple|fruit\nbanana|yellow');
    };
    const source = createLazyAsyncSource(buildDeps({loadBytes, parse}));
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
        loadBytes: async () => {
          throw new Error('silent');
        },
        logger: undefined,
      }),
    );
    expect(await source.lookup('apple')).toBeNull();
  });
});
