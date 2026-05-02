import {normalizeKey} from '../src/core/dict/normalizeKey';

describe('normalizeKey', () => {
  test('lowercases ASCII', () => {
    expect(normalizeKey('Apple')).toBe('apple');
    expect(normalizeKey('BANANA')).toBe('banana');
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeKey('  hello  ')).toBe('hello');
  });

  test('returns empty string for whitespace-only input', () => {
    expect(normalizeKey('   ')).toBe('');
    expect(normalizeKey('')).toBe('');
  });

  // The Dune.csv regression: file stores Muad’Dib (U+2019), user types
  // Muad'Dib (U+0027). Both must collapse to the same key.
  test('curly right single quote (U+2019) folds to ASCII apostrophe', () => {
    expect(normalizeKey('Muad’Dib')).toBe(normalizeKey("Muad'Dib"));
    expect(normalizeKey('Muad’Dib')).toBe("muad'dib");
  });

  test('curly left single quote (U+2018) folds to ASCII apostrophe', () => {
    expect(normalizeKey('it‘s')).toBe("it's");
  });

  test('modifier letter apostrophe (U+02BC) folds to ASCII apostrophe', () => {
    expect(normalizeKey('Hawaiʼi')).toBe("hawai'i");
  });

  test('fullwidth apostrophe (U+FF07) folds to ASCII apostrophe', () => {
    expect(normalizeKey('a＇b')).toBe("a'b");
  });

  test('curly double quotes fold to ASCII double quote', () => {
    expect(normalizeKey('“hi”')).toBe('"hi"');
    expect(normalizeKey('„hi‟')).toBe('"hi"');
  });

  test('en dash and em dash fold to ASCII hyphen', () => {
    expect(normalizeKey('a–b')).toBe('a-b');
    expect(normalizeKey('a—b')).toBe('a-b');
  });

  test('hyphen variants (U+2010..U+2015) all fold to ASCII hyphen', () => {
    for (const cp of [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015]) {
      expect(normalizeKey('a' + String.fromCharCode(cp) + 'b')).toBe('a-b');
    }
  });

  test('ellipsis U+2026 folds to three ASCII dots', () => {
    expect(normalizeKey('end…')).toBe('end...');
  });

  test('NBSP (U+00A0) folds to a regular space', () => {
    expect(normalizeKey('a b')).toBe('a b');
  });

  test('NFC normalizes decomposed forms (e + combining acute) to é', () => {
    const decomposed = 'café'; // c a f e + COMBINING ACUTE
    const composed = 'café'; // c a f é (single codepoint)
    expect(normalizeKey(decomposed)).toBe(normalizeKey(composed));
  });

  test('does NOT strip diacritics — café stays café', () => {
    expect(normalizeKey('Café')).toBe('café');
  });

  test('astral-plane characters (emoji) survive intact, not split into surrogates', () => {
    // 🚀 = U+1F680 — encoded as a UTF-16 surrogate pair in JS strings.
    // A naive charCodeAt loop would emit two code units separately;
    // the codepoint-aware iterator preserves the character.
    const out = normalizeKey('rocket🚀ship');
    expect(out).toBe('rocket🚀ship');
    // Spot-check: the rocket is exactly one Array.from element.
    expect(Array.from(out).length).toBe('rocket'.length + 1 + 'ship'.length);
  });

  test('astral characters around folded punctuation still fold correctly', () => {
    expect(normalizeKey('🚀’hi’🛸')).toBe("🚀'hi'🛸");
  });

  test('does not touch ASCII punctuation that already matches', () => {
    expect(normalizeKey("don't")).toBe("don't");
    expect(normalizeKey('a-b')).toBe('a-b');
    expect(normalizeKey('"hi"')).toBe('"hi"');
  });

  test('survives engines without String.prototype.normalize', () => {
    const orig = String.prototype.normalize;
    // @ts-expect-error — intentionally remove for the test
    delete String.prototype.normalize;
    try {
      // Without NFC, the curly-quote fold still works.
      expect(normalizeKey('Muad’Dib')).toBe("muad'dib");
    } finally {
      // eslint-disable-next-line no-extend-native
      String.prototype.normalize = orig;
    }
  });
});
