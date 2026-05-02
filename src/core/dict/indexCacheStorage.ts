// Lazy-bound key-value storage for parsed-index persistence.
//
// The Supernote firmware doesn't expose a key-value store through
// sn-plugin-lib, and React Native has no built-in persistent KV.
// The community-standard solution is
// `@react-native-async-storage/async-storage` (a native module).
//
// Two layers of fallback:
//
// 1. Lazy `require()` of the AsyncStorage dep inside a try/catch.
//    If the package isn't installed, fall through to memory.
// 2. SELF-HEALING runtime guard. The plugin host on Supernote ships
//    AsyncStorage's JS shim but not its native module — every
//    getItem/setItem then throws "Native module is null". On the
//    first such failure we swap to the in-memory backend and stay
//    there for the rest of the session. The user gets one warn
//    line, then a working memory cache (no cross-session
//    persistence; same behaviour as before this whole commit).
//
// To get genuine persistence on Supernote, the plugin needs to
// ship its own android/app/src/main/java/... ReactPackage that
// re-exports AsyncStoragePackage; buildPlugin.sh would then bundle
// the native code into app.npk. That's the next step if it turns
// out to be worth the Java surface.

export interface IndexCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
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

// Wraps a real AsyncStorage-like backend with a one-shot self-heal:
// the first time any operation throws (typically the Supernote plugin
// host's "Native module is null" error), swap permanently to memory.
// Subsequent calls hit memory directly with no try/catch overhead.
// The fallback warn fires exactly once per JS-context lifetime.
export const createSelfHealingBackend = (
  primary: AsyncStorageLike,
  logger?: {warn: (msg: string) => void; log?: (msg: string) => void},
): IndexCacheStorage => {
  const warn = logger?.warn ?? (() => {});
  let memory: IndexCacheStorage | null = null;
  // Callers always check `memory` BEFORE invoking this helper, so
  // we're guaranteed first-time semantics here — the warn fires
  // exactly once per session lifetime.
  const fallToMemory = (reason: string): IndexCacheStorage => {
    warn(
      `[indexCache] ${reason} — falling back to in-memory cache for the rest of this session (no cross-session persistence)`,
    );
    memory = createMemoryIndexCacheStorage();
    return memory;
  };
  return {
    async getItem(key) {
      if (memory) {
        return memory.getItem(key);
      }
      try {
        return await primary.getItem(key);
      } catch (e) {
        return fallToMemory(
          `AsyncStorage.getItem threw: ${(e as Error).message}`,
        ).getItem(key);
      }
    },
    async setItem(key, value) {
      if (memory) {
        await memory.setItem(key, value);
        return;
      }
      try {
        await primary.setItem(key, value);
      } catch (e) {
        await fallToMemory(
          `AsyncStorage.setItem threw: ${(e as Error).message}`,
        ).setItem(key, value);
      }
    },
    removeItem: async key => {
      if (memory) {
        await memory.removeItem!(key);
        return;
      }
      try {
        await primary.removeItem?.(key);
      } catch (e) {
        await fallToMemory(
          `AsyncStorage.removeItem threw: ${(e as Error).message}`,
        ).removeItem!(key);
      }
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
    // We can't tell at this point whether the host's native module
    // is actually bound — the AsyncStorage JS shim loads either way.
    // The self-healing wrapper detects the missing native module on
    // first use and swaps to memory.
    logger?.log?.(
      '[indexCache] AsyncStorage JS shim loaded; will probe native binding on first use',
    );
    cachedDefault = createSelfHealingBackend(backend, logger);
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
