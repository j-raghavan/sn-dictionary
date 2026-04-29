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

const safeBuild = (
  loader: LoadDictBytes,
  tag: string,
  warn: (msg: string) => void,
): ParsedDict | null => {
  let bytes: DictBytes | null;
  try {
    bytes = loader();
  } catch (e) {
    warn(`[${tag}] loader threw: ${(e as Error).message}`);
    return null;
  }
  if (!bytes) {
    return null;
  }
  try {
    return buildDict(bytes.ifo, bytes.idx, bytes.dict);
  } catch (e) {
    warn(`[${tag}] buildDict threw: ${(e as Error).message}`);
    return null;
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
    baseDict = safeBuild(deps.loadBase, 'stardict:base', warn);
    if (deps.loadCustom) {
      customDict = safeBuild(deps.loadCustom, 'stardict:custom', warn);
    }
    loaded = true;
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
