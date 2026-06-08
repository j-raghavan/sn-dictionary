// Shared lazy-load + retry harness for any async-loaded DictSource.
// One helper, regardless of whether the format loads a single handle
// (SQLite: open the DB) or a multi-buffer composite (StarDict's
// {ifo, idx, dict, syn?}).
//
// Contract:
//   - load() returns null intentionally -> 'absent', sticks (no retry).
//   - load() / parse() throws            -> 'failed', leaves the
//                                           state empty so the next
//                                           lookup retries (transient
//                                           errors must not permanently
//                                           dead-end the session).
//   - load() returns + parse() ok        -> 'ready', sticks.
//
// Concurrency: the load promise is memoised so concurrent first
// lookups (and any background prime() calls) share one underlying
// load+parse pass instead of racing.
//
// Async parse: parse() may return a Promise so format-specific
// parsers can yield to the event loop on large inputs (e.g.
// StarDict .idx with 200k–2M entries) and keep the UI responsive
// during background priming.

import type {DictEntry, DictSource, DictSourceStatus} from '../lookup';

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
  // here — the harness is format-agnostic. May return a Promise so
  // large parses can yield to the event loop.
  parse: (loaded: TLoaded) => TParsed | Promise<TParsed>;
  // Format-specific lookup against the parsed dict. May return a
  // Promise so backends whose query is inherently async (SQLite over
  // a native bridge) compose through the same harness as the
  // synchronous in-memory StarDict parser.
  lookup: (
    parsed: TParsed,
    word: string,
  ) => DictEntry | null | Promise<DictEntry | null>;
  logger?: {warn: (msg: string) => void};
};

export const createLazyAsyncSource = <TLoaded, TParsed>(
  deps: LazyAsyncSourceDeps<TLoaded, TParsed>,
): DictSource => {
  const warn = deps.logger?.warn ?? (() => {});
  const tag = deps.logTag ?? deps.name;
  let parsed: TParsed | null = null;
  let absent = false;
  // Tracks the last *settled* outcome for status(). 'idle' means
  // nothing has been attempted yet; 'failed' is non-sticky and
  // resets to 'idle' once the next attempt starts.
  let lastOutcome: Exclude<DictSourceStatus, 'loading'> = 'idle';
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
      parsed = await deps.parse(loaded);
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
      // Memoise the in-flight promise so concurrent callers (lookup
      // racing prime, two lookups at once) wait on the same load.
      // Clear on settle so a failed attempt can be retried by the
      // NEXT call. lastOutcome flips to 'loading' for the duration
      // and lands on 'ready' / 'absent' / 'failed' on settle.
      lastOutcome = 'idle';
      inFlight = doLoad()
        .then(() => {
          lastOutcome = absent ? 'absent' : 'ready';
        })
        .catch(() => {
          lastOutcome = 'failed';
        })
        .finally(() => {
          inFlight = null;
        });
    }
    await inFlight;
  };

  const status = (): DictSourceStatus => {
    if (parsed !== null) {
      return 'ready';
    }
    if (absent) {
      return 'absent';
    }
    if (inFlight !== null) {
      return 'loading';
    }
    return lastOutcome;
  };

  return {
    name: deps.name,
    status,
    async prime(): Promise<void> {
      // Same memoised path as lookup(); just doesn't probe a word.
      await ensureLoaded();
    },
    async lookup(word: string): Promise<DictEntry | null> {
      const trimmed = word.trim();
      if (!trimmed) {
        return null;
      }
      await ensureLoaded();
      if (parsed === null) {
        return null;
      }
      return await deps.lookup(parsed, trimmed);
    },
  };
};
