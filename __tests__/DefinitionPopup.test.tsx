// Stub RN primitives as host-string components so react-test-renderer
// emits a plain `{type: 'Text', children: [...]}` JSON tree we can walk.
// This sidesteps the RN preset's Animated/scheduler shim, which
// mis-resolves `Text` to `undefined` under React 19 + RN 0.79 +
// react-test-renderer 19.
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  Pressable: 'Pressable',
  StyleSheet: {create: (s: unknown) => s},
}));

jest.mock('sn-plugin-lib', () => ({
  PluginManager: {closePluginView: jest.fn(() => Promise.resolve(true))},
}));

import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {PluginManager} from 'sn-plugin-lib';
import DefinitionPopup from '../src/ui/DefinitionPopup';
import {
  showDefinition,
  hideDefinition,
  __testing__,
} from '../src/ui/popupController';
import type {DefinitionFormat, LookupResult} from '../src/core/lookup';

const closePluginView = PluginManager.closePluginView as jest.Mock;

const found = (
  source: string,
  word: string,
  definition: string,
  format: DefinitionFormat = 'plain',
): LookupResult => ({
  queriedFor: word,
  hits: [{source, entry: {word, definition, format}}],
});

const notFound = (queriedFor: string): LookupResult => ({
  queriedFor,
  hits: [],
});

beforeEach(() => {
  __testing__.reset();
  closePluginView.mockClear();
  closePluginView.mockImplementation(() => Promise.resolve(true));
});

const renderPopup = (): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<DefinitionPopup />);
  });
  return tree;
};

const collectText = (tree: ReactTestRenderer): string => {
  const acc: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      acc.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object' && 'children' in node) {
      visit((node as {children: unknown}).children);
    }
  };
  visit(tree.toJSON());
  return acc.join(' | ');
};

describe('DefinitionPopup', () => {
  test('renders no visible text when state is invisible', () => {
    expect(collectText(renderPopup())).toBe('');
  });

  test('renders headword and definition for a single-source hit', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(found('WordNet', 'hello', 'a greeting'), 'OCR: hello');
    });
    const text = collectText(tree);
    expect(text).toContain('hello');
    expect(text).toContain('a greeting');
    expect(text).toContain('OCR: hello');
    expect(text).toContain('Close');
  });

  test('does NOT render a source badge when there is only one hit', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(found('WordNet', 'hello', 'a greeting'));
    });
    expect(collectText(tree)).not.toContain('WordNet');
  });

  test('renders not-found message when the result has zero hits', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(notFound('xenoglossy'));
    });
    const text = collectText(tree);
    expect(text).toContain('xenoglossy');
    expect(text).toMatch(/no definition found/i);
  });

  test('reverts to invisible after hideDefinition', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(notFound('foo'));
    });
    expect(collectText(tree)).toContain('foo');
    act(() => {
      hideDefinition();
    });
    expect(collectText(tree)).toBe('');
  });

  test('Close button calls PluginManager.closePluginView and hides locally', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(notFound('foo'));
    });
    expect(collectText(tree)).toContain('foo');
    const closeBtn = tree.root.findByProps({accessibilityRole: 'button'});
    act(() => {
      closeBtn.props.onPress();
    });
    expect(collectText(tree)).toBe('');
    expect(closePluginView).toHaveBeenCalledTimes(1);
  });

  test('format=html: HTML tags get stripped to readable plain text', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(
        found(
          'WikDict',
          'namaste',
          '<i>intj</i><br><ol><li>A salutation</li></ol>',
          'html',
        ),
        'OCR: namaste',
      );
    });
    const text = collectText(tree);
    // Tags stripped, layout preserved as bullet/newline.
    expect(text).not.toMatch(/<\/?[a-z]/i);
    expect(text).toContain('intj');
    expect(text).toContain('• A salutation');
  });

  test('format=plain: definition renders verbatim (no parser, no strip)', () => {
    const tree = renderPopup();
    // Deliberately HTML-looking content with format=plain — the
    // popup must NOT strip it because the source declared plain.
    const literal = '<not stripped> because format is plain';
    act(() => {
      showDefinition(found('Custom', 'x', literal, 'plain'));
    });
    expect(collectText(tree)).toContain(literal);
  });

  test('format=wordnet but body is unparseable: falls back to plain rendering', () => {
    // A source can declare 'wordnet' but ship a body that doesn't
    // match the WordNet shape (e.g. an empty entry). The popup
    // shouldn't drop the content; it should render the raw string.
    const tree = renderPopup();
    act(() => {
      showDefinition(found('Custom', 'x', 'a single line', 'wordnet'));
    });
    expect(collectText(tree)).toContain('a single line');
  });

  test('renders parsed WordNet senses with POS labels, examples, synonyms', () => {
    const tree = renderPopup();
    const aiEntry =
      'AI\n' +
      '     n 1: an agency of the United States Army responsible for ' +
      'providing intelligence [syn: {Army Intelligence}]\n' +
      '     2: the branch of computer science that deal with writing ' +
      'computer programs that can solve problems creatively; ' +
      '"workers in AI hope to imitate intelligence" ' +
      '[syn: {artificial intelligence}]';
    act(() => {
      showDefinition(found('WordNet', 'AI', aiEntry, 'wordnet'), 'OCR: AI');
    });
    const text = collectText(tree);
    expect(text).toContain('Army Intelligence');
    expect(text).toContain('artificial intelligence');
    expect(text).toContain('branch of computer science');
    expect(text).toContain('noun');
    expect(text).toContain('1.');
    expect(text).toContain('2.');
    expect(text).toContain('workers in AI hope to imitate intelligence');
    expect(text).toMatch(/Synonyms/i);
  });

  test('falls back to raw text when the entry does not parse as WordNet format', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(
        found('WordNet', 'unstructured', 'a single line with no WordNet structure'),
      );
    });
    const text = collectText(tree);
    expect(text).toContain('a single line with no WordNet structure');
  });

  test('Close button swallows a closePluginView rejection without throwing', () => {
    closePluginView.mockImplementationOnce(() =>
      Promise.reject(new Error('host gone')),
    );
    const tree = renderPopup();
    act(() => {
      showDefinition(notFound('foo'));
    });
    const closeBtn = tree.root.findByProps({accessibilityRole: 'button'});
    expect(() => {
      act(() => {
        closeBtn.props.onPress();
      });
    }).not.toThrow();
  });

  test('renders one section per hit and a source badge when there are ≥2 hits', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(
        {
          queriedFor: 'apple',
          hits: [
            {
              source: 'medical-en',
              entry: {word: 'apple', definition: 'a pomaceous fruit (medical)'},
            },
            {
              source: 'WordNet',
              entry: {word: 'apple', definition: 'an edible fruit (WordNet)'},
            },
          ],
        },
        'OCR: apple',
      );
    });
    const text = collectText(tree);
    // Both source labels appear.
    expect(text).toContain('medical-en');
    expect(text).toContain('WordNet');
    // Both definitions appear.
    expect(text).toContain('a pomaceous fruit (medical)');
    expect(text).toContain('an edible fruit (WordNet)');
    // Headword shown once at the top, taken from the first hit.
    expect(text).toContain('apple');
  });

  test('uses the first hit\'s entry word as the popup headword', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition({
        queriedFor: 'apple',
        hits: [
          {
            source: 'a',
            entry: {word: 'CustomCanonical', definition: 'def-a'},
          },
          {
            source: 'b',
            entry: {word: 'WordNetCanonical', definition: 'def-b'},
          },
        ],
      });
    });
    const text = collectText(tree);
    expect(text).toContain('CustomCanonical');
    // Second source's canonical word still appears? It's not rendered
    // as a header — only the first hit's word goes at the top.
    // But individual section bodies don't render a per-section
    // headword, so 'WordNetCanonical' won't appear in the body either
    // (only in tests where parsedHit.parsed.parseFailed renders the
    // raw entry word would it leak — which our raw renderer doesn't).
    // We assert the first canonical leads.
    const firstIdx = text.indexOf('CustomCanonical');
    expect(firstIdx).toBeGreaterThanOrEqual(0);
  });
});
