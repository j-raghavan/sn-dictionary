import {decodeUtf8, encodeUtf8, __testing__} from '../src/sdk/utf8';

const {manualEncodeUtf8, manualDecodeUtf8} = __testing__;

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
