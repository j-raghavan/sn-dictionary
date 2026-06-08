// RFC-4180 CSV row parser — ported VERBATIM from the v1.x in-memory CSV
// engine (master:src/core/dict/csvDictSource.ts) so CSV sideload stays
// byte-for-byte backward-compatible (ADR-0008). The old test suite is
// the contract: parseRow + the row-stream semantics are unchanged.
//
// Output rows: word is TRIMMED; definition is NOT trimmed (leading/
// trailing whitespace preserved exactly — e.g. Dune's "ABA, loose
// robe…" yields definition " loose robe…"); phonetic (when configured)
// is trimmed and only present when non-empty. Empty-headword rows are
// skipped. Key folding (normalizeKey) + first-wins dedupe happen
// DOWNSTREAM (at insert time) — this parser stays pure on the decoded
// string.
//
// Async + cooperative-yield: a multi-MB CSV means ~100k iterations; on
// Hermes the JS thread runs everything, so we yield to the event loop
// every YIELD_PERIOD rows (same discipline as the StarDict parsers) so
// the popup paints and tap input stays live during first load. A yield
// also fires right after decodeText (the boundary between the native
// TextDecoder and the JS iteration).

import {decodeText} from '../../sdk/textDecode';
import {shouldYield, yieldToEventLoop} from './yieldOften';

export type CsvParseConfig = {
  // Column indices (0-based). Defaults: headword=0, definition=1.
  headwordCol?: number;
  definitionCol?: number;
  // Opt-in pronunciation column.
  phoneticCol?: number;
  // True = first row is a header and is skipped.
  hasHeader?: boolean;
};

export type CsvRow = {word: string; definition: string; phonetic?: string};

// Minimal RFC 4180-style CSV row parser. Caller guarantees
// `start < s.length`. Handles:
//   - quoted fields with "" -> "
//   - embedded commas and newlines inside quotes
//   - \r\n and \n row terminators
//   - lone \r (legacy Mac) row terminators
//   - trailing rows without a final newline
export const parseRow = (
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

// Decode the bytes (CP1252/UTF-16/BOM via decodeText) and walk the rows.
// Returns the parsed CsvRows in file order (caller dedupes by folded key,
// first-wins). Skips empty-headword rows; an out-of-range definition/
// phonetic col yields '' / no-phonetic (not a crash).
export const parseCsvRows = async (
  bytes: Uint8Array,
  config: CsvParseConfig = {},
): Promise<CsvRow[]> => {
  const headwordCol = config.headwordCol ?? 0;
  const definitionCol = config.definitionCol ?? 1;
  const phoneticCol = config.phoneticCol;
  const hasHeader = config.hasHeader ?? false;

  // decodeText runs the native TextDecoder over the full buffer in one
  // synchronous chunk; a yield here bounds the worst-case pre-iteration
  // pause so anything queued (popup paint) lands before the row loop.
  const text = decodeText(bytes);
  await yieldToEventLoop();

  const rows: CsvRow[] = [];
  let cursor = 0;
  let rowIdx = 0;
  while (cursor < text.length) {
    const next = parseRow(text, cursor);
    cursor = next.next;
    if (hasHeader && rowIdx === 0) {
      rowIdx++;
      continue;
    }
    rowIdx++;
    const word = next.row[headwordCol]?.trim() ?? '';
    const definition = next.row[definitionCol] ?? '';
    if (word.length > 0) {
      const out: CsvRow = {word, definition};
      if (phoneticCol !== undefined) {
        const phonetic = next.row[phoneticCol]?.trim() ?? '';
        if (phonetic.length > 0) {
          out.phonetic = phonetic;
        }
      }
      rows.push(out);
    }
    // Yield based on rows *seen* (rowIdx), not entries kept, so a file
    // full of skipped/duplicate rows still yields on schedule.
    if (shouldYield(rowIdx)) {
      await yieldToEventLoop();
    }
  }
  return rows;
};
