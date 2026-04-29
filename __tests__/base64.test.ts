import {decodeBase64, __testing__} from '../src/sdk/base64';

const {manualDecodeBase64} = __testing__;

const ROUND_TRIP: Array<[string, number[]]> = [
  ['', []],
  ['QQ==', [0x41]], // 'A'
  ['QUI=', [0x41, 0x42]], // 'AB'
  ['QUJD', [0x41, 0x42, 0x43]], // 'ABC'
  ['SGVsbG8sIHdvcmxkIQ==', [
    0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21,
  ]],
];

describe('base64 codec', () => {
  describe.each([
    ['platform fast path', decodeBase64],
    ['manual fallback', manualDecodeBase64],
  ])('%s', (_label, decode) => {
    test.each(ROUND_TRIP)('decodes %p', (input, expected) => {
      expect(Array.from(decode(input))).toEqual(expected);
    });

    test('decodes a binary blob and round-trips through Buffer', () => {
      const original = Buffer.from([
        0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x01,
      ]);
      const b64 = original.toString('base64');
      expect(Array.from(decode(b64))).toEqual(Array.from(original));
    });
  });

  test('manual decoder strips whitespace defensively', () => {
    expect(Array.from(manualDecodeBase64('QU\nJD'))).toEqual([0x41, 0x42, 0x43]);
    expect(Array.from(manualDecodeBase64('QU JD'))).toEqual([0x41, 0x42, 0x43]);
  });
});

describe('base64 codec defensive fallbacks', () => {
  test('falls back to manual decode when atob is missing', () => {
    jest.isolateModules(() => {
      const g = globalThis as Record<string, unknown>;
      const orig = g.atob;
      delete g.atob;
      try {
        const fresh = require('../src/sdk/base64') as typeof import('../src/sdk/base64');
        expect(Array.from(fresh.decodeBase64('QUJD'))).toEqual([
          0x41, 0x42, 0x43,
        ]);
      } finally {
        g.atob = orig;
      }
    });
  });

  test('falls back to manual decode when atob throws', () => {
    jest.isolateModules(() => {
      const g = globalThis as Record<string, unknown>;
      const orig = g.atob;
      g.atob = () => {
        throw new Error('atob broken');
      };
      try {
        const fresh = require('../src/sdk/base64') as typeof import('../src/sdk/base64');
        expect(Array.from(fresh.decodeBase64('QUJD'))).toEqual([
          0x41, 0x42, 0x43,
        ]);
      } finally {
        g.atob = orig;
      }
    });
  });
});
