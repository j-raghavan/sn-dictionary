// StarDict-backed DictSource. Lazy-initialises the parsed dict on the
// first lookup so plugin startup stays cheap (no eager base64 decode +
// gunzip + index build before the user does anything).
//
// loadBase is async so the same factory works for both the bundled
// base dict (sync bytes wrapped in async) and runtime-discovered user
// dicts (three files fetched from external storage).

import type {DefinitionFormat, DictEntry, DictSource} from '../lookup';
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
  // Explicit format override. Used by the bundled WordNet base dict
  // (passes 'wordnet') so the popup parses senses. If omitted, the
  // format is auto-derived from the .ifo's sametypesequence.
  format?: DefinitionFormat;
  logger?: {warn: (msg: string) => void};
};

// StarDict spec: `sametypesequence=m` is plain UTF-8 text, `=h` is
// HTML, and several others (`x`, `y`, `n`, …) are dict-specific
// formats we don't currently render. Anything other than `h` falls
// back to plain text — the strings still display, just without
// structure.
const formatFromMeta = (meta: ParsedDict['meta']): DefinitionFormat => {
  if (meta.sametypesequence === 'h') {
    return 'html';
  }
  return 'plain';
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
    lookup: (parsed, word): DictEntry | null => {
      const hit = lookupDict(parsed, word);
      if (!hit) {
        return null;
      }
      const format = deps.format ?? formatFromMeta(parsed.meta);
      return {word: hit.canonicalWord, definition: hit.definition, format};
    },
    logger: deps.logger,
  });
