// StarDict `.ifo` header parser.
// Format: UTF-8, INI-like `key=value` lines. The first line ("StarDict's
// dict ifo file") is a magic header and is ignored. We extract only
// the fields the runtime needs; everything else is preserved as-is in
// the rawFields map for diagnostics.

import {decodeUtf8} from '../../../sdk/utf8';

export type IfoMeta = {
  bookname?: string;
  wordcount: number;
  synwordcount?: number;
  idxfilesize?: number;
  // 32 = 4-byte offsets in .idx (default); 64 = 8-byte for very large
  // dictionaries. Anything else is rejected as malformed.
  idxoffsetbits: 32 | 64;
  // If present, all entries in .dict use this single type sequence and
  // the .dict bytes for an entry are exactly its raw payload (no
  // type prefix). The most common value is 'm' (pure UTF-8 text).
  sametypesequence?: string;
  rawFields: Record<string, string>;
};

export const parseIfo = (bytes: Uint8Array): IfoMeta => {
  const text = decodeUtf8(bytes);
  const lines = text.split(/\r?\n/);
  const map: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1);
    if (k) {
      map[k] = v;
    }
  }
  const wordcountRaw = map.wordcount;
  const wordcount = wordcountRaw ? parseInt(wordcountRaw, 10) : NaN;
  if (!Number.isFinite(wordcount) || wordcount <= 0) {
    throw new Error('parseIfo: missing or invalid wordcount');
  }
  const idxoffsetbitsRaw = map.idxoffsetbits;
  let idxoffsetbits: 32 | 64 = 32;
  if (idxoffsetbitsRaw !== undefined && idxoffsetbitsRaw !== '') {
    if (idxoffsetbitsRaw === '32') {
      idxoffsetbits = 32;
    } else if (idxoffsetbitsRaw === '64') {
      idxoffsetbits = 64;
    } else {
      throw new Error(
        `parseIfo: idxoffsetbits must be 32 or 64, got "${idxoffsetbitsRaw}"`,
      );
    }
  }
  return {
    bookname: map.bookname,
    wordcount,
    synwordcount: map.synwordcount
      ? parseInt(map.synwordcount, 10)
      : undefined,
    idxfilesize: map.idxfilesize ? parseInt(map.idxfilesize, 10) : undefined,
    idxoffsetbits,
    sametypesequence: map.sametypesequence,
    rawFields: map,
  };
};
