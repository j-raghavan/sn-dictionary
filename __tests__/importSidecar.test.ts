// Sidecar validation + slug naming (TF5-FR2).

import {
  parseCsvConfig,
  parseSidecar,
  slugDbFilename,
  slugForName,
} from '../src/core/dict/sqlite/importSidecar';

describe('parseSidecar', () => {
  it('accepts a minimal valid sidecar (name + language)', () => {
    const res = parseSidecar({name: 'Dune Glossary', language: 'en'});
    expect(res).toEqual({
      ok: true,
      sidecar: {name: 'Dune Glossary', language: 'en'},
    });
  });

  it('trims the name and lowercases the language', () => {
    const res = parseSidecar({name: '  Dune  ', language: 'EN'});
    expect(res).toEqual({ok: true, sidecar: {name: 'Dune', language: 'en'}});
  });

  it('keeps a known format and passes optional string fields through', () => {
    const res = parseSidecar({
      name: 'D',
      language: 'de',
      format: 'html',
      license: 'CC-BY-SA',
      version: '1.2',
      description: 'desc',
    });
    expect(res).toEqual({
      ok: true,
      sidecar: {
        name: 'D',
        language: 'de',
        format: 'html',
        license: 'CC-BY-SA',
        version: '1.2',
        description: 'desc',
      },
    });
  });

  it('drops an unknown format (kept valid, format omitted)', () => {
    const res = parseSidecar({name: 'D', language: 'en', format: 'markdown'});
    expect(res).toEqual({ok: true, sidecar: {name: 'D', language: 'en'}});
  });

  it('rejects a missing / empty / whitespace name', () => {
    expect(parseSidecar({language: 'en'}).ok).toBe(false);
    expect(parseSidecar({name: '', language: 'en'}).ok).toBe(false);
    expect(parseSidecar({name: '   ', language: 'en'}).ok).toBe(false);
    expect(parseSidecar({name: 42, language: 'en'}).ok).toBe(false);
  });

  it('rejects a non-ISO-639-1 language', () => {
    expect(parseSidecar({name: 'D', language: 'eng'}).ok).toBe(false);
    expect(parseSidecar({name: 'D', language: 'e'}).ok).toBe(false);
    expect(parseSidecar({name: 'D', language: '12'}).ok).toBe(false);
    expect(parseSidecar({name: 'D'}).ok).toBe(false);
  });

  it("accepts the 'und' (undetermined) language tag", () => {
    // 'und' is the discovery default for a meta-less dict — a valid
    // language value (thesaurus short-circuits to empty), so the strict
    // parser must accept it.
    const res = parseSidecar({name: 'D', language: 'und'});
    expect(res).toEqual({ok: true, sidecar: {name: 'D', language: 'und'}});
    expect(parseSidecar({name: 'D', language: 'UND'})).toEqual({
      ok: true,
      sidecar: {name: 'D', language: 'und'},
    });
  });

  it('rejects non-object input without throwing', () => {
    expect(parseSidecar(null).ok).toBe(false);
    expect(parseSidecar('str').ok).toBe(false);
    expect(parseSidecar(42).ok).toBe(false);
    expect(parseSidecar(undefined).ok).toBe(false);
  });

  it('ignores non-string optional fields', () => {
    const res = parseSidecar({
      name: 'D',
      language: 'en',
      license: 99,
      version: {},
      description: [],
    });
    expect(res).toEqual({ok: true, sidecar: {name: 'D', language: 'en'}});
  });
});

describe('slugForName', () => {
  it('lowercases and folds non-alphanumeric runs to single hyphens', () => {
    expect(slugForName('Dune Glossary!')).toBe('dune-glossary');
    expect(slugForName('A   B___C')).toBe('a-b-c');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugForName('  --Dune--  ')).toBe('dune');
    expect(slugForName('***edge***')).toBe('edge');
  });

  it('returns empty for an all-symbol name', () => {
    expect(slugForName('!!!')).toBe('');
    expect(slugForName('   ')).toBe('');
  });

  it('caps at 48 chars without a trailing hyphen', () => {
    const long = 'a'.repeat(60);
    expect(slugForName(long)).toHaveLength(48);
    // A name that would cut mid-hyphen still ends clean.
    const cutAtHyphen = 'a'.repeat(47) + ' tail';
    const slug = slugForName(cutAtHyphen);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(48);
  });
});

describe('slugDbFilename', () => {
  it('builds <slug>.<lang>.db', () => {
    expect(slugDbFilename('Dune Glossary', 'en')).toBe('dune-glossary.en.db');
  });

  it('falls back to dict-<lang> when the name slugs to empty', () => {
    expect(slugDbFilename('!!!', 'de')).toBe('dict-de.de.db');
  });
});

// --- parseCsvConfig (M16) ------------------------------------------

describe('parseCsvConfig', () => {
  it('returns {} for a non-object / null / undefined block', () => {
    expect(parseCsvConfig(undefined)).toEqual({});
    expect(parseCsvConfig(null)).toEqual({});
    expect(parseCsvConfig('csv')).toEqual({});
    expect(parseCsvConfig(42)).toEqual({});
  });

  it('returns {} for an empty object (all defaults applied downstream)', () => {
    expect(parseCsvConfig({})).toEqual({});
  });

  it('picks every valid non-negative integer column + boolean hasHeader', () => {
    expect(
      parseCsvConfig({
        headwordCol: 0,
        definitionCol: 1,
        phoneticCol: 2,
        hasHeader: true,
      }),
    ).toEqual({headwordCol: 0, definitionCol: 1, phoneticCol: 2, hasHeader: true});
  });

  it('omits a column with a per-key fallback when invalid (float/neg/non-number)', () => {
    expect(parseCsvConfig({headwordCol: 1.5})).toEqual({});
    expect(parseCsvConfig({definitionCol: -1})).toEqual({});
    expect(parseCsvConfig({phoneticCol: '2'})).toEqual({});
    // hasHeader only accepts a real boolean.
    expect(parseCsvConfig({hasHeader: 'yes'})).toEqual({});
  });

  it('keeps the valid keys and drops the invalid ones in a mixed block', () => {
    expect(
      parseCsvConfig({headwordCol: 0, definitionCol: -5, phoneticCol: 3, hasHeader: false}),
    ).toEqual({headwordCol: 0, phoneticCol: 3, hasHeader: false});
  });
});
