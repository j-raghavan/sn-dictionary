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

  test('converts <li> to bulleted line', () => {
    expect(htmlToPlainText('<ol><li>first</li><li>second</li></ol>')).toBe(
      '• first\n• second',
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
    expect(out).toContain('• A salutation; a greeting used for most purposes');
    expect(out).toContain('noun');
    expect(out).toContain(
      '• greeting, salutation, an instance of the interjection namaste',
    );
    // No tags leak through.
    expect(out).not.toMatch(/<\/?[a-z]/i);
  });

  test('decodes named HTML entities', () => {
    expect(htmlToPlainText('AT&amp;T')).toBe('AT&T');
    expect(htmlToPlainText('1 &lt; 2 &gt; 0')).toBe('1 < 2 > 0');
    expect(htmlToPlainText('&quot;hi&quot;')).toBe('"hi"');
    expect(htmlToPlainText('it&apos;s')).toBe("it's");
    expect(htmlToPlainText('a&nbsp;b')).toBe('a b');
  });

  test('decodes numeric HTML entities (decimal and hex)', () => {
    expect(htmlToPlainText('&#65;&#66;')).toBe('AB');
    expect(htmlToPlainText('&#x41;&#x42;')).toBe('AB');
    expect(htmlToPlainText('&#X41;')).toBe('A');
  });

  test('drops unknown / malformed entities cleanly', () => {
    // Unknown name -> empty string.
    expect(htmlToPlainText('a &totallymadeup; b')).toBe('a b');
    // No semicolon within 10 chars -> treat & as literal.
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
});
