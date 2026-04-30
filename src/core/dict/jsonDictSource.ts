// JSON-backed DictSource. Two accepted shapes:
//
//   1. {"word": "definition", ...}
//   2. [{"word": "...", "definition": "..."}, ...]
//      (object keys are also accepted as {"headword", "def"} aliases
//      so users don't have to be precise about field names)
//
// Lookup is case-insensitive. First occurrence of a key wins.

import {decodeUtf8} from '../../sdk/utf8';
import type {DictEntry, DictSource} from '../lookup';
import {createLazyAsyncSource, type LoadBytes} from './lazyAsyncSource';

export type JsonDictDeps = {
  name: string;
  loadBytes: LoadBytes;
  // Default 10 MB. JSON dicts are usually small glossaries.
  maxBytes?: number;
  logger?: {warn: (msg: string) => void};
};

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

type ParsedJson = {
  index: Map<string, {word: string; definition: string}>;
};

const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

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

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const buildJson = (bytes: Uint8Array): ParsedJson => {
  const text = stripBom(decodeUtf8(bytes));
  const data: unknown = JSON.parse(text);
  const index = new Map<string, {word: string; definition: string}>();

  const insert = (word: string, definition: string): void => {
    const w = word.trim();
    if (w.length === 0) {
      return;
    }
    const key = w.toLowerCase();
    if (!index.has(key)) {
      index.set(key, {word: w, definition});
    }
  };

  if (Array.isArray(data)) {
    for (const row of data) {
      if (!isPlainObject(row)) {
        continue;
      }
      const w = pickHeadword(row);
      const d = pickDefinition(row);
      if (typeof w === 'string' && typeof d === 'string') {
        insert(w, d);
      }
    }
  } else if (isPlainObject(data)) {
    for (const [w, d] of Object.entries(data)) {
      if (typeof d === 'string') {
        insert(w, d);
      }
    }
  } else {
    throw new Error('JSON root must be an object map or an array of entries');
  }

  return {index};
};

const lookupJson = (parsed: ParsedJson, word: string): DictEntry | null => {
  const hit = parsed.index.get(word.toLowerCase());
  return hit ? {word: hit.word, definition: hit.definition} : null;
};

export const createJsonDictSource = (deps: JsonDictDeps): DictSource =>
  createLazyAsyncSource<ParsedJson>({
    name: deps.name,
    loadBytes: deps.loadBytes,
    parse: buildJson,
    lookup: lookupJson,
    maxBytes: deps.maxBytes ?? DEFAULT_MAX_BYTES,
    logger: deps.logger,
  });
