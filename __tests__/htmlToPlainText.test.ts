import {htmlToPlainText, looksLikeHtml} from '../src/ui/htmlToPlainText';

describe('looksLikeHtml', () => {
  test('detects opening tags', () => {
    expect(looksLikeHtml('<i>hi</i>')).toBe(true);
  });

  test('detects self-closing tags', () => {
    expect(looksLikeHtml('hi<br/>there')).toBe(true);
  });

  test('rejects plain text', () => {
    expect(looksLikeHtml('a greeting used for most purposes')).toBe(false);
  });

  test('rejects text with stray angle brackets', () => {
    expect(looksLikeHtml('x < y')).toBe(false);
  });
});

describe('htmlToPlainText', () => {
  test('returns plain text unchanged (idempotent on no-tag input)', () => {
    const text = 'a greeting used for most purposes';
    expect(htmlToPlainText(text)).toBe(text);
  });

  test('strips inline tags but keeps text content', () => {
    expect(htmlToPlainText('<i>intj</i>')).toBe('intj');
    expect(htmlToPlainText('<b>bold</b> and <span>span</span>')).toBe(
      'bold and span',
    );
  });

  test('converts <br> to newline', () => {
    expect(htmlToPlainText('a<br>b<br/>c<br />d')).toBe('a\nb\nc\nd');
  });

  test('numbers <ol> items with "N. " markers (v1.0.9)', () => {
    expect(htmlToPlainText('<ol><li>first</li><li>second</li></ol>')).toBe(
      '1. first\n2. second',
    );
  });

  test('keeps "• " bullets for <ul> items', () => {
    expect(htmlToPlainText('<ul><li>first</li><li>second</li></ul>')).toBe(
      '• first\n• second',
    );
  });

  test('indents nested <ol> items by 2 spaces per nesting level', () => {
    const html =
      '<ol><li>outer one<ol><li>inner a</li><li>inner b</li></ol></li>' +
      '<li>outer two</li></ol>';
    expect(htmlToPlainText(html)).toBe(
      '1. outer one\n  1. inner a\n  2. inner b\n2. outer two',
    );
  });

  test('mixed <ol> + <ul> nest each maintain their own marker style', () => {
    const html =
      '<ol><li>numbered<ul><li>bullet a</li><li>bullet b</li></ul></li></ol>';
    expect(htmlToPlainText(html)).toBe(
      '1. numbered\n  • bullet a\n  • bullet b',
    );
  });

  test('renders the real-world Wiktionary namaste entry readably', () => {
    const html =
      '<i>intj</i><br><ol><li>A salutation; a greeting used for most ' +
      'purposes including hello</li></ol><br><ol><i>noun</i><br><ol>' +
      '<li>greeting, salutation, an instance of the interjection ' +
      'namaste</li></ol>';
    const out = htmlToPlainText(html);
    expect(out).toContain('intj');
    expect(out).toContain('1. A salutation; a greeting used for most purposes');
    expect(out).toContain('noun');
    // Nested under an outer <ol> opened just before <i>noun</i>: the
    // inner <ol>'s items show at depth 2 (two-space indent).
    expect(out).toContain(
      '  1. greeting, salutation, an instance of the interjection namaste',
    );
    // No tags leak through.
    expect(out).not.toMatch(/<\/?[a-z]/i);
  });

  test('decodes named HTML entities', () => {
    expect(htmlToPlainText('AT&amp;T')).toBe('AT&T');
    expect(htmlToPlainText('1 &lt; 2 &gt; 0')).toBe('1 < 2 > 0');
    expect(htmlToPlainText('&quot;hi&quot;')).toBe('"hi"');
    expect(htmlToPlainText('it&apos;s')).toBe("it's");
    expect(htmlToPlainText('a&nbsp;b')).toBe('a\u00a0b');
  });

  test('decodes numeric HTML entities (decimal and hex)', () => {
    expect(htmlToPlainText('&#65;&#66;')).toBe('AB');
    expect(htmlToPlainText('&#x41;&#x42;')).toBe('AB');
    expect(htmlToPlainText('&#X41;')).toBe('A');
  });

  test('drops unknown / malformed entities cleanly', () => {
    // Unknown name -> empty string.
    expect(htmlToPlainText('a &totallymadeup; b')).toBe('a b');
    // No semicolon within 20 chars -> treat & as literal.
    expect(htmlToPlainText('use & for and')).toBe('use & for and');
  });

  test('treats malformed unclosed tag as literal text rather than dropping', () => {
    expect(htmlToPlainText('a <unclosed b c')).toBe('a <unclosed b c');
  });

  test('preserves trailing unclosed-tag content after a well-formed tag', () => {
    // After a real <i>...</i> the looksLikeHtml short-circuit doesn't
    // fire, so the loop walks into the trailing '<unclosed'. The
    // malformed-tag path inside the loop should keep that suffix as
    // literal text rather than dropping it silently.
    expect(htmlToPlainText('<i>good</i> tail <unclosed extra')).toBe(
      'good tail <unclosed extra',
    );
  });

  test('treats an empty entity (&;) as no character', () => {
    expect(htmlToPlainText('a&;b')).toBe('ab');
  });

  test('collapses runs of whitespace and newlines', () => {
    const messy = '<p>x</p>     <p>y</p><br><br><br>z';
    const out = htmlToPlainText(messy);
    expect(out).not.toMatch(/ {3}/); // no triple-space
    expect(out).not.toMatch(/\n{3,}/); // no triple-newline
    expect(out).toContain('x');
    expect(out).toContain('y');
    expect(out).toContain('z');
  });

  test('handles attributes on tags (drops them along with the tag)', () => {
    expect(htmlToPlainText('<a href="https://x">link</a>')).toBe('link');
    expect(htmlToPlainText('<li class="bullet">x</li>')).toBe('• x');
  });

  test('handles uppercase / mixed-case tag names', () => {
    expect(htmlToPlainText('<I>x</I><BR/><LI>y</LI>')).toBe('x\n• y');
  });

  test('rejects out-of-range numeric entities silently', () => {
    expect(htmlToPlainText('&#999999999;')).toBe('');
    expect(htmlToPlainText('&#0;')).toBe('');
  });

  test('handles empty string', () => {
    expect(htmlToPlainText('')).toBe('');
  });

  test('handles content with only tags (returns empty after strip)', () => {
    expect(htmlToPlainText('<br><br>')).toBe('');
  });

  test('preserves UTF-8 / multi-byte content inside tags', () => {
    expect(htmlToPlainText('<i>नमस्ते</i>')).toBe('नमस्ते');
  });

  test('does not run the converter for plain ASCII text without entities', () => {
    // Performance contract: no `<` and no `&` => exact same string out.
    const plain = 'A simple definition that uses no HTML at all.';
    expect(htmlToPlainText(plain)).toBe(plain);
  });

  describe('Wikdict <div>-translation shape (issues #15 + #19)', () => {
    // Verbatim definition extracted from wikdict-de-fr.zip's
    // stardict.dict for headword "Gestirn" (offset 5002035, len 222).
    // Wikdict wraps each translation in <div>...</div> directly after
    // the German definition text, with no <br> or other separator.
    //
    //   - Pre-v1.0.7 the renderer concatenated "ist" and "astre" into
    //     "istastre" (issue #15).
    //   - v1.0.8 split them onto two lines (`ist\nastre`).
    //   - v1.0.9 joins them inline with an em-dash separator
    //     (`ist — astre`) per alioth9's follow-up on issue #15: "I
    //     think it would be better to have the translation on the
    //     same line and rather have some separator like em-dash".
    const wikdictGestirn =
      '<div>/<font color="gray">ɡəˈʃtɪʁn</font>/<br>\n' +
      '<font color="green">noun, neutral</font><br>' +
      'Astronomie, gehoben, meist im Plural: Himmelskörper im ' +
      'Allgemeinen, welcher am Nachthimmel sichtbar ist' +
      '<div>astre</div></div>';

    test('joins definition text and translation with " — " separator', () => {
      const out = htmlToPlainText(wikdictGestirn);
      // The smoking-gun regression: "istastre" must not appear.
      expect(out).not.toMatch(/istastre/);
      // Translation joins inline with em-dash, not a newline.
      expect(out).toMatch(/sichtbar ist — astre/);
      // And explicitly NOT the v1.0.8 newline shape — pin the format
      // so a future revert can't quietly regress.
      expect(out).not.toMatch(/sichtbar ist\nastre/);
    });

    test('preserves all upstream content (IPA, POS, definition, translation)', () => {
      const out = htmlToPlainText(wikdictGestirn);
      expect(out).toContain('ɡəˈʃtɪʁn');
      expect(out).toContain('noun, neutral');
      expect(out).toContain(
        'Astronomie, gehoben, meist im Plural: Himmelskörper im Allgemeinen',
      );
      expect(out).toContain('astre');
    });

    test('outer <div> wrapper does not produce a leading blank line', () => {
      // The whole entry is wrapped in <div>...</div>; the open tag
      // sits at position 0 with no prior content. Inline-vs-block
      // discrimination must pick block-mode here so the popup
      // doesn't render a leading empty first line.
      const out = htmlToPlainText(wikdictGestirn);
      expect(out.startsWith('\n')).toBe(false);
    });

    test('NBSP before <div> still triggers the inline em-dash join', () => {
      // Belt-and-suspenders: a future Wikdict shape with `&nbsp;`
      // (decoded to U+00A0) immediately before <div>...</div> should
      // still pass the "content on this line → inline em-dash" test.
      // The contentOnLine tracker treats NBSP as whitespace so the
      // last meaningful char (the body word) wins.
      const nbspBeforeDiv =
        '<div>Definition body&nbsp;<div>translation</div></div>';
      const out = htmlToPlainText(nbspBeforeDiv);
      expect(out).toMatch(/Definition body — translation/);
      expect(out).not.toMatch(/body translation/);
    });

    test('trailing-space-before-<div> still triggers em-dash join', () => {
      // Defensive: `…ist <div>astre</div>` (trailing single space
      // between definition and translation) collapses through the
      // post-pass — the em-dash separator is what un-glues them.
      const trailingSpace =
        '<div>Astronomie: Himmelskörper, welcher am Nachthimmel sichtbar ist ' +
        '<div>astre</div></div>';
      const out = htmlToPlainText(trailingSpace);
      expect(out).toMatch(/sichtbar ist — astre/);
      expect(out).not.toMatch(/ist astre/);
    });

    test('multi-translation Wikdict <ol><li><div>...</div></li> shape numbers items and bullets are gone', () => {
      // Real shape from wikdict-de-fr "Hund": two translations under
      // a nested <ol>. Each translation is the only content of its
      // <li>, so each renders as a numbered item without an em-dash
      // (block-mode div, line-start at the marker).
      const wikdictHund =
        '<div><font color="green">noun, male</font><br><ol>' +
        '<li>Haustier, dessen Vorfahre der Wolf ist<ol>' +
        '<li><div>chien</div></li>' +
        '<li><div>chienne</div></li>' +
        '</ol></li></ol></div>';
      const out = htmlToPlainText(wikdictHund);
      // Outer <li> still gets its number; inner <li>s get nested
      // depth-2 numbering.
      expect(out).toMatch(/^noun, male/);
      expect(out).toContain('1. Haustier, dessen Vorfahre der Wolf ist');
      expect(out).toContain('  1. chien');
      expect(out).toContain('  2. chienne');
      // Pre-v1.0.7 glue: "istchien" must never appear.
      expect(out).not.toMatch(/istchien/);
      // Nested numbered items on consecutive lines (no blank gap
      // between them after post-pass).
      expect(out).toMatch(/ {2}1\. chien\n {2}2\. chienne/);
    });

    test('Himmel-style: <li>body<div>translation</div></li> joins inline', () => {
      // The exact "Astronomie: der Kosmos<div>ciel</div>" shape from
      // issue #19: the <div> follows real text WITHIN the same <li>,
      // so it should join with an em-dash producing
      // "2. Astronomie: der Kosmos — ciel" (depending on the outer
      // numbering at the time of render).
      const html =
        '<ol><li>Astronomie: der Kosmos<div>ciel</div></li></ol>';
      expect(htmlToPlainText(html)).toBe('1. Astronomie: der Kosmos — ciel');
    });

    test('multiple sibling <div> translations in one <li> join with comma', () => {
      // alioth9's ideal in issue #19: "Decke aus Stoff oder ähnlichem
      // Material — ciel, dais". Comma-join is the sibling-translation
      // shape; this test pins it.
      const html =
        '<ol><li>Decke aus Stoff oder ähnlichem Material' +
        '<div>ciel</div><div>dais</div></li></ol>';
      expect(htmlToPlainText(html)).toBe(
        '1. Decke aus Stoff oder ähnlichem Material — ciel, dais',
      );
    });

    test('outer <li> with only a nested <ol> renders the outer marker on its own line', () => {
      // Known-imperfect rendering for the Himmel shape where the
      // outer <li> wraps two siblings <ol>s with no direct text.
      // alioth9 acknowledged this is a file-level structural issue
      // and even OSS-Dict can't pair them. We pin the simple "marker
      // on its own line" output so behaviour is at least predictable.
      const html =
        '<ol>' +
        '<li><ol><li>inner one</li><li>inner two</li></ol></li>' +
        '<li>second top<div>tr</div></li>' +
        '</ol>';
      const out = htmlToPlainText(html);
      expect(out).toContain('1.');
      expect(out).toContain('  1. inner one');
      expect(out).toContain('  2. inner two');
      expect(out).toContain('2. second top — tr');
    });
  });

  describe('inline-div translation edge cases', () => {
    test('em-dash never doubles up: a sole <div> at the start renders block-mode', () => {
      // The outer wrapper case: `<div>x</div>` has no preceding
      // content, so block-mode selects and we don't emit a leading
      // " — ".
      expect(htmlToPlainText('<div>x</div>')).toBe('x');
    });

    test('three sibling translations: " — a, b, c"', () => {
      // Stress the comma-list path past two siblings.
      const html =
        '<ol><li>body<div>a</div><div>b</div><div>c</div></li></ol>';
      expect(htmlToPlainText(html)).toBe('1. body — a, b, c');
    });

    test('<br> between translations resets the comma-list state', () => {
      // After a <br>, we're on a new line; even if a <div> follows
      // some text, it's a fresh em-dash group, not a continuation
      // of the previous <div> run.
      const html = '<ol><li>a<div>x</div><br>b<div>y</div></li></ol>';
      expect(htmlToPlainText(html)).toBe('1. a — x\nb — y');
    });

    test('paragraph-mode <p>x</p><p>y</p> preserves paragraph break', () => {
      // <p> intent is two newlines collapsed to one by post-pass.
      expect(htmlToPlainText('<p>x</p><p>y</p>')).toBe('x\ny');
    });
  });
});
