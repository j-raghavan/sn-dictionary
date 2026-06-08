import {isMetaJsonName} from '../src/core/dict/metaJsonName';

describe('isMetaJsonName', () => {
  it('matches the shared meta.json convention', () => {
    expect(isMetaJsonName('meta.json')).toBe(true);
  });

  it('matches the per-file <basename>.meta.json sidecar convention', () => {
    expect(isMetaJsonName('Dune.meta.json')).toBe(true);
    expect(isMetaJsonName('my-dict.meta.json')).toBe(true);
  });

  it('is case-insensitive on the .meta.json suffix', () => {
    expect(isMetaJsonName('Dune.META.JSON')).toBe(true);
    expect(isMetaJsonName('Dune.Meta.Json')).toBe(true);
  });

  it('rejects non-sidecar names', () => {
    expect(isMetaJsonName('Dune.json')).toBe(false);
    expect(isMetaJsonName('metajson')).toBe(false);
    expect(isMetaJsonName('meta.json.bak')).toBe(false);
    expect(isMetaJsonName('')).toBe(false);
  });
});
