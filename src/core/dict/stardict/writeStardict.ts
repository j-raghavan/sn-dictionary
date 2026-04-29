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
};

export const writeStarDict = (
  entries: Record<string, string>,
  options: WriteOptions = {},
): StarDictBytes => {
  // .idx is sorted by case-sensitive byte order in the StarDict spec.
  const sortedWords = Object.keys(entries).sort();
  const dictParts: Uint8Array[] = [];
  const idxBuilder: number[] = [];
  let offset = 0;
  for (const word of sortedWords) {
    const def = entries[word];
    const defBytes = encodeUtf8(def);
    const wordBytes = encodeUtf8(word);
    for (const b of wordBytes) {
      idxBuilder.push(b);
    }
    idxBuilder.push(0);
    writeU32BE(idxBuilder, offset);
    writeU32BE(idxBuilder, defBytes.length);
    dictParts.push(defBytes);
    offset += defBytes.length;
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
    'sametypesequence=m\n';
  const ifo = encodeUtf8(ifoText);
  return {ifo, idx, dict};
};
