// Convert HTML-formatted definition text into plain text suitable for
// the popup's fallback render path. Used for StarDict dicts whose
// .ifo declares `sametypesequence=h` (Wiktionary-derived dicts in
// particular), and as a safety net for any user-authored CSV/JSON
// definition that happens to contain HTML.
//
// Design constraints:
// - Single-pass, no DOM, no regex over the whole string. RN's JS engine
//   has no DOMParser; pulling in an HTML parser library is overkill for
//   the structural-tag set dicts use in practice.
// - Idempotent on plain text (no `<` or `&` -> output equals input
//   modulo whitespace collapse). WordNet entries flow through
//   untouched; the existing parseWordNetEntry path still runs first.
// - Conservative tag handling: known structural tags get layout
//   substitutions; everything else is dropped (content kept).

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

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
  return ENTITY_MAP[entity.toLowerCase()] ?? '';
};

// Identify the bare tag name from "<i>", "</i>", "<br/>", "<li class=x>".
// Returns lowercased name without the leading slash.
const tagNameOf = (rawTag: string): string => {
  const trimmed = rawTag.trim();
  const stripped = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const spaceOrSlash = stripped.search(/[\s/>]/);
  return (spaceOrSlash < 0 ? stripped : stripped.slice(0, spaceOrSlash)).toLowerCase();
};

const HAS_HTML_TAG = /<\/?[a-zA-Z][^>]*>/;

// Returns true if the input looks like HTML (contains at least one
// well-formed-looking tag). Lets the popup short-circuit and skip the
// converter for plain text.
export const looksLikeHtml = (s: string): boolean => HAS_HTML_TAG.test(s);

export const htmlToPlainText = (html: string): string => {
  if (!looksLikeHtml(html) && html.indexOf('&') < 0) {
    return html;
  }
  let out = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end < 0) {
        // Malformed: no closing '>'. Treat the rest as text rather
        // than dropping it.
        out += html.slice(i);
        break;
      }
      const name = tagNameOf(html.slice(i + 1, end));
      // Layout substitutions for the structural tags Wiktionary-style
      // dicts use. Other tags (i, b, span, font, …) drop, content stays.
      if (name === 'br') {
        out += '\n';
      } else if (name === 'li' && !html.slice(i + 1, end).trim().startsWith('/')) {
        // Opening <li>: introduce a bullet on its own line.
        out += '\n• ';
      } else if (name === 'p' && !html.slice(i + 1, end).trim().startsWith('/')) {
        // Opening <p>: paragraph break.
        out += '\n\n';
      }
      // /li, /ol, /ul, ol, ul, /p, and all unknown tags: no output.
      i = end + 1;
    } else if (ch === '&') {
      const semi = html.indexOf(';', i);
      // Entity references are short. If we can't find a ';' within
      // 20 chars, treat the '&' as literal. The limit covers long
      // numeric entities (`&#1234567890;`) and verbose-but-reasonable
      // named ones; anything longer is almost certainly not an entity.
      if (semi < 0 || semi - i > 20) {
        out += '&';
        i++;
      } else {
        out += decodeEntity(html.slice(i + 1, semi));
        i = semi + 1;
      }
    } else {
      out += ch;
      i++;
    }
  }
  // Tidy: collapse runs of inline whitespace and any multi-newline
  // sequence to a single newline. This produces tight output where
  // each visible line is either a label, a bullet, or a paragraph —
  // matching what users actually want for definition rendering. A
  // <br> immediately followed by <li> shouldn't waste a blank line.
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
};
