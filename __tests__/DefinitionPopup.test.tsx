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
  TextInput: 'TextInput',
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
  showRecognizing,
  hideDefinition,
  setPopupActions,
  type PopupActions,
  __testing__,
} from '../src/ui/popupController';
import type {DefinitionFormat, LookupResult} from '../src/core/lookup';
import type {ThesaurusResult} from '../src/core/dict/sqlite/thesaurusLookup';

const closePluginView = PluginManager.closePluginView as jest.Mock;

const found = (
  source: string,
  word: string,
  definition: string,
  format: DefinitionFormat = 'plain',
): LookupResult => ({
  queriedFor: word,
  hits: [{source, entry: {word, definition, format}}],
  loading: [],
});

const notFound = (queriedFor: string): LookupResult => ({
  queriedFor,
  hits: [],
  loading: [],
});

const loading = (queriedFor: string, sources: string[]): LookupResult => ({
  queriedFor,
  hits: [],
  loading: sources,
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

  test('when two hits disagree on phonetic, the header shows the first one (later still visible in its section)', () => {
    // Documented rule: the header phonetic is the FIRST hit with a
    // phonetic; later disagreements stay reachable per-source in
    // each section body. Pinning the rule so a future refactor
    // can't silently swap to "last wins" or "merge".
    const tree = renderPopup();
    act(() => {
      showDefinition({
        queriedFor: 'tomato',
        hits: [
          {
            source: 'AmEng',
            entry: {
              word: 'tomato',
              definition: 'red fruit (US)',
              format: 'plain',
              phonetic: 'tuh-MAY-toh',
            },
          },
          {
            source: 'BrEng',
            entry: {
              word: 'tomato',
              definition: 'red fruit (UK)',
              format: 'plain',
              phonetic: 'tuh-MAH-toh',
            },
          },
        ],
        loading: [],
      });
    });
    const text = collectText(tree);
    // Both phonetics appear *somewhere* in the rendered tree (the
    // first in the header, the second only via its section body if
    // a future render path exposes it; today only the header path
    // renders phonetics, so we assert the rule by header position).
    expect(text).toContain('tuh-MAY-toh');
    // Header label encodes the chosen phonetic — first hit wins.
    const headerLabelled = tree.root.findAllByProps({
      accessibilityLabel: 'Pronunciation: tuh-MAY-toh',
    });
    expect(headerLabelled.length).toBe(1);
    // Negative pin: there is NO header label for the second hit's
    // phonetic. (Equivalent to "last wins" / "merge" — explicitly
    // not the rule.)
    const wrongHeader = tree.root.findAllByProps({
      accessibilityLabel: 'Pronunciation: tuh-MAH-toh',
    });
    expect(wrongHeader.length).toBe(0);
  });

  test('header phonetic comes from the first hit that supplies one (skips earlier hits without)', () => {
    // Multi-dict scenario: WordNet has no phonetic, but the user's
    // CSV does. The header should still surface the CSV's phonetic
    // rather than nothing.
    const tree = renderPopup();
    act(() => {
      showDefinition({
        queriedFor: 'arrakis',
        hits: [
          {
            source: 'WordNet',
            entry: {
              word: 'arrakis',
              definition: 'no entry',
              format: 'plain',
            },
          },
          {
            source: 'Dune',
            entry: {
              word: 'ARRAKIS',
              definition: 'the planet known as Dune',
              format: 'plain',
              phonetic: 'uh-RAK-is',
            },
          },
        ],
        loading: [],
      });
    });
    expect(collectText(tree)).toContain('uh-RAK-is');
  });

  test('phonetic font-size scales with the user-selected font size', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition({
        queriedFor: 'arrakis',
        hits: [
          {
            source: 'Dune',
            entry: {
              word: 'ARRAKIS',
              definition: 'the planet',
              format: 'plain',
              phonetic: 'uh-RAK-is',
            },
          },
        ],
        loading: [],
      });
    });
    const findPhoneticFontSize = (): number => {
      const json = tree.toJSON();
      let captured: number | null = null;
      const visit = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        if (
          node &&
          typeof node === 'object' &&
          'props' in node &&
          'children' in node
        ) {
          const obj = node as {
            props: {style?: unknown};
            children: unknown;
          };
          const text = JSON.stringify(obj.children);
          if (text.includes('uh-RAK-is')) {
            const flatten = (s: unknown): {fontSize?: number} => {
              if (Array.isArray(s)) {
                return Object.assign({}, ...s.map(flatten));
              }
              if (s && typeof s === 'object') {
                return s as {fontSize?: number};
              }
              return {};
            };
            const flat = flatten(obj.props.style);
            if (typeof flat.fontSize === 'number') {
              captured = flat.fontSize;
            }
          }
          visit(obj.children);
        }
      };
      visit(json);
      if (captured === null) {
        throw new Error('phonetic Text not found');
      }
      return captured;
    };
    const baseFontSize = findPhoneticFontSize();
    act(() => {
      tree.root
        .findAllByProps({
          accessibilityRole: 'button',
          accessibilityLabel: 'Increase text size',
        })[0]
        .props.onPress();
    });
    expect(findPhoneticFontSize()).toBeGreaterThan(baseFontSize);
  });

  test('phonetic Text exposes a localised "Pronunciation: ..." accessibilityLabel', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition({
        queriedFor: 'arrakis',
        hits: [
          {
            source: 'Dune',
            entry: {
              word: 'ARRAKIS',
              definition: 'the planet',
              format: 'plain',
              phonetic: 'uh-RAK-is',
            },
          },
        ],
        loading: [],
      });
    });
    // Match by the accessibility-label prefix; full string includes
    // the phonetic value verbatim.
    const labelled = tree.root.findAllByProps({
      accessibilityLabel: 'Pronunciation: uh-RAK-is',
    });
    expect(labelled.length).toBe(1);
  });

  test('renders phonetic line under the headword when the first hit carries one', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition({
        queriedFor: 'arrakis',
        hits: [
          {
            source: 'Dune',
            entry: {
              word: 'ARRAKIS',
              definition: 'the planet known as Dune',
              format: 'plain',
              phonetic: 'uh-RAK-is',
            },
          },
        ],
        loading: [],
      });
    });
    const text = collectText(tree);
    expect(text).toContain('ARRAKIS');
    expect(text).toContain('uh-RAK-is');
    // Phonetic precedes the definition body.
    expect(text.indexOf('uh-RAK-is')).toBeLessThan(
      text.indexOf('the planet known as Dune'),
    );
  });

  test('omits the phonetic line entirely when the first hit has none', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(found('WordNet', 'hello', 'a greeting'));
    });
    // No stray phonetic styling appears in the tree — sanity check by
    // confirming the only text nodes between headword and definition
    // are chrome, not a phonetic respelling. If a future regression
    // adds an empty phonetic Text, it'd render an empty string but
    // produce a Text node — collectText would show extra ' | '
    // separators around 'hello'. Guard against the bug at the source:
    // the phonetic style line must not appear in the JSON tree.
    const json = JSON.stringify(tree.toJSON());
    expect(json).not.toMatch(/"fontStyle":"italic"/);
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
    // Multiple buttons exist (Close + font-size controls); find by
    // the localised label.
    const closeBtn = tree.root.findByProps({
      accessibilityRole: 'button',
      accessibilityLabel: 'Close',
    });
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
    expect(text).toContain('1. A salutation');
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
    const closeBtn = tree.root.findByProps({
      accessibilityRole: 'button',
      accessibilityLabel: 'Close',
    });
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
          loading: [],
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

  test("uses the first hit's entry word as the popup headword", () => {
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
        loading: [],
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

  test('renders Loading… placeholder for each loading source while no hits have arrived', () => {
    // The streaming variant of lookup() emits an initial snapshot
    // with every source still loading. The popup must open with
    // placeholders rather than a "no definition found" message.
    const tree = renderPopup();
    act(() => {
      showDefinition(loading('apple', ['UserDict', 'WordNet']));
    });
    const text = collectText(tree);
    // Both source badges appear.
    expect(text).toContain('UserDict');
    expect(text).toContain('WordNet');
    // Loading label appears (en locale).
    expect(text).toMatch(/Loading…/);
    // Not-found message must NOT appear during the loading state.
    expect(text).not.toMatch(/no definition found/i);
    // Headword falls back to the queried text.
    expect(text).toContain('apple');
  });

  test('renders both resolved hits and pending loading sections in the same snapshot', () => {
    // Mid-resolution snapshot: one source has resolved, one is still
    // loading. The popup shows the resolved hit AND a placeholder for
    // the pending source so the layout doesn't flicker as the second
    // source lands.
    const tree = renderPopup();
    act(() => {
      showDefinition({
        queriedFor: 'apple',
        hits: [
          {
            source: 'WordNet',
            entry: {word: 'apple', definition: 'an edible fruit', format: 'plain'},
          },
        ],
        loading: ['UserDict'],
      });
    });
    const text = collectText(tree);
    expect(text).toContain('an edible fruit');
    expect(text).toContain('UserDict');
    expect(text).toMatch(/Loading…/);
  });

  test('loading-only snapshot with one source: no badge (single section)', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(loading('apple', ['Solo']));
    });
    const text = collectText(tree);
    // Single section — no badge label.
    expect(text).not.toContain('Solo');
    expect(text).toMatch(/Loading…/);
  });

  test('shows the localised "Recognizing…" message when the popup is in the recognizing kind', () => {
    // Tap-to-popup speedup: the lasso flow opens the popup on tap,
    // before any OCR or lookup result exists. The popup must render
    // a recognizing message — not a stale prior result, not an
    // empty card.
    const tree = renderPopup();
    act(() => {
      showRecognizing();
    });
    const text = collectText(tree);
    expect(text).toContain('Recognizing…');
    // Must not surface lookup-result chrome that has no value here.
    expect(text).not.toMatch(/no definition found/i);
    expect(text).not.toMatch(/Loading…/);
    // Close button is always available so the user can dismiss.
    expect(text).toContain('Close');
  });

  test('renders the OCR label alongside Recognizing… when supplied', () => {
    const tree = renderPopup();
    act(() => {
      showRecognizing('OCR: hello');
    });
    const text = collectText(tree);
    expect(text).toContain('Recognizing…');
    expect(text).toContain('OCR: hello');
  });

  describe('font-size ( − )( A )( + ) circular controls', () => {
    const findFontBtn = (
      tree: ReactTestRenderer,
      label: 'Decrease text size' | 'Increase text size',
    ) =>
      tree.root.findAllByProps({
        accessibilityRole: 'button',
        accessibilityLabel: label,
      })[0];

    const tryFindFontBtn = (
      tree: ReactTestRenderer,
      label: 'Decrease text size' | 'Increase text size',
    ) =>
      tree.root.findAllByProps({
        accessibilityRole: 'button',
        accessibilityLabel: label,
      });

    test('both circles always render with constant layout', () => {
      const tree = renderPopup();
      act(() => {
        showDefinition(found('WordNet', 'hello', 'a greeting'));
      });
      // Two distinct Pressables, always — never hidden, only greyed.
      expect(tryFindFontBtn(tree, 'Decrease text size')).toHaveLength(1);
      expect(tryFindFontBtn(tree, 'Increase text size')).toHaveLength(1);
    });

    test('default S: minus is greyed and disabled; plus is active', () => {
      const tree = renderPopup();
      act(() => {
        showDefinition(found('WordNet', 'hello', 'a greeting'));
      });
      const minus = findFontBtn(tree, 'Decrease text size');
      const plus = findFontBtn(tree, 'Increase text size');
      expect(minus.props.disabled).toBe(true);
      expect(plus.props.disabled).toBe(false);
      // All three glyphs always rendered — minus, A indicator, plus.
      const text = collectText(tree);
      expect(text).toContain('−');
      expect(text).toContain('A');
      expect(text).toContain('+');
    });

    test('M: both buttons active, neither greyed', () => {
      const tree = renderPopup();
      act(() => {
        showDefinition(found('WordNet', 'hello', 'a greeting'));
      });
      act(() => {
        findFontBtn(tree, 'Increase text size').props.onPress();
      });
      const minus = findFontBtn(tree, 'Decrease text size');
      const plus = findFontBtn(tree, 'Increase text size');
      expect(minus.props.disabled).toBe(false);
      expect(plus.props.disabled).toBe(false);
    });

    test('L: plus is greyed and disabled; minus is active', () => {
      const tree = renderPopup();
      act(() => {
        showDefinition(found('WordNet', 'hello', 'a greeting'));
      });
      act(() => {
        findFontBtn(tree, 'Increase text size').props.onPress();
        findFontBtn(tree, 'Increase text size').props.onPress();
      });
      const minus = findFontBtn(tree, 'Decrease text size');
      const plus = findFontBtn(tree, 'Increase text size');
      expect(minus.props.disabled).toBe(false);
      expect(plus.props.disabled).toBe(true);
    });

    test('round-trip: pressing plus twice then minus twice returns to S state', () => {
      const tree = renderPopup();
      act(() => {
        showDefinition(found('WordNet', 'hello', 'a greeting'));
      });
      act(() => {
        findFontBtn(tree, 'Increase text size').props.onPress();
        findFontBtn(tree, 'Increase text size').props.onPress();
      });
      act(() => {
        findFontBtn(tree, 'Decrease text size').props.onPress();
        findFontBtn(tree, 'Decrease text size').props.onPress();
      });
      expect(findFontBtn(tree, 'Decrease text size').props.disabled).toBe(true);
      expect(findFontBtn(tree, 'Increase text size').props.disabled).toBe(false);
    });

    test('font-size controls are NOT rendered during the recognizing kind', () => {
      const tree = renderPopup();
      act(() => {
        showRecognizing();
      });
      expect(tryFindFontBtn(tree, 'Decrease text size')).toHaveLength(0);
      expect(tryFindFontBtn(tree, 'Increase text size')).toHaveLength(0);
    });

    test('fontScale propagates to the definition body — Text fontSize grows on A+', () => {
      const tree = renderPopup();
      act(() => {
        showDefinition(found('WordNet', 'hello', 'a greeting', 'plain'));
      });
      const findDefinitionFontSize = (): number => {
        const json = tree.toJSON();
        let captured: number | null = null;
        const visit = (node: unknown): void => {
          if (Array.isArray(node)) {
            node.forEach(visit);
            return;
          }
          if (
            node &&
            typeof node === 'object' &&
            'props' in node &&
            'children' in node
          ) {
            const obj = node as {
              props: {style?: unknown};
              children: unknown;
              type?: string;
            };
            const text = JSON.stringify(obj.children);
            if (text.includes('a greeting')) {
              const flatten = (s: unknown): {fontSize?: number} => {
                if (Array.isArray(s)) {
                  return Object.assign({}, ...s.map(flatten));
                }
                if (s && typeof s === 'object') {
                  return s as {fontSize?: number};
                }
                return {};
              };
              const flat = flatten(obj.props.style);
              if (typeof flat.fontSize === 'number') {
                captured = flat.fontSize;
              }
            }
            visit(obj.children);
          }
        };
        visit(json);
        if (captured === null) {
          throw new Error('definition Text not found');
        }
        return captured;
      };
      const baseFontSize = findDefinitionFontSize();
      act(() => {
        tree.root
          .findAllByProps({
            accessibilityRole: 'button',
            accessibilityLabel: 'Increase text size',
          })[0]
          .props.onPress();
      });
      const mediumFontSize = findDefinitionFontSize();
      expect(mediumFontSize).toBeGreaterThan(baseFontSize);
    });
  });

  test('transitions cleanly from recognizing to result without a flicker of stale state', () => {
    // Simulates the on-device lifecycle: tap → showRecognizing →
    // OCR completes → showDefinition. The popup must end on the
    // result kind with the freshly-emitted hits, not retain any
    // recognizing chrome.
    const tree = renderPopup();
    act(() => {
      showRecognizing();
    });
    expect(collectText(tree)).toContain('Recognizing…');
    act(() => {
      showDefinition(found('WordNet', 'hello', 'a greeting'), 'OCR: hello');
    });
    const text = collectText(tree);
    expect(text).not.toContain('Recognizing…');
    expect(text).toContain('hello');
    expect(text).toContain('a greeting');
  });
});

// --- Definition/Thesaurus toggle (TF4-FR4) -------------------------

const flush = async (): Promise<void> => {
  // Let the thesaurus fetch promise + its setState settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const wordnetHit = (
  word: string,
  definition: string,
): LookupResult => ({
  queriedFor: word,
  hits: [{source: 'WordNet', entry: {word, definition, format: 'wordnet'}}],
  loading: [],
});

const fakeActions = (
  lookupThesaurus: PopupActions['lookupThesaurus'],
): PopupActions => ({
  lookupThesaurus,
  addUserEntry: async () => undefined,
  relookup: async () => undefined,
});

describe('DefinitionPopup — Definition/Thesaurus toggle', () => {
  test('renders both tabs once there is a hit', () => {
    setPopupActions(fakeActions(async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}})));
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    const text = collectText(tree);
    expect(text).toContain('Definition');
    expect(text).toContain('Thesaurus');
  });

  test('switching to Thesaurus shows synonyms/antonyms; back shows the definition', async () => {
    setPopupActions(
      fakeActions(async () => ({
        lang: 'en',
        omw: {synonyms: ['glad'], antonyms: ['sad']},
      })),
    );
    const tree = renderPopup();
    act(() => showDefinition(wordnetHit('happy', 'feeling joy')));
    // Definition tab first.
    expect(collectText(tree)).toContain('feeling joy');
    // Flip to Thesaurus.
    const thTab = tree.root.findAll(
      n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress,
    )[0];
    await act(async () => {
      thTab.props.onPress();
    });
    await flush();
    const th = collectText(tree);
    expect(th).toContain('glad');
    expect(th).toContain('sad');
    // Flip back to Definition.
    const defTab = tree.root.findAll(
      n => n.props.accessibilityLabel === 'Definition' && n.props.onPress,
    )[0];
    await act(async () => {
      defTab.props.onPress();
    });
    expect(collectText(tree)).toContain('feeling joy');
  });

  test('fetches the thesaurus exactly ONCE across def->thes->def->thes flips (cache)', async () => {
    const spy = jest.fn(async () => ({
      lang: 'en',
      omw: {synonyms: ['glad'], antonyms: []} as ThesaurusResult,
    }));
    setPopupActions(fakeActions(spy));
    const tree = renderPopup();
    act(() => showDefinition(wordnetHit('happy', 'feeling joy')));

    const press = label =>
      tree.root
        .findAll(n => n.props.accessibilityLabel === label && n.props.onPress)[0]
        .props.onPress();

    await act(async () => press('Thesaurus'));
    await flush();
    await act(async () => press('Definition'));
    await act(async () => press('Thesaurus'));
    await flush();
    await act(async () => press('Definition'));
    await act(async () => press('Thesaurus'));
    await flush();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("'und' language -> empty thesaurus -> empty-state, not an error", async () => {
    // The action returns empty omw for 'und'; assembleThesaurus yields
    // empty; the component shows the empty-state string.
    setPopupActions(
      fakeActions(async () => ({lang: 'und', omw: {synonyms: [], antonyms: []}})),
    );
    const tree = renderPopup();
    act(() => showDefinition(found('User', 'photon', 'a light quantum')));
    await act(async () =>
      tree.root
        .findAll(n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress)[0]
        .props.onPress(),
    );
    await flush();
    const text = collectText(tree);
    expect(text).toContain('No synonyms or antonyms available.');
  });

  test('EN WordNet merges sense synonyms with OMW (deduped)', async () => {
    setPopupActions(
      fakeActions(async () => ({
        lang: 'en',
        omw: {synonyms: ['cheerful'], antonyms: []},
      })),
    );
    const tree = renderPopup();
    // A real WordNet body: headword on line 0, then an indented sense
    // line whose [syn:] block carries 'glad' (+ the headword itself).
    act(() =>
      showDefinition(
        wordnetHit(
          'happy',
          'happy\n     adj 1: feeling joy [syn: {glad}, {happy}]',
        ),
      ),
    );
    await act(async () =>
      tree.root
        .findAll(n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress)[0]
        .props.onPress(),
    );
    await flush();
    const text = collectText(tree);
    // sense synonym 'glad' + OMW 'cheerful'; headword 'happy' excluded.
    expect(text).toContain('glad');
    expect(text).toContain('cheerful');
  });

  test('non-EN (plain) source is OMW-only — sense synonyms ignored', async () => {
    setPopupActions(
      fakeActions(async () => ({
        lang: 'de',
        omw: {synonyms: ['glücklich'], antonyms: []},
      })),
    );
    const tree = renderPopup();
    // plain-format hit: even if it had [syn:] text, assembleThesaurus
    // takes OMW only for non-'wordnet' formats.
    act(() => showDefinition(found('Imported', 'froh', 'froh [syn: {ignored}]', 'plain')));
    await act(async () =>
      tree.root
        .findAll(n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress)[0]
        .props.onPress(),
    );
    await flush();
    const text = collectText(tree);
    expect(text).toContain('glücklich');
    expect(text).not.toContain('ignored');
  });

  test('antonyms-only result renders the Antonyms group (no Synonyms group)', async () => {
    setPopupActions(
      fakeActions(async () => ({
        lang: 'en',
        omw: {synonyms: [], antonyms: ['cold']},
      })),
    );
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hot', 'high temperature')));
    await act(async () =>
      tree.root
        .findAll(n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress)[0]
        .props.onPress(),
    );
    await flush();
    const text = collectText(tree);
    expect(text).toContain('Antonyms');
    expect(text).toContain('cold');
    expect(text).not.toContain('Synonyms');
  });

  test('a thesaurus fetch rejection -> empty-state, not a crash', async () => {
    setPopupActions(
      fakeActions(async () => {
        throw new Error('db unavailable');
      }),
    );
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    await act(async () =>
      tree.root
        .findAll(n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress)[0]
        .props.onPress(),
    );
    await flush();
    expect(collectText(tree)).toContain('No synonyms or antonyms available.');
  });

  test('switching headword mid-fetch does not clobber the new headword (cancelled)', async () => {
    // First headword's fetch is deferred; we flip to a new headword
    // (resetting tab + cache) before it resolves. The stale resolution
    // must be discarded (cancelled), not written into state.
    let resolveFirst!: (v: {lang: string; omw: ThesaurusResult}) => void;
    const spy = jest.fn((word: string) => {
      if (word === 'first') {
        return new Promise<{lang: string; omw: ThesaurusResult}>(res => {
          resolveFirst = res;
        });
      }
      return Promise.resolve({lang: 'en', omw: {synonyms: ['second-syn'], antonyms: []}});
    });
    setPopupActions(fakeActions(spy as PopupActions['lookupThesaurus']));
    const tree = renderPopup();

    act(() => showDefinition(wordnetHit('first', 'def one')));
    await act(async () =>
      tree.root
        .findAll(n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress)[0]
        .props.onPress(),
    );
    // New headword arrives before 'first' resolves.
    act(() => showDefinition(wordnetHit('second', 'def two')));
    // Now resolve the STALE first fetch — must be ignored.
    await act(async () => {
      resolveFirst({lang: 'en', omw: {synonyms: ['stale-syn'], antonyms: []}});
      await Promise.resolve();
    });
    await flush();
    // Back on Definition tab (reset by new headword); no stale data.
    expect(collectText(tree)).toContain('def two');
    expect(collectText(tree)).not.toContain('stale-syn');
  });

  test('no registered actions -> Thesaurus tab shows loading, never crashes', async () => {
    // getPopupActions() is null (not registered) — guarded.
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    await act(async () =>
      tree.root
        .findAll(n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress)[0]
        .props.onPress(),
    );
    await flush();
    // No crash; the body stays on the loading placeholder.
    expect(collectText(tree)).toContain('Loading…');
  });
});

// --- OCR correction editable field (TF6-FR1..FR5) ------------------

const relookupActions = (
  relookup: PopupActions['relookup'],
): PopupActions => ({
  lookupThesaurus: async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}}),
  addUserEntry: async () => undefined,
  relookup,
});

const findByLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(n => n.props.accessibilityLabel === label);

describe('DefinitionPopup — OCR correction (editable)', () => {
  test('lasso flow (editable=true) renders the OCR field + Look up button', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting'), 'OCR: hello', true));
    expect(findByLabel(tree, 'Look up').length).toBe(1);
    // The OCR field is seeded with the queried word.
    const input = findByLabel(tree, 'OCR')[0];
    expect(input.props.value).toBe('hello');
  });

  test('doc-select flow (editable omitted) has NO OCR field', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting'), 'OCR: hello'));
    expect(findByLabel(tree, 'Look up').length).toBe(0);
  });

  test('editable is gated on === true, not ocrLabel presence', () => {
    // ocrLabel present but editable false-y -> still NO field.
    const tree = renderPopup();
    act(() =>
      showDefinition(found('WordNet', 'hi', 'greeting'), 'OCR: hi', false),
    );
    expect(findByLabel(tree, 'Look up').length).toBe(0);
  });

  test('Look up re-runs the lookup with the corrected (edited) text', async () => {
    const relookup = jest.fn(async () => undefined);
    setPopupActions(relookupActions(relookup));
    const tree = renderPopup();
    act(() => showDefinition(notFound('helo'), 'OCR: helo', true));
    // Correct the text.
    const input = findByLabel(tree, 'OCR')[0];
    act(() => input.props.onChangeText('hello'));
    await act(async () => findByLabel(tree, 'Look up')[0].props.onPress());
    expect(relookup).toHaveBeenCalledWith('hello');
  });

  test('Look up on empty/whitespace text is a no-op', async () => {
    const relookup = jest.fn(async () => undefined);
    setPopupActions(relookupActions(relookup));
    const tree = renderPopup();
    act(() => showDefinition(notFound('x'), 'OCR: x', true));
    const input = findByLabel(tree, 'OCR')[0];
    act(() => input.props.onChangeText('   '));
    await act(async () => findByLabel(tree, 'Look up')[0].props.onPress());
    expect(relookup).not.toHaveBeenCalled();
  });

  test('Look up swallows a relookup rejection (pipeline surfaces its own errors)', async () => {
    const relookup = jest.fn(async () => {
      throw new Error('relookup failed');
    });
    setPopupActions(relookupActions(relookup));
    const tree = renderPopup();
    act(() => showDefinition(notFound('helo'), 'OCR: helo', true));
    const input = findByLabel(tree, 'OCR')[0];
    act(() => input.props.onChangeText('hello'));
    await act(async () => {
      findByLabel(tree, 'Look up')[0].props.onPress();
      await Promise.resolve();
    });
    // No unhandled rejection / crash; the handler swallowed it.
    expect(relookup).toHaveBeenCalledWith('hello');
  });

  test('Look up with no registered actions does not crash', async () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('x'), 'OCR: x', true));
    const input = findByLabel(tree, 'OCR')[0];
    act(() => input.props.onChangeText('hello'));
    await act(async () => findByLabel(tree, 'Look up')[0].props.onPress());
    // No throw — assertion is reaching here.
    expect(findByLabel(tree, 'Look up').length).toBe(1);
  });
});

// --- Add-word form (TF7-FR3/FR4/FR6) -------------------------------

const addActions = (
  addUserEntry: PopupActions['addUserEntry'],
  relookup: PopupActions['relookup'],
): PopupActions => ({
  lookupThesaurus: async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}}),
  addUserEntry,
  relookup,
});

describe('DefinitionPopup — add-word form', () => {
  test('not-found shows an "Add definition" affordance', () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('photon')));
    expect(findByLabel(tree, 'Add definition').length).toBe(1);
  });

  test('a found result shows NO add affordance', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    expect(findByLabel(tree, 'Add definition').length).toBe(0);
  });

  test('opening the form prefills the headword with the queried word', () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('photon')));
    act(() => findByLabel(tree, 'Add definition')[0].props.onPress());
    const hwInput = findByLabel(tree, 'Headword')[0];
    expect(hwInput.props.value).toBe('photon');
    // Body input is multiline.
    const bodyInput = findByLabel(tree, 'Definition')[0];
    expect(bodyInput.props.multiline).toBe(true);
  });

  test('save -> addUserEntry then relookup with the headword', async () => {
    const addUserEntry = jest.fn(async () => undefined);
    const relookup = jest.fn(async () => undefined);
    setPopupActions(addActions(addUserEntry, relookup));
    const tree = renderPopup();
    act(() => showDefinition(notFound('photon')));
    act(() => findByLabel(tree, 'Add definition')[0].props.onPress());
    act(() =>
      findByLabel(tree, 'Definition')[0].props.onChangeText('a light quantum'),
    );
    await act(async () => {
      findByLabel(tree, 'Save')[0].props.onPress();
      await Promise.resolve();
    });
    expect(addUserEntry).toHaveBeenCalledWith('photon', 'a light quantum');
    expect(relookup).toHaveBeenCalledWith('photon');
  });

  test('the user entry renders first with a User badge after relookup', async () => {
    // Model relookup surfacing a User hit ahead of WordNet — the
    // registry order [user, ...imported, base] puts User first.
    const relookup = jest.fn(async (word: string) => {
      showDefinition({
        queriedFor: word,
        hits: [
          {source: 'User', entry: {word, definition: 'my def', format: 'plain'}},
          {source: 'WordNet', entry: {word, definition: 'wn def', format: 'wordnet'}},
        ],
        loading: [],
      });
    });
    setPopupActions(addActions(async () => undefined, relookup));
    const tree = renderPopup();
    act(() => showDefinition(notFound('photon')));
    act(() => findByLabel(tree, 'Add definition')[0].props.onPress());
    act(() => findByLabel(tree, 'Definition')[0].props.onChangeText('my def'));
    await act(async () => {
      findByLabel(tree, 'Save')[0].props.onPress();
      await Promise.resolve();
    });
    const text = collectText(tree);
    // User badge present, and its definition appears before WordNet's.
    expect(text).toContain('User');
    expect(text.indexOf('my def')).toBeLessThan(text.indexOf('wn def'));
  });

  test('empty body -> inline validation error, no action call', async () => {
    const addUserEntry = jest.fn(async () => undefined);
    setPopupActions(addActions(addUserEntry, async () => undefined));
    const tree = renderPopup();
    act(() => showDefinition(notFound('photon')));
    act(() => findByLabel(tree, 'Add definition')[0].props.onPress());
    // Leave body empty.
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
    expect(addUserEntry).not.toHaveBeenCalled();
    expect(collectText(tree)).toContain('Enter a headword and a definition.');
  });

  test('an addUserEntry rejection (IO failure) is surfaced inline', async () => {
    const addUserEntry = jest.fn(async () => {
      throw new Error('disk full');
    });
    const relookup = jest.fn(async () => undefined);
    setPopupActions(addActions(addUserEntry, relookup));
    const tree = renderPopup();
    act(() => showDefinition(notFound('photon')));
    act(() => findByLabel(tree, 'Add definition')[0].props.onPress());
    act(() => findByLabel(tree, 'Definition')[0].props.onChangeText('a def'));
    await act(async () => {
      findByLabel(tree, 'Save')[0].props.onPress();
      await Promise.resolve();
    });
    expect(collectText(tree)).toContain('Could not save');
    expect(relookup).not.toHaveBeenCalled();
  });

  test('save with no registered actions surfaces the failure inline', async () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('photon')));
    act(() => findByLabel(tree, 'Add definition')[0].props.onPress());
    act(() => findByLabel(tree, 'Definition')[0].props.onChangeText('a def'));
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
    expect(collectText(tree)).toContain('Could not save');
  });
});
