import {buildCopyText, entryToPlainText} from '../src/ui/copyText';
import {htmlToPlainText} from '../src/ui/htmlToPlainText';
import {htmlToSpans} from '../src/ui/htmlToSpans';
import type {DefinitionFormat, SourceHit} from '../src/core/lookup';
import type {ThesaurusResult} from '../src/core/dict/sqlite/thesaurusLookup';

const hit = (
  source: string,
  word: string,
  definition: string,
  format: DefinitionFormat = 'plain',
): SourceHit => ({source, entry: {word, definition, format}});

describe('entryToPlainText', () => {
  test('plain format copies the definition verbatim', () => {
    expect(entryToPlainText(hit('User', 'apple', 'a fruit', 'plain'))).toBe(
      'a fruit',
    );
  });

  test('html format is reduced to tag-free text (no angle brackets)', () => {
    const html = '<div><font color="green">noun</font><br>a domestic animal</div>';
    const out = entryToPlainText(hit('Dict', 'cat', html, 'html'));
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain('noun');
    expect(out).toContain('a domestic animal');
  });

  test('wordnet format renders senses like the on-screen blocks', () => {
    const raw =
      'anatomy\n' +
      '     n 1: the branch of morphology that deals with the structure ' +
      'of animals [syn: {general anatomy}]\n' +
      '     2: alternative names for the body; "the flesh is weak"';
    const out = entryToPlainText(hit('WordNet', 'anatomy', raw, 'wordnet'));
    // POS label + index, definition without the [syn:] block, the
    // extracted synonyms on a labelled line, and the example quoted.
    expect(out).toContain('noun 1. the branch of morphology');
    expect(out).not.toContain('[syn:');
    expect(out).toContain('Synonyms: general anatomy');
    expect(out).toContain('2. alternative names for the body');
    expect(out).toContain('"the flesh is weak"');
  });

  test('a sense with no part-of-speech omits the pos label', () => {
    // A leading num-only sense (no preceding pos block) parses with an
    // undefined pos, so the copy line starts at the index, not a label.
    const raw = 'word\n     1: a definition with no part of speech';
    const out = entryToPlainText(hit('X', 'word', raw, 'wordnet'));
    expect(out).toBe('1. a definition with no part of speech');
  });

  test('wordnet that fails to parse falls back to the raw definition', () => {
    // No sense lines -> parseFailed -> raw text passes through.
    const raw = 'just a bare line with no sense structure';
    expect(entryToPlainText(hit('X', 'x', raw, 'wordnet'))).toBe(raw);
  });
});

describe('buildCopyText (definition tab)', () => {
  const thes: ThesaurusResult = {synonyms: [], antonyms: []};

  test('single source, no badges: just the body', () => {
    const out = buildCopyText({
      tab: 'definition',
      hits: [hit('User', 'apple', 'a fruit', 'plain')],
      thesaurus: null,
      showSourceBadges: false,
    });
    expect(out).toBe('a fruit');
  });

  test('multi source with badges: each section prefixed by its source', () => {
    const out = buildCopyText({
      tab: 'definition',
      hits: [
        hit('WordNet', 'apple', 'a fruit', 'plain'),
        hit('Dune', 'apple', 'a house word', 'plain'),
      ],
      thesaurus: thes,
      showSourceBadges: true,
    });
    expect(out).toBe('WordNet\na fruit\n\nDune\na house word');
  });

  test('empty hits yields empty string (nothing to copy)', () => {
    expect(
      buildCopyText({
        tab: 'definition',
        hits: [],
        thesaurus: null,
        showSourceBadges: false,
      }),
    ).toBe('');
  });
});

describe('buildCopyText (thesaurus tab)', () => {
  test('labelled synonyms and antonyms lines', () => {
    const out = buildCopyText({
      tab: 'thesaurus',
      hits: [hit('WordNet', 'sky', '...', 'wordnet')],
      thesaurus: {synonyms: ['ciel', 'paradis'], antonyms: ['ground']},
      showSourceBadges: false,
    });
    expect(out).toBe('Synonyms: ciel, paradis\nAntonyms: ground');
  });

  test('synonyms only when there are no antonyms', () => {
    const out = buildCopyText({
      tab: 'thesaurus',
      hits: [],
      thesaurus: {synonyms: ['big', 'large'], antonyms: []},
      showSourceBadges: false,
    });
    expect(out).toBe('Synonyms: big, large');
  });

  test('antonyms only when there are no synonyms', () => {
    const out = buildCopyText({
      tab: 'thesaurus',
      hits: [],
      thesaurus: {synonyms: [], antonyms: ['cold']},
      showSourceBadges: false,
    });
    expect(out).toBe('Antonyms: cold');
  });

  test('null thesaurus (not yet resolved) yields empty string', () => {
    expect(
      buildCopyText({
        tab: 'thesaurus',
        hits: [],
        thesaurus: null,
        showSourceBadges: false,
      }),
    ).toBe('');
  });
});

// Regression lock for the html copy path. The reducer reduces html via
// htmlToPlainText; the on-screen popup renders the SAME html via
// htmlToSpans (HtmlText). Both extend the same HtmlBaseRenderer, so the
// copied TEXT must equal the flattened on-screen span tokens — that is
// what makes copy faithful to the screen (spec F2-AC2). The two finalize
// passes are separately maintained, so pin the equivalence here: if
// either drifts, copy stops matching the render and this fails.
describe('html copy tracks the on-screen htmlToSpans tokens (no drift)', () => {
  const flattenSpans = (html: string): string =>
    htmlToSpans(html)
      .map(span => span.text)
      .join('');

  test.each([
    '<div>noun<br>a domestic animal</div>',
    '<div>/<font color="gray">himl</font>/<br>' +
      '<font color="green">noun, male</font><br>' +
      '<ol><li>Luftraum</li><li>Religion: text</li></ol></div>',
    '<b>bold</b> and <i>italic</i> &amp; entity',
    'plain text with no markup at all',
    '<div>a<div>b</div>c</div>',
  ])('htmlToPlainText === flattened htmlToSpans for %#', html => {
    expect(htmlToPlainText(html)).toBe(flattenSpans(html));
  });

  test('entryToPlainText(html hit) equals the flattened on-screen spans', () => {
    const html = '<div>noun<br>a domestic animal</div>';
    expect(
      entryToPlainText({
        source: 'D',
        entry: {word: 'cat', definition: html, format: 'html'},
      }),
    ).toBe(flattenSpans(html));
  });
});
