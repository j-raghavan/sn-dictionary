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
