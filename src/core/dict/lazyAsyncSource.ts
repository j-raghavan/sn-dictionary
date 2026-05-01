// Shared lazy-load + retry harness for any async-loaded DictSource.
// One helper, regardless of whether the format loads a single byte
// buffer (CSV, JSON) or a multi-buffer composite (StarDict's
// {ifo, idx, dict, syn?}).
//
// Contract:
//   - load() returns null intentionally -> 'absent', sticks (no retry).
//   - load() / parse() throws            -> 'failed', leaves the
//                                           state empty so the next
//                                           lookup retries (transient
//                                           errors must not permanently
//                                           dead-end the session).
//   - load() returns + parse() ok        -> 'success', sticks.
//
// Concurrency: the load promise is memoised so concurrent first
// lookups share one underlying load+parse pass instead of racing.

import type {DictEntry, DictSource} from '../lookup';

export type LazyAsyncSourceDeps<TLoaded, TParsed> = {
  // Display name for the popup section label.
  name: string;
  // Optional log-tag prefix for warn messages. Defaults to `name`.
  // Existing StarDict logs read `[stardict:WordNet] ...` so the
  // factory passes "stardict:WordNet" here while keeping `name`
  // = "WordNet" for the popup.
  logTag?: string;
  // Loader: returns whatever the parser needs. Null = absent
  // (deliberate opt-out); throwing = transient failure (will retry).
  load: () => Promise<TLoaded | null>;
  // Format-specific parse. Size caps and any other validation belong
  // here — the harness is format-agnostic.
  parse: (loaded: TLoaded) => TParsed;
  // Format-specific lookup against the parsed dict.
  lookup: (parsed: TParsed, word: string) => DictEntry | null;
  logger?: {warn: (msg: string) => void};
};

export const createLazyAsyncSource = <TLoaded, TParsed>(
  deps: LazyAsyncSourceDeps<TLoaded, TParsed>,
): DictSource => {
  const warn = deps.logger?.warn ?? (() => {});
  const tag = deps.logTag ?? deps.name;
  let parsed: TParsed | null = null;
  let absent = false;
  let inFlight: Promise<void> | null = null;

  const doLoad = async (): Promise<void> => {
    let loaded: TLoaded | null;
    try {
      loaded = await deps.load();
    } catch (e) {
      warn(`[${tag}] loader threw: ${(e as Error).message}`);
      throw e;
    }
    if (loaded === null) {
      absent = true;
      return;
    }
    try {
      parsed = deps.parse(loaded);
    } catch (e) {
      warn(`[${tag}] parse threw: ${(e as Error).message}`);
      throw e;
    }
  };

  const ensureLoaded = async (): Promise<void> => {
    if (parsed !== null || absent) {
      return;
    }
    if (inFlight === null) {
      // Memoise the in-flight promise so concurrent callers wait on
      // the same load. Clear on settle so a failed attempt can be
      // retried by the NEXT lookup (not by the racing concurrent
      // ones — they all observe the same failure here).
      inFlight = doLoad().finally(() => {
        inFlight = null;
      });
    }
    try {
      await inFlight;
    } catch {
      // swallow — caller observes via parsed===null
    }
  };

  return {
    name: deps.name,
    async lookup(word: string): Promise<DictEntry | null> {
      const trimmed = word.trim();
      if (!trimmed) {
        return null;
      }
      await ensureLoaded();
      if (parsed === null) {
        return null;
      }
      return deps.lookup(parsed, trimmed);
    },
  };
};
