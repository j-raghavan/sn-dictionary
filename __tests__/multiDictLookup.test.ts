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
  test('returns not-found with no sources configured', async () => {
    const lookup = createMultiDictLookup([]);
    expect(await lookup.lookup('apple')).toEqual({
      found: false,
      queriedFor: 'apple',
    });
  });

  test('returns not-found preserving original input on whitespace', async () => {
    const lookup = createMultiDictLookup([stubSource('A', {apple: 'fruit'})]);
    expect(await lookup.lookup('   ')).toEqual({found: false, queriedFor: '   '});
  });

  test('does not call any source for empty/whitespace input', async () => {
    const a = stubSource('A', {apple: 'fruit'});
    const lookup = createMultiDictLookup([a]);
    await lookup.lookup('   ');
    expect(a.lookup).not.toHaveBeenCalled();
  });

  test('returns the first source that hits (first-match-wins)', async () => {
    const a = stubSource('A', {apple: 'a fruit (A)'});
    const b = stubSource('B', {apple: 'a fruit (B)'});
    const lookup = createMultiDictLookup([a, b]);
    expect(await lookup.lookup('apple')).toEqual({
      found: true,
      entry: {word: 'apple', definition: 'a fruit (A)'},
    });
    // b is never queried because a hit.
    expect(b.lookup).not.toHaveBeenCalled();
  });

  test('falls through to later sources when earlier ones miss', async () => {
    const a = stubSource('A', {apple: 'fruit'});
    const b = stubSource('B', {grape: 'small fruit'});
    const lookup = createMultiDictLookup([a, b]);
    expect(await lookup.lookup('grape')).toEqual({
      found: true,
      entry: {word: 'grape', definition: 'small fruit'},
    });
    expect(a.lookup).toHaveBeenCalled();
    expect(b.lookup).toHaveBeenCalled();
  });

  test('returns not-found when no source has the word', async () => {
    const a = stubSource('A', {apple: 'fruit'});
    const b = stubSource('B', {banana: 'yellow fruit'});
    const lookup = createMultiDictLookup([a, b]);
    expect(await lookup.lookup('mango')).toEqual({
      found: false,
      queriedFor: 'mango',
    });
  });

  test('isolates a throwing source: warns and continues to the next', async () => {
    const warn = jest.fn();
    const broken: DictSource = {
      name: 'broken',
      lookup: jest.fn(async () => {
        throw new Error('disk gone');
      }),
    };
    const fallback = stubSource('B', {apple: 'fruit'});
    const lookup = createMultiDictLookup([broken, fallback], {warn});
    expect(await lookup.lookup('apple')).toEqual({
      found: true,
      entry: {word: 'apple', definition: 'fruit'},
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/source "broken" threw: disk gone/),
    );
  });

  test('returns not-found when every source throws (warned for each)', async () => {
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
      found: false,
      queriedFor: 'apple',
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
    expect((await lookup.lookup('apple')).found).toBe(true);
  });

  test('passes the trimmed query to each source', async () => {
    const a = stubSource('A', {apple: 'fruit'});
    const lookup = createMultiDictLookup([a]);
    await lookup.lookup('  apple  ');
    expect(a.lookup).toHaveBeenCalledWith('apple');
  });
});
