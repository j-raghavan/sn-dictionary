import {htmlToSpans, type Span} from '../src/ui/htmlToSpans';

// Helper: collapse a span list into the visible plain text (ignoring
// styles). Pinned to the same shape htmlToPlainText produces — any
// drift between the two is a bug in the shared HtmlBaseRenderer.
const concatText = (spans: Span[]): string =>
  spans.map((s) => s.text).join('');

// Helper: extract just the text + a compact style summary per span,
// for readable assertion failures. Style summary is "B" for bold,
// "I" for italic, color string verbatim if present, "-" for none.
const summary = (spans: Span[]): Array<[string, string]> =>
  spans.map((s) => {
    const tags: string[] = [];
    if (s.style.bold) {
      tags.push('B');
    }
    if (s.style.italic) {
      tags.push('I');
    }
    if (s.style.color) {
      tags.push(`color=${s.style.color}`);
    }
    return [s.text, tags.length === 0 ? '-' : tags.join(',')];
  });

describe('htmlToSpans — basic shape', () => {
  test('empty input returns empty array', () => {
    expect(htmlToSpans('')).toEqual([]);
  });

  test('plain text returns a single unstyled span', () => {
    const spans = htmlToSpans('a greeting used for most purposes');
    expect(spans).toEqual([
      {text: 'a greeting used for most purposes', style: {}},
    ]);
  });

  test('inline tags strip and produce a single unstyled span when no styling applies', () => {
    const spans = htmlToSpans('<span>plain inside span</span>');
    expect(concatText(spans)).toBe('plain inside span');
    expect(spans.every((s) => Object.keys(s.style).length === 0)).toBe(true);
  });
});

describe('htmlToSpans — inline styling', () => {
  test('<b> wraps content in a bold span', () => {
    const spans = htmlToSpans('a <b>bold</b> word');
    expect(summary(spans)).toEqual([
      ['a ', '-'],
      ['bold', 'B'],
      [' word', '-'],
    ]);
  });

  test('<strong> is treated identically to <b>', () => {
    expect(summary(htmlToSpans('<strong>x</strong>'))).toEqual([['x', 'B']]);
  });

  test('<i> wraps content in an italic span', () => {
    const spans = htmlToSpans('<i>POS</i> word');
    expect(summary(spans)).toEqual([
      ['POS', 'I'],
      [' word', '-'],
    ]);
  });

  test('<em> is treated identically to <i>', () => {
    expect(summary(htmlToSpans('<em>x</em>'))).toEqual([['x', 'I']]);
  });

  test('nested <b><i>x</i></b> merges to bold+italic on the leaf span', () => {
    expect(summary(htmlToSpans('<b><i>x</i></b>'))).toEqual([['x', 'B,I']]);
  });

  test('<font color="green"> contributes a color hint', () => {
    expect(summary(htmlToSpans('<font color="green">noun</font>'))).toEqual([
      ['noun', 'color=green'],
    ]);
  });

  test('innermost <font color> wins when nested', () => {
    expect(
      summary(htmlToSpans('<font color="red"><font color="blue">x</font></font>')),
    ).toEqual([['x', 'color=blue']]);
  });

  test('<font> with no color attribute is a no-op', () => {
    expect(summary(htmlToSpans('<font>x</font>'))).toEqual([['x', '-']]);
  });
});

describe('htmlToSpans — layout never carries surrounding style', () => {
  test('<i><br></i> emits an unstyled newline (layout out of italic scope)', () => {
    // The <br> sits inside an <i> scope. The line break is layout,
    // so the unstyled span must NOT inherit italic. Otherwise an
    // outer italic POS scope would italicise the newline / list
    // markers that follow inside it.
    const spans = htmlToSpans('<i>a<br>b</i>');
    // We expect: ["a" italic][newline unstyled]["b" italic].
    const tagged = summary(spans);
    expect(tagged).toContainEqual(['a', 'I']);
    expect(tagged).toContainEqual(['b', 'I']);
    // The newline span has no italic.
    const newlineSpan = spans.find((s) => s.text === '\n');
    expect(newlineSpan).toBeDefined();
    expect(newlineSpan?.style.italic).toBeFalsy();
  });

  test('list markers emitted inside <font color> scope are unstyled', () => {
    const spans = htmlToSpans(
      '<font color="green"><ol><li>a</li></ol></font>',
    );
    // Marker chunk "1. " (with leading newline depending on
    // position). It must NOT carry color=green even though it's
    // emitted inside the <font> scope.
    const marker = spans.find((s) => s.text.includes('1.'));
    expect(marker).toBeDefined();
    expect(marker?.style.color).toBeFalsy();
    // The actual content "a" inherits the color.
    const content = spans.find((s) => s.text === 'a');
    expect(content?.style.color).toBe('green');
  });
});

describe('htmlToSpans — list rendering matches plain-text shape', () => {
  test('<ol><li>...</li></ol> produces "N. " markers', () => {
    const spans = htmlToSpans('<ol><li>first</li><li>second</li></ol>');
    expect(concatText(spans)).toBe('1. first\n2. second');
  });

  test('<ul><li>...</li></ul> produces "• " bullets', () => {
    const spans = htmlToSpans('<ul><li>first</li><li>second</li></ul>');
    expect(concatText(spans)).toBe('• first\n• second');
  });

  test('nested <ol> under <ol> indents inner items by 2 spaces per depth', () => {
    const html =
      '<ol><li>outer one<ol><li>inner a</li><li>inner b</li></ol></li>' +
      '<li>outer two</li></ol>';
    expect(concatText(htmlToSpans(html))).toBe(
      '1. outer one\n  1. inner a\n  2. inner b\n2. outer two',
    );
  });
});

describe('htmlToSpans — translation (<div>) emboldening', () => {
  test('inline <div> after content emits " — " unstyled and bolds the translation', () => {
    // The exact issue #19 / #15 shape: definition body inline-followed
    // by a <div>translation</div>.
    const spans = htmlToSpans(
      '<ol><li>Astronomie: der Kosmos<div>ciel</div></li></ol>',
    );
    // Visible text matches the plain-text path.
    expect(concatText(spans)).toBe('1. Astronomie: der Kosmos — ciel');
    // The translation word is bold.
    const translationSpan = spans.find((s) => s.text === 'ciel');
    expect(translationSpan?.style.bold).toBe(true);
    // The em-dash separator is layout — never bold (otherwise the
    // bold scope would visually expand past the word). Coalescing
    // merges adjacent unstyled chunks, so the dash lives inside a
    // larger unstyled span; assert that whichever span contains
    // " — " is NOT bold.
    const dashContainer = spans.find((s) => s.text.includes(' — '));
    expect(dashContainer).toBeDefined();
    expect(dashContainer?.style.bold).toBeFalsy();
  });

  test('multiple sibling <div> translations render with comma layout, each bold', () => {
    const spans = htmlToSpans(
      '<ol><li>body<div>a</div><div>b</div><div>c</div></li></ol>',
    );
    expect(concatText(spans)).toBe('1. body — a, b, c');
    // a, b, c each carry bold.
    const labelled = summary(spans);
    expect(labelled).toContainEqual(['a', 'B']);
    expect(labelled).toContainEqual(['b', 'B']);
    expect(labelled).toContainEqual(['c', 'B']);
    // The comma layout chunk is NOT bold.
    const commaSpan = spans.find((s) => s.text === ', ');
    expect(commaSpan).toBeDefined();
    expect(commaSpan?.style.bold).toBeFalsy();
  });

  test('block-mode <div> (sole content of an <li>) does NOT bold', () => {
    // When a <div> is the only content of its <li>, it renders in
    // block mode (no em-dash). In that case the translation reads
    // as an item body; emboldening would over-emphasise it. Per the
    // base class rule, block-mode <div> pushes an empty style so
    // the content stays at the popup's body weight.
    const spans = htmlToSpans('<ol><li><div>chien</div></li></ol>');
    expect(concatText(spans)).toBe('1. chien');
    const word = spans.find((s) => s.text === 'chien');
    expect(word?.style.bold).toBeFalsy();
  });
});

describe('htmlToSpans — full Wikdict + Wiktionary entry shape', () => {
  test('Gestirn (wikdict-de-fr): IPA grey, POS green, definition body, translation bold', () => {
    const wikdictGestirn =
      '<div>/<font color="gray">ɡəˈʃtɪʁn</font>/<br>' +
      '<font color="green">noun, neutral</font><br>' +
      'Astronomie, gehoben, meist im Plural: Himmelskörper im ' +
      'Allgemeinen, welcher am Nachthimmel sichtbar ist' +
      '<div>astre</div></div>';
    const spans = htmlToSpans(wikdictGestirn);
    const text = concatText(spans);
    expect(text).toContain('/ɡəˈʃtɪʁn/');
    expect(text).toContain('noun, neutral');
    expect(text).toContain('Astronomie');
    expect(text).toMatch(/sichtbar ist — astre/);
    // IPA carries the grey colour hint from the dict.
    const ipa = spans.find((s) => s.text === 'ɡəˈʃtɪʁn');
    expect(ipa?.style.color).toBe('gray');
    // POS carries the green colour hint.
    const pos = spans.find((s) => s.text === 'noun, neutral');
    expect(pos?.style.color).toBe('green');
    // Translation is bold.
    const translation = spans.find((s) => s.text === 'astre');
    expect(translation?.style.bold).toBe(true);
  });

  test('Hund-style nested <ol> with <div> translations: nested numbering, no bold (block-mode)', () => {
    const wikdictHund =
      '<div><font color="green">noun, male</font><br><ol>' +
      '<li>Haustier, dessen Vorfahre der Wolf ist<ol>' +
      '<li><div>chien</div></li>' +
      '<li><div>chienne</div></li>' +
      '</ol></li></ol></div>';
    const spans = htmlToSpans(wikdictHund);
    expect(concatText(spans)).toBe(
      'noun, male\n1. Haustier, dessen Vorfahre der Wolf ist\n  1. chien\n  2. chienne',
    );
    // chien / chienne are leaf <div>s but block-mode (sole content
    // of their <li>) — so they are NOT bold. This matches the
    // base-class rule and the plain-text path's expectation.
    expect(spans.find((s) => s.text === 'chien')?.style.bold).toBeFalsy();
    expect(spans.find((s) => s.text === 'chienne')?.style.bold).toBeFalsy();
    // POS still bears the green hint.
    expect(spans.find((s) => s.text === 'noun, male')?.style.color).toBe(
      'green',
    );
  });
});

describe('htmlToSpans — trim + edge cases (coverage)', () => {
  test('NBSP between body and inline <div> is trimmed before em-dash', () => {
    // Hits the trimTrailingInlineWhitespace path: NBSP-only tail
    // gets stripped before the em-dash separator is emitted.
    const html =
      '<div>Definition body&nbsp;<div>translation</div></div>';
    const spans = htmlToSpans(html);
    expect(concatText(spans)).toBe('Definition body — translation');
    // No span retains the NBSP that originally sat between body
    // and translation (proves trim ran rather than the post-pass
    // happening to elide it).
    expect(spans.some((s) => s.text.includes('\u00a0'))).toBe(false);
  });

  test('trim helper drops a tail span that is entirely whitespace (different style)', () => {
    // Span sequence: ["foo" bold, " " italic, then inline <div>].
    // The italic-only-space tail becomes whole-span whitespace; the
    // trim helper pops it so the em-dash adjoins "foo" cleanly.
    const html = '<b>foo</b><i> </i><div>tr</div>';
    const spans = htmlToSpans(html);
    expect(concatText(spans)).toBe('foo — tr');
    // The italic-only-space tail is gone after trim.
    expect(spans.some((s) => s.style.italic && s.text.trim() === '')).toBe(
      false,
    );
  });

  test('trim helper walks multiple all-whitespace tail spans', () => {
    // Three nested tail spans of pure whitespace, each with
    // different styles → trim must pop more than one before
    // landing on the real body content.
    const html =
      '<b>foo</b><i> </i><font color="red"> </font><div>tr</div>';
    expect(concatText(htmlToSpans(html))).toBe('foo — tr');
  });

  test('translation following a sole-whitespace last span renders inline', () => {
    // Pin: even when an upstream `<i> </i>` sits between body and
    // <div>, the inline em-dash still applies (whitespace-only
    // inter-tag content is whitespace from contentOnLine's POV).
    const html = '<b>body</b> <div>tr</div>';
    expect(concatText(htmlToSpans(html))).toBe('body — tr');
  });

  test('block-mode <div> close emits a newline so adjacent block-divs separate', () => {
    // Sequence of two block-mode <div>s at top level: each closes
    // with a newline, ensuring the second renders on its own line.
    const spans = htmlToSpans('<div>a</div><div>b</div>');
    expect(concatText(spans)).toBe('a\nb');
  });

  test('stray </div> with no matching open does not throw (defensive pop)', () => {
    // Empty inlineDivStack → handleDivClose's `?? false` branch.
    // The renderer must not throw; the orphan close emits a
    // block-mode newline.
    expect(() => htmlToSpans('orphan</div>tail')).not.toThrow();
  });

  test('</br> close tag is a no-op (br only emits on open)', () => {
    // Hits the close-side branch of <br> handling: the renderer
    // ignores the close, leaving content adjacent.
    expect(concatText(htmlToSpans('a</br>b'))).toBe('ab');
  });

  test('whitespace-only line at line-start renders as no line at all', () => {
    // Hits the line-empty filter: a line whose only content is the
    // indent + whitespace chunk (no real content) is dropped.
    const spans = htmlToSpans('<br>   <br>real');
    expect(concatText(spans)).toBe('real');
  });

  test('normalise step-2 trim drops a whole-whitespace tail chunk (different style)', () => {
    // Tail chunk after normalise is a different-style space-only
    // run, so step-2 trim must pop the chunk entirely (line 244-245
    // in htmlToSpans.ts). Without this branch, the rendered text
    // would carry a trailing space that shifts the visible width.
    const spans = htmlToSpans('<ol><li>text<i> </i></li></ol>');
    expect(concatText(spans)).toBe('1. text');
  });

  test('normalise step-2 trim partially trims trailing whitespace from tail chunk', () => {
    // Tail chunk has content + trailing space. Step-2 trims just
    // the trailing whitespace (line 248 in htmlToSpans.ts).
    const spans = htmlToSpans('<ol><li>text </li></ol>');
    expect(concatText(spans)).toBe('1. text');
  });

  test('content with only inline tags and no text yields empty span list', () => {
    // Hits the normalise empty-input fast path (line 144) — the
    // span renderer was constructed (no fast-path return), but no
    // emitText / emitLayout fired, so the buffer is empty.
    expect(htmlToSpans('<span></span>')).toEqual([]);
  });
});

describe('htmlToSpans — text matches htmlToPlainText byte-for-byte', () => {
  // Cross-renderer invariant: visible characters from htmlToSpans
  // must equal what htmlToPlainText produces. Any divergence means
  // the base class is being used inconsistently.
  test.each([
    ['plain', 'a greeting used for most purposes'],
    ['inline tags', '<i>intj</i>'],
    ['br', 'a<br>b<br/>c<br />d'],
    ['ol', '<ol><li>first</li><li>second</li></ol>'],
    ['ul', '<ul><li>first</li><li>second</li></ul>'],
    [
      'nested ol',
      '<ol><li>outer<ol><li>inner a</li><li>inner b</li></ol></li><li>outer 2</li></ol>',
    ],
    [
      'Gestirn',
      '<div>/<font color="gray">ɡəˈʃtɪʁn</font>/<br><font color="green">noun, neutral</font><br>Astronomie, gehoben, meist im Plural: Himmelskörper im Allgemeinen, welcher am Nachthimmel sichtbar ist<div>astre</div></div>',
    ],
    [
      'Himmel inline',
      '<ol><li>Astronomie: der Kosmos<div>ciel</div></li></ol>',
    ],
    [
      'multi-translations',
      '<ol><li>Decke aus Stoff oder ähnlichem Material<div>ciel</div><div>dais</div></li></ol>',
    ],
    [
      'Hund',
      '<div><font color="green">noun, male</font><br><ol><li>Haustier, dessen Vorfahre der Wolf ist<ol><li><div>chien</div></li><li><div>chienne</div></li></ol></li></ol></div>',
    ],
    ['entities', 'AT&amp;T &lt; &gt; &nbsp;&#65;'],
  ])('%s', (_label, html) => {
    // Lazily import to keep the cross-renderer invariant explicit.
    const {htmlToPlainText} = require('../src/ui/htmlToPlainText');
    expect(concatText(htmlToSpans(html))).toBe(htmlToPlainText(html));
  });
});
