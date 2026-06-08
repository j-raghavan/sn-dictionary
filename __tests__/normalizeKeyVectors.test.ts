// Cross-language parity oracle (M10 / ADR-0006). The same fixture pins
// BOTH the TS normalizeKey (here, host) and the Kotlin NormalizeKey.fold
// (android/app/src/main/java/com/sndict/imports/NormalizeKey.kt, verified
// on-device). If a fold rule changes, add a vector here and the Kotlin
// port must match — keeping natively-imported dict keys identical to
// base.db (IV-4).

import {normalizeKey} from '../src/core/dict/normalizeKey';
import vectorsJson from './_fixtures/normalizeKeyVectors.json';

type Vector = {input: string; expected: string};
const vectors = (vectorsJson as {vectors: Vector[]}).vectors;

describe('normalizeKey parity vectors', () => {
  it('has a non-trivial set of vectors', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(20);
  });

  it.each(vectors)('fold($input) === $expected', ({input, expected}) => {
    expect(normalizeKey(input)).toBe(expected);
  });
});
