// StarDict `.syn` (synonym index) parser.
// Format: a packed sequence of records:
//   word (UTF-8) \0 original_word_index (4 bytes big-endian unsigned)
//
// `original_word_index` is the 0-based ordinal of an entry in the
// sorted `.idx` list. A `.syn` entry maps an alternate spelling /
// transliteration / inflected form to the canonical .idx entry, so
// looking up the synonym should resolve to the same .dict definition.
//
// `.syn` is optional in StarDict; many dicts omit it. Its presence is
// load-bearing for cross-script lookups (e.g. Wiktionary Hindi-English
// keeps Devanagari headwords in `.idx` and Latin transliterations in
// `.syn` — without reading `.syn`, "namaste" would never match the
// नमस्ते entry).

import {decodeUtf8} from '../../../sdk/utf8';

export type SynEntry = {
  word: string;
  // Index into the parsed .idx entries array (0-based).
  originalWordIndex: number;
};

export const parseSyn = (bytes: Uint8Array): SynEntry[] => {
  const entries: SynEntry[] = [];
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  let i = 0;
  while (i < bytes.length) {
    let end = i;
    while (end < bytes.length && bytes[end] !== 0) {
      end++;
    }
    if (end >= bytes.length) {
      throw new Error('parseSyn: unterminated word at end of buffer');
    }
    if (end === i) {
      throw new Error(`parseSyn: empty word at offset ${i}`);
    }
    if (end + 1 + 4 > bytes.length) {
      throw new Error(
        `parseSyn: truncated record after word at offset ${i}`,
      );
    }
    const word = decodeUtf8(bytes.subarray(i, end));
    const originalWordIndex = view.getUint32(end + 1, false);
    entries.push({word, originalWordIndex});
    i = end + 1 + 4;
  }
  return entries;
};
