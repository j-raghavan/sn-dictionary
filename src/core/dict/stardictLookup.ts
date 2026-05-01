// StarDict-backed DictSource. Lazy-initialises the parsed dict on the
// first lookup so plugin startup stays cheap (no eager base64 decode +
// gunzip + index build before the user does anything).
//
// loadBase is async so the same factory works for both the bundled
// base dict (sync bytes wrapped in async) and runtime-discovered user
// dicts (three files fetched from external storage).

import type {DictEntry, DictSource} from '../lookup';
import {createLazyAsyncSource} from './lazyAsyncSource';
import {buildDict, lookupDict, type ParsedDict} from './stardict/stardictDict';

export type DictBytes = {
  ifo: Uint8Array;
  idx: Uint8Array;
  dict: Uint8Array;
  // Optional StarDict synonym index. If present, alternate spellings
  // / transliterations / inflected forms get merged into the lookup
  // map alongside the .idx headwords.
  syn?: Uint8Array;
};

export type LoadDictBytes = () => Promise<DictBytes | null>;

export type StardictLookupDeps = {
  name: string;
  loadBase: LoadDictBytes;
  logger?: {warn: (msg: string) => void};
};

const lookupParsed = (
  parsed: ParsedDict,
  word: string,
): DictEntry | null => {
  const hit = lookupDict(parsed, word);
  return hit ? {word: hit.canonicalWord, definition: hit.definition} : null;
};

export const createStardictLookup = (
  deps: StardictLookupDeps,
): DictSource =>
  createLazyAsyncSource<DictBytes, ParsedDict>({
    name: deps.name,
    // Preserve the long-standing "[stardict:<name>] ..." log prefix
    // so existing on-device logcat searches and tests keep working.
    logTag: `stardict:${deps.name}`,
    load: deps.loadBase,
    parse: bytes => buildDict(bytes.ifo, bytes.idx, bytes.dict, bytes.syn),
    lookup: lookupParsed,
    logger: deps.logger,
  });
