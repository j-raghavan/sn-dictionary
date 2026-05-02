// Random-access reader over a StarDict .dict / .dict.dz body.
//
// .dict is a packed concatenation of UTF-8 definition payloads; the
// .idx records carry (offset, length) into that payload. With raw
// .dict the reader is a thin wrapper around `subarray`. With .dict.dz
// the gzip stream carries a "dictzip" RA extra field that lets us
// inflate ONLY the chunk(s) covering a requested byte range — orders
// of magnitude cheaper than inflating the whole file at startup just
// to slice a few hundred bytes per lookup.
//
// dictzip RA layout (RFC 1952 gzip + dictzip-specific subfield):
//
//   gzip header (10 bytes)        — magic 1f 8b, FLG.FEXTRA set
//   XLEN (u16 LE) + XDATA[XLEN]   — extra fields; we walk for SI=RA
//     RA payload:
//       VER   (u16 LE) = 1
//       CHLEN (u16 LE) = uncompressed bytes per chunk
//       CHCNT (u16 LE) = number of chunks
//       CHCNT × u16 LE = compressed length of each chunk
//   FNAME (zstr) if FLG.FNAME
//   FCOMMENT (zstr) if FLG.FCOMMENT
//   FHCRC (u16) if FLG.FHCRC
//   chunk[0] | chunk[1] | ... | chunk[N-1]
//   gzip trailer (CRC32 + ISIZE)
//
// Subtle: real dictzip writes chunks as a SINGLE continuous deflate
// stream broken into byte-aligned slices using Z_FULL_FLUSH between
// chunks. Each chunk's bytes inflate independently (the flush resets
// inflate state), but the chunks do NOT carry BFINAL=1 — the outer
// stream is a Z_FINISH only at the very end, and it lands inside the
// LAST chunk. Calling pako.inflateRaw(chunkBytes) on a non-final
// chunk therefore returns `undefined` (pako never sees end-of-stream)
// and silently breaks the reader.
//
// Fix: append a synthetic 5-byte stored-empty-block marker
// (`01 00 00 ff ff` — BFINAL=1, BTYPE=stored, LEN=0, NLEN=0xffff)
// to every chunk before inflating. That tells pako "this is the
// last block" without changing what it produces. The last chunk
// already has BFINAL=1 of its own; pako stops at the first end-of-
// stream marker and ignores the trailing sentinel, so the same
// always-append code path handles both cases.
//
// Fallback for gzip-without-RA: a few writers (and our synthetic test
// fixtures from older releases) emit a single-block gzip with no RA
// extra field. We can't random-access those, so we pre-inflate once
// and wrap the resulting buffer in the raw reader. Same observable
// behaviour, just no memory savings — and our synthetic fixtures are
// tiny so the cost is irrelevant in tests.

import pako from 'pako';

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

// gzip FLG bits we care about (RFC 1952 §2.3.1).
const FLG_FHCRC = 0x02;
const FLG_FEXTRA = 0x04;
const FLG_FNAME = 0x08;
const FLG_FCOMMENT = 0x10;

// dictzip RA subfield identifier ('R', 'A').
const SI_R = 0x52;
const SI_A = 0x41;

const readU16LE = (bytes: Uint8Array, pos: number): number => {
  // eslint-disable-next-line no-bitwise
  return bytes[pos] | (bytes[pos + 1] << 8);
};

export interface DictReader {
  // Returns a NEW Uint8Array (copy) covering [offset, offset+length)
  // of the *uncompressed* .dict body. Always returns exactly
  // `length` bytes; throws if the requested range is out of bounds.
  slice(offset: number, length: number): Uint8Array;
}

class RawReader implements DictReader {
  constructor(private readonly bytes: Uint8Array) {}
  slice(offset: number, length: number): Uint8Array {
    const end = offset + length;
    if (offset < 0 || end > this.bytes.length) {
      throw new Error(
        `dictReader: slice [${offset}, ${end}) out of range (size ${this.bytes.length})`,
      );
    }
    // Return a COPY, not a subarray view, so callers can't accidentally
    // hold references into the underlying buffer that would prevent
    // garbage collection. Cost is bounded by definition length (<<KB
    // for typical entries).
    return this.bytes.slice(offset, end);
  }
}

type DictzipChunk = {
  // Position in the original .dict.dz buffer where this chunk's
  // raw-deflate stream starts.
  compressedStart: number;
  compressedLength: number;
};

type DictzipIndex = {
  chunkSize: number;
  chunks: DictzipChunk[];
};

class DictzipReader implements DictReader {
  // Decompressed-chunk cache. Lookups against a sorted user dict
  // tend to walk the .dict body roughly in offset order, so most
  // queries land in a small set of chunks. Bounded re-inflate cost
  // even without an LRU — eviction lands in Phase 3 if memory
  // becomes a problem.
  private readonly cache = new Map<number, Uint8Array>();

  constructor(
    private readonly bytes: Uint8Array,
    private readonly index: DictzipIndex,
  ) {}

  slice(offset: number, length: number): Uint8Array {
    if (offset < 0 || length < 0) {
      throw new Error(
        `dictReader: slice [${offset}, ${offset + length}) has negative bound`,
      );
    }
    const out = new Uint8Array(length);
    let written = 0;
    let cursor = offset;
    while (written < length) {
      const chunkIdx = Math.floor(cursor / this.index.chunkSize);
      if (chunkIdx >= this.index.chunks.length) {
        throw new Error(
          `dictReader: slice [${offset}, ${offset + length}) past last chunk (${this.index.chunks.length} chunks of ${this.index.chunkSize})`,
        );
      }
      const within = cursor - chunkIdx * this.index.chunkSize;
      const chunk = this.getChunk(chunkIdx);
      const available = chunk.length - within;
      const take = Math.min(length - written, available);
      // The last chunk may be shorter than chunkSize; if the caller
      // asks for bytes beyond its uncompressed end, the chunk index
      // says "in range" but `available` collapses to 0. Detect and
      // throw rather than spin forever.
      if (take <= 0) {
        throw new Error(
          `dictReader: slice [${offset}, ${offset + length}) past end of last chunk (uncompressed size ${chunkIdx * this.index.chunkSize + chunk.length})`,
        );
      }
      out.set(chunk.subarray(within, within + take), written);
      written += take;
      cursor += take;
    }
    return out;
  }

  private getChunk(i: number): Uint8Array {
    const cached = this.cache.get(i);
    if (cached !== undefined) {
      return cached;
    }
    const meta = this.index.chunks[i];
    const compressed = this.bytes.subarray(
      meta.compressedStart,
      meta.compressedStart + meta.compressedLength,
    );
    // Append the BFINAL=1 stored-empty-block sentinel (see file
    // header): non-final dictzip chunks lack end-of-stream markers,
    // and pako.inflateRaw silently returns undefined without one.
    const padded = new Uint8Array(compressed.length + DEFLATE_END_SENTINEL.length);
    padded.set(compressed, 0);
    padded.set(DEFLATE_END_SENTINEL, compressed.length);
    const inflated = pako.inflateRaw(padded);
    if (!(inflated instanceof Uint8Array)) {
      throw new Error(
        `dictReader: pako.inflateRaw returned ${typeof inflated} for chunk ${i} (compressed ${meta.compressedLength} bytes)`,
      );
    }
    this.cache.set(i, inflated);
    return inflated;
  }
}

// 5-byte raw-deflate trailer that terminates the stream as an empty
// stored block: BFINAL=1, BTYPE=00 (stored), padding to byte boundary
// (0 bits), LEN=0, NLEN=0xffff.
const DEFLATE_END_SENTINEL = new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]);

// Returns the parsed dictzip RA index, or null if the gzip stream
// lacks an RA extra field (so the caller falls back to whole-file
// inflate).
const parseDictzipExtra = (bytes: Uint8Array): DictzipIndex | null => {
  if (
    bytes.length < 18 ||
    bytes[0] !== GZIP_MAGIC_0 ||
    bytes[1] !== GZIP_MAGIC_1
  ) {
    return null;
  }
  const flg = bytes[3];
  // eslint-disable-next-line no-bitwise
  if ((flg & FLG_FEXTRA) === 0) {
    return null;
  }
  // Header is 10 bytes; XLEN follows immediately.
  const xlen = readU16LE(bytes, 10);
  const xdataStart = 12;
  const xdataEnd = xdataStart + xlen;
  if (xdataEnd > bytes.length) {
    return null;
  }
  // Walk subfields searching for ('R', 'A').
  let raPayloadStart = -1;
  let raPayloadLen = 0;
  let pos = xdataStart;
  while (pos + 4 <= xdataEnd) {
    const si1 = bytes[pos];
    const si2 = bytes[pos + 1];
    const subLen = readU16LE(bytes, pos + 2);
    if (pos + 4 + subLen > xdataEnd) {
      // Malformed extra field — bail out. Caller will fall back to
      // whole-file inflate which is still likely to succeed.
      return null;
    }
    if (si1 === SI_R && si2 === SI_A) {
      raPayloadStart = pos + 4;
      raPayloadLen = subLen;
      break;
    }
    pos += 4 + subLen;
  }
  if (raPayloadStart < 0) {
    return null;
  }
  // RA payload: VER(2) + CHLEN(2) + CHCNT(2) + CHCNT × u16(2 each).
  if (raPayloadLen < 6) {
    return null;
  }
  const ver = readU16LE(bytes, raPayloadStart);
  if (ver !== 1) {
    return null;
  }
  const chunkSize = readU16LE(bytes, raPayloadStart + 2);
  const chunkCount = readU16LE(bytes, raPayloadStart + 4);
  if (chunkSize === 0 || raPayloadLen < 6 + chunkCount * 2) {
    return null;
  }
  // Locate where the deflate streams start: skip optional FNAME,
  // FCOMMENT (zero-terminated strings) and FHCRC (2 bytes).
  let dataStart = xdataEnd;
  /* eslint-disable no-bitwise */
  if (flg & FLG_FNAME) {
    while (dataStart < bytes.length && bytes[dataStart] !== 0) {
      dataStart++;
    }
    dataStart++;
  }
  if (flg & FLG_FCOMMENT) {
    while (dataStart < bytes.length && bytes[dataStart] !== 0) {
      dataStart++;
    }
    dataStart++;
  }
  if (flg & FLG_FHCRC) {
    dataStart += 2;
  }
  /* eslint-enable no-bitwise */
  if (dataStart > bytes.length) {
    return null;
  }
  const chunks: DictzipChunk[] = new Array(chunkCount);
  let compressedOffset = dataStart;
  for (let i = 0; i < chunkCount; i++) {
    const compressedLength = readU16LE(bytes, raPayloadStart + 6 + i * 2);
    chunks[i] = {compressedStart: compressedOffset, compressedLength};
    compressedOffset += compressedLength;
  }
  return {chunkSize, chunks};
};

const isGzip = (bytes: Uint8Array): boolean =>
  bytes.length >= 2 &&
  bytes[0] === GZIP_MAGIC_0 &&
  bytes[1] === GZIP_MAGIC_1;

export const createDictReader = (bytes: Uint8Array): DictReader => {
  if (!isGzip(bytes)) {
    return new RawReader(bytes);
  }
  const index = parseDictzipExtra(bytes);
  if (index !== null) {
    return new DictzipReader(bytes, index);
  }
  // gzip without dictzip RA: fall back to whole-file inflate. We
  // lose the random-access memory savings, but functional behaviour
  // is preserved. This path is exercised by older test fixtures and
  // by any user-supplied dict that isn't a real dictzip.
  return new RawReader(pako.inflate(bytes));
};

export const __testing__ = {parseDictzipExtra};
