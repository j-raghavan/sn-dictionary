// StarDict-backed DictSource. Lazy-initialises the parsed dict on the
// first lookup so plugin startup stays cheap (no eager base64 decode +
// gunzip + index build before the user does anything).
//
// loadBase is async so the same factory works for both the bundled
// base dict (sync bytes wrapped in async) and runtime-discovered user
// dicts (three files fetched from external storage).
//
// Optional persistent index cache: when `cache` is provided, the
// parsed lookup index is written to it after the first parse and
// read back on subsequent loads. Hydrating from cache skips
// parseIdx + parseSyn + the per-entry normalizeKey pass — the
// dominant CPU cost on Wiktionary-class dicts (~60 s parse →
// ~1–5 s JSON deserialise + Map build). Cache validation uses
// idx and syn fingerprints so a replaced file invalidates cleanly.
// Any cache miss / invalidation transparently falls through to
// live parse + write-back, so a corrupted store can never block
// startup.

import type {DefinitionFormat, DictEntry, DictSource} from '../lookup';
import {createLazyAsyncSource} from './lazyAsyncSource';
import {buildDict, lookupDict, type ParsedDict} from './stardict/stardictDict';
import {createDictReader} from './stardict/dictReader';
import {
  buildEnvelope,
  cacheKeyForSource,
  decodeIndexCache,
  encodeIndexCache,
  fingerprintBytes,
  hydrateIndex,
} from './indexCache';
import type {IndexCacheStorage} from './indexCacheStorage';

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
  // Optional persistent index cache. See file header comment.
  cache?: IndexCacheStorage;
  logger?: {warn: (msg: string) => void; log?: (msg: string) => void};
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

const buildParsedFromCache = (
  bytes: DictBytes,
  envelope: ReturnType<typeof decodeIndexCache>,
): ParsedDict | null => {
  if (envelope === null) {
    return null;
  }
  const dictReader = createDictReader(bytes.dict);
  return {
    meta: envelope.meta,
    index: hydrateIndex(envelope),
    dictReader,
  };
};

export const createStardictLookup = (
  deps: StardictLookupDeps,
): DictSource => {
  const tag = `stardict:${deps.name}`;
  const cache = deps.cache;
  const cacheKey = cacheKeyForSource(deps.name);
  const log = deps.logger?.log ?? (() => {});
  const warn = deps.logger?.warn ?? (() => {});

  const parseWithCache = async (bytes: DictBytes): Promise<ParsedDict> => {
    const idxFp = fingerprintBytes(bytes.idx);
    const synFp =
      bytes.syn === undefined || bytes.syn.length === 0
        ? null
        : fingerprintBytes(bytes.syn);

    if (cache) {
      let raw: string | null = null;
      try {
        raw = await cache.getItem(cacheKey);
      } catch (e) {
        warn(
          `[${tag}] cache.getItem threw: ${(e as Error).message} — parsing live`,
        );
      }
      const envelope = decodeIndexCache(raw, idxFp, synFp);
      const fromCache = buildParsedFromCache(bytes, envelope);
      if (fromCache !== null) {
        log(`[${tag}] hydrated from cache (${envelope!.entries.length} entries)`);
        return fromCache;
      }
      // Cache miss / invalidation. We could log raw === null vs
      // envelope === null separately, but the only useful signal
      // for an operator is "we did the slow path"; both lead there.
      log(`[${tag}] cache miss — parsing live`);
    }

    const parsed = await buildDict(
      bytes.ifo,
      bytes.idx,
      bytes.dict,
      bytes.syn,
    );

    if (cache) {
      // Fire-and-forget write: a slow setItem must not block the
      // first lookup. setImmediate-equivalent via Promise.resolve so
      // the write runs after the current microtask.
      Promise.resolve().then(async () => {
        try {
          const envelope = buildEnvelope(parsed.meta, parsed.index, idxFp, synFp);
          await cache.setItem(cacheKey, encodeIndexCache(envelope));
          log(`[${tag}] cache written (${parsed.index.size} entries)`);
        } catch (e) {
          warn(
            `[${tag}] cache write threw: ${(e as Error).message} — next load will re-parse`,
          );
        }
      });
    }

    return parsed;
  };

  return createLazyAsyncSource<DictBytes, ParsedDict>({
    name: deps.name,
    // Preserve the long-standing "[stardict:<name>] ..." log prefix
    // so existing on-device logcat searches and tests keep working.
    logTag: tag,
    load: deps.loadBase,
    parse: parseWithCache,
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
};
