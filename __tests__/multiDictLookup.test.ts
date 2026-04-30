import {createMultiDictLookup} from '../src/core/dict/multiDictLookup';
import type {DictEntry, DictSource} from '../src/core/lookup';

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
    });
  });

  test('returns no hits with original input preserved on whitespace', async () => {
    const lookup = createMultiDictLookup([stubSource('A', {apple: 'fruit'})]);
    expect(await lookup.lookup('   ')).toEqual({queriedFor: '   ', hits: []});
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
});
