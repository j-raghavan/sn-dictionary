// Wire-format encoder + decoder for the cached parsed StarDict
// index. Cache hits skip parseIdx + parseSyn + the index-build pass
// — the dominant CPU cost on first lookup of a Wiktionary-class
// dict (~60 s of parse → ~5 s of JSON.parse + Map build on Hermes).
//
// We only cache the lookup-key → (canonicalWord, offset, length)
// table. The .dict / .dict.dz body is NOT cached: the dictzip RA
// reader rebuilds its chunk index from the gzip header in
// milliseconds, and caching the body would multiply storage cost
// for no useful gain.
//
// Validation: every cached payload is fingerprinted with the
// idx-bytes length + first/last 64 bytes (hex). If the user
// replaces fr-en-strdict.idx the fingerprint mismatches and we
// fall through to live parse. .syn is fingerprinted independently
// so dropping in a new synonym file invalidates the cache cleanly.

import type {IfoMeta} from './stardict/parseIfo';
import type {IdxEntry} from './stardict/parseIdx';

const SCHEMA_VERSION = 1 as const;

export type CachedIndexEntry = [
  // Pre-normalised lookup key (case-folded, NFC).
  string,
  // Canonical headword (rendered as the popup's word title).
  string,
  // .dict offset (bytes).
  number,
  // .dict length (bytes).
  number,
];

export type CachedIndexEnvelope = {
  readonly version: typeof SCHEMA_VERSION;
  readonly idxFingerprint: string;
  readonly synFingerprint: string | null;
  readonly meta: IfoMeta;
  readonly entries: readonly CachedIndexEntry[];
};

const HEAD_TAIL_BYTES = 64;

// Length + hex(head) + hex(tail) — enough to detect any plausible
// dictionary swap. Not cryptographic; collision risk is negligible
// in practice (the user would need a different dict whose .idx had
// the same length AND the same first 64 + last 64 bytes).
export const fingerprintBytes = (bytes: Uint8Array | undefined): string => {
  if (bytes === undefined) {
    return 'absent';
  }
  if (bytes.length === 0) {
    return 'empty';
  }
  const toHex = (b: Uint8Array): string =>
    Array.from(b, n => n.toString(16).padStart(2, '0')).join('');
  const head = toHex(bytes.subarray(0, Math.min(HEAD_TAIL_BYTES, bytes.length)));
  if (bytes.length <= HEAD_TAIL_BYTES * 2) {
    return `${bytes.length}:${head}`;
  }
  const tail = toHex(bytes.subarray(bytes.length - HEAD_TAIL_BYTES));
  return `${bytes.length}:${head}:${tail}`;
};

export const encodeIndexCache = (envelope: CachedIndexEnvelope): string =>
  JSON.stringify(envelope);

// Returns the validated envelope on success, null on any of:
//   - JSON parse failure
//   - missing / wrong schema version
//   - shape mismatch
//   - fingerprint mismatch against the live idx / syn bytes
// Any "soft" cache invalidation lands here; the caller re-parses.
export const decodeIndexCache = (
  raw: string | null,
  expectedIdxFingerprint: string,
  expectedSynFingerprint: string | null,
): CachedIndexEnvelope | null => {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const env = parsed as Partial<CachedIndexEnvelope>;
  if (env.version !== SCHEMA_VERSION) {
    return null;
  }
  if (env.idxFingerprint !== expectedIdxFingerprint) {
    return null;
  }
  // Treat undefined and null as the same "no syn" signal so older
  // payloads written before the syn-fingerprint field existed don't
  // need a migration.
  if ((env.synFingerprint ?? null) !== expectedSynFingerprint) {
    return null;
  }
  if (!env.meta || typeof env.meta !== 'object') {
    return null;
  }
  if (!Array.isArray(env.entries)) {
    return null;
  }
  return env as CachedIndexEnvelope;
};

// Hydrate the lookup Map from cached entries — same shape that
// stardictDict.buildDict would have built, just skipped the parse
// and the per-entry normalizeKey + Map.set work.
export const hydrateIndex = (
  envelope: CachedIndexEnvelope,
): Map<string, IdxEntry> => {
  const index = new Map<string, IdxEntry>();
  for (const [key, word, offset, length] of envelope.entries) {
    if (!index.has(key)) {
      index.set(key, {word, offset, length});
    }
  }
  return index;
};

// Build a CachedIndexEnvelope from a freshly-parsed index. Iterates
// the live Map in insertion order so the cache write produces
// stable bytes for a given dict.
export const buildEnvelope = (
  meta: IfoMeta,
  index: Map<string, IdxEntry>,
  idxFingerprint: string,
  synFingerprint: string | null,
): CachedIndexEnvelope => {
  const entries: CachedIndexEntry[] = [];
  for (const [key, entry] of index) {
    entries.push([key, entry.word, entry.offset, entry.length]);
  }
  return {
    version: SCHEMA_VERSION,
    idxFingerprint,
    synFingerprint,
    meta,
    entries,
  };
};

export const cacheKeyForSource = (sourceName: string): string =>
  `@sndict_index:${sourceName}`;
