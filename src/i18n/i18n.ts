// Bilingual UI chrome for the popup and the toolbar buttons. The
// dictionary CONTENT stays English (WordNet) — users who want
// non-English content build their own .snplg via the Prong B
// converter — but the surrounding labels, the plugin name, and the
// button names render in the user's locale.
//
// Locale detection: try Intl.Collator's resolved locale (works in
// modern Hermes / JSC), fall back to en. The detected locale is
// resolved once at module load and reused — locale doesn't change
// during a plugin session.
//
// Strings the user actually sees:
//   - The plugin name on the plugin manager card (driven by
//     PluginConfig.json's `name` field, which the firmware parses
//     as a JSON-encoded {locale: string} map; see Sticker plugin
//     for a working precedent).
//   - The button label in the lasso / DOC selection toolbar
//     (driven by registerButton's `button.name`, same JSON-encoded
//     map convention).
//   - The popup labels: "Synonyms", "OCR", "No definition found
//     for", "Close".

export type StringId =
  | 'popup.synonyms'
  | 'popup.ocr'
  | 'popup.notFoundFor'
  | 'popup.close'
  | 'popup.loading';

// Locale codes use the firmware's convention: en, zh_CN, zh_TW, ja,
// th, nl. Underscore (not hyphen) matches PluginButton.nameMap shape
// observed in logcat for sibling plugins.
const STRINGS: Record<string, Partial<Record<StringId, string>>> = {
  en: {
    'popup.synonyms': 'Synonyms',
    'popup.ocr': 'OCR',
    'popup.notFoundFor': 'No definition found for',
    'popup.close': 'Close',
    'popup.loading': 'Loading…',
  },
  zh_CN: {
    'popup.synonyms': '同义词',
    'popup.ocr': '识别',
    'popup.notFoundFor': '未找到定义：',
    'popup.close': '关闭',
    'popup.loading': '加载中…',
  },
  zh_TW: {
    'popup.synonyms': '同義詞',
    'popup.ocr': '辨識',
    'popup.notFoundFor': '未找到定義：',
    'popup.close': '關閉',
    'popup.loading': '載入中…',
  },
  ja: {
    'popup.synonyms': '類義語',
    'popup.ocr': 'OCR',
    'popup.notFoundFor': '定義が見つかりません：',
    'popup.close': '閉じる',
    'popup.loading': '読み込み中…',
  },
  th: {
    'popup.synonyms': 'คำพ้องความหมาย',
    'popup.ocr': 'OCR',
    'popup.notFoundFor': 'ไม่พบคำจำกัดความสำหรับ',
    'popup.close': 'ปิด',
    'popup.loading': 'กำลังโหลด…',
  },
  nl: {
    'popup.synonyms': 'Synoniemen',
    'popup.ocr': 'OCR',
    'popup.notFoundFor': 'Geen definitie gevonden voor',
    'popup.close': 'Sluiten',
    'popup.loading': 'Bezig met laden…',
  },
  de: {
    'popup.synonyms': 'Synonyme',
    'popup.ocr': 'OCR',
    'popup.notFoundFor': 'Keine Definition gefunden für',
    'popup.close': 'Schließen',
    'popup.loading': 'Wird geladen…',
  },
};

// Toolbar button label — the firmware reads this as a JSON-encoded
// {locale: string} map and picks the right one for the device
// locale (see Sticker plugin's logcat trace for the proven shape).
const BUTTON_NAME: Record<string, string> = {
  en: 'Lookup',
  zh_CN: '查询',
  zh_TW: '查詢',
  ja: '検索',
  th: 'ค้นหา',
  nl: 'Opzoeken',
  de: 'Nachschlagen',
};

// Plugin display name on the plugin manager card.
const PLUGIN_NAME: Record<string, string> = {
  en: 'Dictionary',
  zh_CN: '词典',
  zh_TW: '詞典',
  ja: '辞書',
  th: 'พจนานุกรม',
  nl: 'Woordenboek',
  de: 'Wörterbuch',
};

const FALLBACK_LOCALE = 'en';

const normaliseLocale = (raw: string): string => {
  // Map BCP-47 hyphens to firmware-style underscores so 'zh-CN' from
  // Intl resolves the same row as our 'zh_CN' table key.
  const swap = raw.replace('-', '_');
  if (STRINGS[swap]) {
    return swap;
  }
  // Try language-only (e.g. 'zh_HK' -> 'zh' -> not present, then en).
  const lang = swap.split('_')[0];
  if (STRINGS[lang]) {
    return lang;
  }
  // Cantonese / Hong Kong falls back to traditional rather than en.
  if (swap.startsWith('zh') && STRINGS.zh_TW) {
    return 'zh_TW';
  }
  return FALLBACK_LOCALE;
};

export const detectLocale = (): string => {
  try {
    if (typeof Intl !== 'undefined' && Intl.Collator) {
      const resolved = new Intl.Collator().resolvedOptions().locale;
      if (resolved) {
        return normaliseLocale(resolved);
      }
    }
  } catch {
    // fall through
  }
  return FALLBACK_LOCALE;
};

const LOCALE = detectLocale();

export const t = (id: StringId, locale: string = LOCALE): string => {
  const resolved = normaliseLocale(locale);
  return (
    STRINGS[resolved]?.[id] ?? STRINGS[FALLBACK_LOCALE][id] ?? String(id)
  );
};

// JSON-encoded map of {locale: name} — what the firmware expects in
// PluginButton.name and PluginConfig.json's `name` field. Identical
// shape across both, so one helper covers both consumers.
export const localizedButtonName = (): string => JSON.stringify(BUTTON_NAME);
export const localizedPluginName = (): string => JSON.stringify(PLUGIN_NAME);

export const __testing__ = {
  STRINGS,
  BUTTON_NAME,
  PLUGIN_NAME,
  normaliseLocale,
};
