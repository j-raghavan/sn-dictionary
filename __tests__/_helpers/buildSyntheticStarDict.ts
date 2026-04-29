// Synthesises a minimal StarDict triple in memory for tests.
// Always emits idxoffsetbits=32 + sametypesequence=m (the most common
// shape, what our build pipeline will produce). The caller can request
// gzip wrapping to exercise the dictzip-decompression path.

import pako from 'pako';

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

export type SyntheticStarDict = {
  ifo: Uint8Array;
  idx: Uint8Array;
  dict: Uint8Array;
};

export type BuildOptions = {
  bookname?: string;
  gzipDict?: boolean;
};

export const buildSyntheticStarDict = (
  entries: Record<string, string>,
  options: BuildOptions = {},
): SyntheticStarDict => {
  const sortedWords = Object.keys(entries).sort();
  const dictParts: Uint8Array[] = [];
  const idxBuilder: number[] = [];
  const encoder = new TextEncoder();
  let offset = 0;
  for (const word of sortedWords) {
    const def = entries[word];
    const defBytes = encoder.encode(def);
    const wordBytes = encoder.encode(word);
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
    `bookname=${options.bookname ?? 'Test'}\n` +
    `wordcount=${sortedWords.length}\n` +
    `idxfilesize=${idx.length}\n` +
    'idxoffsetbits=32\n' +
    'sametypesequence=m\n';
  const ifo = encoder.encode(ifoText);
  return {ifo, idx, dict};
};
