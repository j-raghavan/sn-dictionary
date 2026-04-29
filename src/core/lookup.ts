// Gesture-agnostic lookup contract. The runtime implementation lives
// in src/core/dict/stardictLookup.ts.

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
