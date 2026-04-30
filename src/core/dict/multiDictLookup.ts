// Registry over one or more DictSources. Fans out to every source
// concurrently and returns the union of hits, in source-array order.
// A source that throws is logged and treated as "no hit" — one bad
// dict doesn't break the rest of the lookup.

import type {
  DictEntry,
  DictLookup,
  DictSource,
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

export const createMultiDictLookup = (
  sources: DictSource[],
  logger?: Logger,
): DictLookup => {
  const warn = logger?.warn ?? (() => {});

  return {
    async lookup(text: string): Promise<LookupResult> {
      const trimmed = text.trim();
      if (!trimmed) {
        return {queriedFor: text, hits: []};
      }
      // Snapshot the sources array at lookup start. The caller (index.js)
      // is allowed to mutate the shared `sources` array after discovery
      // completes (sources.unshift(...userDicts)). Without a snapshot, a
      // mutation in flight would desync sources.length from entries.length
      // post-Promise.all, leaving us indexing past the resolved values
      // and pushing { entry: undefined } as a hit — breaking the popup
      // which expects entry.definition to exist.
      const snapshot = sources.slice();
      // Concurrent fan-out, then walk in snapshot order so the popup
      // section ordering is deterministic regardless of which source
      // resolved first.
      const entries = await Promise.all(
        snapshot.map(s => safeLookup(s, trimmed, warn)),
      );
      const hits: SourceHit[] = [];
      for (let i = 0; i < snapshot.length; i++) {
        const entry = entries[i];
        if (entry != null) {
          hits.push({source: snapshot[i].name, entry});
        }
      }
      return {queriedFor: text, hits};
    },
  };
};
