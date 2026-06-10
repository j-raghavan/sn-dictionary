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
  // If present, all entries share this single type sequence and the
  // .dict bytes for an entry are exactly its raw payload. If ABSENT,
  // each entry is `<type-char-byte><payload>` plus a 0x00 terminator
  // except the last; splitDictEntry strips that metadata. Most common
  // value is 'm' (pure UTF-8 text); 'h' is HTML.
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
  // Strict numeric parse: parseInt('12abc', 10) === 12 silently.
  // For headline metadata that drives parsing (wordcount drives the
  // expected entry count for diagnostics; idxoffsetbits picks the
  // .idx field width) we reject any value that isn't pure digits.
  const strictPositiveInt = (raw: string | undefined): number | null => {
    if (raw === undefined || !/^\d+$/.test(raw)) {
      return null;
    }
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  };
  const wordcount = strictPositiveInt(map.wordcount);
  if (wordcount === null || wordcount <= 0) {
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
  // synwordcount and idxfilesize are diagnostic-only — drop a
  // malformed value rather than throwing, since a bad header
  // shouldn't block lookup.
  const synwordcount = strictPositiveInt(map.synwordcount) ?? undefined;
  const idxfilesize = strictPositiveInt(map.idxfilesize) ?? undefined;

  return {
    bookname: map.bookname,
    wordcount,
    synwordcount,
    idxfilesize,
    idxoffsetbits,
    sametypesequence: map.sametypesequence,
    rawFields: map,
  };
};
