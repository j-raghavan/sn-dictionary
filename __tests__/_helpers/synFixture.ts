// Builds a synthetic StarDict .syn buffer for tests. The real
// writeStarDict helper emits only the {ifo, idx, dict} triple; this
// adds the optional .syn (synonym index) so the import pipeline's
// alias-merge row-count behaviour can be exercised on host fixtures.
//
// .syn format: repeated `word \0 originalWordIndex(u32 BE)`, where
// originalWordIndex is the 0-based ordinal of a headword in the
// SORTED .idx list (writeStarDict sorts keys ascending).

import {encodeUtf8} from '../../src/sdk/utf8';

// alias -> canonical headword. headwords is the full set written into
// the triple (same object passed to writeStarDict); we sort it the way
// writeStarDict does to compute each canonical's .idx ordinal.
export const buildSyn = (
  headwords: string[],
  aliases: Record<string, string>,
): Uint8Array => {
  const sorted = [...headwords].sort();
  const parts: number[] = [];
  for (const [alias, canonical] of Object.entries(aliases)) {
    const idx = sorted.indexOf(canonical);
    if (idx < 0) {
      throw new Error(`buildSyn: canonical "${canonical}" not in headwords`);
    }
    for (const b of encodeUtf8(alias)) {
      parts.push(b);
    }
    parts.push(0);
    /* eslint-disable no-bitwise */
    parts.push((idx >>> 24) & 0xff, (idx >>> 16) & 0xff, (idx >>> 8) & 0xff, idx & 0xff);
    /* eslint-enable no-bitwise */
  }
  return Uint8Array.from(parts);
};
