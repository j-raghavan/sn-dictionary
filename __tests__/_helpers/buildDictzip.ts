// Synthesises a valid dictzip-encoded gzip stream for tests:
//
//   gzip header(10) + XLEN + XDATA(SI=RA + chunk index)
//                  + chunk[0] deflate + chunk[1] deflate + ...
//                  + zeroed CRC32 + ISIZE trailer
//
// The trailer is zeroed because pako.inflateRaw (which the runtime
// reader uses for per-chunk inflation) never validates it, and tests
// never exercise the whole-file pako.inflate fallback against a real
// dictzip fixture. If a future test needs a spec-clean trailer we'd
// need a CRC32 helper here.
//
// chunkSize defaults to 64 — small enough that even tiny fixtures
// span multiple chunks, exercising the cross-chunk slice path.

/* eslint-disable no-bitwise */

import pako from 'pako';

export type DictzipOpts = {
  chunkSize?: number;
};

const u16le = (v: number): [number, number] => [v & 0xff, (v >>> 8) & 0xff];

export const encodeDictzip = (
  data: Uint8Array,
  opts: DictzipOpts = {},
): Uint8Array => {
  const chunkSize = opts.chunkSize ?? 64;
  if (chunkSize <= 0 || chunkSize > 0xffff) {
    throw new Error(`encodeDictzip: chunkSize ${chunkSize} out of range`);
  }
  // Slice the input into chunkSize-byte uncompressed chunks. Even an
  // empty input produces zero chunks (chunkCount=0), which exercises
  // the no-data edge case in the parser.
  const compressedChunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    const piece = data.subarray(i, Math.min(i + chunkSize, data.length));
    compressedChunks.push(pako.deflateRaw(piece));
  }
  const chunkCount = compressedChunks.length;
  // RA payload: VER(2) + CHLEN(2) + CHCNT(2) + chunkCount × u16.
  const raPayloadLen = 6 + chunkCount * 2;
  // XDATA = one subfield = SI1(1) + SI2(1) + SUBLEN(2) + payload.
  const xdataLen = 4 + raPayloadLen;
  const out: number[] = [
    0x1f, 0x8b, // gzip magic
    0x08, // CM = deflate
    0x04, // FLG = FEXTRA
    0, 0, 0, 0, // MTIME = 0
    0, // XFL = 0
    0xff, // OS = unknown
    ...u16le(xdataLen), // XLEN
    0x52, 0x41, // 'R', 'A'
    ...u16le(raPayloadLen), // SUBLEN
    ...u16le(1), // VER = 1
    ...u16le(chunkSize), // CHLEN
    ...u16le(chunkCount), // CHCNT
  ];
  for (const c of compressedChunks) {
    out.push(...u16le(c.length));
  }
  for (const c of compressedChunks) {
    for (let i = 0; i < c.length; i++) {
      out.push(c[i]);
    }
  }
  // Trailer: CRC32 (u32 LE) + ISIZE (u32 LE) — both zeroed; the
  // runtime reader never reads the trailer.
  out.push(0, 0, 0, 0);
  out.push(
    data.length & 0xff,
    (data.length >>> 8) & 0xff,
    (data.length >>> 16) & 0xff,
    (data.length >>> 24) & 0xff,
  );
  return new Uint8Array(out);
};
