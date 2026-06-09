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

// The native clipboard bridge is device-only (NativeModules); mock it so
// the popup's copy handlers are exercised without a native module.
jest.mock('../src/native/clipboard', () => ({
  copyToClipboard: jest.fn(() =>
    Promise.resolve({success: true, code: 'OK', message: ''}),
  ),
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
  getCurrentState,
  type PopupActions,
  __testing__,
} from '../src/ui/popupController';
import type {DefinitionFormat, LookupResult} from '../src/core/lookup';
import type {ThesaurusResult} from '../src/core/dict/sqlite/thesaurusLookup';
import type {
  DbFile,
  DictPref,
  RestoreSummary,
} from '../src/core/dict/sqlite/settings';

import {copyToClipboard} from '../src/native/clipboard';
import {htmlToPlainText} from '../src/ui/htmlToPlainText';

const closePluginView = PluginManager.closePluginView as jest.Mock;
const copyMock = copyToClipboard as jest.Mock;

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
  copyMock.mockClear();
  copyMock.mockImplementation(() =>
    Promise.resolve({success: true, code: 'OK', message: ''}),
  );
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
  listDictPrefs: async () => [],
  setDictPrefs: async () => undefined,
  getKeepSources: async () => true,
  setKeepSources: async () => undefined,
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
  listDictPrefs: async () => [],
  setDictPrefs: async () => undefined,
  getKeepSources: async () => true,
  setKeepSources: async () => undefined,
});

const findByLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(n => n.props.accessibilityLabel === label);

// Narrowed read of the current popup kind: getCurrentState() is a union
// and `.kind` only exists on the visible variants, so narrow on .visible
// first (mirrors the guard popupController.closeSettings uses).
const currentKind = (): string | undefined => {
  const s = getCurrentState();
  return s.visible ? s.kind : undefined;
};

// Tap the pencil to enter edit mode.
const enterEdit = (tree: ReactTestRenderer) =>
  act(() => findByLabel(tree, 'Edit recognized text')[0].props.onPress());

describe('DefinitionPopup — OCR correction (display-first → tap-to-edit)', () => {
  test('CASE 1: editable, fresh result -> DISPLAY mode (text + pencil, NO field)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting'), 'OCR: hello', true));
    // The recognized text is shown via a tappable pencil row; NO edit
    // field or Lookup button yet.
    expect(findByLabel(tree, 'Edit recognized text').length).toBe(1);
    expect(findByLabel(tree, 'OCR').length).toBe(0);
    expect(findByLabel(tree, 'Look up').length).toBe(0);
    // The display row carries the recognized word (seeded from queriedFor).
    expect(collectText(tree)).toContain('hello');
  });

  test('CASE 2: tapping the pencil -> EDIT mode (field + Look up appear)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting'), 'OCR: hello', true));
    enterEdit(tree);
    const input = findByLabel(tree, 'OCR');
    expect(input.length).toBe(1);
    expect(input[0].props.value).toBe('hello');
    expect(input[0].props.autoFocus).toBe(true);
    expect(findByLabel(tree, 'Look up').length).toBe(1);
  });

  test('CASE 3: Look up in edit mode re-runs the lookup with the edited text', async () => {
    const relookup = jest.fn(async () => undefined);
    setPopupActions(relookupActions(relookup));
    const tree = renderPopup();
    act(() => showDefinition(notFound('helo'), 'OCR: helo', true));
    enterEdit(tree);
    act(() => findByLabel(tree, 'OCR')[0].props.onChangeText('hello'));
    await act(async () => findByLabel(tree, 'Look up')[0].props.onPress());
    expect(relookup).toHaveBeenCalledWith('hello');
  });

  test('CASE 4: a NEW result resets back to display mode (editing -> false)', () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('helo'), 'OCR: helo', true));
    enterEdit(tree);
    expect(findByLabel(tree, 'OCR').length).toBe(1); // editing
    // A new result arrives (e.g. after relookup) -> back to display mode.
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting'), 'OCR: hello', true));
    expect(findByLabel(tree, 'OCR').length).toBe(0); // no field
    expect(findByLabel(tree, 'Edit recognized text').length).toBe(1); // pencil back
  });

  test('CASE 5: doc-select flow (editable !== true) has NO pencil and NO field', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting'), 'OCR: hello'));
    expect(findByLabel(tree, 'Edit recognized text').length).toBe(0);
    expect(findByLabel(tree, 'OCR').length).toBe(0);
    expect(findByLabel(tree, 'Look up').length).toBe(0);
    // The plain OCR label still renders in the non-editable flow.
    expect(collectText(tree)).toContain('OCR: hello');
  });

  test('editable is gated on === true, not ocrLabel presence', () => {
    const tree = renderPopup();
    act(() =>
      showDefinition(found('WordNet', 'hi', 'greeting'), 'OCR: hi', false),
    );
    expect(findByLabel(tree, 'Edit recognized text').length).toBe(0);
    expect(findByLabel(tree, 'Look up').length).toBe(0);
  });

  test('Look up on empty/whitespace text is a no-op', async () => {
    const relookup = jest.fn(async () => undefined);
    setPopupActions(relookupActions(relookup));
    const tree = renderPopup();
    act(() => showDefinition(notFound('x'), 'OCR: x', true));
    enterEdit(tree);
    act(() => findByLabel(tree, 'OCR')[0].props.onChangeText('   '));
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
    enterEdit(tree);
    act(() => findByLabel(tree, 'OCR')[0].props.onChangeText('hello'));
    await act(async () => {
      findByLabel(tree, 'Look up')[0].props.onPress();
      await Promise.resolve();
    });
    expect(relookup).toHaveBeenCalledWith('hello');
  });

  test('Look up with no registered actions does not crash', async () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('x'), 'OCR: x', true));
    enterEdit(tree);
    act(() => findByLabel(tree, 'OCR')[0].props.onChangeText('hello'));
    await act(async () => findByLabel(tree, 'Look up')[0].props.onPress());
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
  listDictPrefs: async () => [],
  setDictPrefs: async () => undefined,
  getKeepSources: async () => true,
  setKeepSources: async () => undefined,
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

describe('DefinitionPopup — copy to clipboard', () => {
  test('Copy writes the word + definition and shows the "Copied" status', async () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'rain', 'to fall as water')));
    await act(async () => findByLabel(tree, 'Copy')[0].props.onPress());
    expect(copyMock).toHaveBeenCalledWith('rain\nto fall as water');
    expect(collectText(tree)).toContain('Copied');
  });

  test('Copy on a single-hit definition copies the word then the body', async () => {
    const tree = renderPopup();
    act(() => showDefinition(found('User', 'apple', 'a fruit')));
    await act(async () => findByLabel(tree, 'Copy')[0].props.onPress());
    expect(copyMock).toHaveBeenCalledWith('apple\na fruit');
  });

  test('a failed copy shows the failure status, not "Copied"', async () => {
    copyMock.mockImplementation(() =>
      Promise.resolve({
        success: false,
        code: 'NO_CLIPBOARD_SERVICE',
        message: 'x',
      }),
    );
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'rain', 'to fall as water')));
    await act(async () => findByLabel(tree, 'Copy')[0].props.onPress());
    const text = collectText(tree);
    expect(text).toContain("Couldn't copy");
    expect(text).not.toContain('Copied');
  });

  test('a thrown copy promise is treated as a failure, never a crash', async () => {
    copyMock.mockImplementation(() => Promise.reject(new Error('boom')));
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'rain', 'to fall as water')));
    await act(async () => findByLabel(tree, 'Copy')[0].props.onPress());
    expect(collectText(tree)).toContain("Couldn't copy");
  });

  test('no Copy action in the not-found state (nothing to copy)', () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('photon')));
    expect(findByLabel(tree, 'Copy')).toHaveLength(0);
  });

  test('the copy status clears when a new word is looked up', async () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'rain', 'to fall as water')));
    await act(async () => findByLabel(tree, 'Copy')[0].props.onPress());
    expect(collectText(tree)).toContain('Copied');
    act(() => showDefinition(found('WordNet', 'snow', 'frozen rain')));
    expect(collectText(tree)).not.toContain('Copied');
  });
});

// Integration-level copy tests: exercise the popup's wiring of the
// active tab / multi-source / format into buildCopyText — the paths the
// reducer tests cover in isolation but that a DefinitionPopup param-
// wiring regression (wrong `tab`, dropped `showSourceBadges`) would
// otherwise slip past. Uses the module-level flush/fakeActions/wordnetHit
// helpers from the thesaurus suite.
const pressTab = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    n => n.props.accessibilityLabel === label && n.props.onPress,
  )[0].props.onPress();

describe('DefinitionPopup — copy wiring (tab / multi-source / format)', () => {
  test('Copy on the Thesaurus tab copies the word + synonyms/antonyms', async () => {
    setPopupActions(
      fakeActions(async () => ({
        lang: 'en',
        omw: {synonyms: ['glad'], antonyms: ['sad']},
      })),
    );
    const tree = renderPopup();
    act(() => showDefinition(wordnetHit('happy', 'feeling joy')));
    await act(async () => pressTab(tree, 'Thesaurus'));
    await flush();
    await act(async () => findByLabel(tree, 'Copy')[0].props.onPress());
    expect(copyMock).toHaveBeenCalledWith(
      'happy\nSynonyms: glad\nAntonyms: sad',
    );
  });

  test('the copy status clears when switching tabs', async () => {
    setPopupActions(
      fakeActions(async () => ({
        lang: 'en',
        omw: {synonyms: ['glad'], antonyms: []},
      })),
    );
    const tree = renderPopup();
    act(() => showDefinition(wordnetHit('happy', 'feeling joy')));
    await act(async () => findByLabel(tree, 'Copy')[0].props.onPress());
    expect(collectText(tree)).toContain('Copied');
    await act(async () => pressTab(tree, 'Thesaurus'));
    await flush();
    expect(collectText(tree)).not.toContain('Copied');
  });

  test('Copy on a multi-source result copies the word + each badged section', async () => {
    setPopupActions(
      fakeActions(async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}})),
    );
    const tree = renderPopup();
    act(() =>
      showDefinition({
        queriedFor: 'apple',
        hits: [
          {
            source: 'WordNet',
            entry: {word: 'apple', definition: 'a fruit', format: 'plain'},
          },
          {
            source: 'Dune',
            entry: {
              word: 'apple',
              definition: 'a house word',
              format: 'plain',
            },
          },
        ],
        loading: [],
      }),
    );
    await act(async () => findByLabel(tree, 'Copy')[0].props.onPress());
    expect(copyMock).toHaveBeenCalledWith(
      'apple\nWordNet\na fruit\n\nDune\na house word',
    );
  });

  test('on the Thesaurus tab with no thesaurus, Copy still copies the word', async () => {
    setPopupActions(
      fakeActions(async () => ({lang: 'und', omw: {synonyms: [], antonyms: []}})),
    );
    const tree = renderPopup();
    act(() => showDefinition(wordnetHit('xyzzy', 'no known relations')));
    await act(async () => pressTab(tree, 'Thesaurus'));
    await flush();
    // The single Copy stays (it always copies at least the word).
    expect(findByLabel(tree, 'Copy')).toHaveLength(1);
    await act(async () => findByLabel(tree, 'Copy')[0].props.onPress());
    expect(copyMock).toHaveBeenCalledWith('xyzzy');
  });

  test('Copy of an html-format definition copies the word + the reduced text', async () => {
    const html = '<div>noun<br>a domestic animal</div>';
    const tree = renderPopup();
    act(() => showDefinition(found('Dict', 'cat', html, 'html')));
    await act(async () => findByLabel(tree, 'Copy')[0].props.onPress());
    const copied = copyMock.mock.calls[copyMock.mock.calls.length - 1][0];
    expect(copied).not.toMatch(/[<>]/);
    expect(copied).toBe(`cat\n${htmlToPlainText(html)}`);
  });
});

// --- Settings panel shell (F1) -------------------------------------

const pressLabel = (tree: ReactTestRenderer, label: string) =>
  findByLabel(tree, label)[0].props.onPress();

describe('DefinitionPopup — settings panel', () => {
  test('the gear renders in a result state (found)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    expect(findByLabel(tree, 'Settings')).toHaveLength(1);
  });

  test('the gear renders even in the not-found result state', () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('xenoglossy')));
    expect(findByLabel(tree, 'Settings')).toHaveLength(1);
  });

  test('the gear is absent during the recognizing kind', () => {
    const tree = renderPopup();
    act(() => showRecognizing());
    expect(findByLabel(tree, 'Settings')).toHaveLength(0);
  });

  test('tapping the gear opens the settings panel (title shown, kind=settings)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    act(() => pressLabel(tree, 'Settings'));
    const text = collectText(tree);
    expect(text).toContain('Settings');
    // The result definition is gone (panel replaced it).
    expect(text).not.toContain('a greeting');
    expect(currentKind()).toBe('settings');
    // The panel has a Back button.
    expect(findByLabel(tree, 'Back')).toHaveLength(1);
  });

  test('Back restores the prior result AND the Thesaurus tab (F1-AC2)', async () => {
    setPopupActions(
      fakeActions(async () => ({
        lang: 'en',
        omw: {synonyms: ['glad'], antonyms: ['sad']},
      })),
    );
    const tree = renderPopup();
    act(() => showDefinition(wordnetHit('happy', 'feeling joy')));
    // Flip to the Thesaurus tab and let the fetch settle.
    await act(async () =>
      tree.root
        .findAll(n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress)[0]
        .props.onPress(),
    );
    await flush();
    expect(collectText(tree)).toContain('glad');
    // Open settings, then Back.
    act(() => pressLabel(tree, 'Settings'));
    expect(currentKind()).toBe('settings');
    await act(async () => pressLabel(tree, 'Back'));
    await flush();
    // The result is back AND we're on the Thesaurus tab (synonyms still
    // render) — Back did not clobber the restored tab.
    const text = collectText(tree);
    expect(text).toContain('glad');
    expect(text).toContain('sad');
    expect(currentKind()).toBe('result');
  });

  test('the gear renders in the loading result state', () => {
    // Lead decision 4: the gear shows in every result state — incl. the
    // streaming "loading" snapshot, not just found/not-found.
    const tree = renderPopup();
    act(() => showDefinition(loading('apple', ['WordNet'])));
    expect(findByLabel(tree, 'Settings')).toHaveLength(1);
  });

  test('Back restores the editable lasso OCR row (the pencil returns)', async () => {
    // The other state-carry dimension besides activeTab: an editable
    // (lasso) result must come back editable after Settings → Back, so the
    // OCR-correction pencil reappears.
    const tree = renderPopup();
    act(() =>
      showDefinition(found('WordNet', 'rain', 'water'), 'OCR: rain', true),
    );
    expect(findByLabel(tree, 'Edit recognized text')).toHaveLength(1);
    act(() => pressLabel(tree, 'Settings'));
    expect(currentKind()).toBe('settings');
    await act(async () => pressLabel(tree, 'Back'));
    expect(currentKind()).toBe('result');
    expect(findByLabel(tree, 'Edit recognized text')).toHaveLength(1);
  });
});

// --- Dictionary manager (F3) ---------------------------------------

const dictPref = (
  name: string,
  enabled: boolean,
  sortOrder: number,
  removable = false,
): DictPref => ({prefKey: name, name, enabled, sortOrder, removable});

// PopupActions whose listDictPrefs returns a fixed set and whose
// setDictPrefs is a spy (captures the persisted payload the manager sends).
// F4: optional keepSources value + setKeepSources spy for the toggle tests.
const dictManagerActions = (
  prefs: DictPref[],
  setDictPrefs: PopupActions['setDictPrefs'] = async () => undefined,
  keepSources = true,
  setKeepSources: PopupActions['setKeepSources'] = async () => undefined,
): PopupActions => ({
  lookupThesaurus: async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}}),
  addUserEntry: async () => undefined,
  relookup: async () => undefined,
  listDictPrefs: async () => prefs,
  setDictPrefs,
  getKeepSources: async () => keepSources,
  setKeepSources,
});

// Open settings from a result, then let the mount-time listDictPrefs fetch
// + its setState settle so the list is rendered.
const openSettings = async (tree: ReactTestRenderer): Promise<void> => {
  act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
  act(() => pressLabel(tree, 'Settings'));
  await flush();
};

describe('DefinitionPopup — dictionary manager (F3)', () => {
  test('renders one row per pref with the section title (F3-FR2)', async () => {
    setPopupActions(
      dictManagerActions([
        dictPref('User', true, 0),
        dictPref('Dune', true, 1, true),
        dictPref('WordNet', true, 2),
      ]),
    );
    const tree = renderPopup();
    await openSettings(tree);
    const text = collectText(tree);
    expect(text).toContain('Dictionaries');
    expect(text).toContain('User');
    expect(text).toContain('Dune');
    expect(text).toContain('WordNet');
  });

  test('an enabled row shows Disable; toggling persists enabled=false (F3-FR3)', async () => {
    const spy = jest.fn(async (_prefs: DictPref[]) => undefined);
    setPopupActions(
      dictManagerActions(
        [dictPref('User', true, 0), dictPref('WordNet', true, 1)],
        spy,
      ),
    );
    const tree = renderPopup();
    await openSettings(tree);
    // Toggle User off.
    await act(async () => findByLabel(tree, 'Disable: User')[0].props.onPress());
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0] as DictPref[];
    expect(payload.find(p => p.name === 'User')?.enabled).toBe(false);
    // sortOrder is renumbered to the array index.
    expect(payload.map(p => p.sortOrder)).toEqual([0, 1]);
    // The row now offers Enable (off-state shown, not hidden).
    expect(findByLabel(tree, 'Enable: User')).toHaveLength(1);
  });

  test('Move-down on the top row reorders and persists the new order (F3-AC1)', async () => {
    const spy = jest.fn(async (_prefs: DictPref[]) => undefined);
    setPopupActions(
      dictManagerActions(
        [
          dictPref('User', true, 0),
          dictPref('Dune', true, 1, true),
          dictPref('WordNet', true, 2),
        ],
        spy,
      ),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => findByLabel(tree, 'Move down: User')[0].props.onPress());
    const payload = spy.mock.calls[0][0] as DictPref[];
    expect(payload.map(p => p.name)).toEqual(['Dune', 'User', 'WordNet']);
    expect(payload.map(p => p.sortOrder)).toEqual([0, 1, 2]);
  });

  test('Move-up on a lower row promotes it (F3-AC1) and persists the order', async () => {
    const spy = jest.fn(async (_prefs: DictPref[]) => undefined);
    setPopupActions(
      dictManagerActions(
        [
          dictPref('User', true, 0),
          dictPref('Dune', true, 1, true),
          dictPref('WordNet', true, 2),
        ],
        spy,
      ),
    );
    const tree = renderPopup();
    await openSettings(tree);
    // Move WordNet up twice -> [WordNet, User, Dune].
    await act(async () => findByLabel(tree, 'Move up: WordNet')[0].props.onPress());
    expect((spy.mock.calls[0][0] as DictPref[]).map(p => p.name)).toEqual([
      'User',
      'WordNet',
      'Dune',
    ]);
  });

  test('the top row hides Move-up and the bottom row hides Move-down (hide-don\'t-grey)', async () => {
    setPopupActions(
      dictManagerActions([
        dictPref('User', true, 0),
        dictPref('WordNet', true, 1),
      ]),
    );
    const tree = renderPopup();
    await openSettings(tree);
    // Top row (User) has no Move-up; bottom row (WordNet) has no Move-down.
    expect(findByLabel(tree, 'Move up: User')).toHaveLength(0);
    expect(findByLabel(tree, 'Move down: User')).toHaveLength(1);
    expect(findByLabel(tree, 'Move up: WordNet')).toHaveLength(1);
    expect(findByLabel(tree, 'Move down: WordNet')).toHaveLength(0);
  });

  test('disabling all sources shows the all-disabled warning (F3-FR5 / AC5)', async () => {
    setPopupActions(
      dictManagerActions([
        dictPref('User', false, 0),
        dictPref('WordNet', false, 1),
      ]),
    );
    const tree = renderPopup();
    await openSettings(tree);
    expect(collectText(tree)).toContain(
      'All dictionaries are off — lookups return nothing.',
    );
  });

  test('with at least one enabled dict, no warning is shown', async () => {
    setPopupActions(
      dictManagerActions([
        dictPref('User', false, 0),
        dictPref('WordNet', true, 1),
      ]),
    );
    const tree = renderPopup();
    await openSettings(tree);
    expect(collectText(tree)).not.toContain('All dictionaries are off');
  });

  test('re-fetches the list on every mount (EC6)', async () => {
    const listSpy = jest.fn(async () => [dictPref('WordNet', true, 0)]);
    setPopupActions({
      lookupThesaurus: async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}}),
      addUserEntry: async () => undefined,
      relookup: async () => undefined,
      listDictPrefs: listSpy,
      setDictPrefs: async () => undefined,
      getKeepSources: async () => true,
      setKeepSources: async () => undefined,
    });
    const tree = renderPopup();
    await openSettings(tree);
    expect(listSpy).toHaveBeenCalledTimes(1);
    // Back to the result, then re-open settings -> the panel re-mounts and
    // re-fetches (a fresh detached import could have changed the set).
    await act(async () => pressLabel(tree, 'Back'));
    act(() => pressLabel(tree, 'Settings'));
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  test('renders without crashing when no actions are registered (null guard)', async () => {
    // No setPopupActions — getPopupActions() is null; the panel opens with
    // an empty list and no warning, no crash.
    const tree = renderPopup();
    await openSettings(tree);
    expect(collectText(tree)).toContain('Dictionaries');
    expect(collectText(tree)).not.toContain('All dictionaries are off');
  });

  test('a setDictPrefs rejection is swallowed (optimistic UI stays)', async () => {
    const spy = jest.fn(async () => {
      throw new Error('persist failed');
    });
    setPopupActions(
      dictManagerActions([dictPref('WordNet', true, 0)], spy),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Disable: WordNet')[0].props.onPress();
      await Promise.resolve();
    });
    // The optimistic toggle still applied (row now shows Enable).
    expect(findByLabel(tree, 'Enable: WordNet')).toHaveLength(1);
  });

  test('a listDictPrefs rejection leaves an empty list (no crash)', async () => {
    setPopupActions({
      lookupThesaurus: async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}}),
      addUserEntry: async () => undefined,
      relookup: async () => undefined,
      listDictPrefs: async () => {
        throw new Error('read failed');
      },
      setDictPrefs: async () => undefined,
      getKeepSources: async () => true,
      setKeepSources: async () => undefined,
    });
    const tree = renderPopup();
    await openSettings(tree);
    expect(collectText(tree)).toContain('Dictionaries');
  });
});

describe('DefinitionPopup — keep-sources toggle (F4)', () => {
  test('renders the Import sources section with the keep label + hint', async () => {
    setPopupActions(dictManagerActions([dictPref('WordNet', true, 0)]));
    const tree = renderPopup();
    await openSettings(tree);
    const text = collectText(tree);
    expect(text).toContain('Import sources');
    expect(text).toContain('Keep source files after import');
  });

  test('keep=true shows the Keep state on the toggle', async () => {
    setPopupActions(
      dictManagerActions([dictPref('WordNet', true, 0)], undefined, true),
    );
    const tree = renderPopup();
    await openSettings(tree);
    // The switch control reflects the persisted keep state.
    const sw = findByLabel(tree, 'Keep source files after import');
    expect(sw).toHaveLength(1);
    expect(sw[0].props.accessibilityState).toMatchObject({checked: true});
  });

  test('toggling persists the flipped value via setKeepSources', async () => {
    const spy = jest.fn(async (_keep: boolean) => undefined);
    setPopupActions(
      dictManagerActions([dictPref('WordNet', true, 0)], undefined, true, spy),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Keep source files after import')[0].props.onPress();
      await Promise.resolve();
    });
    // Flipped keep=true -> setKeepSources(false).
    expect(spy).toHaveBeenCalledWith(false);
    // The control now reflects the optimistic off (delete) state.
    const sw = findByLabel(tree, 'Keep source files after import');
    expect(sw[0].props.accessibilityState).toMatchObject({checked: false});
  });

  test('loads keep=false from the engine and shows the Delete state', async () => {
    setPopupActions(
      dictManagerActions([dictPref('WordNet', true, 0)], undefined, false),
    );
    const tree = renderPopup();
    await openSettings(tree);
    const sw = findByLabel(tree, 'Keep source files after import');
    expect(sw[0].props.accessibilityState).toMatchObject({checked: false});
  });

  test('a setKeepSources rejection is swallowed (optimistic UI stays)', async () => {
    const spy = jest.fn(async () => {
      throw new Error('persist failed');
    });
    setPopupActions(
      dictManagerActions([dictPref('WordNet', true, 0)], undefined, true, spy),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Keep source files after import')[0].props.onPress();
      await Promise.resolve();
    });
    const sw = findByLabel(tree, 'Keep source files after import');
    expect(sw[0].props.accessibilityState).toMatchObject({checked: false});
  });

  test('null actions: the toggle defaults to keep, no crash', async () => {
    const tree = renderPopup();
    await openSettings(tree);
    const sw = findByLabel(tree, 'Keep source files after import');
    expect(sw[0].props.accessibilityState).toMatchObject({checked: true});
  });

  test('a getKeepSources rejection keeps the safe default (keep), no crash', async () => {
    setPopupActions({
      lookupThesaurus: async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}}),
      addUserEntry: async () => undefined,
      relookup: async () => undefined,
      listDictPrefs: async () => [dictPref('WordNet', true, 0)],
      setDictPrefs: async () => undefined,
      getKeepSources: async () => {
        throw new Error('read failed');
      },
      setKeepSources: async () => undefined,
    });
    const tree = renderPopup();
    await openSettings(tree);
    const sw = findByLabel(tree, 'Keep source files after import');
    expect(sw[0].props.accessibilityState).toMatchObject({checked: true});
  });

  test('unmount before the keep/list fetches resolve does not setState (cancel guard)', async () => {
    // Deferred actions so the panel unmounts (Back) while both fetches are
    // still pending — the cancelled guard must skip both setState calls.
    let releasePrefs!: (p: DictPref[]) => void;
    let releaseKeep!: (k: boolean) => void;
    setPopupActions({
      lookupThesaurus: async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}}),
      addUserEntry: async () => undefined,
      relookup: async () => undefined,
      listDictPrefs: () =>
        new Promise<DictPref[]>(res => {
          releasePrefs = res;
        }),
      setDictPrefs: async () => undefined,
      getKeepSources: () =>
        new Promise<boolean>(res => {
          releaseKeep = res;
        }),
      setKeepSources: async () => undefined,
    });
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    act(() => pressLabel(tree, 'Settings'));
    // Leave settings (unmount the panel) BEFORE the fetches resolve.
    await act(async () => pressLabel(tree, 'Back'));
    // Now resolve — the cancelled guard means no setState-after-unmount.
    await act(async () => {
      releasePrefs([dictPref('WordNet', true, 0)]);
      releaseKeep(false);
      await Promise.resolve();
    });
    // No crash / no warning surfaced; the popup is back on the result view.
    expect(collectText(tree)).toContain('hello');
  });
});

// --- Remove an imported dict (F7) ----------------------------------

const okDelete = {
  ok: true as const,
  removed: {slugDb: true, audit: true, pref: true, sources: true},
};

// PopupActions with the F3 list + the F7 delete seam: a confirm port (resolves
// true=Delete / false=Cancel) and a deleteImportedDict spy.
const deleteActions = (
  prefs: DictPref[],
  confirmDeleteDict: PopupActions['confirmDeleteDict'] = async () => true,
  deleteImportedDict: PopupActions['deleteImportedDict'] = async () => okDelete,
  listDictPrefs: PopupActions['listDictPrefs'] = async () => prefs,
): PopupActions => ({
  lookupThesaurus: async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}}),
  addUserEntry: async () => undefined,
  relookup: async () => undefined,
  listDictPrefs,
  setDictPrefs: async () => undefined,
  getKeepSources: async () => true,
  setKeepSources: async () => undefined,
  confirmDeleteDict,
  deleteImportedDict,
});

describe('DefinitionPopup — remove imported dict (F7)', () => {
  test('Remove renders ONLY on removable rows (F7-FR1)', async () => {
    setPopupActions(
      deleteActions([
        dictPref('User', true, 0),
        dictPref('Dune', true, 1, true),
        dictPref('WordNet', true, 2),
      ]),
    );
    const tree = renderPopup();
    await openSettings(tree);
    // Imported (removable) Dune has a Remove control...
    expect(findByLabel(tree, 'Remove: Dune')).toHaveLength(1);
    // ...base/User do NOT (hide-don't-grey).
    expect(findByLabel(tree, 'Remove: User')).toHaveLength(0);
    expect(findByLabel(tree, 'Remove: WordNet')).toHaveLength(0);
  });

  test('tapping Remove confirms, then deletes on Delete + re-fetches (F7-FR2/FR3)', async () => {
    const confirm = jest.fn(async (_name: string) => true);
    const del = jest.fn(async (_key: string) => okDelete);
    // The list loses Dune after the delete (re-fetch returns the new set).
    const lists = [
      [dictPref('User', true, 0), dictPref('Dune', true, 1, true), dictPref('WordNet', true, 2)],
      [dictPref('User', true, 0), dictPref('WordNet', true, 1)],
    ];
    let call = 0;
    setPopupActions(
      deleteActions(lists[0], confirm, del, async () => lists[Math.min(call++, 1)]),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Remove: Dune')[0].props.onPress();
      await flush();
    });
    // Confirm shown with the dict name; delete called with Dune's prefKey.
    expect(confirm).toHaveBeenCalledWith('Dune');
    expect(del).toHaveBeenCalledWith('Dune');
    // The list re-fetched -> Dune row is gone.
    expect(findByLabel(tree, 'Remove: Dune')).toHaveLength(0);
    expect(collectText(tree)).not.toContain('Dune');
  });

  test('cancelling the confirm does NOT delete (only Delete proceeds)', async () => {
    const confirm = jest.fn(async () => false); // user taps Cancel
    const del = jest.fn(async () => okDelete);
    setPopupActions(deleteActions([dictPref('Dune', true, 0, true)], confirm, del));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Remove: Dune')[0].props.onPress();
      await flush();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
    // The row stays.
    expect(findByLabel(tree, 'Remove: Dune')).toHaveLength(1);
  });

  test('a deleteImportedDict rejection is swallowed (no crash)', async () => {
    const del = jest.fn(async () => {
      throw new Error('delete blew up');
    });
    setPopupActions(
      deleteActions([dictPref('Dune', true, 0, true)], async () => true, del),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Remove: Dune')[0].props.onPress();
      await flush();
    });
    // No crash; the popup is still on the settings panel.
    expect(collectText(tree)).toContain('Dictionaries');
  });

  test('Remove is a no-op when the F7 ports are absent (F3/F4-only actions)', async () => {
    // dictManagerActions omits confirmDeleteDict/deleteImportedDict — but the
    // Remove control still renders on a removable row; tapping it is a no-op.
    setPopupActions(dictManagerActions([dictPref('Dune', true, 0, true)]));
    const tree = renderPopup();
    await openSettings(tree);
    const remove = findByLabel(tree, 'Remove: Dune');
    expect(remove).toHaveLength(1);
    await act(async () => {
      remove[0].props.onPress();
      await flush();
    });
    // No crash; row stays.
    expect(findByLabel(tree, 'Remove: Dune')).toHaveLength(1);
  });

  test('unmount before the post-delete re-fetch resolves does not setState (cancel guard)', async () => {
    // Defer the re-fetch's listDictPrefs so the panel can unmount (Back)
    // while it is still pending — the cancelled guard must skip its setState.
    let releaseRefetch!: (p: DictPref[]) => void;
    let listCalls = 0;
    const listDictPrefs: PopupActions['listDictPrefs'] = () => {
      listCalls += 1;
      // 1st call (mount) resolves immediately; the 2nd (post-delete refresh)
      // is deferred so we can unmount before it lands.
      if (listCalls === 1) {
        return Promise.resolve([dictPref('Dune', true, 0, true)]);
      }
      return new Promise<DictPref[]>(res => {
        releaseRefetch = res;
      });
    };
    setPopupActions(
      deleteActions([dictPref('Dune', true, 0, true)], async () => true, async () => okDelete, listDictPrefs),
    );
    const tree = renderPopup();
    await openSettings(tree);
    // Trigger the delete -> its post-delete refreshList fires (the deferred
    // 2nd listDictPrefs), then Back (unmount) before it resolves.
    await act(async () => {
      findByLabel(tree, 'Remove: Dune')[0].props.onPress();
      await flush();
    });
    await act(async () => pressLabel(tree, 'Back'));
    // Resolve the deferred re-fetch AFTER unmount — the cancelled guard means
    // no setState-after-unmount (no crash / warning).
    await act(async () => {
      releaseRefetch([dictPref('Dune', true, 0, true)]);
      await Promise.resolve();
    });
    expect(collectText(tree)).toContain('hello');
  });
});

// --- DB export section (F5) ----------------------------------------

const MYSTYLE = '/storage/emulated/0/MyStyle';

type ExportSummaryShape = {
  copied: string[];
  failed: {file: string; reason: string}[];
  targetDir: string;
};

// PopupActions carrying the F3 list + the F5 export ports: a folder
// lister, a createFolder spy, an exportDbs spy, and listExportableDbs.
// All four export ports are optional on PopupActions; the section renders
// only when exportDbs is present.
const exportActions = (
  exportDbs: PopupActions['exportDbs'] = async (targetDir) => ({
    copied: ['base.db', 'user.db'],
    failed: [],
    targetDir,
  }),
  listFolders: PopupActions['listFolders'] = async () => [`${MYSTYLE}/SnDict`],
  createFolder: PopupActions['createFolder'] = async () => true,
  listExportableDbs: PopupActions['listExportableDbs'] = async () =>
    [
      {label: 'WordNet', filename: 'base.db'},
      {label: 'User', filename: 'user.db'},
    ] as DbFile[],
): PopupActions => ({
  lookupThesaurus: async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}}),
  addUserEntry: async () => undefined,
  relookup: async () => undefined,
  listDictPrefs: async () => [],
  setDictPrefs: async () => undefined,
  getKeepSources: async () => true,
  setKeepSources: async () => undefined,
  listExportableDbs,
  listFolders,
  createFolder,
  exportDbs,
});

describe('DefinitionPopup — DB export (F5)', () => {
  test('the export section renders its title + the chooser root path', async () => {
    setPopupActions(exportActions());
    const tree = renderPopup();
    await openSettings(tree);
    const text = collectText(tree);
    expect(text).toContain('Export dictionaries');
    // The chooser opens at the MyStyle root.
    expect(text).toContain(MYSTYLE);
  });

  test('the chooser lists subfolders and descends on tap (F5-FR2)', async () => {
    setPopupActions(exportActions(undefined, async () => [`${MYSTYLE}/SnDict`]));
    const tree = renderPopup();
    await openSettings(tree);
    // The SnDict subfolder is listed; tapping it descends into it.
    await act(async () => {
      findByLabel(tree, 'Use this folder: SnDict')[0].props.onPress();
      await flush();
    });
    // Current path is now MyStyle/SnDict.
    expect(collectText(tree)).toContain(`${MYSTYLE}/SnDict`);
  });

  test('the section is absent when the export ports are not wired', async () => {
    // dictManagerActions omits the F5 ports -> the section renders nothing.
    setPopupActions(dictManagerActions([dictPref('User', true, 0)]));
    const tree = renderPopup();
    await openSettings(tree);
    expect(collectText(tree)).not.toContain('Export dictionaries');
  });

  test('Export calls exportDbs with the current folder and shows the summary (F5-FR5)', async () => {
    const exportSpy = jest.fn(async (targetDir: string) => ({
      copied: ['base.db', 'user.db', 'dune.en.db'],
      failed: [],
      targetDir,
    }));
    setPopupActions(exportActions(exportSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Export dictionaries')[0].props.onPress();
      await flush();
    });
    // Exported to the root folder; the summary shows the copied count.
    expect(exportSpy).toHaveBeenCalledWith(MYSTYLE);
    const text = collectText(tree);
    expect(text).toContain('Export complete');
    expect(text).toContain(MYSTYLE);
  });

  test('a partial-failure summary lists the failed file (F5-AC4)', async () => {
    const exportSpy = jest.fn(async (targetDir: string) => ({
      copied: ['base.db'],
      failed: [{file: 'user.db', reason: 'disk error'}],
      targetDir,
    }));
    setPopupActions(exportActions(exportSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Export dictionaries')[0].props.onPress();
      await flush();
    });
    expect(collectText(tree)).toContain('user.db');
  });

  test('an export rejection (no-space / plugin-dir guard) surfaces its reason (F5-AC2/AC5)', async () => {
    const exportSpy = jest.fn(async () => {
      throw new Error('Not enough free space to export — nothing was copied.');
    });
    setPopupActions(exportActions(exportSpy as PopupActions['exportDbs']));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Export dictionaries')[0].props.onPress();
      await flush();
    });
    expect(collectText(tree)).toContain('Not enough free space');
  });

  test('New folder creates a named child and descends into it (F5-AC3)', async () => {
    const createSpy = jest.fn(async () => true);
    const listSpy = jest.fn(async () => [] as string[]);
    setPopupActions(exportActions(undefined, listSpy, createSpy));
    const tree = renderPopup();
    await openSettings(tree);
    // Type a folder name into the New-folder input, then tap "+".
    await act(async () => {
      findByLabel(tree, 'New folder')[0].props.onChangeText('backup');
      await flush();
    });
    await act(async () => {
      // The "+" Pressable is the 2nd New-folder-labelled node (after input).
      findByLabel(tree, 'New folder')[1].props.onPress();
      await flush();
    });
    expect(createSpy).toHaveBeenCalledWith(`${MYSTYLE}/backup`);
    // Descended into the new folder (current path updated).
    expect(collectText(tree)).toContain(`${MYSTYLE}/backup`);
  });

  test('New folder with a blank name is a no-op', async () => {
    const createSpy = jest.fn(async () => true);
    setPopupActions(exportActions(undefined, undefined, createSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'New folder')[1].props.onPress();
      await flush();
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  test('Up navigates back to the parent after descending', async () => {
    setPopupActions(exportActions(undefined, async () => [`${MYSTYLE}/SnDict`]));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Use this folder: SnDict')[0].props.onPress();
      await flush();
    });
    // Up row appears below root; tap it to go back to MyStyle.
    await act(async () => {
      findByLabel(tree, `Move up: ${MYSTYLE}/SnDict`)[0].props.onPress();
      await flush();
    });
    // Back at the root: the Up row is gone (atRoot hides it).
    expect(findByLabel(tree, `Move up: ${MYSTYLE}`)).toHaveLength(0);
  });

  test('a listFolders rejection yields an empty chooser (no crash)', async () => {
    setPopupActions(
      exportActions(undefined, async () => {
        throw new Error('listFiles blew up');
      }),
    );
    const tree = renderPopup();
    await openSettings(tree);
    // The section still renders (title + root path), just with no rows.
    expect(collectText(tree)).toContain('Export dictionaries');
    expect(collectText(tree)).toContain(MYSTYLE);
  });

  test('the chooser has no rows when listFolders is not wired', async () => {
    // exportDbs present (section renders) but listFolders absent -> the
    // loadFolders short-circuit sets an empty list.
    const noListFolders = exportActions();
    delete noListFolders.listFolders;
    setPopupActions(noListFolders);
    const tree = renderPopup();
    await openSettings(tree);
    expect(collectText(tree)).toContain('Export dictionaries');
    // No SnDict subfolder row (listFolders never ran).
    expect(findByLabel(tree, 'Use this folder: SnDict')).toHaveLength(0);
  });

  test('a createFolder resolving false does NOT descend (stays at root)', async () => {
    const createSpy = jest.fn(async () => false);
    setPopupActions(exportActions(undefined, async () => [], createSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'New folder')[0].props.onChangeText('backup');
      await flush();
    });
    await act(async () => {
      findByLabel(tree, 'New folder')[1].props.onPress();
      await flush();
    });
    expect(createSpy).toHaveBeenCalledWith(`${MYSTYLE}/backup`);
    // Did NOT descend — still at the MyStyle root.
    expect(collectText(tree)).not.toContain(`${MYSTYLE}/backup`);
  });

  test('a createFolder rejection is swallowed (no crash, name retained)', async () => {
    const createSpy = jest.fn(async () => {
      throw new Error('mkdir EACCES');
    });
    setPopupActions(exportActions(undefined, async () => [], createSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'New folder')[0].props.onChangeText('backup');
      await flush();
    });
    await act(async () => {
      findByLabel(tree, 'New folder')[1].props.onPress();
      await flush();
    });
    // No crash; still on the export section.
    expect(collectText(tree)).toContain('Export dictionaries');
  });

  test('New folder is a no-op when the createFolder port is absent', async () => {
    const noCreate = exportActions();
    delete noCreate.createFolder;
    setPopupActions(noCreate);
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'New folder')[0].props.onChangeText('backup');
      await flush();
    });
    await act(async () => {
      findByLabel(tree, 'New folder')[1].props.onPress();
      await flush();
    });
    // No descend, no crash.
    expect(collectText(tree)).not.toContain(`${MYSTYLE}/backup`);
  });

  test('unmount before the export resolves does not setState (cancel guard)', async () => {
    // Defer exportDbs so the panel can unmount (Back) while it is pending —
    // the cancelled guard must skip the summary setState (no crash).
    let releaseExport!: (s: ExportSummaryShape) => void;
    const exportSpy: PopupActions['exportDbs'] = () =>
      new Promise(res => {
        releaseExport = res;
      });
    setPopupActions(exportActions(exportSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Export dictionaries')[0].props.onPress();
      await flush();
    });
    // Back (unmount the panel) before the export resolves.
    await act(async () => pressLabel(tree, 'Back'));
    // Resolve AFTER unmount — the cancelled guard means no setState.
    await act(async () => {
      releaseExport({copied: ['base.db'], failed: [], targetDir: MYSTYLE});
      await Promise.resolve();
    });
    // The prior result is back; no export summary leaked into it.
    expect(collectText(tree)).toContain('hello');
  });

  test('unmount before an export REJECTION resolves does not setState', async () => {
    // The catch path's cancelled guard: defer a rejecting export, unmount,
    // then reject — no setState-after-unmount.
    let rejectExport!: (e: Error) => void;
    const exportSpy: PopupActions['exportDbs'] = () =>
      new Promise((_res, rej) => {
        rejectExport = rej;
      });
    setPopupActions(exportActions(exportSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Export dictionaries')[0].props.onPress();
      await flush();
    });
    await act(async () => pressLabel(tree, 'Back'));
    await act(async () => {
      rejectExport(new Error('NO_SPACE'));
      await Promise.resolve();
    });
    expect(collectText(tree)).toContain('hello');
  });

  test('a listed folder with no slash renders its bare name (basename edge)', async () => {
    // A listFiles entry that is a bare segment (no slash) exercises the
    // basename slash<0 fallback.
    setPopupActions(exportActions(undefined, async () => ['solo']));
    const tree = renderPopup();
    await openSettings(tree);
    expect(findByLabel(tree, 'Use this folder: solo')).toHaveLength(1);
  });
});

// --- DB restore section (F8) ---------------------------------------

// PopupActions carrying the F5 export ports PLUS the F8 restore ports
// (confirmRestore + restoreDbs). The Restore button renders only when
// restoreDbs is wired; the confirm gate uses confirmRestore (a
// host-mockable port).
const restoreActions = (
  restoreDbs: PopupActions['restoreDbs'] = async (backupDir) => ({
    restored: ['user.db', 'dune.en.db'],
    failed: [],
    backupDir,
  }),
  confirmRestore: PopupActions['confirmRestore'] = async () => true,
): PopupActions => ({
  ...exportActions(),
  restoreDbs,
  confirmRestore,
});

describe('DefinitionPopup — DB restore (F8)', () => {
  test('the Restore control renders when the restore port is wired', async () => {
    setPopupActions(restoreActions());
    const tree = renderPopup();
    await openSettings(tree);
    expect(findByLabel(tree, 'Restore from here')).toHaveLength(1);
  });

  test('the Restore control is ABSENT when only the export ports are wired', async () => {
    // exportActions() has no restoreDbs port -> no Restore button.
    setPopupActions(exportActions());
    const tree = renderPopup();
    await openSettings(tree);
    expect(findByLabel(tree, 'Restore from here')).toHaveLength(0);
  });

  test('confirm -> restoreDbs(current) -> shows the restored count + reopen message', async () => {
    const restoreSpy = jest.fn(async (backupDir: string) => ({
      restored: ['user.db', 'dune.en.db'],
      failed: [],
      backupDir,
    }));
    const confirmSpy = jest.fn(async () => true);
    setPopupActions(restoreActions(restoreSpy, confirmSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Restore from here')[0].props.onPress();
      await flush();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Restored from the current (root) folder; the summary shows the count
    // AND the "reopen the plugin to finish" message (no auto re-bootstrap).
    expect(restoreSpy).toHaveBeenCalledWith(MYSTYLE);
    const text = collectText(tree);
    expect(text).toContain('Restored: 2');
    expect(text).toContain('reopen the plugin to finish');
  });

  test('cancel (confirm -> false) does NOT call restoreDbs', async () => {
    const restoreSpy = jest.fn(async (backupDir: string) => ({
      restored: [],
      failed: [],
      backupDir,
    }));
    setPopupActions(restoreActions(restoreSpy, async () => false));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Restore from here')[0].props.onPress();
      await flush();
    });
    expect(restoreSpy).not.toHaveBeenCalled();
    // No reopen message (nothing was restored).
    expect(collectText(tree)).not.toContain('reopen the plugin');
  });

  test('an empty-backup summary surfaces the no-backup reason (no reopen prompt)', async () => {
    const restoreSpy = jest.fn(async (backupDir: string) => ({
      restored: [],
      failed: [{file: backupDir, reason: 'No dictionary backups found in this folder.'}],
      backupDir,
    }));
    setPopupActions(restoreActions(restoreSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Restore from here')[0].props.onPress();
      await flush();
    });
    const text = collectText(tree);
    expect(text).toContain('No dictionary backups found');
    // No reopen prompt — nothing changed on disk.
    expect(text).not.toContain('reopen the plugin to finish');
  });

  test('a partial-failure restore lists the failed file + the reopen message', async () => {
    const restoreSpy = jest.fn(async (backupDir: string) => ({
      restored: ['user.db'],
      failed: [{file: 'dune.en.db', reason: 'disk error'}],
      backupDir,
    }));
    setPopupActions(restoreActions(restoreSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Restore from here')[0].props.onPress();
      await flush();
    });
    const text = collectText(tree);
    expect(text).toContain('Restored: 1');
    expect(text).toContain('dune.en.db');
    expect(text).toContain('reopen the plugin to finish');
  });

  test('a restore REJECTION surfaces its reason verbatim', async () => {
    const restoreSpy = jest.fn(async () => {
      throw new Error('native copy unavailable');
    });
    setPopupActions(
      restoreActions(restoreSpy as PopupActions['restoreDbs']),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Restore from here')[0].props.onPress();
      await flush();
    });
    expect(collectText(tree)).toContain('native copy unavailable');
  });

  test('a null confirmRestore port treats restore as confirmed (still inert without restoreDbs)', async () => {
    // restoreDbs wired but confirmRestore absent -> the restore proceeds
    // without a confirm dialog (the port gates the button, not the confirm).
    const restoreSpy = jest.fn(async (backupDir: string) => ({
      restored: ['user.db'],
      failed: [],
      backupDir,
    }));
    const actions = restoreActions(restoreSpy);
    delete actions.confirmRestore;
    setPopupActions(actions);
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Restore from here')[0].props.onPress();
      await flush();
    });
    expect(restoreSpy).toHaveBeenCalledWith(MYSTYLE);
    expect(collectText(tree)).toContain('Restored: 1');
  });

  test('unmount before a restore resolves does not setState (cancelled guard)', async () => {
    let resolveRestore!: (s: RestoreSummary) => void;
    const restoreSpy: PopupActions['restoreDbs'] = () =>
      new Promise<RestoreSummary>(res => {
        resolveRestore = res;
      });
    setPopupActions(restoreActions(restoreSpy));
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Restore from here')[0].props.onPress();
      await flush();
    });
    await act(async () => pressLabel(tree, 'Back'));
    await act(async () => {
      resolveRestore({restored: ['user.db'], failed: [], backupDir: MYSTYLE});
      await Promise.resolve();
    });
    expect(collectText(tree)).toContain('hello');
  });
});
