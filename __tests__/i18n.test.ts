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

  test('renders all configured locales for every popup string', () => {
    const localeRows = Object.keys(STRINGS);
    const ids: Array<'popup.synonyms' | 'popup.close' | 'popup.notFoundFor' | 'popup.ocr'> = [
      'popup.synonyms',
      'popup.close',
      'popup.notFoundFor',
      'popup.ocr',
    ];
    for (const locale of localeRows) {
      for (const id of ids) {
        const value = t(id, locale);
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
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
