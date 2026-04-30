// StarDict-backed DictSource. Lazy-initialises the parsed dict on the
// first lookup so plugin startup stays cheap (no eager base64 decode +
// gunzip + index build before the user does anything).

import type {DictEntry, DictSource} from '../lookup';
import {buildDict, lookupDict, type ParsedDict} from './stardict/stardictDict';

export type DictBytes = {
  ifo: Uint8Array;
  idx: Uint8Array;
  dict: Uint8Array;
};

// Loaders are functions so the data source (build-time base64 blob,
// runtime fetch from external storage, etc.) can be swapped without
// touching this file.
export type LoadDictBytes = () => DictBytes | null;

export type StardictLookupDeps = {
  name: string;
  loadBase: LoadDictBytes;
  logger?: {warn: (msg: string) => void};
};

// Internal load outcome.
//   - 'success' -> dict is non-null
//   - 'absent'  -> loader intentionally returned null (no dict for
//                  this slot — sticky, do not retry)
//   - 'failed'  -> loader or buildDict threw — leave loaded=false so
//                  the next lookup retries (transient errors must
//                  not permanently dead-end the session)
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
    return {
      kind: 'success',
      dict: buildDict(bytes.ifo, bytes.idx, bytes.dict),
    };
  } catch (e) {
    warn(`[${tag}] buildDict threw: ${(e as Error).message}`);
    return {kind: 'failed'};
  }
};

export const createStardictLookup = (
  deps: StardictLookupDeps,
): DictSource => {
  const warn = deps.logger?.warn ?? (() => {});
  const tag = `stardict:${deps.name}`;
  let dict: ParsedDict | null = null;
  let loaded = false;

  const ensureLoaded = (): void => {
    if (loaded) {
      return;
    }
    const outcome = safeBuild(deps.loadBase, tag, warn);
    if (outcome.kind === 'success') {
      dict = outcome.dict;
      loaded = true;
    } else if (outcome.kind === 'absent') {
      // Intentional opt-out — stick so we don't burn loader calls.
      loaded = true;
    }
    // 'failed' leaves loaded=false; next lookup retries.
  };

  return {
    name: deps.name,
    async lookup(word: string): Promise<DictEntry | null> {
      ensureLoaded();
      const trimmed = word.trim();
      if (!trimmed || dict === null) {
        return null;
      }
      const hit = lookupDict(dict, trimmed);
      if (!hit) {
        return null;
      }
      return {word: hit.canonicalWord, definition: hit.definition};
    },
  };
};
