// Synthesises a real-shape dictzip stream for tests:
//
//   gzip header(10) + XLEN + XDATA(SI=RA + chunk index)
//                  + chunk[0] | chunk[1] | ... | chunk[N-1]
//                  + zeroed CRC32 + ISIZE trailer
//
// Each chunk is the byte slice of a SINGLE continuous raw-deflate
// stream, segmented at the boundary using Z_FULL_FLUSH (so each
// chunk's bytes inflate independently with a fresh inflate state)
// and only the LAST chunk carries Z_FINISH (BFINAL=1).
//
// This faithfully matches what `dictzip(1)` writes, so the runtime
// reader's "append BFINAL sentinel before pako.inflateRaw" code path
// is exercised against synthetic fixtures — not just real-world
// files.
//
// The trailer is zeroed because pako.inflateRaw (which the runtime
// reader uses for per-chunk inflation) never validates it.
//
// chunkSize defaults to 64 — small enough that even tiny fixtures
// span multiple chunks, exercising the cross-chunk slice path.

/* eslint-disable no-bitwise */

import pako from 'pako';

export type DictzipOpts = {
  chunkSize?: number;
};

const u16le = (v: number): [number, number] => [v & 0xff, (v >>> 8) & 0xff];

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

// Encode `data` as a single raw-deflate stream segmented at every
// `chunkSize` uncompressed bytes via Z_FULL_FLUSH, with Z_FINISH on
// the last chunk. Returns the per-chunk compressed byte slices.
//
// Note: pako exposes Deflate (uppercase D) as a constructor on the
// default export, with .push(data, flushMode) where flushMode is one
// of pako.constants.Z_NO_FLUSH / Z_FULL_FLUSH / Z_FINISH. Each push
// emits one or more output chunks via .onData(buffer). We capture
// those, collecting bytes into a single buffer, and slice it at the
// post-flush byte offsets — those are exactly the chunk boundaries
// that the dictzip reader will see.
const deflateSegmented = (
  data: Uint8Array,
  chunkSize: number,
): Uint8Array[] => {
  const deflator = new pako.Deflate({raw: true});
  const collected: Uint8Array[] = [];
  // Override onData to collect output chunks into a single buffer.
  // We then split that buffer at boundary offsets we record after
  // each .push().
  deflator.onData = (buf: Uint8Array) => {
    collected.push(
      buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer),
    );
  };
  const boundaries: number[] = [];
  let bytesProduced = 0;
  const flushBoundary = (): void => {
    bytesProduced = collected.reduce((s, p) => s + p.length, 0);
    boundaries.push(bytesProduced);
  };
  if (data.length === 0) {
    return [];
  }
  let i = 0;
  while (i < data.length) {
    const end = Math.min(i + chunkSize, data.length);
    const piece = data.subarray(i, end);
    const isLast = end === data.length;
    deflator.push(piece, isLast ? pako.constants.Z_FINISH : pako.constants.Z_FULL_FLUSH);
    flushBoundary();
    i = end;
  }
  if (deflator.err !== 0) {
    throw new Error(`encodeDictzip: deflate error ${deflator.err} (${deflator.msg})`);
  }
  const merged = concat(collected);
  // Slice merged at every recorded boundary to recover per-chunk
  // compressed byte slices.
  const slices: Uint8Array[] = [];
  let prev = 0;
  for (const b of boundaries) {
    slices.push(merged.subarray(prev, b));
    prev = b;
  }
  return slices;
};

export const encodeDictzip = (
  data: Uint8Array,
  opts: DictzipOpts = {},
): Uint8Array => {
  const chunkSize = opts.chunkSize ?? 64;
  if (chunkSize <= 0 || chunkSize > 0xffff) {
    throw new Error(`encodeDictzip: chunkSize ${chunkSize} out of range`);
  }
  const compressedChunks = deflateSegmented(data, chunkSize);
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
