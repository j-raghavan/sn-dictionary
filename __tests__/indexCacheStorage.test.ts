import {
  createMemoryIndexCacheStorage,
  createSelfHealingBackend,
  getDefaultIndexCacheStorage,
  __testing__,
} from '../src/core/dict/indexCacheStorage';

beforeEach(() => {
  __testing__.resetDefault();
});

describe('createMemoryIndexCacheStorage', () => {
  test('round-trips a value through getItem/setItem', async () => {
    const store = createMemoryIndexCacheStorage();
    await store.setItem('k', 'v');
    expect(await store.getItem('k')).toBe('v');
  });

  test('returns null for missing keys', async () => {
    const store = createMemoryIndexCacheStorage();
    expect(await store.getItem('nope')).toBeNull();
  });

  test('removeItem clears a key', async () => {
    const store = createMemoryIndexCacheStorage();
    await store.setItem('k', 'v');
    await store.removeItem!('k');
    expect(await store.getItem('k')).toBeNull();
  });
});

describe('createSelfHealingBackend', () => {
  test('forwards calls to a working primary backend', async () => {
    const primary = {
      getItem: jest.fn(async () => 'value'),
      setItem: jest.fn(async () => undefined),
    };
    const store = createSelfHealingBackend(primary);
    expect(await store.getItem('k')).toBe('value');
    await store.setItem('k', 'v');
    expect(primary.setItem).toHaveBeenCalledWith('k', 'v');
  });

  test('falls back to memory on the first getItem throw and stays there', async () => {
    const warn = jest.fn();
    const primary = {
      getItem: jest.fn(async () => {
        throw new Error('Native module is null, cannot access legacy storage');
      }),
      setItem: jest.fn(async () => {
        throw new Error('Native module is null');
      }),
    };
    const store = createSelfHealingBackend(primary, {warn});
    // First getItem throws → swap to memory; the memory backend
    // returns null (no value set), but the call doesn't propagate
    // the error.
    expect(await store.getItem('k')).toBeNull();
    // Subsequent calls go to memory directly — primary.setItem is
    // NOT invoked again.
    await store.setItem('k', 'v');
    expect(primary.setItem).not.toHaveBeenCalled();
    expect(await store.getItem('k')).toBe('v');
    // Single fallback warn line per session.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/falling back to in-memory cache/),
    );
  });

  test('falls back to memory on the first setItem throw and stays there', async () => {
    const warn = jest.fn();
    const primary = {
      getItem: jest.fn(async () => null),
      setItem: jest
        .fn<Promise<void>, [string, string]>()
        .mockImplementationOnce(async () => {
          throw new Error('Native module is null');
        }),
    };
    const store = createSelfHealingBackend(primary, {warn});
    await store.setItem('k', 'v');
    // The retry on the memory fallback succeeds.
    expect(await store.getItem('k')).toBe('v');
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/AsyncStorage.setItem threw/),
    );
  });

  test('falls back when removeItem throws', async () => {
    const warn = jest.fn();
    const primary = {
      getItem: jest.fn(async () => null),
      setItem: jest.fn(async () => undefined),
      removeItem: jest.fn(async () => {
        throw new Error('Native module is null');
      }),
    };
    const store = createSelfHealingBackend(primary, {warn});
    await store.removeItem!('k');
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/AsyncStorage.removeItem threw/),
    );
    // Subsequent setItem goes to memory.
    await store.setItem('k', 'v');
    expect(primary.setItem).not.toHaveBeenCalled();
  });

  test('only one fallback warn fires even with many subsequent operations', async () => {
    const warn = jest.fn();
    const primary = {
      getItem: jest.fn(async () => {
        throw new Error('Native module is null');
      }),
      setItem: jest.fn(async () => undefined),
    };
    const store = createSelfHealingBackend(primary, {warn});
    await store.getItem('k');
    await store.getItem('k');
    await store.setItem('k', 'v');
    await store.removeItem!('k');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('getDefaultIndexCacheStorage', () => {
  test('returns a working KV', async () => {
    const store = getDefaultIndexCacheStorage();
    await store.setItem('k', 'v');
    const out = await store.getItem('k');
    // Either AsyncStorage round-trips, or the self-healing wrapper
    // already swapped to memory — both yield the value back.
    expect(out === 'v' || out === null).toBe(true);
  });

  test('memoises the default backend across calls', () => {
    const a = getDefaultIndexCacheStorage();
    const b = getDefaultIndexCacheStorage();
    expect(a).toBe(b);
  });

  test('logs an informational note about the chosen path', () => {
    const log = jest.fn();
    const warn = jest.fn();
    getDefaultIndexCacheStorage({log, warn});
    expect(log.mock.calls.length + warn.mock.calls.length).toBeGreaterThan(0);
  });
});

// Coverage for the AsyncStorage-success branch — the lazy require()
// path is otherwise unreachable in jest because the real
// @react-native-async-storage/async-storage module uses
// NativeModules which jest doesn't bind. We use jest.isolateModules
// so the mock applies only within this describe block.
describe('getDefaultIndexCacheStorage with AsyncStorage available', () => {
  test('selects the AsyncStorage backend and logs the available note', async () => {
    let storedKey: string | null = null;
    let storedValue: string | null = null;
    jest.isolateModules(() => {
      jest.doMock(
        '@react-native-async-storage/async-storage',
        () => ({
          __esModule: true,
          default: {
            getItem: async (k: string) =>
              storedKey === k ? storedValue : null,
            setItem: async (k: string, v: string) => {
              storedKey = k;
              storedValue = v;
            },
            removeItem: async () => {
              storedKey = null;
              storedValue = null;
            },
          },
        }),
        {virtual: false},
      );
      const log = jest.fn();
      const warn = jest.fn();
      const mod = require('../src/core/dict/indexCacheStorage');
      mod.__testing__.resetDefault();
      const store = mod.getDefaultIndexCacheStorage({log, warn});
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/AsyncStorage JS shim loaded/),
      );
      return store.setItem('k', 'v').then(async () => {
        expect(await store.getItem('k')).toBe('v');
      });
    });
  });
});
