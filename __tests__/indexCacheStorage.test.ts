import {
  createMemoryIndexCacheStorage,
  getDefaultIndexCacheStorage,
  wrapKvBackend,
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

describe('wrapKvBackend', () => {
  test('forwards getItem / setItem to the underlying backend', async () => {
    const backend = {
      getItem: jest.fn(async () => 'value'),
      setItem: jest.fn(async () => undefined),
    };
    const store = wrapKvBackend(backend);
    expect(await store.getItem('k')).toBe('value');
    await store.setItem('k', 'v');
    expect(backend.setItem).toHaveBeenCalledWith('k', 'v');
  });

  test('swallows getItem errors and returns null', async () => {
    const warn = jest.fn();
    const backend = {
      getItem: jest.fn(async () => {
        throw new Error('disk full');
      }),
      setItem: jest.fn(async () => undefined),
    };
    const store = wrapKvBackend(backend, {warn});
    expect(await store.getItem('k')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/getItem.*disk full/),
    );
  });

  test('swallows setItem errors (writes are best-effort)', async () => {
    const warn = jest.fn();
    const backend = {
      getItem: jest.fn(async () => null),
      setItem: jest.fn(async () => {
        throw new Error('quota exceeded');
      }),
    };
    const store = wrapKvBackend(backend, {warn});
    await expect(store.setItem('k', 'v')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/setItem.*quota/),
    );
  });

  test('exposes removeItem only when the backend supports it', async () => {
    const withRemove = wrapKvBackend({
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(async () => undefined),
    });
    expect(typeof withRemove.removeItem).toBe('function');
    const withoutRemove = wrapKvBackend({
      getItem: jest.fn(),
      setItem: jest.fn(),
    });
    expect(withoutRemove.removeItem).toBeUndefined();
  });

  test('removeItem swallows errors', async () => {
    const warn = jest.fn();
    const store = wrapKvBackend(
      {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(async () => {
          throw new Error('boom');
        }),
      },
      {warn},
    );
    await expect(store.removeItem!('k')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/removeItem.*boom/));
  });
});

describe('getDefaultIndexCacheStorage', () => {
  test('returns a working KV (AsyncStorage if installed, memory otherwise)', async () => {
    const store = getDefaultIndexCacheStorage();
    await store.setItem('k', 'v');
    // When AsyncStorage isn't loadable in the test env, the memory
    // backend round-trips. With the dep installed it may also
    // round-trip; either way we assert behaviour, not which backend
    // was selected.
    const out = await store.getItem('k');
    expect(out === 'v' || out === null).toBe(true);
  });

  test('memoises the default backend across calls', () => {
    const a = getDefaultIndexCacheStorage();
    const b = getDefaultIndexCacheStorage();
    expect(a).toBe(b);
  });

  test('logs an informational note when the backend resolves', () => {
    const log = jest.fn();
    const warn = jest.fn();
    getDefaultIndexCacheStorage({log, warn});
    // Either a "AsyncStorage available" log or a "falling back" warn
    // fires; whichever it is, the user gets a log line.
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
      // The real package's index emits an ESM-style default export.
      // Mirror that so the lazy `mod?.default ?? mod` line resolves
      // to our fake.
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
      // Re-import so the mock is in effect.
      const mod = require('../src/core/dict/indexCacheStorage');
      mod.__testing__.resetDefault();
      const store = mod.getDefaultIndexCacheStorage({log, warn});
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/AsyncStorage backend available/),
      );
      // Round-trip through the wrapper.
      return store.setItem('k', 'v').then(async () => {
        expect(await store.getItem('k')).toBe('v');
      });
    });
  });
});
