// Gesture-agnostic lookup contract. Two layers:
//
// - DictSource: a single dictionary backend (StarDict, future CSV /
//   JSON / MDX). Knows how to answer "does this word have an entry?".
// - DictLookup: what handlers consume — a registry over one or more
//   DictSources that fans out to every source and returns the union
//   of hits. The popup renders one section per hit when there are
//   ≥2; a single hit renders inline as before.

export type DictEntry = {
  word: string;
  definition: string;
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
};

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
