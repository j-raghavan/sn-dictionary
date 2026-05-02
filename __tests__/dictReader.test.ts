// Hand-crafted dictzip headers in the malformed-input tests use
// bit-packing to compose multi-byte fields. Disable the lint at file
// scope so the fixtures stay terse instead of every line carrying a
// disable comment.
/* eslint-disable no-bitwise */

import pako from 'pako';
import {createDictReader, __testing__} from '../src/core/dict/stardict/dictReader';
import {encodeDictzip} from './_helpers/buildDictzip';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('createDictReader', () => {
  describe('raw .dict (no gzip header)', () => {
    test('slices the requested byte range', () => {
      const reader = createDictReader(enc('apple|banana|cherry'));
      // Walk past 'apple|' (6 bytes) and read 6 bytes: 'banana'.
      expect(dec(reader.slice(6, 6))).toBe('banana');
    });

    test('supports zero-length slices at the end of the buffer', () => {
      const reader = createDictReader(enc('xyz'));
      expect(reader.slice(3, 0)).toEqual(new Uint8Array(0));
    });

    test('throws when the slice runs past the end of the buffer', () => {
      const reader = createDictReader(enc('abc'));
      expect(() => reader.slice(2, 5)).toThrow(/out of range/);
    });

    test('throws on a negative offset', () => {
      const reader = createDictReader(enc('abc'));
      expect(() => reader.slice(-1, 1)).toThrow(/out of range/);
    });

    test('returns a copy, not a view, so callers cannot pin the original buffer', () => {
      const buf = enc('abcdef');
      const reader = createDictReader(buf);
      const out = reader.slice(0, 3);
      // Mutate the slice and verify the original is untouched.
      out[0] = 0;
      expect(buf[0]).toBe('a'.charCodeAt(0));
    });
  });

  describe('gzip without dictzip RA extra field (legacy fixture)', () => {
    test('falls back to whole-file inflate and serves slices', () => {
      const original = enc('alpha|beta|gamma');
      const gzipped = pako.gzip(original);
      // Sanity: pako.gzip does not set the FEXTRA flag.
      expect(__testing__.parseDictzipExtra(gzipped)).toBeNull();
      const reader = createDictReader(gzipped);
      // Walk past 'alpha|' (6 bytes) and read 4 bytes: 'beta'.
      expect(dec(reader.slice(6, 4))).toBe('beta');
    });
  });

  describe('dictzip with RA extra field', () => {
    test('inflates only the chunks covering the requested slice', () => {
      // 6 chunks × 64 bytes covers 384 bytes; inflate only chunks
      // straddling the requested range (e.g. bytes 100..150).
      const body = new Uint8Array(384);
      for (let i = 0; i < body.length; i++) {
        body[i] = i & 0xff;
      }
      const dz = encodeDictzip(body, {chunkSize: 64});
      const reader = createDictReader(dz);
      const sliced = reader.slice(100, 50);
      // Expected bytes are body[100..150].
      const expected = body.subarray(100, 150);
      expect(Array.from(sliced)).toEqual(Array.from(expected));
    });

    test('handles slices that span multiple chunks', () => {
      // chunkSize=8 bytes, body=40 bytes → 5 chunks. Slice spans
      // chunks 1, 2, and 3.
      const body = enc('0123456789ABCDEFGHIJabcdefghijklmnopqrst');
      expect(body.length).toBe(40);
      const dz = encodeDictzip(body, {chunkSize: 8});
      const reader = createDictReader(dz);
      // Bytes 6..30 cover '67' + 'ABCDEFGH' + 'IJabcdef' + 'gh'.
      expect(dec(reader.slice(6, 24))).toBe('6789ABCDEFGHIJabcdefghij');
    });

    test('handles a slice that starts at offset 0', () => {
      const body = enc('the quick brown fox jumps over the lazy dog');
      const dz = encodeDictzip(body, {chunkSize: 8});
      const reader = createDictReader(dz);
      expect(dec(reader.slice(0, 9))).toBe('the quick');
    });

    test('handles a slice that ends exactly at the last chunk boundary', () => {
      const body = enc('1234567890ABCDEFGHIJ'); // 20 bytes
      const dz = encodeDictzip(body, {chunkSize: 5});
      const reader = createDictReader(dz);
      expect(dec(reader.slice(15, 5))).toBe('FGHIJ');
    });

    test('caches inflated chunks across slice calls', () => {
      const body = new Uint8Array(64).fill(0xab);
      const dz = encodeDictzip(body, {chunkSize: 16});
      const reader = createDictReader(dz);
      const inflateRawSpy = jest.spyOn(pako, 'inflateRaw');
      try {
        reader.slice(0, 16); // chunk 0
        reader.slice(0, 16); // chunk 0 again — should hit cache
        reader.slice(16, 16); // chunk 1
        reader.slice(0, 16); // chunk 0 still cached
        // Three distinct chunks-of-content requested across four
        // slices, but chunk 0 is fetched once and cached → exactly
        // 2 inflateRaw calls.
        expect(inflateRawSpy).toHaveBeenCalledTimes(2);
      } finally {
        inflateRawSpy.mockRestore();
      }
    });

    test('throws when the slice runs past the end of the last chunk', () => {
      const body = enc('0123456789'); // 10 bytes — chunks (4,4,2)
      const dz = encodeDictzip(body, {chunkSize: 4});
      const reader = createDictReader(dz);
      // Asks for 5 bytes starting at offset 8: only 2 bytes ('89')
      // are actually present after offset 8. The slice must throw,
      // not silently truncate or spin.
      expect(() => reader.slice(8, 5)).toThrow(/past end of last chunk/);
    });

    test('throws when the slice starts past the last chunk entirely', () => {
      const body = enc('abcdefgh'); // 8 bytes — 2 chunks of 4
      const dz = encodeDictzip(body, {chunkSize: 4});
      const reader = createDictReader(dz);
      // Offset 100 is way past chunk count.
      expect(() => reader.slice(100, 1)).toThrow(/past last chunk/);
    });

    test('throws on a negative offset', () => {
      const body = enc('xyz');
      const dz = encodeDictzip(body, {chunkSize: 4});
      const reader = createDictReader(dz);
      expect(() => reader.slice(-1, 2)).toThrow(/negative bound/);
    });
  });

  describe('parseDictzipExtra (raw header parser)', () => {
    const {parseDictzipExtra} = __testing__;

    test('returns null for non-gzip input', () => {
      expect(parseDictzipExtra(enc('not gzip'))).toBeNull();
    });

    test('returns null for gzip with no FEXTRA flag', () => {
      const gzipped = pako.gzip(enc('hello'));
      // Sanity: pako.gzip leaves FLG=0.
      expect(gzipped[3] & 0x04).toBe(0);
      expect(parseDictzipExtra(gzipped)).toBeNull();
    });

    test('returns null when the extra field has no RA subfield', () => {
      // Hand-build a gzip stream with FEXTRA set but a non-RA
      // subfield. The reader walks subfields; it should find no RA
      // and return null without throwing.
      const inner = pako.deflateRaw(enc('hello'));
      const out: number[] = [
        0x1f, 0x8b, 0x08, 0x04, // magic, CM, FLG=FEXTRA
        0, 0, 0, 0, // MTIME
        0, 0xff, // XFL, OS
        0x06, 0x00, // XLEN = 6
        0x58, 0x59, // 'X', 'Y' — not RA
        0x02, 0x00, // SUBLEN = 2
        0x00, 0x00, // payload
      ];
      for (let i = 0; i < inner.length; i++) {
        out.push(inner[i]);
      }
      out.push(0, 0, 0, 0, 0, 0, 0, 0); // trailer
      expect(parseDictzipExtra(new Uint8Array(out))).toBeNull();
    });

    test('returns null for a malformed RA payload (VER ≠ 1)', () => {
      // RA subfield with VER=99. Reader rejects unknown versions.
      const out: number[] = [
        0x1f, 0x8b, 0x08, 0x04, 0, 0, 0, 0, 0, 0xff, 0x0a, 0x00,
        0x52, 0x41, 0x06, 0x00,
        0x63, 0x00, // VER = 99
        0x40, 0x00, // CHLEN = 64
        0x00, 0x00, // CHCNT = 0
      ];
      // No trailer needed — parseDictzipExtra only reads the header.
      expect(parseDictzipExtra(new Uint8Array(out))).toBeNull();
    });

    test('parses a real dictzip header end-to-end', () => {
      const body = enc('definition body');
      const dz = encodeDictzip(body, {chunkSize: 8});
      const idx = parseDictzipExtra(dz);
      expect(idx).not.toBeNull();
      expect(idx?.chunkSize).toBe(8);
      // 15 bytes / 8 = 2 chunks.
      expect(idx?.chunks.length).toBe(2);
    });

    test('returns null when XLEN runs past the end of the buffer (truncated header)', () => {
      // Header claims XLEN=200 but the file is much shorter — the
      // reader must reject without throwing. Buffer must clear the
      // 18-byte minimum first so the XLEN check is what actually
      // rejects (otherwise the size-floor guard short-circuits).
      const out: number[] = [
        0x1f, 0x8b, 0x08, 0x04, 0, 0, 0, 0, 0, 0xff,
        0xc8, 0x00, // XLEN = 200 — far beyond the buffer
        // Pad to 20 bytes total to clear the 18-byte minimum.
        0, 0, 0, 0, 0, 0, 0, 0,
      ];
      expect(parseDictzipExtra(new Uint8Array(out))).toBeNull();
    });

    test('returns null when a subfield length spills past XDATA (malformed extra field)', () => {
      // XLEN = 6, one subfield with SUBLEN=200 — overruns XDATA.
      const out: number[] = [
        0x1f, 0x8b, 0x08, 0x04, 0, 0, 0, 0, 0, 0xff,
        0x06, 0x00, // XLEN = 6
        0x58, 0x59, // 'X', 'Y'
        0xc8, 0x00, // SUBLEN = 200
        0x00, 0x00, // (only 2 of the 200 bytes present)
      ];
      expect(parseDictzipExtra(new Uint8Array(out))).toBeNull();
    });

    test('returns null when RA SUBLEN is shorter than the fixed payload header (<6)', () => {
      // RA subfield with SUBLEN=4 — too small to even hold VER+CHLEN+CHCNT.
      const out: number[] = [
        0x1f, 0x8b, 0x08, 0x04, 0, 0, 0, 0, 0, 0xff,
        0x08, 0x00, // XLEN = 8
        0x52, 0x41, // 'R', 'A'
        0x04, 0x00, // SUBLEN = 4
        0x01, 0x00, // VER = 1
        0x40, 0x00, // CHLEN = 64
      ];
      expect(parseDictzipExtra(new Uint8Array(out))).toBeNull();
    });

    test('returns null when chunkSize is 0', () => {
      // Spec doesn't allow CHLEN=0; reader rejects.
      const out: number[] = [
        0x1f, 0x8b, 0x08, 0x04, 0, 0, 0, 0, 0, 0xff,
        0x0a, 0x00,
        0x52, 0x41, 0x06, 0x00,
        0x01, 0x00, // VER = 1
        0x00, 0x00, // CHLEN = 0
        0x00, 0x00, // CHCNT = 0
      ];
      expect(parseDictzipExtra(new Uint8Array(out))).toBeNull();
    });

    test('returns null when chunk-length table overruns SUBLEN', () => {
      // SUBLEN=8 declares 1 chunk's worth of u16 (=2 bytes) but
      // CHCNT=5 needs 10 bytes — the table doesn't fit.
      const out: number[] = [
        0x1f, 0x8b, 0x08, 0x04, 0, 0, 0, 0, 0, 0xff,
        0x0c, 0x00,
        0x52, 0x41, 0x08, 0x00,
        0x01, 0x00, // VER = 1
        0x40, 0x00, // CHLEN = 64
        0x05, 0x00, // CHCNT = 5  (needs 10 byte table; SUBLEN only allows 2)
        0x10, 0x00, // first chunk length
      ];
      expect(parseDictzipExtra(new Uint8Array(out))).toBeNull();
    });

    test('skips an FNAME field before the deflate streams', () => {
      // Dictzip with FLG = FEXTRA | FNAME. The "filename" is a
      // single zero-terminated byte. The reader has to walk past it
      // before the first compressed chunk.
      const innerData = enc('hello');
      const inner = pako.deflateRaw(innerData);
      const flg = 0x04 | 0x08; // FEXTRA + FNAME
      const out: number[] = [
        0x1f, 0x8b, 0x08, flg, 0, 0, 0, 0, 0, 0xff,
        0x0c, 0x00, // XLEN = 12
        0x52, 0x41, 0x08, 0x00,
        0x01, 0x00, // VER = 1
        0x05, 0x00, // CHLEN = 5
        0x01, 0x00, // CHCNT = 1
        inner.length & 0xff, (inner.length >>> 8) & 0xff, // chunk[0] compressed length
        // FNAME: "x.dz\0"
        0x78, 0x2e, 0x64, 0x7a, 0x00,
      ];
      for (let i = 0; i < inner.length; i++) {
        out.push(inner[i]);
      }
      out.push(0, 0, 0, 0, 0, 0, 0, 0); // trailer
      const idx = parseDictzipExtra(new Uint8Array(out));
      expect(idx).not.toBeNull();
      // dataStart must be past XDATA (12 + 12 = 24) + 5-byte FNAME = 29.
      expect(idx?.chunks[0].compressedStart).toBe(29);
    });

    test('skips an FCOMMENT field before the deflate streams', () => {
      const innerData = enc('hi');
      const inner = pako.deflateRaw(innerData);
      const flg = 0x04 | 0x10; // FEXTRA + FCOMMENT
      const out: number[] = [
        0x1f, 0x8b, 0x08, flg, 0, 0, 0, 0, 0, 0xff,
        0x0c, 0x00,
        0x52, 0x41, 0x08, 0x00,
        0x01, 0x00,
        0x02, 0x00,
        0x01, 0x00,
        inner.length & 0xff, (inner.length >>> 8) & 0xff,
        // FCOMMENT: "c\0" (2 bytes)
        0x63, 0x00,
      ];
      for (let i = 0; i < inner.length; i++) {
        out.push(inner[i]);
      }
      out.push(0, 0, 0, 0, 0, 0, 0, 0);
      const idx = parseDictzipExtra(new Uint8Array(out));
      expect(idx).not.toBeNull();
      // dataStart = 12 + 12 + 2 = 26.
      expect(idx?.chunks[0].compressedStart).toBe(26);
    });

    test('skips the 2-byte FHCRC field before the deflate streams', () => {
      const innerData = enc('a');
      const inner = pako.deflateRaw(innerData);
      const flg = 0x04 | 0x02; // FEXTRA + FHCRC
      const out: number[] = [
        0x1f, 0x8b, 0x08, flg, 0, 0, 0, 0, 0, 0xff,
        0x0c, 0x00,
        0x52, 0x41, 0x08, 0x00,
        0x01, 0x00,
        0x01, 0x00,
        0x01, 0x00,
        inner.length & 0xff, (inner.length >>> 8) & 0xff,
        // FHCRC: 2 bytes
        0xab, 0xcd,
      ];
      for (let i = 0; i < inner.length; i++) {
        out.push(inner[i]);
      }
      out.push(0, 0, 0, 0, 0, 0, 0, 0);
      const idx = parseDictzipExtra(new Uint8Array(out));
      expect(idx).not.toBeNull();
      // dataStart = 12 + 12 + 2 = 26.
      expect(idx?.chunks[0].compressedStart).toBe(26);
    });

    test('returns null when optional headers run past the end of the buffer', () => {
      // FLG declares FNAME but the file ends inside the XDATA, so
      // the FNAME walk overruns the buffer and dataStart > length.
      const flg = 0x04 | 0x08;
      const out: number[] = [
        0x1f, 0x8b, 0x08, flg, 0, 0, 0, 0, 0, 0xff,
        0x0c, 0x00,
        0x52, 0x41, 0x08, 0x00,
        0x01, 0x00,
        0x10, 0x00,
        0x01, 0x00,
        0x01, 0x00,
        // No FNAME bytes; the parser will scan past the buffer end.
      ];
      expect(parseDictzipExtra(new Uint8Array(out))).toBeNull();
    });
  });
});
