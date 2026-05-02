// Lazy-bound key-value storage for parsed-index persistence.
//
// The Supernote firmware doesn't expose a key-value store through
// sn-plugin-lib, and React Native has no built-in persistent KV.
// The community-standard solution is
// `@react-native-async-storage/async-storage` (a native module).
//
// Like sn-shapes does for favourites, we lazy-`require()` the dep
// inside a try/catch so:
//   * tests run without the dep installed (memory fallback);
//   * production with the dep installed gets durable persistence;
//   * production without the dep falls back to in-memory — the
//     plugin still works, just doesn't speed up subsequent loads.
//
// Public surface is an interface, not the concrete AsyncStorage
// shape, so callers depend on contract not on a third-party type.

export interface IndexCacheStorage {
  // Returns `null` for a missing key OR any storage error.
  // Callers must treat any non-null return as "may be valid; verify
  // fingerprint" because the disk store could outlive the data
  // format that produced it.
  getItem(key: string): Promise<string | null>;
  // Failures are swallowed (logged): cache writes are a perf
  // optimisation, never a correctness requirement, so a write loss
  // must not abort a successful parse.
  setItem(key: string, value: string): Promise<void>;
  // Used by tests to clear a key on tear-down. Optional in the
  // production AsyncStorage implementation only because some
  // backends don't support it; ours does.
  removeItem?(key: string): Promise<void>;
}

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

const tryLoadAsyncStorage = (): AsyncStorageLike | null => {
  try {
    const mod = require('@react-native-async-storage/async-storage');
    const candidate = mod?.default ?? mod;
    if (
      candidate &&
      typeof candidate.getItem === 'function' &&
      typeof candidate.setItem === 'function'
    ) {
      return candidate as AsyncStorageLike;
    }
  } catch {
    // Dep absent — fall through to memory backend.
  }
  return null;
};

export const wrapKvBackend = (
  backend: AsyncStorageLike,
  logger?: {warn: (msg: string) => void},
): IndexCacheStorage => {
  const warn = logger?.warn ?? (() => {});
  return {
    async getItem(key) {
      try {
        return await backend.getItem(key);
      } catch (e) {
        warn(`[indexCache] getItem("${key}") threw: ${(e as Error).message}`);
        return null;
      }
    },
    async setItem(key, value) {
      try {
        await backend.setItem(key, value);
      } catch (e) {
        warn(`[indexCache] setItem("${key}") threw: ${(e as Error).message}`);
      }
    },
    removeItem: backend.removeItem
      ? async key => {
          try {
            await backend.removeItem!(key);
          } catch (e) {
            warn(
              `[indexCache] removeItem("${key}") threw: ${(e as Error).message}`,
            );
          }
        }
      : undefined,
  };
};

export const createMemoryIndexCacheStorage = (): IndexCacheStorage => {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
};

let cachedDefault: IndexCacheStorage | null = null;

export const getDefaultIndexCacheStorage = (logger?: {
  warn: (msg: string) => void;
  log?: (msg: string) => void;
}): IndexCacheStorage => {
  if (cachedDefault) {
    return cachedDefault;
  }
  const backend = tryLoadAsyncStorage();
  if (backend !== null) {
    logger?.log?.('[indexCache] AsyncStorage backend available');
    cachedDefault = wrapKvBackend(backend, logger);
  } else {
    logger?.warn(
      '[indexCache] AsyncStorage not available — falling back to in-memory cache (no cross-session persistence)',
    );
    cachedDefault = createMemoryIndexCacheStorage();
  }
  return cachedDefault;
};

export const __testing__ = {
  resetDefault: () => {
    cachedDefault = null;
  },
};
