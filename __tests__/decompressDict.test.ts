import pako from 'pako';
import {decompressDict} from '../src/core/dict/stardict/decompressDict';

describe('decompressDict', () => {
  test('passes raw .dict bytes through unchanged', () => {
    const raw = new TextEncoder().encode('a fruitanother fruitsmall red fruit');
    const result = decompressDict(raw);
    expect(result).toBe(raw);
  });

  test('inflates a gzip-wrapped .dict.dz', () => {
    const original = new TextEncoder().encode(
      'definition one|definition two|definition three',
    );
    const gzipped = pako.gzip(original);
    expect(gzipped[0]).toBe(0x1f);
    expect(gzipped[1]).toBe(0x8b);
    const result = decompressDict(gzipped);
    expect(new TextDecoder().decode(result)).toBe(
      'definition one|definition two|definition three',
    );
  });

  test('treats a 1-byte buffer as raw (insufficient for magic check)', () => {
    const tiny = new Uint8Array([0x1f]);
    expect(decompressDict(tiny)).toBe(tiny);
  });

  test('treats an empty buffer as raw', () => {
    const empty = new Uint8Array(0);
    expect(decompressDict(empty)).toBe(empty);
  });
});
