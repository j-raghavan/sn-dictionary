import {
  decodeUtf8,
  encodeUtf8,
  tryDecodeUtf8Strict,
  __testing__,
} from '../src/sdk/utf8';

const {manualEncodeUtf8, manualDecodeUtf8, manualTryDecodeUtf8Strict} =
  __testing__;

const ROUND_TRIP_SAMPLES = [
  '',
  'a',
  'anatomy',
  'Hello, world!',
  'Café',
  'naïve résumé',
  '日本語',
  'Mix: ASCII / café / 日本 / 🚀',
  '🎉',
  '😀😃😄',
];

describe('utf8 codec', () => {
  describe.each([
    ['platform fast path', encodeUtf8, decodeUtf8],
    ['manual fallback', manualEncodeUtf8, manualDecodeUtf8],
  ])('%s', (_label, encode, decode) => {
    test.each(ROUND_TRIP_SAMPLES)('round-trips %p', input => {
      const bytes = encode(input);
      expect(decode(bytes)).toBe(input);
    });

    test('produces ASCII bytes for ASCII strings', () => {
      const bytes = encode('anatomy');
      expect(Array.from(bytes)).toEqual([
        0x61, 0x6e, 0x61, 0x74, 0x6f, 0x6d, 0x79,
      ]);
    });

    test('produces 2-byte UTF-8 for Latin-supplement codepoints', () => {
      const bytes = encode('é'); // U+00E9 -> 0xC3 0xA9
      expect(Array.from(bytes)).toEqual([0xc3, 0xa9]);
    });

    test('produces 3-byte UTF-8 for BMP codepoints above 0x07FF', () => {
      const bytes = encode('日'); // U+65E5 -> 0xE6 0x97 0xA5
      expect(Array.from(bytes)).toEqual([0xe6, 0x97, 0xa5]);
    });

    test('produces 4-byte UTF-8 for surrogate-pair emoji', () => {
      const bytes = encode('🚀'); // U+1F680 -> 0xF0 0x9F 0x9A 0x80
      expect(Array.from(bytes)).toEqual([0xf0, 0x9f, 0x9a, 0x80]);
    });
  });

  test('manual decoder maps a stray continuation byte to U+FFFD', () => {
    // 0x80 alone is an invalid continuation byte
    expect(manualDecodeUtf8(new Uint8Array([0x80]))).toBe('�');
  });

  test('manual decoder gracefully handles a truncated 2-byte sequence', () => {
    // 0xC2 starts a 2-byte sequence but the buffer ends; the missing
    // continuation byte is treated as 0, yielding U+0080.
    expect(manualDecodeUtf8(new Uint8Array([0xc2]))).toBe('');
  });
  test('manual decoder gracefully handles truncated 3- and 4-byte sequences', () => {
    expect(() => manualDecodeUtf8(new Uint8Array([0xe0]))).not.toThrow();
    expect(() => manualDecodeUtf8(new Uint8Array([0xf0]))).not.toThrow();
  });

  test('manual encoder does not crash on a lone high surrogate', () => {
    expect(() => manualEncodeUtf8('\uD83D')).not.toThrow();
    expect(manualEncodeUtf8('\uD83D').length).toBeGreaterThan(0);
  });
});

describe('tryDecodeUtf8Strict', () => {
  describe.each([
    ['platform fast path', tryDecodeUtf8Strict],
    ['manual fallback', manualTryDecodeUtf8Strict],
  ])('%s', (_label, decode) => {
    test('accepts ASCII', () => {
      expect(decode(new Uint8Array([0x61, 0x62, 0x63]))).toBe('abc');
    });
    test('accepts well-formed multibyte UTF-8', () => {
      // é = C3 A9, 日 = E6 97 A5, 🚀 = F0 9F 9A 80
      expect(
        decode(
          new Uint8Array([0xc3, 0xa9, 0xe6, 0x97, 0xa5, 0xf0, 0x9f, 0x9a, 0x80]),
        ),
      ).toBe('é日🚀');
    });
    test('accepts an empty buffer', () => {
      expect(decode(new Uint8Array([]))).toBe('');
    });
    test('rejects a stray continuation byte (0x92, the Dune.csv case)', () => {
      expect(decode(new Uint8Array([0x61, 0x92, 0x63]))).toBeNull();
    });
    test('rejects an invalid lead byte (0xC0 — overlong start)', () => {
      expect(decode(new Uint8Array([0xc0, 0x80]))).toBeNull();
    });
    test('rejects an invalid lead byte (0xF5 — above U+10FFFF range)', () => {
      expect(decode(new Uint8Array([0xf5, 0x80, 0x80, 0x80]))).toBeNull();
    });
    test('rejects a truncated 2-byte sequence', () => {
      expect(decode(new Uint8Array([0xc2]))).toBeNull();
    });
    test('rejects a truncated 3-byte sequence', () => {
      expect(decode(new Uint8Array([0xe6, 0x97]))).toBeNull();
    });
    test('rejects a truncated 4-byte sequence', () => {
      expect(decode(new Uint8Array([0xf0, 0x9f, 0x9a]))).toBeNull();
    });
    test('rejects a 2-byte sequence with bad continuation', () => {
      expect(decode(new Uint8Array([0xc2, 0x20]))).toBeNull();
    });
    test('rejects a 3-byte sequence with bad continuation', () => {
      expect(decode(new Uint8Array([0xe6, 0x97, 0x20]))).toBeNull();
    });
    test('rejects a 4-byte sequence with bad continuation', () => {
      expect(decode(new Uint8Array([0xf0, 0x9f, 0x9a, 0x20]))).toBeNull();
    });
    test('rejects an overlong 3-byte form (E0 with second byte < 0xA0)', () => {
      expect(decode(new Uint8Array([0xe0, 0x80, 0x80]))).toBeNull();
    });
    test('rejects a UTF-16 surrogate half encoded as 3-byte UTF-8 (ED A0 80)', () => {
      expect(decode(new Uint8Array([0xed, 0xa0, 0x80]))).toBeNull();
    });
    test('rejects an overlong 4-byte form (F0 with second byte < 0x90)', () => {
      expect(decode(new Uint8Array([0xf0, 0x80, 0x80, 0x80]))).toBeNull();
    });
    test('rejects 4-byte forms above U+10FFFF (F4 with second byte >= 0x90)', () => {
      expect(decode(new Uint8Array([0xf4, 0x90, 0x80, 0x80]))).toBeNull();
    });
  });

  test('falls back to manual strict decode when host TextDecoder is broken', () => {
    jest.isolateModules(() => {
      const g = globalThis as Record<string, unknown>;
      const origDecoder = g.TextDecoder;
      class BrokenDecoder {
        decode(): string {
          throw new Error('decoder broken');
        }
      }
      g.TextDecoder = BrokenDecoder;
      try {
        const fresh = require('../src/sdk/utf8') as typeof import('../src/sdk/utf8');
        // Valid UTF-8 must still produce a string.
        expect(fresh.tryDecodeUtf8Strict(new Uint8Array([0x61]))).toBe('a');
        // And invalid input must still be rejected.
        expect(
          fresh.tryDecodeUtf8Strict(new Uint8Array([0x92])),
        ).toBeNull();
      } finally {
        g.TextDecoder = origDecoder;
      }
    });
  });
});

describe('utf8 codec defensive fallbacks', () => {
  test('falls back to manual encode/decode when globals are missing', () => {
    // Simulate a JS engine without TextEncoder/TextDecoder (the
    // observed Supernote-firmware behaviour) by deleting the globals
    // before the module evaluates `hasTextEncoder` / `hasTextDecoder`.
    jest.isolateModules(() => {
      const g = globalThis as Record<string, unknown>;
      const origEncoder = g.TextEncoder;
      const origDecoder = g.TextDecoder;
      delete g.TextEncoder;
      delete g.TextDecoder;
      try {
        const fresh = require('../src/sdk/utf8') as typeof import('../src/sdk/utf8');
        const bytes = fresh.encodeUtf8('anatomy');
        expect(Array.from(bytes)).toEqual([
          0x61, 0x6e, 0x61, 0x74, 0x6f, 0x6d, 0x79,
        ]);
        expect(fresh.decodeUtf8(bytes)).toBe('anatomy');
      } finally {
        g.TextEncoder = origEncoder;
        g.TextDecoder = origDecoder;
      }
    });
  });

  test('falls back to manual encode/decode when globals throw on call', () => {
    // Belt-and-suspenders: even if the host advertises TextEncoder/
    // Decoder but the implementations throw on use, we still want
    // bytes to flow via the manual path.
    jest.isolateModules(() => {
      const g = globalThis as Record<string, unknown>;
      const origEncoder = g.TextEncoder;
      const origDecoder = g.TextDecoder;
      class BrokenEncoder {
        encode(): Uint8Array {
          throw new Error('encoder broken');
        }
      }
      class BrokenDecoder {
        decode(): string {
          throw new Error('decoder broken');
        }
      }
      g.TextEncoder = BrokenEncoder;
      g.TextDecoder = BrokenDecoder;
      try {
        const fresh = require('../src/sdk/utf8') as typeof import('../src/sdk/utf8');
        const bytes = fresh.encodeUtf8('anatomy');
        expect(Array.from(bytes)).toEqual([
          0x61, 0x6e, 0x61, 0x74, 0x6f, 0x6d, 0x79,
        ]);
        expect(fresh.decodeUtf8(bytes)).toBe('anatomy');
      } finally {
        g.TextEncoder = origEncoder;
        g.TextDecoder = origDecoder;
      }
    });
  });
});
