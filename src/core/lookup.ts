// Gesture-agnostic lookup contract. Two layers:
//
// - DictSource: a single dictionary backend (StarDict, future CSV /
//   JSON / MDX). Knows how to answer "does this word have an entry?".
// - DictLookup: what handlers consume — a registry over one or more
//   DictSources that produces a single LookupResult. Step 1 keeps
//   first-match-wins semantics; Step 2 will broaden the result shape
//   to surface every matching source.

export type DictEntry = {
  word: string;
  definition: string;
};

export type LookupResult =
  | {found: true; entry: DictEntry}
  | {found: false; queriedFor: string};

export interface DictLookup {
  lookup(text: string): Promise<LookupResult>;
}

// A single dict source. The registry composes many of these. Keep
// the shape minimal: a name (for popup labelling and logs) and a
// `lookup` that returns the matched entry or null.
export interface DictSource {
  readonly name: string;
  lookup(word: string): Promise<DictEntry | null>;
}
