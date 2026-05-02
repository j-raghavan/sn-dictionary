// Registry over one or more DictSources. Fans out to every source
// concurrently and returns the union of hits, in source-array order.
// A source that throws is logged and treated as "no hit" — one bad
// dict doesn't break the rest of the lookup.
//
// Streaming progress: when the caller passes onUpdate, the registry
// emits an initial empty-hits snapshot listing every source as
// loading (so the popup can open instantly), then re-emits after
// each source resolves. The final snapshot has loading=[]. This
// removes the "popup hangs until the slowest source returns"
// behaviour without changing the resolution semantics for callers
// that don't pass onUpdate.

import type {
  DictEntry,
  DictLookup,
  DictSource,
  LookupOnUpdate,
  LookupResult,
  SourceHit,
} from '../lookup';

export type Logger = {warn: (msg: string) => void};

const safeLookup = async (
  source: DictSource,
  word: string,
  warn: (msg: string) => void,
): Promise<DictEntry | null> => {
  try {
    return await source.lookup(word);
  } catch (e) {
    warn(
      `[multiDict] source "${source.name}" threw: ${(e as Error).message}`,
    );
    return null;
  }
};

const emit = (
  onUpdate: LookupOnUpdate | undefined,
  snapshot: LookupResult,
): void => {
  if (!onUpdate) {
    return;
  }
  try {
    onUpdate(snapshot);
  } catch {
    // Listeners must not break the lookup pipeline.
  }
};

// A custom DictSource may ship a buggy status() that throws. Treat
// any thrown status as non-loading (fall through to lookup) — we'd
// rather query the source and let safeLookup handle a faulty
// implementation than reject the entire fan-out for one bad actor.
const isLoading = (
  source: DictSource,
  warn: (msg: string) => void,
): boolean => {
  if (typeof source.status !== 'function') {
    return false;
  }
  try {
    return source.status() === 'loading';
  } catch (e) {
    warn(
      `[multiDict] source "${source.name}" status() threw: ${(e as Error).message}`,
    );
    return false;
  }
};

export const createMultiDictLookup = (
  sources: DictSource[],
  logger?: Logger,
): DictLookup => {
  const warn = logger?.warn ?? (() => {});

  return {
    async lookup(
      text: string,
      onUpdate?: LookupOnUpdate,
    ): Promise<LookupResult> {
      const trimmed = text.trim();
      if (!trimmed) {
        const empty: LookupResult = {queriedFor: text, hits: [], loading: []};
        emit(onUpdate, empty);
        return empty;
      }
      // Snapshot the sources array at lookup start. The caller (index.js)
      // is allowed to mutate the shared `sources` array after discovery
      // completes (sources.unshift(...userDicts)). Without a snapshot, a
      // mutation in flight would desync sources.length from entries.length
      // post-Promise.all, leaving us indexing past the resolved values
      // and pushing { entry: undefined } as a hit — breaking the popup
      // which expects entry.definition to exist.
      const snapshot = sources.slice();
      const resolved: (DictEntry | null | undefined)[] = new Array(
        snapshot.length,
      );

      const buildSnapshot = (): LookupResult => {
        const hits: SourceHit[] = [];
        const loading: string[] = [];
        for (let i = 0; i < snapshot.length; i++) {
          const entry = resolved[i];
          if (entry === undefined) {
            loading.push(snapshot[i].name);
          } else if (entry !== null) {
            hits.push({source: snapshot[i].name, entry});
          }
        }
        return {queriedFor: text, hits, loading};
      };

      // Initial emission — popup opens immediately with every source
      // marked as loading. Skipped when no listener is attached so the
      // non-streaming call path stays a single Promise.all.
      emit(onUpdate, buildSnapshot());

      // Concurrent fan-out, then walk in snapshot order so the popup
      // section ordering is deterministic regardless of which source
      // resolved first.
      //
      // Sources whose prime is currently in flight (status='loading')
      // are NOT awaited: their lookup() would share the in-flight
      // prime promise and block the entire fan-out for ~60–80 s on a
      // Wiktionary-class dict. We leave them in `loading` and let
      // the user re-tap once the prime finishes (logcat
      // [startup] primed user dict "<name>" announces readiness).
      // We deliberately do NOT subscribe to a background resolution
      // here — popup state is global, and a stale emission from a
      // prior lookup would clobber a fresh tap's popup.
      //
      // 'idle' sources go through the normal lookup path: lazy
      // semantics still hold — first user query triggers the load.
      // This preserves behaviour for sources that never had prime()
      // called (test fixtures, sources skipped by the prime loop).
      await Promise.all(
        snapshot.map(async (source, i) => {
          if (isLoading(source, warn)) {
            return;
          }
          const entry = await safeLookup(source, trimmed, warn);
          resolved[i] = entry;
          emit(onUpdate, buildSnapshot());
        }),
      );

      return buildSnapshot();
    },
  };
};
