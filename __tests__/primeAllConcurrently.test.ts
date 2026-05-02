// Integration contract for the production startup sequence:
//   discovery → prepend sources → primeAllConcurrently(...) → lookup
//
// Locks the property that motivated commits 07393bf + d68cc4d:
//
//   * primeAllConcurrently MUST flip every source's status to
//     'loading' synchronously (modulo a microtask), so multiDictLookup
//     skips them at fan-out time.
//   * A user tap arriving DURING prime must return without invoking
//     the per-word lookup() of any still-priming source — i.e. it
//     must NOT trigger an out-of-band lazy-load that blocks the
//     pipeline on a slow parse.
//   * After all primes settle, every source is 'ready' and lookups
//     return full hits.
//
// A serial-prime regression (a `for...of await` loop) would break
// the second invariant: only the first source would be 'loading',
// the rest would still be 'idle', and multiDictLookup's gate would
// fall through to lookup() on the idle sources — re-creating the
// original 70-second on-device hang. The negative test below
// codifies that shape so it can never come back silently.

import {createLazyAsyncSource} from '../src/core/dict/lazyAsyncSource';
import {createMultiDictLookup} from '../src/core/dict/multiDictLookup';
import {primeAllConcurrently} from '../src/core/dict/primeAllConcurrently';
import type {DictSource} from '../src/core/lookup';

type Controlled = {
  source: DictSource;
  resolveLoad: () => void;
  rejectLoad: (err: Error) => void;
  parseSpy: jest.Mock;
  perWordLookupSpy: jest.Mock;
};

// Builds a real lazyAsyncSource whose load() promise we control.
// parse() is synchronous and produces a one-entry map; the
// per-word lookup is spied so the test can assert whether a still-
// priming source was queried out-of-band.
const buildControlledSource = (name: string, definition: string): Controlled => {
  let resolveLoad!: () => void;
  let rejectLoad!: (err: Error) => void;
  const loadPromise = new Promise<Uint8Array>((resolve, reject) => {
    resolveLoad = () => resolve(new Uint8Array());
    rejectLoad = reject;
  });
  const parseSpy = jest.fn(() => new Map([['apple', definition]]));
  const perWordLookupSpy = jest.fn(
    (parsed: Map<string, string>, word: string) => {
      const def = parsed.get(word);
      return def
        ? {word, definition: def, format: 'plain' as const}
        : null;
    },
  );
  const source = createLazyAsyncSource<Uint8Array, Map<string, string>>({
    name,
    load: () => loadPromise,
    parse: parseSpy,
    lookup: perWordLookupSpy,
  });
  return {source, resolveLoad, rejectLoad, parseSpy, perWordLookupSpy};
};

describe('primeAllConcurrently — production startup contract', () => {
  test('flips every source to status=loading immediately, before any prime resolves', async () => {
    const a = buildControlledSource('A', 'fruit-A');
    const b = buildControlledSource('B', 'fruit-B');
    const c = buildControlledSource('C', 'fruit-C');
    const sources = [a.source, b.source, c.source];
    const logger = {log: jest.fn()};

    // Kick off prime-all but DO NOT await yet.
    const primesDone = primeAllConcurrently(sources, logger);
    // One microtask flush so each source's prime() can call
    // ensureLoaded → status flips to 'loading'.
    await Promise.resolve();

    expect(a.source.status?.()).toBe('loading');
    expect(b.source.status?.()).toBe('loading');
    expect(c.source.status?.()).toBe('loading');
    expect(logger.log).not.toHaveBeenCalled(); // none have settled yet

    // Cleanup so jest doesn't hang on unresolved promises.
    a.resolveLoad();
    b.resolveLoad();
    c.resolveLoad();
    await primesDone;
  });

  test('user-initiated lookup during prime returns fast, lists priming sources as loading, never invokes their per-word lookup', async () => {
    const a = buildControlledSource('A', 'fruit-A');
    const b = buildControlledSource('B', 'fruit-B');
    const c = buildControlledSource('C', 'fruit-C');
    const sources = [a.source, b.source, c.source];
    const lookup = createMultiDictLookup(sources);
    const logger = {log: jest.fn()};

    // Production order: kick off concurrent prime, then user taps.
    const primesDone = primeAllConcurrently(sources, logger);
    await Promise.resolve(); // status flips to 'loading'

    const result = await lookup.lookup('apple');

    // The lookup completes without waiting on any prime.
    expect(result.hits).toEqual([]);
    expect(result.loading).toEqual(['A', 'B', 'C']);
    // Crucially: the format-specific lookup function inside each
    // lazyAsyncSource was never invoked. multiDictLookup skipped
    // them at the gate. This is the property that breaks under
    // a serial-prime regression — the negative test below pins it.
    expect(a.perWordLookupSpy).not.toHaveBeenCalled();
    expect(b.perWordLookupSpy).not.toHaveBeenCalled();
    expect(c.perWordLookupSpy).not.toHaveBeenCalled();

    a.resolveLoad();
    b.resolveLoad();
    c.resolveLoad();
    await primesDone;
  });

  test('after all primes settle, sources are ready and lookups return full hits', async () => {
    const a = buildControlledSource('A', 'fruit-A');
    const b = buildControlledSource('B', 'fruit-B');
    const sources = [a.source, b.source];
    const lookup = createMultiDictLookup(sources);
    const logger = {log: jest.fn()};

    const primesDone = primeAllConcurrently(sources, logger);
    a.resolveLoad();
    b.resolveLoad();
    await primesDone;

    expect(a.source.status?.()).toBe('ready');
    expect(b.source.status?.()).toBe('ready');
    expect(logger.log).toHaveBeenCalledWith(
      '[startup] primed user dict "A"',
    );
    expect(logger.log).toHaveBeenCalledWith(
      '[startup] primed user dict "B"',
    );

    const result = await lookup.lookup('apple');
    expect(result.loading).toEqual([]);
    expect(result.hits.map(h => h.source)).toEqual(['A', 'B']);
    expect(result.hits.map(h => h.entry.definition)).toEqual([
      'fruit-A',
      'fruit-B',
    ]);
  });

  test('skips sources that do not implement prime() without throwing', async () => {
    const noPrime: DictSource = {
      name: 'NoPrime',
      lookup: jest.fn(async () => null),
    };
    const a = buildControlledSource('A', 'fruit-A');
    const sources = [noPrime, a.source];
    const logger = {log: jest.fn()};

    const primesDone = primeAllConcurrently(sources, logger);
    a.resolveLoad();
    await primesDone;

    // Only A was primed and logged.
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      '[startup] primed user dict "A"',
    );
  });

  test('does not double-parse when prime and lookup race on the same source', async () => {
    // Lazy harness memoises in-flight load+parse, so a user tap that
    // races primeAllConcurrently must not trigger a second parse.
    const a = buildControlledSource('A', 'fruit-A');
    const sources = [a.source];
    const lookup = createMultiDictLookup(sources);
    const logger = {log: jest.fn()};

    const primesDone = primeAllConcurrently(sources, logger);
    await Promise.resolve(); // 'loading'
    // User taps — gate skips because status is 'loading'.
    const racingLookup = lookup.lookup('apple');
    a.resolveLoad();
    await primesDone;
    await racingLookup;

    expect(a.parseSpy).toHaveBeenCalledTimes(1);
  });

  // --- NEGATIVE TEST: documents the regression mode ---
  //
  // This test does NOT exercise primeAllConcurrently. It builds a
  // SERIAL prime sequence (the bug shape from before commit d68cc4d)
  // and proves that under that wiring, multiDictLookup's gate fails
  // to protect against the still-idle sources. If anyone reverts
  // index.js to a `for...of await source.prime()` loop, the
  // assertion below confirms why that change is unsafe.
  test('NEGATIVE: serial priming triggers per-word lookup on still-idle sources, blocking the fan-out', async () => {
    const slow = buildControlledSource('Slow', 'fruit-slow');
    const queued = buildControlledSource('Queued', 'fruit-queued');
    const sources = [slow.source, queued.source];
    const lookup = createMultiDictLookup(sources);
    const logger = {log: jest.fn()};

    // Serial prime: only Slow becomes 'loading'; Queued stays 'idle'.
    const serialPrime = (async () => {
      await slow.source.prime?.();
      logger.log(`[startup] primed user dict "${slow.source.name}"`);
      await queued.source.prime?.();
      logger.log(`[startup] primed user dict "${queued.source.name}"`);
    })();
    await Promise.resolve();

    expect(slow.source.status?.()).toBe('loading');
    // Queued is still 'idle' — this is the gap.
    expect(queued.source.status?.()).toBe('idle');

    // User taps. The gate skips Slow ('loading') but falls through
    // to Queued ('idle'), which the lazy harness handles by
    // triggering load+parse — invoking Queued's per-word lookup
    // function once parsed.
    const racingLookup = lookup.lookup('apple');

    // Resolve Queued's load so the racing lookup can complete.
    queued.resolveLoad();
    // Resolve Slow's so the prime sequence can drain.
    slow.resolveLoad();
    await serialPrime;
    const result = await racingLookup;

    // The smoking gun: Queued's per-word lookup was invoked even
    // though it wasn't yet 'primed'. Under concurrent priming, it
    // would have been 'loading' at the gate and skipped.
    expect(queued.perWordLookupSpy).toHaveBeenCalled();
    // And it surfaced in the hits — not in `loading` — because the
    // gate didn't catch it.
    expect(result.hits.map(h => h.source)).toContain('Queued');
  });
});
