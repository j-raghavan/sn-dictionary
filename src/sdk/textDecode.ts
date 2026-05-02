// Text decoder for user-supplied dictionary files.
//
// StarDict mandates UTF-8 by spec, so its readers stay on
// `decodeUtf8`. CSV / JSON files, on the other hand, come from
// arbitrary editors — Excel-on-Windows is the most common source and
// it exports as Windows-1252 by default. v1.0.4 read those bytes as
// UTF-8, replaced every smart quote / dash / ellipsis with U+FFFD,
// and the firmware font rendered the replacement character as a
// black diamond. This module makes the decode robust:
//
//   1. UTF-16 LE/BE BOM (Excel "Unicode Text" exports do this).
//   2. UTF-8 with optional BOM, validated strictly.
//   3. Fallback: Windows-1252.
//
// CP1252 will decode literally anything (every byte 0x00–0xFF maps
// to some codepoint), so step 3 cannot fail. UTF-8 with random bytes
// almost always fails strict validation within the first few bytes,
// so misclassification is vanishingly unlikely in practice.

import {tryDecodeUtf8Strict} from './utf8';

// Map the C1 range (0x80–0x9F) to its CP1252 codepoints. Bytes
// outside this range map identity (0x00–0x7F is ASCII; 0xA0–0xFF is
// Latin-1, which CP1252 inherits). Five C1 slots — 0x81, 0x8D, 0x8F,
// 0x90, 0x9D — are undefined in the CP1252 spec; per WHATWG those
// decode to U+FFFD.
const CP1252_C1: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

const decodeCp1252 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80 || b >= 0xa0) {
      s += String.fromCharCode(b);
    } else {
      s += String.fromCharCode(CP1252_C1[b] ?? 0xfffd);
    }
  }
  return s;
};

const decodeUtf16 = (
  bytes: Uint8Array,
  littleEndian: boolean,
  offset: number,
): string => {
  let s = '';
  for (let i = offset; i + 1 < bytes.length; i += 2) {
    const lo = bytes[littleEndian ? i : i + 1];
    const hi = bytes[littleEndian ? i + 1 : i];
    // eslint-disable-next-line no-bitwise
    s += String.fromCharCode((hi << 8) | lo);
  }
  return s;
};

const hasUtf16LeBom = (b: Uint8Array): boolean =>
  b.length >= 2 && b[0] === 0xff && b[1] === 0xfe;

const hasUtf16BeBom = (b: Uint8Array): boolean =>
  b.length >= 2 && b[0] === 0xfe && b[1] === 0xff;

const hasUtf8Bom = (b: Uint8Array): boolean =>
  b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;

// Decode an arbitrary text file to a JS string. Never throws and
// never returns a "needs-recoding" sentinel — a string is always
// produced. Strips a leading BOM in every supported encoding.
export const decodeText = (bytes: Uint8Array): string => {
  if (hasUtf16LeBom(bytes)) {
    return decodeUtf16(bytes, true, 2);
  }
  if (hasUtf16BeBom(bytes)) {
    return decodeUtf16(bytes, false, 2);
  }
  const utf8Body = hasUtf8Bom(bytes) ? bytes.subarray(3) : bytes;
  const utf8 = tryDecodeUtf8Strict(utf8Body);
  if (utf8 !== null) {
    return utf8;
  }
  return decodeCp1252(bytes);
};

export const __testing__ = {decodeCp1252, decodeUtf16};
