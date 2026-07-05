// Shared HTML tokenizer used by every dictionary-entry render path.
//
// Why a tokenizer (vs. continuing the inline state-machine pattern
// `htmlToPlainText` shipped in v1.0.6): two consumers now share the
// same parse — the plain-text reducer used by tests + non-RN paths,
// and the React Native span renderer that emits nested <Text> for
// bold / italic / colour. Doing the parse twice would be wasted work
// and a divergence hazard. A single visitor-style emitter keeps the
// tag set, entity table, and malformed-tag handling in one place.
//
// Design constraints carried over from htmlToPlainText:
//   - Single-pass, no DOM library, no regex over the whole string.
//     RN's JS engine has no DOMParser; pulling in an HTML parser is
//     overkill for the structural tag set dicts use.
//   - Entity decoding for the small set Wikdict / Wiktionary actually
//     emit (named + numeric), with a 20-char ceiling to keep runaway
//     `&...` from a malformed body cheap.
//   - Malformed unclosed tags surface as literal text rather than
//     silently swallowing the rest of the entry.

export type TagInfo = {
  // Lowercased tag name with no leading slash.
  name: string;
  // True for `</foo>`, false for `<foo>` and `<foo/>`. Self-closing
  // detection is left to the caller — `<br>` and `<br/>` both arrive
  // as `{name:'br', isClose:false}`. Tags whose close tag is
  // semantically a no-op (br, hr) are typically handled by ignoring
  // close-side events for that name.
  isClose: boolean;
  // Attribute map, lowercased keys, raw (entity-undecoded) values.
  // Kept lazy-ish: we only parse the inside of the tag once per
  // open/close, but every consumer pays the cost. In practice tag
  // attribute counts in dict HTML are tiny (`<font color="green">`,
  // `<a href="...">`) so this never shows up in profiling.
  attrs: Record<string, string>;
};

export type HtmlVisitor = {
  // Called for each contiguous run of decoded text content. NEVER
  // called with the empty string — the parser elides empty flushes.
  onText(text: string): void;
  // Called for every tag boundary (open and close). Self-closing
  // tags (`<br/>`) emit a single `{isClose:false}` event — close-side
  // is the consumer's responsibility for tags where it matters.
  onTag(tag: TagInfo): void;
};

// Named entities dict bodies actually emit. Keys are case-SENSITIVE:
// `Dagger`/`prime` etc. are distinct entities from `dagger`/`Prime`,
// so decodeEntity tries an exact-case hit before folding to lowercase.
//
// NULL-PROTOTYPE map: a plain object literal inherits `toString`,
// `constructor`, `valueOf`, `__proto__`, … from Object.prototype, so
// `ENTITY_MAP['toString']` would resolve a truthy function and make
// `&toString;` render its source. Object.create(null) has no prototype
// chain, so a missing key is always `undefined` and folds to '' below.
const ENTITY_MAP: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  bull: '•',
  middot: '·',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  times: '×',
  divide: '÷',
  deg: '°',
  copy: '©',
  reg: '®',
  trade: '™',
  para: '¶',
  sect: '§',
  dagger: '†',
  Dagger: '‡',
  prime: '′',
  Prime: '″',
  larr: '←',
  rarr: '→',
  harr: '↔',
  nbsp: ' ',
  },
);

const decodeEntity = (entity: string): string => {
  if (entity.length === 0) {
    return '';
  }
  if (entity[0] === '#') {
    const isHex = entity[1] === 'x' || entity[1] === 'X';
    const codepoint = isHex
      ? parseInt(entity.slice(2), 16)
      : parseInt(entity.slice(1), 10);
    if (Number.isFinite(codepoint) && codepoint > 0 && codepoint <= 0x10ffff) {
      try {
        return String.fromCodePoint(codepoint);
      } catch {
        return '';
      }
    }
    return '';
  }
  // Exact case first (so `Dagger`/`Prime` stay distinct from
  // `dagger`/`prime`), then fold. Unknown -> '' (never echo the
  // literal `&foo;` back into the body).
  return ENTITY_MAP[entity] ?? ENTITY_MAP[entity.toLowerCase()] ?? '';
};

const HAS_HTML_TAG = /<\/?[a-zA-Z][^>]*>/;

// Lowercased tag name without the leading slash. Stops at the first
// whitespace, `/`, or `>` after the name.
const tagNameOf = (rawTag: string): string => {
  const trimmed = rawTag.trim();
  const stripped = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const spaceOrSlash = stripped.search(/[\s/>]/);
  return (
    spaceOrSlash < 0 ? stripped : stripped.slice(0, spaceOrSlash)
  ).toLowerCase();
};

// Parse the body of a tag (e.g. `font color="green" size="3"`) into
// an attribute map. Tolerant of the loose attribute syntax dict HTML
// uses in practice: unquoted values, missing values, mixed quote
// styles. Quote-stripping is shallow — entity decoding inside the
// value is left to consumers, since attribute values almost never
// carry entities in dict bodies.
const parseTagAttrs = (rawTag: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const start = rawTag.startsWith('/') ? 1 : 0;
  let i = start;
  // Skip the tag name itself.
  while (i < rawTag.length && !/[\s/>]/.test(rawTag[i])) {
    i++;
  }
  while (i < rawTag.length) {
    // Skip any whitespace between attributes.
    while (i < rawTag.length && /\s/.test(rawTag[i])) {
      i++;
    }
    if (i >= rawTag.length || rawTag[i] === '/' || rawTag[i] === '>') {
      break;
    }
    const nameStart = i;
    while (i < rawTag.length && !/[\s=/>]/.test(rawTag[i])) {
      i++;
    }
    const name = rawTag.slice(nameStart, i).toLowerCase();
    while (i < rawTag.length && /\s/.test(rawTag[i])) {
      i++;
    }
    if (rawTag[i] !== '=') {
      // Boolean / valueless attribute (`<input disabled>`-style).
      // Dict HTML doesn't use these, but recording them as empty
      // string keeps the consumer contract simple.
      attrs[name] = '';
      continue;
    }
    i++; // consume '='
    while (i < rawTag.length && /\s/.test(rawTag[i])) {
      i++;
    }
    let value = '';
    if (rawTag[i] === '"' || rawTag[i] === "'") {
      const quote = rawTag[i];
      i++;
      const valStart = i;
      while (i < rawTag.length && rawTag[i] !== quote) {
        i++;
      }
      value = rawTag.slice(valStart, i);
      if (i < rawTag.length) {
        i++; // consume closing quote
      }
    } else {
      const valStart = i;
      while (i < rawTag.length && !/[\s/>]/.test(rawTag[i])) {
        i++;
      }
      value = rawTag.slice(valStart, i);
    }
    attrs[name] = value;
  }
  return attrs;
};

// Returns true if the input looks like HTML (contains at least one
// well-formed-looking tag). Lets the popup short-circuit and skip
// the tokenizer for plain text.
export const looksLikeHtml = (s: string): boolean => HAS_HTML_TAG.test(s);

// A matched OPEN/CLOSE pair of a known structural tag, e.g.
// `<b>...</b>`, `<font ...>...</font>`. The backreference \1 forces the
// close tag to match the open — so a stray standalone pseudo-tag a plain
// dict emits (`<thgt>`, `<snh>`, `<US>`, `<UL>`, `<latin>`) never fires.
// Notably the thesaurus's <UL>/<US> are spelling labels, NOT list tags;
// the paired requirement is exactly what keeps them from being rendered.
const HTML_PAIR =
  /<(b|i|strong|em|font|div|span|p|ol|ul|li|a)(?:\s[^>]*)?>[\s\S]*?<\/\1>/i;
const HTML_BR = /<br\s*\/?>/i;

// Stricter than looksLikeHtml: true only when the string carries HTML
// a renderer should actually lay out — a matched structural pair or an
// explicit <br>. Used by the 'plain'-format branch to decide whether a
// definition that was NOT typed as HTML nonetheless contains real markup
// worth handing to HtmlText, without misfiring on the standalone
// pseudo-tags plain dicts pepper through their text.
export const containsRenderableHtml = (s: string): boolean =>
  HTML_BR.test(s) || HTML_PAIR.test(s);

// Walk `html` and dispatch text + tag events to `visitor`. Idempotent
// on input with no tags AND no entities (visitor.onText receives the
// whole string in one call). Malformed unclosed tags are surfaced as
// literal text via onText so the trailing content isn't lost.
export const parseHtml = (html: string, visitor: HtmlVisitor): void => {
  if (html.length === 0) {
    return;
  }
  // Fast path: no markup of any kind. One text event, no scanning.
  if (!looksLikeHtml(html) && html.indexOf('&') < 0) {
    visitor.onText(html);
    return;
  }
  let buf = '';
  let i = 0;
  const flush = (): void => {
    if (buf.length > 0) {
      visitor.onText(buf);
      buf = '';
    }
  };
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end < 0) {
        // Malformed: no closing '>'. Treat the rest as text rather
        // than silently dropping the suffix.
        buf += html.slice(i);
        break;
      }
      flush();
      const inner = html.slice(i + 1, end);
      const isClose = inner.trim().startsWith('/');
      visitor.onTag({
        name: tagNameOf(inner),
        isClose,
        attrs: parseTagAttrs(inner),
      });
      i = end + 1;
    } else if (ch === '&') {
      const semi = html.indexOf(';', i);
      // Entity references are short. If we can't find a ';' within
      // 20 chars, treat the '&' as literal. The limit covers long
      // numeric entities AND verbose-but-reasonable named ones;
      // anything longer is almost certainly not an entity.
      if (semi < 0 || semi - i > 20) {
        buf += '&';
        i++;
      } else {
        buf += decodeEntity(html.slice(i + 1, semi));
        i = semi + 1;
      }
    } else {
      buf += ch;
      i++;
    }
  }
  flush();
};
