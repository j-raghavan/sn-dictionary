import {formatFromSametypesequence} from '../src/core/dict/stardict/formatFromIfo';
import type {IfoMeta} from '../src/core/dict/stardict/parseIfo';

const meta = (sametypesequence?: string): IfoMeta => ({
  wordcount: 1,
  idxoffsetbits: 32,
  sametypesequence,
  rawFields: {},
});

describe('formatFromSametypesequence', () => {
  it("returns 'html' for sametypesequence='h'", () => {
    expect(formatFromSametypesequence(meta('h'))).toBe('html');
  });

  it("returns 'plain' for sametypesequence='m' (plain UTF-8 text)", () => {
    expect(formatFromSametypesequence(meta('m'))).toBe('plain');
  });

  it("returns 'plain' for other / dict-specific type sequences", () => {
    expect(formatFromSametypesequence(meta('x'))).toBe('plain');
    expect(formatFromSametypesequence(meta('y'))).toBe('plain');
  });

  it("returns 'plain' when sametypesequence is absent", () => {
    expect(formatFromSametypesequence(meta(undefined))).toBe('plain');
  });
});
