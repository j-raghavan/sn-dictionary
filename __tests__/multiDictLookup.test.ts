import {createMultiDictLookup} from '../src/core/dict/multiDictLookup';
import type {DictEntry, DictSource, LookupResult} from '../src/core/lookup';

const stubSource = (
  name: string,
  table: Record<string, string>,
): DictSource => ({
  name,
  lookup: jest.fn(async (word: string): Promise<DictEntry | null> => {
    const def = table[word.toLowerCase()];
    return def ? {word, definition: def} : null;
  }),
});

describe('createMultiDictLookup', () => {
  test('returns no hits with no sources configured', async () => {
    const lookup = createMultiDictLookup([]);
    expect(await lookup.lookup('apple')).toEqual({
      queriedFor: 'apple',
      hits: [],
      loading: [],
    });
  });

  test('returns no hits with original input preserved on whitespace', async () => {
    const lookup = createMultiDictLookup([stubSource('A', {apple: 'fruit'})]);
    expect(await lookup.lookup('   ')).toEqual({
      queriedFor: '   ',
      hits: [],
      loading: [],
    });
  });

  test('does not call any source for empty/whitespace input', async () => {
    const a = stubSource('A', {apple: 'fruit'});
    const lookup = createMultiDictLookup([a]);
    await lookup.lookup('   ');
    expect(a.lookup).not.toHaveBeenCalled();
  });

  test('collects hits from all sources that match (fan-out)', async () => {
    const a = stubSource('A', {apple: 'a fruit (A)'});
    const b = stubSource('B', {apple: 'a fruit (B)'});
    const lookup = createMultiDictLookup([a, b]);
    const result = await lookup.lookup('apple');
    expect(result.hits).toEqual([
      {source: 'A', entry: {word: 'apple', definition: 'a fruit (A)'}},
      {source: 'B', entry: {word: 'apple', definition: 'a fruit (B)'}},
    ]);
    expect(result.loading).toEqual([]);
  });

  test('preserves source-array order regardless of resolution order', async () => {
    // Source "A" resolves slowly; "B" resolves fast. The output
    // order must follow the array, not the wall-clock order.
    const a: DictSource = {
      name: 'A',
      lookup: jest.fn(
        () =>
          new Promise(resolve =>
            setTimeout(
              () => resolve({word: 'apple', definition: 'a-slow'}),
              25,
            ),
          ),
      ),
    };
    const b: DictSource = {
      name: 'B',
      lookup: jest.fn(async () => ({word: 'apple', definition: 'b-fast'})),
    };
    const lookup = createMultiDictLookup([a, b]);
    const result = await lookup.lookup('apple');
    expect(result.hits.map(h => h.source)).toEqual(['A', 'B']);
  });

  test('omits sources that miss', async () => {
    const a = stubSource('A', {apple: 'fruit'});
    const b = stubSource('B', {grape: 'small fruit'});
    const lookup = createMultiDictLookup([a, b]);
    const result = await lookup.lookup('apple');
    expect(result.hits.map(h => h.source)).toEqual(['A']);
  });

  test('returns no hits when no source has the word', async () => {
    const a = stubSource('A', {apple: 'fruit'});
    const b = stubSource('B', {banana: 'yellow fruit'});
    const lookup = createMultiDictLookup([a, b]);
    expect(await lookup.lookup('mango')).toEqual({
      queriedFor: 'mango',
      hits: [],
      loading: [],
    });
  });

  test('isolates a throwing source: warns and continues with others', async () => {
    const warn = jest.fn();
    const broken: DictSource = {
      name: 'broken',
      lookup: jest.fn(async () => {
        throw new Error('disk gone');
      }),
    };
    const fallback = stubSource('B', {apple: 'fruit'});
    const lookup = createMultiDictLookup([broken, fallback], {warn});
    const result = await lookup.lookup('apple');
    expect(result.hits).toEqual([
      {source: 'B', entry: {word: 'apple', definition: 'fruit'}},
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/source "broken" threw: disk gone/),
    );
  });

  test('returns no hits when every source throws (warned for each)', async () => {
    const warn = jest.fn();
    const a: DictSource = {
      name: 'a',
      lookup: jest.fn(async () => {
        throw new Error('a fail');
      }),
    };
    const b: DictSource = {
      name: 'b',
      lookup: jest.fn(async () => {
        throw new Error('b fail');
      }),
    };
    const lookup = createMultiDictLookup([a, b], {warn});
    expect(await lookup.lookup('apple')).toEqual({
      queriedFor: 'apple',
      hits: [],
      loading: [],
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a fail'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('b fail'));
  });

  test('survives without a logger when a source throws', async () => {
    const broken: DictSource = {
      name: 'broken',
      lookup: jest.fn(async () => {
        throw new Error('boom');
      }),
    };
    const fallback = stubSource('B', {apple: 'fruit'});
    const lookup = createMultiDictLookup([broken, fallback]);
    expect((await lookup.lookup('apple')).hits.length).toBe(1);
  });

  test('passes the trimmed query to each source', async () => {
    const a = stubSource('A', {apple: 'fruit'});
    const lookup = createMultiDictLookup([a]);
    await lookup.lookup('  apple  ');
    expect(a.lookup).toHaveBeenCalledWith('apple');
  });

  test('survives mid-flight mutation of the sources array (snapshot semantics)', async () => {
    // Repro: index.js shares the sources array with the registry and
    // mutates it (sources.unshift(...userDicts)) after discovery
    // completes. If a lookup is in flight when discovery resolves, a
    // naive implementation would index past the resolved entries and
    // push undefined as a "hit", breaking the popup downstream.
    const base = stubSource('Base', {apple: 'fruit (base)'});
    const sources: DictSource[] = [base];
    const lookup = createMultiDictLookup(sources);

    // Kick off a lookup, then prepend new sources before it resolves.
    const inFlight = lookup.lookup('apple');
    sources.unshift(stubSource('UserA', {apple: 'fruit (userA)'}));
    sources.unshift(stubSource('UserB', {apple: 'fruit (userB)'}));

    const result = await inFlight;
    // The in-flight lookup must observe ONLY the sources present at
    // its start (the base), not the late-arriving prepends. Hits and
    // sources.length stay aligned; no undefined entries leak through.
    expect(result.hits).toEqual([
      {source: 'Base', entry: {word: 'apple', definition: 'fruit (base)'}},
    ]);
    for (const hit of result.hits) {
      expect(hit.entry).toBeDefined();
      expect(hit.entry.definition).toEqual(expect.any(String));
    }

    // Subsequent lookups DO see the new sources — the registry uses
    // the live array, just snapshots per-call so each lookup is
    // internally consistent.
    const next = await lookup.lookup('apple');
    expect(next.hits.map(h => h.source)).toEqual(['UserB', 'UserA', 'Base']);
  });

  describe('streaming progress (onUpdate)', () => {
    test('emits an initial empty-hits snapshot listing every source as loading', async () => {
      const a = stubSource('A', {apple: 'fruit (A)'});
      const b = stubSource('B', {apple: 'fruit (B)'});
      const lookup = createMultiDictLookup([a, b]);
      const updates: LookupResult[] = [];
      await lookup.lookup('apple', s => updates.push({...s}));
      expect(updates.length).toBeGreaterThan(0);
      const initial = updates[0];
      expect(initial.hits).toEqual([]);
      expect(initial.loading).toEqual(['A', 'B']);
    });

    test('emits a snapshot after each source resolution and a final snapshot with loading=[]', async () => {
      // 'A' resolves after 'B' so the visible progression is
      //   [A,B] loading -> A loading + B hit -> both resolved.
      const a: DictSource = {
        name: 'A',
        lookup: jest.fn(
          () =>
            new Promise(resolve =>
              setTimeout(
                () => resolve({word: 'apple', definition: 'a-slow'}),
                15,
              ),
            ),
        ),
      };
      const b: DictSource = {
        name: 'B',
        lookup: jest.fn(async () => ({word: 'apple', definition: 'b-fast'})),
      };
      const lookup = createMultiDictLookup([a, b]);
      const updates: LookupResult[] = [];
      const final = await lookup.lookup('apple', s => updates.push({...s}));
      // Initial + per-source resolution emissions.
      expect(updates[0].loading).toEqual(['A', 'B']);
      const lastInterim = updates[updates.length - 1];
      expect(lastInterim.loading).toEqual([]);
      expect(final.loading).toEqual([]);
      expect(final.hits.map(h => h.source)).toEqual(['A', 'B']);
    });

    test('streaming snapshot omits sources that miss but resolves them out of loading', async () => {
      const a = stubSource('A', {apple: 'fruit'});
      const b = stubSource('B', {grape: 'small fruit'}); // misses apple
      const lookup = createMultiDictLookup([a, b]);
      const updates: LookupResult[] = [];
      const final = await lookup.lookup('apple', s => updates.push({...s}));
      expect(final.hits.map(h => h.source)).toEqual(['A']);
      expect(final.loading).toEqual([]);
      // No mid-flight snapshot has 'B' as a hit; it should just drop
      // out of loading once it resolves.
      for (const u of updates) {
        expect(u.hits.map(h => h.source)).not.toContain('B');
      }
    });

    test('emits a single empty snapshot for whitespace-only input', async () => {
      const a = stubSource('A', {apple: 'fruit'});
      const lookup = createMultiDictLookup([a]);
      const updates: LookupResult[] = [];
      await lookup.lookup('   ', s => updates.push({...s}));
      expect(updates).toEqual([
        {queriedFor: '   ', hits: [], loading: []},
      ]);
    });

    test('a throwing onUpdate listener does not break the lookup', async () => {
      const a = stubSource('A', {apple: 'fruit'});
      const lookup = createMultiDictLookup([a]);
      const final = await lookup.lookup('apple', () => {
        throw new Error('listener boom');
      });
      expect(final.hits.map(h => h.source)).toEqual(['A']);
    });

    test('no listener: skips the streaming code path entirely', async () => {
      const a = stubSource('A', {apple: 'fruit'});
      const lookup = createMultiDictLookup([a]);
      // Passing no second argument exercises the non-streaming
      // resolution path (single Promise.all without per-source emit).
      const final = await lookup.lookup('apple');
      expect(final.hits.map(h => h.source)).toEqual(['A']);
      expect(final.loading).toEqual([]);
    });
  });

  describe('skip-still-priming behaviour', () => {
    // Regression: a real on-device tap blocked for >32 s waiting on
    // a Wiktionary-class user dict that was still finishing its
    // initial prime. The reentrancy guard rejected the user's
    // retap. Lookups must NOT await sources whose status() reports
    // they are still loading.

    test('does NOT await a source whose status is loading', async () => {
      let resolveSlow: (v: DictEntry | null) => void = () => {};
      const slow: DictSource = {
        name: 'Slow',
        status: () => 'loading',
        lookup: jest.fn(
          () =>
            new Promise<DictEntry | null>(resolve => {
              resolveSlow = resolve;
            }),
        ),
      };
      const fast = stubSource('Fast', {apple: 'fruit'});
      const lookup = createMultiDictLookup([slow, fast]);
      // The lookup must resolve without ever hearing back from Slow.
      const result = await lookup.lookup('apple');
      // Slow is reported as still-loading; Fast contributed a hit.
      expect(result.loading).toEqual(['Slow']);
      expect(result.hits.map(h => h.source)).toEqual(['Fast']);
      // Slow.lookup was never invoked — no risk of a stale
      // background emission landing in a future popup.
      expect(slow.lookup).not.toHaveBeenCalled();
      // Cleanup so jest doesn't hold the promise forever.
      resolveSlow(null);
    });

    test('DOES await a source whose status is idle (lazy first-lookup compat)', async () => {
      // 'idle' means prime() was never called — typical of test
      // fixtures and any source that the runtime warm-up loop didn't
      // touch. Lookups must still trigger the load via the normal
      // lazy path; otherwise idle sources would be permanently
      // unreachable.
      const idle = stubSource('Idle', {apple: 'fruit'});
      Object.assign(idle, {status: () => 'idle'});
      const lookup = createMultiDictLookup([idle]);
      const result = await lookup.lookup('apple');
      expect(idle.lookup).toHaveBeenCalledWith('apple');
      expect(result.hits.map(h => h.source)).toEqual(['Idle']);
      expect(result.loading).toEqual([]);
    });

    test('still awaits a source whose status is ready / absent / failed', async () => {
      // 'absent' and 'failed' both resolve quickly via lookup() — no
      // reason to skip them. Verify the gate only triggers for
      // loading/idle.
      const ready = stubSource('Ready', {apple: 'fruit'});
      Object.assign(ready, {status: () => 'ready'});
      const absent: DictSource = {
        name: 'Absent',
        status: () => 'absent',
        lookup: jest.fn(async () => null),
      };
      const failed: DictSource = {
        name: 'Failed',
        status: () => 'failed',
        lookup: jest.fn(async () => null),
      };
      const lookup = createMultiDictLookup([ready, absent, failed]);
      const result = await lookup.lookup('apple');
      expect(result.loading).toEqual([]);
      expect(absent.lookup).toHaveBeenCalled();
      expect(failed.lookup).toHaveBeenCalled();
    });

    test('a source with no status() method is treated as ready (compat)', async () => {
      // Existing tests build sources without a status hook. Those
      // must continue to be queried normally — only sources that
      // explicitly report loading/idle should be skipped.
      const a = stubSource('A', {apple: 'fruit'}); // no status()
      const lookup = createMultiDictLookup([a]);
      const result = await lookup.lookup('apple');
      expect(result.hits.map(h => h.source)).toEqual(['A']);
      expect(result.loading).toEqual([]);
    });

    test('a source whose status() throws is logged and queried normally', async () => {
      // A faulty custom source must not break the entire fan-out.
      // status() throwing → fall through to lookup() (the source's
      // own behaviour decides what happens next).
      const warn = jest.fn();
      const flaky: DictSource = {
        name: 'Flaky',
        status: () => {
          throw new Error('status boom');
        },
        lookup: jest.fn(async () => ({
          word: 'apple',
          definition: 'fruit',
          format: 'plain',
        })),
      };
      const fallback = stubSource('B', {apple: 'fruit (B)'});
      const lookup = createMultiDictLookup([flaky, fallback], {warn});
      const result = await lookup.lookup('apple');
      expect(flaky.lookup).toHaveBeenCalled();
      expect(result.hits.map(h => h.source)).toEqual(['Flaky', 'B']);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/source "Flaky" status\(\) threw: status boom/),
      );
    });
  });
});
