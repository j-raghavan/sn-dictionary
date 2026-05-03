// JSON-backed DictSource. Two accepted shapes:
//
//   1. {"word": "definition", ...}
//   2. [{"word": "...", "definition": "..."}, ...]
//      (object keys are also accepted as {"headword", "def"} aliases
//      so users don't have to be precise about field names)
//
// Lookup is case-insensitive. First occurrence of a key wins.
//
// Async + cooperative-yield: native JSON.parse runs in C++ and is
// fast even for MB-scale files, but the JS-side iteration that
// builds the lookup map is exactly the kind of long synchronous
// loop that freezes input on Hermes. We yield every YIELD_PERIOD
// entries — same discipline as CSV and StarDict.

import {decodeText} from '../../sdk/textDecode';
import type {DictEntry, DictSource} from '../lookup';
import {createLazyAsyncSource} from './lazyAsyncSource';
import type {LoadBytes} from './csvDictSource';
import {normalizeKey} from './normalizeKey';
import {shouldYield, yieldToEventLoop} from './yieldOften';

export type JsonDictDeps = {
  name: string;
  loadBytes: LoadBytes;
  // Default 10 MB. JSON dicts are usually small glossaries.
  maxBytes?: number;
  logger?: {warn: (msg: string) => void};
};

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

type JsonRow = {word: string; definition: string; phonetic?: string};

type ParsedJson = {
  index: Map<string, JsonRow>;
};

const pickHeadword = (row: Record<string, unknown>): string | undefined => {
  const candidates = ['word', 'headword', 'term', 'key'];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === 'string') {
      return v;
    }
  }
  return undefined;
};

const pickDefinition = (row: Record<string, unknown>): string | undefined => {
  const candidates = ['definition', 'def', 'meaning', 'value'];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === 'string') {
      return v;
    }
  }
  return undefined;
};

// Recognise the common spellings users (and AI agents asked to
// produce a glossary) reach for first. Whichever shows up first
// wins. Trimmed; empty strings are treated as absent.
const pickPhonetic = (row: Record<string, unknown>): string | undefined => {
  const candidates = ['phonetic', 'pronunciation', 'ipa', 'phon'];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const buildJson = async (bytes: Uint8Array): Promise<ParsedJson> => {
  // Three pre-iteration yields close every non-yieldable boundary in
  // this parser: decodeText (native TextDecoder), JSON.parse (native
  // C++ parse), and the single allocation that materialises the key
  // list before iteration starts. Each step is fast (tens of ms even
  // at 10 MB), but back-to-back without any yield between them they
  // can stack into a perceptible pause — and they sit BEFORE the
  // iteration's own yield gate, so the per-iteration discipline can't
  // recover the time. Yielding at every transition lets the popup
  // paint a "Loading…" placeholder and keeps tap input live.
  const text = decodeText(bytes);
  await yieldToEventLoop();
  const data: unknown = JSON.parse(text);
  await yieldToEventLoop();
  const index = new Map<string, JsonRow>();

  const insert = (word: string, definition: string, phonetic?: string): void => {
    const w = word.trim();
    if (w.length === 0) {
      return;
    }
    const key = normalizeKey(w);
    if (key.length > 0 && !index.has(key)) {
      const row: JsonRow = {word: w, definition};
      if (phonetic !== undefined) {
        row.phonetic = phonetic;
      }
      index.set(key, row);
    }
  };

  // Yield convention: every loop in this codebase yields on the
  // *count of iterations completed*, not the loop index. So
  // shouldYield(i + 1) here matches CSV's `shouldYield(rowIdx)` and
  // parseIdx's `shouldYield(entries.length)` — first yield fires
  // after exactly YIELD_PERIOD entries processed, regardless of
  // which loop you're in.
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (isPlainObject(row)) {
        const w = pickHeadword(row);
        const d = pickDefinition(row);
        const p = pickPhonetic(row);
        if (typeof w === 'string' && typeof d === 'string') {
          insert(w, d, p);
        }
      }
      if (shouldYield(i + 1)) {
        await yieldToEventLoop();
      }
    }
  } else if (isPlainObject(data)) {
    // Object.keys is one allocation of length N (string refs only),
    // ~3x lighter than Object.entries which builds N two-element
    // tuples. Yield right after so the only synchronous chunk in
    // this branch is the keys allocation itself.
    const keys = Object.keys(data);
    await yieldToEventLoop();
    for (let i = 0; i < keys.length; i++) {
      const w = keys[i];
      const d = data[w];
      if (typeof d === 'string') {
        insert(w, d);
      }
      if (shouldYield(i + 1)) {
        await yieldToEventLoop();
      }
    }
  } else {
    throw new Error('JSON root must be an object map or an array of entries');
  }

  return {index};
};

const lookupJson = (parsed: ParsedJson, word: string): DictEntry | null => {
  const hit = parsed.index.get(normalizeKey(word));
  if (!hit) {
    return null;
  }
  const entry: DictEntry = {
    word: hit.word,
    definition: hit.definition,
    format: 'plain',
  };
  if (hit.phonetic !== undefined) {
    entry.phonetic = hit.phonetic;
  }
  return entry;
};

export const createJsonDictSource = (deps: JsonDictDeps): DictSource => {
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  return createLazyAsyncSource<Uint8Array, ParsedJson>({
    name: deps.name,
    load: async () => {
      const buf = await deps.loadBytes();
      if (buf === null) {
        return null;
      }
      // Size cap is per-format (10 MB for JSON). The unified lazy
      // helper is format-agnostic; the check belongs here.
      if (buf.byteLength > maxBytes) {
        throw new Error(
          `file too large: ${buf.byteLength} bytes > ${maxBytes} cap`,
        );
      }
      return new Uint8Array(buf);
    },
    parse: buildJson,
    lookup: lookupJson,
    logger: deps.logger,
  });
};
