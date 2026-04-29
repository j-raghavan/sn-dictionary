// Gesture-agnostic lookup contract. Spike 3 swaps the mock implementation
// for a js-mdict-backed reader; the surrounding handlers are unchanged.

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

const MOCK_ENTRIES: Record<string, string> = {
  hello: 'A greeting or expression of welcome.',
  world: 'The earth, together with all of its countries and peoples.',
  define: 'To state or describe exactly the meaning of something.',
};

export const mockLookup: DictLookup = {
  async lookup(text: string): Promise<LookupResult> {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return {found: false, queriedFor: text};
    }
    const definition = MOCK_ENTRIES[normalized];
    if (definition) {
      return {found: true, entry: {word: normalized, definition}};
    }
    return {found: false, queriedFor: text};
  },
};
