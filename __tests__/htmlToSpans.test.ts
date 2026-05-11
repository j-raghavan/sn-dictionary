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

  test('nested <ol> under <ol> uses 4-space indent and depth-2 alpha markers (v1.0.10)', () => {
    const html =
      '<ol><li>outer one<ol><li>inner a</li><li>inner b</li></ol></li>' +
      '<li>outer two</li></ol>';
    expect(concatText(htmlToSpans(html))).toBe(
      '1. outer one\n    a. inner a\n    b. inner b\n2. outer two',
    );
  });

  test('depth-3 <ol> under depth-2 alpha emits roman markers (i./ii./iii.)', () => {
    const html =
      '<ol><li>L1<ol><li>L2<ol><li>x</li><li>y</li><li>z</li></ol>' +
      '</li></ol></li></ol>';
    expect(concatText(htmlToSpans(html))).toBe(
      '1. L1\n    a. L2\n        i. x\n        ii. y\n        iii. z',
    );
  });

  test('depth-4 <ol> falls back to bullet (•) at 12-space indent', () => {
    const html =
      '<ol><li>1<ol><li>2<ol><li>3<ol><li>4</li></ol></li></ol>' +
      '</li></ol></li></ol>';
    expect(concatText(htmlToSpans(html))).toBe(
      '1. 1\n    a. 2\n        i. 3\n            • 4',
    );
  });

  test('list markers stay unstyled even when the marker style rotates (alpha / roman)', () => {
    // Pin: depth rotation does NOT introduce styling on markers.
    // Markers are layout regardless of which marker shape applies.
    const html =
      '<font color="green"><ol><li>L1<ol><li>L2<ol><li>L3</li></ol>' +
      '</li></ol></li></ol></font>';
    const spans = htmlToSpans(html);
    const alphaMarker = spans.find((s) => s.text.includes('a.'));
    const romanMarker = spans.find((s) => s.text.includes('i.'));
    expect(alphaMarker?.style.color).toBeFalsy();
    expect(romanMarker?.style.color).toBeFalsy();
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

  test('block-mode <div> as sole content of an <li> IS bold (v1.0.10)', () => {
    // Issue #19 follow-up from alioth9: previously the v1.0.9
    // renderer left block-mode <div>s un-bold so single-translation
    // entries (`Astronomie ... — ciel`) read in bold but multi-
    // translation lists (`<li><div>ciel</div></li><li><div>paradis
    // </div></li>`) read at body weight, which felt inconsistent.
    // v1.0.10 unifies the two: any <div> opening inside a list item
    // is treated as a translation and bolded.
    const spans = htmlToSpans('<ol><li><div>chien</div></li></ol>');
    expect(concatText(spans)).toBe('1. chien');
    const word = spans.find((s) => s.text === 'chien');
    expect(word?.style.bold).toBe(true);
  });

  test('top-level <div>x</div> with no enclosing list stays UN-bold', () => {
    // The outer-wrapper case: `<div>...whole entry...</div>` is the
    // common Wikdict shape and must not pop in bold. Only block-mode
    // <div>s INSIDE a list pick up the translation styling.
    const spans = htmlToSpans('<div>plain wrapper body</div>');
    const body = spans.find((s) => s.text.includes('plain wrapper body'));
    expect(body?.style.bold).toBeFalsy();
  });

  test('multiple block-mode <div> siblings inside one <li> all bold', () => {
    // `<li><div>x</div><div>y</div></li>` — first div is block-mode
    // (no preceding content in this <li>); after its close the
    // newline resets contentOnLine so the second div is also block-
    // mode. Both are translations, both bold.
    const spans = htmlToSpans(
      '<ol><li><div>chien</div><div>poules</div></li></ol>',
    );
    const chien = spans.find((s) => s.text === 'chien');
    const poules = spans.find((s) => s.text === 'poules');
    expect(chien?.style.bold).toBe(true);
    expect(poules?.style.bold).toBe(true);
  });

  test('block-mode <div> at depth 2 (under nested <ol>) is bold (Hund / Himmel pattern)', () => {
    // The exact pattern from wikdict-de-fr Himmel sense 1 and Hund:
    // outer <ol><li>body<ol><li><div>tr</div></li></ol></li></ol>.
    // The inner div opens at depth 2 in block mode — bold.
    const spans = htmlToSpans(
      '<ol><li>body<ol><li><div>tr</div></li></ol></li></ol>',
    );
    const tr = spans.find((s) => s.text === 'tr');
    expect(tr?.style.bold).toBe(true);
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

  test('Hund-style nested <ol> with <div> translations: depth-2 alpha markers, both translations bold (v1.0.10)', () => {
    const wikdictHund =
      '<div><font color="green">noun, male</font><br><ol>' +
      '<li>Haustier, dessen Vorfahre der Wolf ist<ol>' +
      '<li><div>chien</div></li>' +
      '<li><div>chienne</div></li>' +
      '</ol></li></ol></div>';
    const spans = htmlToSpans(wikdictHund);
    expect(concatText(spans)).toBe(
      'noun, male\n1. Haustier, dessen Vorfahre der Wolf ist\n    a. chien\n    b. chienne',
    );
    // v1.0.10: chien / chienne are leaf <div>s in block-mode INSIDE
    // a list — translations get bolded the same way inline-mode
    // translations (`Astronomie — ciel`) are bolded. alioth9 in
    // issue #19: "if possible it should be" bolded for consistency.
    expect(spans.find((s) => s.text === 'chien')?.style.bold).toBe(true);
    expect(spans.find((s) => s.text === 'chienne')?.style.bold).toBe(true);
    // POS still bears the green hint.
    expect(spans.find((s) => s.text === 'noun, male')?.style.color).toBe(
      'green',
    );
  });

  test('Himmel (issue #19 verbatim wikdict-de-fr HTML) renders with proper styling', () => {
    // Verbatim HTML alioth9 pasted into issue #19. Pinned here at
    // the span level so the bold / colour / numbering decisions
    // for this exact upstream shape can't drift without a test
    // failing.
    const himmelHtml =
      '<div>/<font color="gray">ˈhɪml̩</font>/<br>\n' +
      '<font color="green">noun, male</font><br>\n' +
      '  <ol>\n' +
      '\t<li>\n' +
      '\t  <ol>\n' +
      '\t\t<li>Luftraum, Gewölbe über der Erde</li>\n' +
      '\t\t<li>Religion: Aufenthaltsort im Jenseits mit Gott und den ' +
      'Engeln, in den die Seligen nach ihrem Tode aufgenommen werden</li>\n' +
      '\t  </ol>\n' +
      '\t  <ol>\n' +
      '\t\t<li><div>ciel</div></li>\n' +
      '\t\t<li><div>paradis</div></li>\n' +
      '\t  </ol>\n' +
      '\t</li>\n' +
      '\t<li>Astronomie: der Kosmos<div>ciel</div></li>\n' +
      '\t<li>Decke aus Stoff oder ähnlichem Material\n' +
      '\t  <ol><li><div>ciel</div></li>\n' +
      '\t\t<li><div>dais</div></li>\n' +
      '\t  </ol></li>\n' +
      '  </ol>\n' +
      '</div>';
    const spans = htmlToSpans(himmelHtml);
    // IPA wraps in the gray colour hint.
    const ipa = spans.find((s) => s.text === 'ˈhɪml̩');
    expect(ipa?.style.color).toBe('gray');
    // POS in green.
    const pos = spans.find((s) => s.text === 'noun, male');
    expect(pos?.style.color).toBe('green');
    // v1.0.10: every translation in this entry is bold. Sense 2 is
    // inline-mode (em-dash join), sense 1's `ciel`/`paradis` and
    // sense 3's `ciel`/`dais` are block-mode <div>s inside <li>s —
    // all four now bold to match alioth9's request that block-mode
    // translations match the visual weight of inline ones.
    const senseTwo = spans.find(
      (s) =>
        s.text === 'ciel' &&
        s.style.bold === true &&
        !s.style.color &&
        !s.style.italic,
    );
    expect(senseTwo).toBeDefined();
    // Block-mode `dais` (sole content of its <li>) is bold — the
    // word coalesces into the same span as anything bold-and-
    // unstyled-otherwise that immediately precedes it; assert via
    // "any span containing 'dais' is bold".
    const daisCarriers = spans.filter((s) => s.text.includes('dais'));
    expect(daisCarriers.length).toBeGreaterThan(0);
    expect(daisCarriers.some((c) => c.style.bold === true)).toBe(true);
    // Sense 1's `paradis` (also block-mode under nested <ol>) bold.
    const paradisCarriers = spans.filter((s) => s.text.includes('paradis'));
    expect(paradisCarriers.length).toBeGreaterThan(0);
    expect(paradisCarriers.some((c) => c.style.bold === true)).toBe(true);
    // Visible text matches the plain-text path snapshot exactly
    // (depth-2 alpha + 4-space indent per v1.0.10).
    expect(concatText(spans)).toBe(
      [
        '/ˈhɪml̩/',
        'noun, male',
        '1.',
        '    a. Luftraum, Gewölbe über der Erde',
        '    b. Religion: Aufenthaltsort im Jenseits mit Gott und den Engeln, in den die Seligen nach ihrem Tode aufgenommen werden',
        '    a. ciel',
        '    b. paradis',
        '2. Astronomie: der Kosmos — ciel',
        '3. Decke aus Stoff oder ähnlichem Material',
        '    a. ciel',
        '    b. dais',
      ].join('\n'),
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
