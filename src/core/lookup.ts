// Gesture-agnostic lookup contract. Two layers:
//
// - DictSource: a single dictionary backend (StarDict, future CSV /
//   JSON / MDX). Knows how to answer "does this word have an entry?".
// - DictLookup: what handlers consume — a registry over one or more
//   DictSources that fans out to every source and returns the union
//   of hits. The popup renders one section per hit when there are
//   ≥2; a single hit renders inline as before.

// How a definition's body should be rendered.
//
//   'wordnet' — looks like a Princeton WordNet entry. The popup
//               parses senses + POS + examples + synonyms and renders
//               them as discrete blocks.
//   'html'    — body contains HTML markup (StarDicts with
//               sametypesequence=h, or any source that knowingly
//               emits HTML). The popup strips tags + decodes
//               entities and renders as plain text.
//   'plain'   — neither of the above. Render the string verbatim.
//
// Sources set this at lookup time based on what they know about
// their content, instead of the popup guessing per render.
export type DefinitionFormat = 'wordnet' | 'html' | 'plain';

export type DictEntry = {
  word: string;
  definition: string;
  format: DefinitionFormat;
  // Optional phonetic transcription (IPA, respelling, Herbert-style
  // syllable stress markers, etc.). Sources fill this when the data
  // they read carries a separate pronunciation field; the popup
  // renders it under the headword. Absent for sources that only
  // know word + definition.
  phonetic?: string;
};

// One source's contribution to the result. `source` is the name of
// the DictSource that produced this hit (used for popup section
// labelling and logs).
export type SourceHit = {
  source: string;
  entry: DictEntry;
};

export type LookupResult = {
  queriedFor: string;
  hits: SourceHit[];
  // Names of sources whose lookup hasn't resolved yet at the moment
  // this snapshot was taken. Empty in the final result. Populated for
  // intermediate snapshots emitted via the optional onUpdate callback,
  // and at the moment of an initial-empty emission so the popup can
  // render placeholder sections instead of blocking on the slowest
  // source.
  loading: string[];
};

// Optional progress callback. Called with an interim snapshot at
// least once before the final resolution: an initial empty-hits
// snapshot listing all sources as loading (so the popup can open
// instantly), then once per source resolution. Errors thrown from
// onUpdate are swallowed — the lookup pipeline must not depend on
// the listener.
export type LookupOnUpdate = (snapshot: LookupResult) => void;

export interface DictLookup {
  lookup(text: string, onUpdate?: LookupOnUpdate): Promise<LookupResult>;
}

// A single dict source. The registry composes many of these. Keep
// the shape minimal: a name (for popup labelling and logs), a
// `lookup` that returns the matched entry or null, plus optional
// warm-up hooks the registry uses to prime sources off the lookup
// path so a user's first tap doesn't pay parse cost.
//
//   prime()  — kick off load+parse in the background. Idempotent
//              (safe to call repeatedly; the lazy harness memoises
//              the in-flight promise). Resolves once the source is
//              ready, absent, or has failed once. Never throws.
//   status() — synchronous snapshot the popup uses to render a
//              "Loading…" placeholder section while a source primes.
//              'absent' is sticky; 'failed' flips back to 'idle' on
//              the next attempt so transient failures retry.
export type DictSourceStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'absent'
  | 'failed';

export interface DictSource {
  readonly name: string;
  lookup(word: string): Promise<DictEntry | null>;
  // Optional so non-lazy sources (synchronous, in-memory, tests) can
  // skip the contract entirely. The registry treats absence as
  // 'ready' — nothing to warm up.
  prime?(): Promise<void>;
  status?(): DictSourceStatus;
}
