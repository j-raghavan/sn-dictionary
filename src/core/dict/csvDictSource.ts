// CSV-backed DictSource. Two columns by default: headword (col 0)
// and definition (col 1). Configurable for files with extra
// metadata columns — including an optional phonetic column that
// gets rendered under the headword in the popup. Quoted fields and
// embedded commas / newlines / escaped quotes are handled per RFC
// 4180.
//
// Lookup is case-insensitive. First occurrence of a key wins (later
// duplicates are ignored), matching StarDict's behaviour.

import {decodeText} from '../../sdk/textDecode';
import type {DictEntry, DictSource} from '../lookup';
import {createLazyAsyncSource} from './lazyAsyncSource';
import {normalizeKey} from './normalizeKey';

export type LoadBytes = () => Promise<ArrayBuffer | null>;

export type CsvDictDeps = {
  name: string;
  loadBytes: LoadBytes;
  // Column indices (0-based). Defaults: headword=0, definition=1.
  // phoneticCol is opt-in: a number selects that column as the
  // pronunciation field; omitted (or out-of-range / empty in a row)
  // means no phonetic. Set via meta.json by users whose CSVs carry
  // a third column (term, def, phonetic).
  headwordCol?: number;
  definitionCol?: number;
  phoneticCol?: number;
  // True = first row is a header and is skipped at parse time.
  hasHeader?: boolean;
  // Reject files larger than this. Default 10 MB. Tuned to the
  // bridge throughput we measured (~0.85 MB/s) so worst-case first
  // load completes in ~12 s.
  maxBytes?: number;
  logger?: {warn: (msg: string) => void};
};

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

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

type CsvRow = {word: string; definition: string; phonetic?: string};

type ParsedCsv = {
  // Lowercase headword -> {canonical word, definition, phonetic?}.
  index: Map<string, CsvRow>;
};

const buildCsv = (
  deps: Required<
    Pick<CsvDictDeps, 'headwordCol' | 'definitionCol' | 'hasHeader'>
  > & {phoneticCol: number | undefined},
) =>
  (bytes: Uint8Array): ParsedCsv => {
    const text = decodeText(bytes);
    const index = new Map<string, CsvRow>();
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
      const key = normalizeKey(word);
      if (key.length > 0 && !index.has(key)) {
        const row: CsvRow = {word, definition};
        if (deps.phoneticCol !== undefined) {
          const phonetic = next.row[deps.phoneticCol]?.trim() ?? '';
          if (phonetic.length > 0) {
            row.phonetic = phonetic;
          }
        }
        index.set(key, row);
      }
    }
    return {index};
  };

const lookupCsv = (parsed: ParsedCsv, word: string): DictEntry | null => {
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

export const createCsvDictSource = (deps: CsvDictDeps): DictSource => {
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const parseCsv = buildCsv({
    headwordCol: deps.headwordCol ?? 0,
    definitionCol: deps.definitionCol ?? 1,
    phoneticCol: deps.phoneticCol,
    hasHeader: deps.hasHeader ?? false,
  });
  return createLazyAsyncSource<Uint8Array, ParsedCsv>({
    name: deps.name,
    load: async () => {
      const buf = await deps.loadBytes();
      if (buf === null) {
        return null;
      }
      // Size cap is per-format (10 MB for CSV). The unified lazy
      // helper is format-agnostic; the check belongs here.
      if (buf.byteLength > maxBytes) {
        throw new Error(
          `file too large: ${buf.byteLength} bytes > ${maxBytes} cap`,
        );
      }
      return new Uint8Array(buf);
    },
    parse: parseCsv,
    lookup: lookupCsv,
    logger: deps.logger,
  });
};
