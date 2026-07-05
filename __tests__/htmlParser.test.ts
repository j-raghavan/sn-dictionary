// Direct tests for the shared HTML tokenizer. Most of its behaviour
// is exercised through htmlToPlainText / htmlToSpans, but a few
// parser-level edge cases (attribute quoting, malformed tags,
// entity decoding boundaries) are clearer to pin at this layer.

import {
  parseHtml,
  looksLikeHtml,
  containsRenderableHtml,
  type TagInfo,
} from '../src/ui/htmlParser';

type Event =
  | {kind: 'text'; value: string}
  | {kind: 'tag'; tag: TagInfo};

const collect = (html: string): Event[] => {
  const events: Event[] = [];
  parseHtml(html, {
    onText: (value) => events.push({kind: 'text', value}),
    onTag: (tag) => events.push({kind: 'tag', tag}),
  });
  return events;
};

describe('looksLikeHtml', () => {
  test('detects opening tags', () => {
    expect(looksLikeHtml('<i>hi</i>')).toBe(true);
  });

  test('detects self-closing tags', () => {
    expect(looksLikeHtml('hi<br/>there')).toBe(true);
  });

  test('detects close tags only', () => {
    expect(looksLikeHtml('hi</i>')).toBe(true);
  });

  test('rejects plain text', () => {
    expect(looksLikeHtml('a greeting used for most purposes')).toBe(false);
  });

  test('rejects text with stray angle brackets (no tag-like name)', () => {
    expect(looksLikeHtml('x < y')).toBe(false);
  });
});

describe('parseHtml — empty + fast path', () => {
  test('empty string emits nothing', () => {
    expect(collect('')).toEqual([]);
  });

  test('plain text without entities or tags emits a single text event', () => {
    expect(collect('hello world')).toEqual([
      {kind: 'text', value: 'hello world'},
    ]);
  });
});

describe('parseHtml — tag events', () => {
  test('open tag emits {isClose: false}', () => {
    expect(collect('<b>')).toEqual([
      {kind: 'tag', tag: {name: 'b', isClose: false, attrs: {}}},
    ]);
  });

  test('close tag emits {isClose: true}', () => {
    expect(collect('</b>')).toEqual([
      {kind: 'tag', tag: {name: 'b', isClose: true, attrs: {}}},
    ]);
  });

  test('self-closing tag emits a single open event (no close)', () => {
    // Consumer-side note: <br/> only emits open. Tags whose semantic
    // close is a no-op (br, hr, img) should be handled by ignoring
    // close events for those names; this parser never invents one.
    expect(collect('<br/>')).toEqual([
      {kind: 'tag', tag: {name: 'br', isClose: false, attrs: {}}},
    ]);
  });

  test('lowercases tag names', () => {
    expect(collect('<DIV><Br></DIV>')).toEqual([
      {kind: 'tag', tag: {name: 'div', isClose: false, attrs: {}}},
      {kind: 'tag', tag: {name: 'br', isClose: false, attrs: {}}},
      {kind: 'tag', tag: {name: 'div', isClose: true, attrs: {}}},
    ]);
  });
});

describe('parseHtml — attribute parsing', () => {
  test('double-quoted attribute value', () => {
    expect(collect('<font color="green">')).toEqual([
      {
        kind: 'tag',
        tag: {name: 'font', isClose: false, attrs: {color: 'green'}},
      },
    ]);
  });

  test('single-quoted attribute value', () => {
    expect(collect("<font color='red'>")).toEqual([
      {
        kind: 'tag',
        tag: {name: 'font', isClose: false, attrs: {color: 'red'}},
      },
    ]);
  });

  test('unquoted attribute value', () => {
    expect(collect('<font color=blue>')).toEqual([
      {
        kind: 'tag',
        tag: {name: 'font', isClose: false, attrs: {color: 'blue'}},
      },
    ]);
  });

  test('multiple attributes on one tag', () => {
    expect(collect('<a href="https://x" title="t">')).toEqual([
      {
        kind: 'tag',
        tag: {
          name: 'a',
          isClose: false,
          attrs: {href: 'https://x', title: 't'},
        },
      },
    ]);
  });

  test('valueless boolean-style attribute records empty string', () => {
    expect(collect('<input disabled>')).toEqual([
      {
        kind: 'tag',
        tag: {name: 'input', isClose: false, attrs: {disabled: ''}},
      },
    ]);
  });

  test('attribute names lowercase', () => {
    expect(collect('<font Color="green">')).toEqual([
      {
        kind: 'tag',
        tag: {name: 'font', isClose: false, attrs: {color: 'green'}},
      },
    ]);
  });

  test('whitespace around = is tolerated', () => {
    expect(collect('<font color = "green">')).toEqual([
      {
        kind: 'tag',
        tag: {name: 'font', isClose: false, attrs: {color: 'green'}},
      },
    ]);
  });

  test('self-closing slash does not become an attribute', () => {
    expect(collect('<br />')).toEqual([
      {kind: 'tag', tag: {name: 'br', isClose: false, attrs: {}}},
    ]);
  });
});

describe('parseHtml — entity decoding', () => {
  test('named entities decode to characters', () => {
    expect(collect('a&amp;b&nbsp;c')).toEqual([
      // NBSP (U+00A0) is what &nbsp; decodes to.
      {kind: 'text', value: 'a&b\u00a0c'},
    ]);
  });

  test('numeric decimal entity', () => {
    expect(collect('&#65;')).toEqual([{kind: 'text', value: 'A'}]);
  });

  test('numeric hex entity (lowercase x)', () => {
    expect(collect('&#x41;')).toEqual([{kind: 'text', value: 'A'}]);
  });

  test('numeric hex entity (uppercase X)', () => {
    expect(collect('&#X41;')).toEqual([{kind: 'text', value: 'A'}]);
  });

  test('out-of-range numeric entity emits nothing', () => {
    expect(collect('&#999999999;')).toEqual([]);
  });

  test('zero numeric entity emits nothing (codepoint 0 is rejected)', () => {
    expect(collect('&#0;')).toEqual([]);
  });

  test('unknown named entity emits nothing for the entity itself', () => {
    expect(collect('a&totallymadeup;b')).toEqual([{kind: 'text', value: 'ab'}]);
  });

  test('& with no semicolon within 20 chars is literal', () => {
    expect(collect('use & for and')).toEqual([
      {kind: 'text', value: 'use & for and'},
    ]);
  });

  test('empty entity (&;) emits nothing for the entity', () => {
    expect(collect('a&;b')).toEqual([{kind: 'text', value: 'ab'}]);
  });

  test('expanded named entities decode to their characters', () => {
    expect(collect('a&bull;b&mdash;c&hellip;')).toEqual([
      {kind: 'text', value: 'a•b—c…'},
    ]);
    expect(collect('&laquo;x&raquo; &deg; &copy; &rarr;')).toEqual([
      {kind: 'text', value: '«x» ° © →'},
    ]);
  });

  test('case-sensitive entities stay distinct (Dagger vs dagger, Prime vs prime)', () => {
    // Exact-case hit wins before the lowercase fold, so the two forms
    // resolve to DIFFERENT glyphs rather than collapsing to one.
    expect(collect('&dagger;&Dagger;')).toEqual([{kind: 'text', value: '†‡'}]);
    expect(collect('&prime;&Prime;')).toEqual([{kind: 'text', value: '′″'}]);
  });

  test('an all-caps spelling of a lowercase entity still folds', () => {
    // No exact-case key for BULL, so it falls back to the lowercased
    // lookup — every pre-existing entity keeps resolving.
    expect(collect('&BULL;')).toEqual([{kind: 'text', value: '•'}]);
  });

  test('Object.prototype member names are NOT resolved as entities', () => {
    // The entity map has a null prototype, so `&toString;` / `&constructor;`
    // / `&__proto__;` don't leak an inherited function/object into the body
    // (they'd otherwise render "function toString() { … }").
    expect(collect('a&toString;b')).toEqual([{kind: 'text', value: 'ab'}]);
    expect(collect('a&constructor;b')).toEqual([{kind: 'text', value: 'ab'}]);
    expect(collect('a&__proto__;b')).toEqual([{kind: 'text', value: 'ab'}]);
    expect(collect('a&hasOwnProperty;b')).toEqual([{kind: 'text', value: 'ab'}]);
    expect(collect('a&valueOf;b')).toEqual([{kind: 'text', value: 'ab'}]);
  });
});

describe('containsRenderableHtml', () => {
  test('true for a matched structural tag pair', () => {
    expect(containsRenderableHtml('a <b>bold</b> word')).toBe(true);
    expect(containsRenderableHtml('<font color="green">x</font>')).toBe(true);
    expect(containsRenderableHtml('<ol><li>one</li></ol>')).toBe(true);
  });

  test('true for an explicit <br>', () => {
    expect(containsRenderableHtml('line one<br>line two')).toBe(true);
    expect(containsRenderableHtml('line one<br/>line two')).toBe(true);
  });

  test('false for plain text', () => {
    expect(containsRenderableHtml('a greeting used for most purposes')).toBe(
      false,
    );
  });

  test('false for standalone plain-dict pseudo-tags (no matched pair)', () => {
    // These appear as lone markers in plain (non-HTML) dicts; the paired
    // requirement is what stops them being handed to the HTML renderer.
    expect(containsRenderableHtml('<thgt>a thought marker')).toBe(false);
    expect(containsRenderableHtml('word <snh> sub-headword')).toBe(false);
    expect(containsRenderableHtml('<latin> lorem ipsum')).toBe(false);
  });

  test('false for thesaurus <UL>/<US> spelling labels (NOT list tags)', () => {
    // The thesaurus uses <UL>/<US> as standalone spelling labels; with no
    // close tag they must NOT be mistaken for <ul> list markup.
    expect(containsRenderableHtml('color <US> colour <UL>')).toBe(false);
  });

  test('false when an open tag is never closed', () => {
    expect(containsRenderableHtml('<b>bold but never closed')).toBe(false);
  });

  test('false when open/close tags mismatch', () => {
    // The backreference forces the SAME tag name; <b>…</i> is not a pair.
    expect(containsRenderableHtml('<b>text</i>')).toBe(false);
  });
});

describe('parseHtml — malformed input', () => {
  test('unclosed tag at end-of-input surfaces as literal text', () => {
    // The fast path doesn't fire (input has '<' that does NOT match
    // a well-formed tag pattern). The slow path's no-> branch
    // captures the suffix as text.
    expect(collect('<b>good</b> tail <unclosed extra')).toEqual([
      {kind: 'tag', tag: {name: 'b', isClose: false, attrs: {}}},
      {kind: 'text', value: 'good'},
      {kind: 'tag', tag: {name: 'b', isClose: true, attrs: {}}},
      // Adjacent text events are NOT merged by the parser; the
      // pre-tag flush emits this slice on its own.
      {kind: 'text', value: ' tail <unclosed extra'},
    ]);
  });

  test('input that starts with < but has no closing > is literal text', () => {
    // Fast path: looksLikeHtml is false (no well-formed-looking
    // tag), no '&' either, so the parser emits the whole input as
    // a single text event without scanning.
    expect(collect('a <unclosed b c')).toEqual([
      {kind: 'text', value: 'a <unclosed b c'},
    ]);
  });

  test('UTF-8 / multi-byte content inside tags survives', () => {
    expect(collect('<i>नमस्ते</i>')).toEqual([
      {kind: 'tag', tag: {name: 'i', isClose: false, attrs: {}}},
      {kind: 'text', value: 'नमस्ते'},
      {kind: 'tag', tag: {name: 'i', isClose: true, attrs: {}}},
    ]);
  });
});
