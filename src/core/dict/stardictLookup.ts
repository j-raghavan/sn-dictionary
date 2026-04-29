// Implements DictLookup on top of the vendored StarDict reader.
// Lazy-initialises the parsed dicts on the first lookup so plugin
// startup stays cheap (no eager base64 decode + gunzip + index build
// before the user does anything). User dict is queried first; falls
// back to the base dict.

import type {DictLookup, LookupResult} from '../lookup';
import {buildDict, lookupDict, type ParsedDict} from './stardict/stardictDict';

export type DictBytes = {
  ifo: Uint8Array;
  idx: Uint8Array;
  dict: Uint8Array;
};

// Bytes loaders are functions so the data source (build-time base64
// blob, future raw-asset bytes via Path A, etc.) can be swapped
// without touching this file.
export type LoadDictBytes = () => DictBytes | null;

export type StardictLookupDeps = {
  loadBase: LoadDictBytes;
  loadCustom?: LoadDictBytes;
  logger?: {warn: (msg: string) => void};
};

// safeBuild distinguishes three outcomes so the caller can decide
// whether a load attempt is "done" (intentional empty / partial
// success) or "should retry next time" (transient failure):
//   - 'success'   -> dict is non-null
//   - 'absent'    -> loader intentionally returned null/undefined
//                    (no dict configured for this slot)
//   - 'failed'    -> loader or buildDict threw
type BuildOutcome =
  | {kind: 'success'; dict: ParsedDict}
  | {kind: 'absent'}
  | {kind: 'failed'};

const safeBuild = (
  loader: LoadDictBytes,
  tag: string,
  warn: (msg: string) => void,
): BuildOutcome => {
  let bytes: DictBytes | null;
  try {
    bytes = loader();
  } catch (e) {
    warn(`[${tag}] loader threw: ${(e as Error).message}`);
    return {kind: 'failed'};
  }
  if (!bytes) {
    return {kind: 'absent'};
  }
  try {
    return {kind: 'success', dict: buildDict(bytes.ifo, bytes.idx, bytes.dict)};
  } catch (e) {
    warn(`[${tag}] buildDict threw: ${(e as Error).message}`);
    return {kind: 'failed'};
  }
};

export const createStardictLookup = (
  deps: StardictLookupDeps,
): DictLookup => {
  const warn = deps.logger?.warn ?? (() => {});
  let baseDict: ParsedDict | null = null;
  let customDict: ParsedDict | null = null;
  let loaded = false;

  const ensureLoaded = (): void => {
    if (loaded) {
      return;
    }
    const baseOutcome = safeBuild(deps.loadBase, 'stardict:base', warn);
    if (baseOutcome.kind === 'success') {
      baseDict = baseOutcome.dict;
    }
    let customOutcome: BuildOutcome = {kind: 'absent'};
    if (deps.loadCustom) {
      customOutcome = safeBuild(deps.loadCustom, 'stardict:custom', warn);
      if (customOutcome.kind === 'success') {
        customDict = customOutcome.dict;
      }
    }
    // Stickily mark loaded when there's nothing useful to retry.
    // Three cases:
    //   1. We have at least one parsed dict -> session is usable;
    //      stop retrying even if another slot failed (don't burn
    //      loader calls on every lookup against a permanently-broken
    //      slot when the fallback is already serving content).
    //   2. All loaders returned 'absent' -> intentional no-dict
    //      configuration; stick.
    //   3. Otherwise (everything failed, no content) -> leave
    //      loaded=false so the next lookup retries; a transient
    //      decode / build error shouldn't permanently dead-end the
    //      session.
    const haveAnyContent = baseDict !== null || customDict !== null;
    const anyFailed =
      baseOutcome.kind === 'failed' || customOutcome.kind === 'failed';
    if (haveAnyContent || !anyFailed) {
      loaded = true;
    }
  };

  return {
    async lookup(text: string): Promise<LookupResult> {
      ensureLoaded();
      const trimmed = text.trim();
      if (!trimmed) {
        return {found: false, queriedFor: text};
      }
      const customHit = customDict ? lookupDict(customDict, trimmed) : null;
      const hit = customHit ?? (baseDict ? lookupDict(baseDict, trimmed) : null);
      if (!hit) {
        return {found: false, queriedFor: text};
      }
      return {
        found: true,
        entry: {word: hit.canonicalWord, definition: hit.definition},
      };
    },
  };
};
