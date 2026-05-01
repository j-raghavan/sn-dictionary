// StarDict-backed DictSource. Lazy-initialises the parsed dict on the
// first lookup so plugin startup stays cheap (no eager base64 decode +
// gunzip + index build before the user does anything).
//
// loadBase is async so the same factory works for both the bundled
// base dict (sync bytes wrapped in async) and runtime-discovered user
// dicts (three files fetched from external storage).

import type {DictEntry, DictSource} from '../lookup';
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

export const createStardictLookup = (
  deps: StardictLookupDeps,
): DictSource => {
  const warn = deps.logger?.warn ?? (() => {});
  const tag = `stardict:${deps.name}`;
  let dict: ParsedDict | null = null;
  let absent = false;
  let inFlight: Promise<void> | null = null;

  const doLoad = async (): Promise<void> => {
    let bytes: DictBytes | null;
    try {
      bytes = await deps.loadBase();
    } catch (e) {
      warn(`[${tag}] loader threw: ${(e as Error).message}`);
      throw e;
    }
    if (bytes === null) {
      // Intentional opt-out — stick so we don't burn loader calls.
      absent = true;
      return;
    }
    try {
      dict = buildDict(bytes.ifo, bytes.idx, bytes.dict, bytes.syn);
    } catch (e) {
      warn(`[${tag}] buildDict threw: ${(e as Error).message}`);
      throw e;
    }
  };

  const ensureLoaded = async (): Promise<void> => {
    if (dict !== null || absent) {
      return;
    }
    // Memoise the in-flight promise so concurrent first lookups share
    // one underlying load+parse pass. Clear on settle so a failed
    // attempt can be retried by the NEXT lookup (not by the racing
    // concurrent ones — they all observe the same failure here).
    if (inFlight === null) {
      inFlight = doLoad().finally(() => {
        inFlight = null;
      });
    }
    try {
      await inFlight;
    } catch {
      // observe via dict===null below
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
      if (dict === null) {
        return null;
      }
      const hit = lookupDict(dict, trimmed);
      return hit ? {word: hit.canonicalWord, definition: hit.definition} : null;
    },
  };
};
