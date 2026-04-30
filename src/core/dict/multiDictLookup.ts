// Registry over one or more DictSources. Step 1 keeps first-match-
// wins semantics so existing behaviour (single base dict) is
// unchanged. Step 2 will broaden the result shape to surface every
// matching source.
//
// Sources are queried in array order, sequentially. The first source
// that returns a non-null DictEntry wins. A source that throws is
// logged and skipped; the next source is tried. This containment
// stops one bad dict from breaking the whole lookup pipeline.

import type {
  DictEntry,
  DictLookup,
  DictSource,
  LookupResult,
} from '../lookup';

export type Logger = {warn: (msg: string) => void};

export const createMultiDictLookup = (
  sources: DictSource[],
  logger?: Logger,
): DictLookup => {
  const warn = logger?.warn ?? (() => {});

  return {
    async lookup(text: string): Promise<LookupResult> {
      const trimmed = text.trim();
      if (!trimmed) {
        return {found: false, queriedFor: text};
      }
      for (const source of sources) {
        let entry: DictEntry | null;
        try {
          entry = await source.lookup(trimmed);
        } catch (e) {
          warn(
            `[multiDict] source "${source.name}" threw: ${(e as Error).message}`,
          );
          continue;
        }
        if (entry !== null) {
          return {found: true, entry};
        }
      }
      return {found: false, queriedFor: text};
    },
  };
};
