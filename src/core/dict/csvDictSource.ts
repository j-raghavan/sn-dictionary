// CSV-backed DictSource. Two columns by default: headword (col 0)
// and definition (col 1). Configurable for files with extra
// metadata columns. Quoted fields and embedded commas / newlines /
// escaped quotes are handled per RFC 4180.
//
// Lookup is case-insensitive. First occurrence of a key wins (later
// duplicates are ignored), matching StarDict's behaviour.

import {decodeUtf8} from '../../sdk/utf8';
import type {DictEntry, DictSource} from '../lookup';
import {createLazyAsyncSource, type LoadBytes} from './lazyAsyncSource';

export type CsvDictDeps = {
  name: string;
  loadBytes: LoadBytes;
  // Column indices (0-based). Defaults: headword=0, definition=1.
  headwordCol?: number;
  definitionCol?: number;
  // True = first row is a header and is skipped at parse time.
  hasHeader?: boolean;
  // Reject files larger than this. Default 10 MB. Tuned to the
  // bridge throughput we measured (~0.85 MB/s) so worst-case first
  // load completes in ~12 s.
  maxBytes?: number;
  logger?: {warn: (msg: string) => void};
};

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

// Minimal RFC 4180-style CSV row parser. Caller guarantees
// `start < s.length`. Handles:
//   - quoted fields with "" -> "
//   - embedded commas and newlines inside quotes
//   - \r\n and \n row terminators
//   - trailing rows without a final newline
const parseRow = (
  s: string,
  start: number,
): {row: string[]; next: number} => {
  const row: string[] = [];
  let i = start;
  for (;;) {
    let field = '';
    if (s.charCodeAt(i) === 0x22 /* " */) {
      i++;
      while (i < s.length) {
        const c = s.charCodeAt(i);
        if (c === 0x22) {
          if (s.charCodeAt(i + 1) === 0x22) {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          field += s[i];
          i++;
        }
      }
    } else {
      while (i < s.length) {
        const c = s.charCodeAt(i);
        if (c === 0x2c /* , */ || c === 0x0a /* \n */ || c === 0x0d /* \r */) {
          break;
        }
        field += s[i];
        i++;
      }
    }
    row.push(field);
    if (i >= s.length) {
      return {row, next: i};
    }
    const c = s.charCodeAt(i);
    if (c === 0x2c) {
      i++;
      continue;
    }
    if (c === 0x0d) {
      i++;
      if (s.charCodeAt(i) === 0x0a) {
        i++;
      }
      return {row, next: i};
    }
    // c === 0x0a (last delimiter possibility)
    i++;
    return {row, next: i};
  }
};

type ParsedCsv = {
  // Lowercase headword -> {canonical word, definition}.
  index: Map<string, {word: string; definition: string}>;
};

const buildCsv = (
  deps: Required<Pick<CsvDictDeps, 'headwordCol' | 'definitionCol' | 'hasHeader'>>,
) =>
  (bytes: Uint8Array): ParsedCsv => {
    const text = stripBom(decodeUtf8(bytes));
    const index = new Map<string, {word: string; definition: string}>();
    let cursor = 0;
    let rowIdx = 0;
    while (cursor < text.length) {
      const next = parseRow(text, cursor);
      cursor = next.next;
      if (deps.hasHeader && rowIdx === 0) {
        rowIdx++;
        continue;
      }
      rowIdx++;
      const word = next.row[deps.headwordCol]?.trim() ?? '';
      const definition = next.row[deps.definitionCol] ?? '';
      if (word.length === 0) {
        continue;
      }
      const key = word.toLowerCase();
      if (!index.has(key)) {
        index.set(key, {word, definition});
      }
    }
    return {index};
  };

const lookupCsv = (parsed: ParsedCsv, word: string): DictEntry | null => {
  const hit = parsed.index.get(word.toLowerCase());
  return hit ? {word: hit.word, definition: hit.definition} : null;
};

export const createCsvDictSource = (deps: CsvDictDeps): DictSource =>
  createLazyAsyncSource<ParsedCsv>({
    name: deps.name,
    loadBytes: deps.loadBytes,
    parse: buildCsv({
      headwordCol: deps.headwordCol ?? 0,
      definitionCol: deps.definitionCol ?? 1,
      hasHeader: deps.hasHeader ?? false,
    }),
    lookup: lookupCsv,
    maxBytes: deps.maxBytes ?? DEFAULT_MAX_BYTES,
    logger: deps.logger,
  });
