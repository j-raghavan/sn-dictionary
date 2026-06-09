import {
  detectLocale,
  localizedButtonName,
  localizedPluginName,
  t,
  __testing__,
} from '../src/i18n/i18n';

const {STRINGS, BUTTON_NAME, PLUGIN_NAME, normaliseLocale} = __testing__;

describe('t (popup string lookup)', () => {
  test('returns the English string for known en-locale ids', () => {
    expect(t('popup.synonyms', 'en')).toBe('Synonyms');
    expect(t('popup.close', 'en')).toBe('Close');
    expect(t('popup.notFoundFor', 'en')).toBe('No definition found for');
    expect(t('popup.ocr', 'en')).toBe('OCR');
  });

  test('returns the Chinese-Simplified string for zh_CN', () => {
    expect(t('popup.synonyms', 'zh_CN')).toBe('同义词');
    expect(t('popup.close', 'zh_CN')).toBe('关闭');
  });

  test('returns the German string for de', () => {
    expect(t('popup.synonyms', 'de')).toBe('Synonyme');
    expect(t('popup.close', 'de')).toBe('Schließen');
    expect(t('popup.notFoundFor', 'de')).toBe('Keine Definition gefunden für');
  });

  test('accepts BCP-47 hyphenated locale codes (zh-CN -> zh_CN)', () => {
    expect(t('popup.close', 'zh-CN')).toBe('关闭');
  });

  test('falls back to the language root when the region is unknown', () => {
    // 'zh_SG' (Singapore Chinese) isn't in our table; should land on
    // zh_TW (the Cantonese / HK / unknown-region fallback).
    expect(t('popup.close', 'zh_SG')).toBe('關閉');
  });

  test('falls back to English when the locale is entirely unknown', () => {
    expect(t('popup.close', 'xx_YY')).toBe('Close');
  });

  test('every locale DEFINES every popup string (no en-fallback gaps)', () => {
    // Assert against the raw STRINGS table, NOT t() — t() silently
    // falls back to English for a missing key, so it would never catch a
    // per-locale gap. This guard verifies each locale row actually
    // carries every popup.* key (so a new key added to one locale but
    // forgotten in another fails the suite instead of shipping an
    // en-fallback on-device).
    const ids = [
      'popup.synonyms',
      'popup.ocr',
      'popup.notFoundFor',
      'popup.close',
      'popup.loading',
      'popup.recognizing',
      'popup.fontSmaller',
      'popup.fontLarger',
      'popup.pronunciation',
      'popup.definition',
      'popup.thesaurus',
      'popup.antonyms',
      'popup.noThesaurus',
      'popup.lookUp',
      'popup.editOcr',
      'popup.addDefinition',
      'popup.headword',
      'popup.definitionBody',
      'popup.save',
      'popup.addEmptyError',
      'popup.addFailedError',
      'popup.copy',
      'popup.copied',
      'popup.copyFailed',
    ] as const;
    const localeRows = Object.keys(STRINGS);
    expect(localeRows.length).toBeGreaterThan(0);
    for (const locale of localeRows) {
      for (const id of ids) {
        const value = STRINGS[locale][id];
        expect(
          typeof value === 'string' && value.length > 0,
        ).toBe(true);
      }
    }
  });

  test('the asserted popup-id list is exhaustive (no StringId left unguarded)', () => {
    // Pin completeness: the en locale's popup.* key set must equal the
    // list the per-locale test iterates, so a future popup.* key forces
    // an update to the guard above rather than slipping through.
    const enPopupKeys = Object.keys(STRINGS.en)
      .filter(k => k.startsWith('popup.'))
      .sort();
    const guarded = [
      'popup.synonyms',
      'popup.ocr',
      'popup.notFoundFor',
      'popup.close',
      'popup.loading',
      'popup.recognizing',
      'popup.fontSmaller',
      'popup.fontLarger',
      'popup.pronunciation',
      'popup.definition',
      'popup.thesaurus',
      'popup.antonyms',
      'popup.noThesaurus',
      'popup.lookUp',
      'popup.editOcr',
      'popup.addDefinition',
      'popup.headword',
      'popup.definitionBody',
      'popup.save',
      'popup.addEmptyError',
      'popup.addFailedError',
      'popup.copy',
      'popup.copied',
      'popup.copyFailed',
    ].sort();
    expect(enPopupKeys).toEqual(guarded);
  });

  test('every locale DEFINES every settings.* string (no en-fallback gaps)', () => {
    // The popup.* guard above filters on 'popup.', so the settings.* keys
    // (F1) are otherwise unguarded. Mirror the same parity assertion: take
    // en's settings.* key set as the source of truth and require every
    // locale to define each one non-empty.
    const settingsIds = Object.keys(STRINGS.en).filter(k =>
      k.startsWith('settings.'),
    );
    // Sanity: F1's three + F3's dictionary-manager keys + F4's keep-sources
    // keys (the keepPrompt is also used by the first-run dialog).
    expect(settingsIds.sort()).toEqual([
      'settings.allDisabled',
      'settings.back',
      'settings.deleteDictPrompt',
      'settings.dictionaries',
      'settings.disableDict',
      'settings.enableDict',
      'settings.export',
      'settings.exportDone',
      'settings.exportFolder',
      'settings.exportNoSpace',
      'settings.keepPrompt',
      'settings.keepSources',
      'settings.keepSourcesHint',
      'settings.moveDown',
      'settings.moveUp',
      'settings.newFolder',
      'settings.open',
      'settings.removeDict',
      'settings.restore',
      'settings.restoreDone',
      'settings.restoreNoBackup',
      'settings.restorePrompt',
      'settings.restoreReopen',
      'settings.restoreSnapshotFailed',
      'settings.save',
      'settings.saveFailed',
      'settings.saved',
      'settings.sources',
      'settings.title',
    ]);
    for (const locale of Object.keys(STRINGS)) {
      for (const id of settingsIds) {
        const value = STRINGS[locale][id as keyof (typeof STRINGS)[string]];
        expect(typeof value === 'string' && value.length > 0).toBe(true);
      }
    }
  });

  test('every locale DEFINES every common.* string (F4/F7 dialog buttons)', () => {
    const commonIds = Object.keys(STRINGS.en).filter(k =>
      k.startsWith('common.'),
    );
    expect(commonIds.sort()).toEqual([
      'common.cancel',
      'common.delete',
      'common.keep',
    ]);
    for (const locale of Object.keys(STRINGS)) {
      for (const id of commonIds) {
        const value = STRINGS[locale][id as keyof (typeof STRINGS)[string]];
        expect(typeof value === 'string' && value.length > 0).toBe(true);
      }
    }
  });

  test('every locale defines a non-empty popup.pronunciation', () => {
    // Catches a missing translation when a future locale is added —
    // the a11y label would silently fall back to en otherwise.
    for (const locale of Object.keys(STRINGS)) {
      const value = t('popup.pronunciation', locale);
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe('detectLocale', () => {
  test('returns a locale string that exists in our table', () => {
    const detected = detectLocale();
    expect(typeof detected).toBe('string');
    // Every detected locale resolves to an entry — either directly
    // or via the language-root / en fallback inside normaliseLocale.
    expect(STRINGS[detected]).toBeDefined();
  });

  test('falls back to en when Intl is unavailable', () => {
    jest.isolateModules(() => {
      const g = globalThis as Record<string, unknown>;
      const orig = g.Intl;
      delete g.Intl;
      try {
        const fresh = require('../src/i18n/i18n') as typeof import('../src/i18n/i18n');
        expect(fresh.detectLocale()).toBe('en');
      } finally {
        g.Intl = orig;
      }
    });
  });

  test('falls back to en when Intl.Collator throws', () => {
    jest.isolateModules(() => {
      const g = globalThis as Record<string, unknown>;
      const origIntl = g.Intl as Record<string, unknown> | undefined;
      g.Intl = {
        ...(origIntl ?? {}),
        Collator: function BrokenCollator(): never {
          throw new Error('broken');
        },
      };
      try {
        const fresh = require('../src/i18n/i18n') as typeof import('../src/i18n/i18n');
        expect(fresh.detectLocale()).toBe('en');
      } finally {
        g.Intl = origIntl as unknown;
      }
    });
  });

  test('falls back to en when Intl.Collator returns an empty locale string', () => {
    jest.isolateModules(() => {
      const g = globalThis as Record<string, unknown>;
      const origIntl = g.Intl as Record<string, unknown> | undefined;
      g.Intl = {
        ...(origIntl ?? {}),
        Collator: function StubCollator() {
          return {resolvedOptions: () => ({locale: ''})};
        },
      };
      try {
        const fresh = require('../src/i18n/i18n') as typeof import('../src/i18n/i18n');
        expect(fresh.detectLocale()).toBe('en');
      } finally {
        g.Intl = origIntl as unknown;
      }
    });
  });
});

describe('t — defensive paths', () => {
  test('returns the string-id verbatim when neither locale nor en has the key', () => {
    // Cast forces an "unknown" id past the StringId type guard,
    // exercising the `?? String(id)` last-ditch fallback. In
    // practice this only fires if we ever ship a typo'd id.
    const unknown = 'popup.unknownKeyForTesting' as 'popup.synonyms';
    expect(t(unknown, 'en')).toBe('popup.unknownKeyForTesting');
  });
});

describe('normaliseLocale', () => {
  test('exact match returns as-is', () => {
    expect(normaliseLocale('zh_CN')).toBe('zh_CN');
    expect(normaliseLocale('ja')).toBe('ja');
  });

  test('hyphen variant resolves to underscore variant', () => {
    expect(normaliseLocale('zh-TW')).toBe('zh_TW');
    expect(normaliseLocale('zh-CN')).toBe('zh_CN');
  });

  test('language-only fallback (ja_JP -> ja)', () => {
    expect(normaliseLocale('ja_JP')).toBe('ja');
  });

  test('Cantonese / HK / unknown-zh falls back to zh_TW', () => {
    expect(normaliseLocale('zh_HK')).toBe('zh_TW');
    expect(normaliseLocale('zh_SG')).toBe('zh_TW');
  });

  test('completely unknown locale falls back to en', () => {
    expect(normaliseLocale('xx_YY')).toBe('en');
    expect(normaliseLocale('klingon')).toBe('en');
  });
});

describe('localizedButtonName / localizedPluginName', () => {
  test('button name is a JSON-encoded {locale: name} map covering every UI locale', () => {
    const parsed = JSON.parse(localizedButtonName());
    expect(parsed.en).toBe('Lookup');
    expect(parsed.zh_CN).toBe('查询');
    expect(parsed.zh_TW).toBe('查詢');
    expect(parsed.ja).toBe('検索');
    expect(parsed.th).toBe('ค้นหา');
    expect(parsed.nl).toBe('Opzoeken');
    expect(parsed.de).toBe('Nachschlagen');
    // Every locale in the strings table also has a button-name row.
    for (const locale of Object.keys(STRINGS)) {
      expect(BUTTON_NAME[locale]).toBeDefined();
    }
  });

  test('plugin name is a JSON-encoded {locale: name} map covering every UI locale', () => {
    const parsed = JSON.parse(localizedPluginName());
    expect(parsed.en).toBe('Dictionary');
    expect(parsed.zh_CN).toBe('词典');
    expect(parsed.zh_TW).toBe('詞典');
    expect(parsed.ja).toBe('辞書');
    expect(parsed.th).toBe('พจนานุกรม');
    expect(parsed.nl).toBe('Woordenboek');
    expect(parsed.de).toBe('Wörterbuch');
    for (const locale of Object.keys(STRINGS)) {
      expect(PLUGIN_NAME[locale]).toBeDefined();
    }
  });
});
