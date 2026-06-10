// Source-of-truth StarDict writer. Used by:
//   - tests, via __tests__/_helpers/buildSyntheticStarDict.ts (re-export)
//   - the placeholder base dict builder at src/core/dict/data/
//   - any future build-time script that emits baseDictData.ts from a
//     larger source (e.g. WordNet)
// Always emits idxoffsetbits=32 + sametypesequence=m, which is what
// our reader expects and what the build pipeline produces.

import pako from 'pako';
import {encodeUtf8} from '../../../sdk/utf8';

const writeU32BE = (target: number[], value: number): void => {
  // Bitwise ops here are the natural way to pack a u32 big-endian.
  /* eslint-disable no-bitwise */
  target.push(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
  /* eslint-enable no-bitwise */
};

export type StarDictBytes = {
  ifo: Uint8Array;
  idx: Uint8Array;
  dict: Uint8Array;
};

export type WriteOptions = {
  bookname?: string;
  // Wrap the .dict in a single-block gzip stream so the runtime
  // exercises the .dict.dz inflate path. Off by default for tests
  // that want deterministic raw bytes.
  gzipDict?: boolean;
  // StarDict spec field controlling the body format. 'm' = plain
  // UTF-8 text (default), 'h' = HTML, others are dict-specific.
  // The reader picks rendering based on this field.
  sametypesequence?: string;
  // Emit the "sametypesequence-absent" .dict layout that StarDicts in
  // the wild use when entries can carry mixed types: NO sametypesequence
  // line in the .ifo, each entry's payload prefixed with a single ASCII
  // type char byte (default 'm'), and a 0x00 terminator after every
  // entry EXCEPT the last. Lets tests reproduce the issue-#28 layout the
  // splitDictEntry helper must handle. The default (sts-present) path is
  // unaffected and stays byte-identical.
  omitSametypesequence?: boolean;
  // Per-word type char used in the omit-sametypesequence layout. Words
  // not listed default to 'm'. Ignored when omitSametypesequence is off.
  perEntryType?: Record<string, string>;
};

export const writeStarDict = (
  entries: Record<string, string>,
  options: WriteOptions = {},
): StarDictBytes => {
  // .idx is sorted by case-sensitive byte order in the StarDict spec.
  const sortedWords = Object.keys(entries).sort();
  const omitSts = options.omitSametypesequence === true;
  const dictParts: Uint8Array[] = [];
  const idxBuilder: number[] = [];
  let offset = 0;
  for (let w = 0; w < sortedWords.length; w++) {
    const word = sortedWords[w];
    const def = entries[word];
    const defBytes = encodeUtf8(def);
    const wordBytes = encodeUtf8(word);
    for (const b of wordBytes) {
      idxBuilder.push(b);
    }
    idxBuilder.push(0);
    // sts-absent layout: prefix a single type-char byte, then append a
    // 0x00 terminator after every entry EXCEPT the last (mirrors the
    // real-world StarDicts splitDictEntry must parse). The .idx length
    // covers the prefix + payload + terminator so a reader slices the
    // whole record. sts-present layout is byte-identical to before.
    let entryBytes = defBytes;
    if (omitSts) {
      const typeChar = options.perEntryType?.[word] ?? 'm';
      const prefix = encodeUtf8(typeChar);
      const isLast = w === sortedWords.length - 1;
      const trailer = isLast ? 0 : 1;
      entryBytes = new Uint8Array(prefix.length + defBytes.length + trailer);
      entryBytes.set(prefix, 0);
      entryBytes.set(defBytes, prefix.length);
      // Trailing byte is left as the zero-initialized 0x00 when present.
    }
    writeU32BE(idxBuilder, offset);
    writeU32BE(idxBuilder, entryBytes.length);
    dictParts.push(entryBytes);
    offset += entryBytes.length;
  }
  const totalDict = dictParts.reduce((s, p) => s + p.length, 0);
  const rawDict = new Uint8Array(totalDict);
  let pos = 0;
  for (const p of dictParts) {
    rawDict.set(p, pos);
    pos += p.length;
  }
  const dict = options.gzipDict ? pako.gzip(rawDict) : rawDict;
  const idx = new Uint8Array(idxBuilder);
  const ifoText =
    "StarDict's dict ifo file\n" +
    'version=2.4.2\n' +
    `bookname=${options.bookname ?? 'Base'}\n` +
    `wordcount=${sortedWords.length}\n` +
    `idxfilesize=${idx.length}\n` +
    'idxoffsetbits=32\n' +
    // sts-absent layout omits the sametypesequence line entirely (the
    // type char lives per-entry in the .dict). Default keeps the line.
    (omitSts ? '' : `sametypesequence=${options.sametypesequence ?? 'm'}\n`);
  const ifo = encodeUtf8(ifoText);
  return {ifo, idx, dict};
};
