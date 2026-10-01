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

// The pen-tool observer is device-only (requireNativeComponent). Mock it
// as a passthrough that renders its children and lets the test drive the
// native onToolDown event, so the pen-only tap-outside-to-close wiring is
// host-exercised. Tests that need the off-device path (native component
// unavailable) override getPenToolObserver to return null.
jest.mock('../src/native/penToolObserver', () => {
  const ReactLocal = require('react');
  const MockPenToolObserver = ({
    children,
    onToolDown,
    ...rest
  }: {
    children?: unknown;
    onToolDown?: (e: {nativeEvent: {toolType: string}}) => void;
  }) =>
    ReactLocal.createElement('PenToolObserver', {onToolDown, ...rest}, children);
  return {getPenToolObserver: jest.fn(() => MockPenToolObserver)};
});

import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {PluginManager} from 'sn-plugin-lib';
import DefinitionPopup from '../src/ui/DefinitionPopup';
import {
  showDefinition,
  showRecognizing,
  showSettings,
  hideDefinition,
  setPopupActions,
  getCurrentState,
  BACKDROP_TAP_RECENCY_MS,
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
import {getPenToolObserver} from '../src/native/penToolObserver';
import {htmlToPlainText} from '../src/ui/htmlToPlainText';
// StyleSheet.create is identity-mocked above, so these are the very
// objects the rendered tree carries — reference-comparable.
import {popupStyles, scaleText} from '../src/ui/popupStyles';
import {FONT_SIZES} from '../src/ui/DefinitionPopup';

const closePluginView = PluginManager.closePluginView as jest.Mock;
const copyMock = copyToClipboard as jest.Mock;
const getObserverMock = getPenToolObserver as jest.Mock;
// The passthrough component the mock returns by default (captured so the
// per-test reset can restore it after the null-observer case).
const passthroughObserver = getObserverMock();

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
  // Restore the passthrough observer (the null-observer test overrides it).
  getObserverMock.mockReturnValue(passthroughObserver);
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
      // All three glyphs always rendered — minus, level indicator, plus.
      // The middle slot now names the level rather than showing a static
      // 'A', so assert it via the slot and not via collectText: 'L' is a
      // substring of 'XL', so a toContain would pass vacuously.
      const text = collectText(tree);
      expect(text).toContain('−');
      expect(text).toContain('+');
      expect(findLevelLabel(tree)).toBe('S');
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

    test('2X (the top): plus is greyed and disabled; minus is active', () => {
      const tree = renderPopup();
      act(() => {
        showDefinition(found('WordNet', 'hello', 'a greeting'));
      });
      // Four presses to the top now, not two — S M L XL 2X.
      act(() => {
        findFontBtn(tree, 'Increase text size').props.onPress();
        findFontBtn(tree, 'Increase text size').props.onPress();
        findFontBtn(tree, 'Increase text size').props.onPress();
        findFontBtn(tree, 'Increase text size').props.onPress();
      });
      const minus = findFontBtn(tree, 'Decrease text size');
      const plus = findFontBtn(tree, 'Increase text size');
      expect(minus.props.disabled).toBe(false);
      expect(plus.props.disabled).toBe(true);
      expect(findLevelLabel(tree)).toBe('2X');
    });

    test('round-trip: four up then four down returns to the S state', () => {
      const tree = renderPopup();
      act(() => {
        showDefinition(found('WordNet', 'hello', 'a greeting'));
      });
      act(() => {
        for (let i = 0; i < 4; i++) {
          findFontBtn(tree, 'Increase text size').props.onPress();
        }
      });
      expect(findLevelLabel(tree)).toBe('2X');
      act(() => {
        for (let i = 0; i < 4; i++) {
          findFontBtn(tree, 'Decrease text size').props.onPress();
        }
      });
      expect(findFontBtn(tree, 'Decrease text size').props.disabled).toBe(true);
      expect(findFontBtn(tree, 'Increase text size').props.disabled).toBe(false);
      expect(findLevelLabel(tree)).toBe('S');
    });

    test('font-size controls are NOT rendered during the recognizing kind', () => {
      const tree = renderPopup();
      act(() => {
        showRecognizing();
      });
      expect(tryFindFontBtn(tree, 'Decrease text size')).toHaveLength(0);
      expect(tryFindFontBtn(tree, 'Increase text size')).toHaveLength(0);
      // ...and neither is the level indicator between them.
      expect(
        tree.root.findAll(
          n => n.props.style === popupStyles.fontSizeIndicator,
        ),
      ).toHaveLength(0);
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
    // Toggle User off — staged LOCALLY (off-state shown immediately), but
    // nothing is persisted until Save.
    await act(async () => findByLabel(tree, 'Disable: User')[0].props.onPress());
    expect(spy).not.toHaveBeenCalled();
    // The row now offers Enable (off-state shown, not hidden).
    expect(findByLabel(tree, 'Enable: User')).toHaveLength(1);
    // Save persists the staged set in one write.
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0] as DictPref[];
    expect(payload.find(p => p.name === 'User')?.enabled).toBe(false);
    // sortOrder is renumbered to the array index.
    expect(payload.map(p => p.sortOrder)).toEqual([0, 1]);
  });

  test('Save is disabled until an edit, enabled after, and confirms INLINE (no modal)', async () => {
    const spy = jest.fn(async (_prefs: DictPref[]) => undefined);
    setPopupActions(
      dictManagerActions(
        [dictPref('User', true, 0), dictPref('WordNet', true, 1)],
        spy,
      ),
    );
    const tree = renderPopup();
    await openSettings(tree);
    // No edits yet -> Save is disabled (a tap is a no-op, nothing persisted).
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
    expect(spy).not.toHaveBeenCalled();
    expect(collectText(tree)).not.toContain('Settings saved');
    // Edit -> Save now persists + confirms inline (NOT via a modal dialog —
    // the old code reused the two-button confirm, showing two "Close" buttons).
    await act(async () => findByLabel(tree, 'Disable: User')[0].props.onPress());
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
    expect(spy).toHaveBeenCalledTimes(1);
    // Inline acknowledgement.
    expect(collectText(tree)).toContain('Settings saved');
    // After a successful save the panel is clean -> Save no-ops again.
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
    expect(spy).toHaveBeenCalledTimes(1);
    // Staging another edit clears the stale "saved" status.
    await act(async () => findByLabel(tree, 'Enable: User')[0].props.onPress());
    expect(collectText(tree)).not.toContain('Settings saved');
  });

  test('a failed save surfaces saveFailed INLINE and STAYS dirty (retryable)', async () => {
    const spy = jest.fn(async (_prefs: DictPref[]) => {
      throw new Error('disk full');
    });
    setPopupActions(
      dictManagerActions(
        [dictPref('User', true, 0), dictPref('WordNet', true, 1)],
        spy,
      ),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => findByLabel(tree, 'Disable: User')[0].props.onPress());
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(collectText(tree)).toContain("Couldn't save settings");
    // Still dirty after the failure -> a retry Save fires again.
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('Save with no setDictPrefs port wired is a safe no-op (no crash)', async () => {
    const noPersist = dictManagerActions([
      dictPref('User', true, 0),
      dictPref('WordNet', true, 1),
    ]);
    delete (noPersist as Partial<PopupActions>).setDictPrefs;
    setPopupActions(noPersist as PopupActions);
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => findByLabel(tree, 'Disable: User')[0].props.onPress());
    // The missing-port guard returns early — no throw, edit stays staged.
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
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
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
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
    // Move WordNet up one -> [User, WordNet, Dune], then Save.
    await act(async () => findByLabel(tree, 'Move up: WordNet')[0].props.onPress());
    await act(async () => findByLabel(tree, 'Save')[0].props.onPress());
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
  sourcesAtRisk: false,
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

  test('a partial delete (source files survived) warns the user (F7-AC3)', async () => {
    const partial = {
      ok: true as const,
      removed: {slugDb: true, audit: true, pref: true, sources: false},
      sourcesAtRisk: true,
    };
    const lists = [
      [dictPref('User', true, 0), dictPref('Dune', true, 1, true), dictPref('WordNet', true, 2)],
      [dictPref('User', true, 0), dictPref('WordNet', true, 1)],
    ];
    let call = 0;
    setPopupActions(
      deleteActions(lists[0], async () => true, async () => partial, async () =>
        lists[Math.min(call++, 1)],
      ),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Remove: Dune')[0].props.onPress();
      await flush();
    });
    // The removed row is gone, but the user is warned it may re-import on reload.
    expect(findByLabel(tree, 'Remove: Dune')).toHaveLength(0);
    expect(collectText(tree)).toContain('may reappear');
  });

  test('removed.sources=false but NOT at risk (keep=false import) shows NO warning', async () => {
    // The source files were never on disk to delete (a keep=false import), so
    // the engine reports removed.sources:false WITHOUT sourcesAtRisk — no
    // resurrection risk, so the panel must NOT warn (the false-positive fix).
    const benign = {
      ok: true as const,
      removed: {slugDb: true, audit: true, pref: true, sources: false},
      sourcesAtRisk: false,
    };
    const lists = [
      [dictPref('User', true, 0), dictPref('Dune', true, 1, true), dictPref('WordNet', true, 2)],
      [dictPref('User', true, 0), dictPref('WordNet', true, 1)],
    ];
    let call = 0;
    setPopupActions(
      deleteActions(lists[0], async () => true, async () => benign, async () =>
        lists[Math.min(call++, 1)],
      ),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Remove: Dune')[0].props.onPress();
      await flush();
    });
    expect(findByLabel(tree, 'Remove: Dune')).toHaveLength(0);
    expect(collectText(tree)).not.toContain('may reappear');
  });

  test('a clean delete (source files removed) shows NO warning', async () => {
    const lists = [
      [dictPref('User', true, 0), dictPref('Dune', true, 1, true), dictPref('WordNet', true, 2)],
      [dictPref('User', true, 0), dictPref('WordNet', true, 1)],
    ];
    let call = 0;
    setPopupActions(
      deleteActions(lists[0], async () => true, async () => okDelete, async () =>
        lists[Math.min(call++, 1)],
      ),
    );
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Remove: Dune')[0].props.onPress();
      await flush();
    });
    expect(collectText(tree)).not.toContain('may reappear');
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
    // Current path is now MyStyle/SnDictPlus.
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

  test('the export result is surfaced as a prominent inline alert banner (no modal)', async () => {
    setPopupActions(exportActions());
    const tree = renderPopup();
    await openSettings(tree);
    await act(async () => {
      findByLabel(tree, 'Export dictionaries')[0].props.onPress();
      await flush();
    });
    // The result renders inline with role=alert (the can't-miss banner that
    // replaced the two-"Close"-button modal) — there is no notify/dialog port.
    const alerts = tree.root.findAll(
      n => n.props.accessibilityRole === 'alert',
    );
    const alertText = alerts
      .map(n => (Array.isArray(n.props.children)
        ? n.props.children.join('')
        : String(n.props.children)))
      .join(' | ');
    expect(alertText).toContain('Export complete');
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

// --- Pen-only tap-outside-to-close (#32) ---------------------------
//
// The GEOMETRY half (inside vs outside the card) is enforced natively by
// z-order: the card renders ON TOP of the dismiss layer, so an inside-card
// tap never reaches the backdrop Pressable. react-test-renderer has no
// layout/hit-testing, so occlusion is NOT host-simulable — it's left to
// device verification. These tests drive the TOOL-TYPE half: the native
// onToolDown feeds the stamped lastToolTypeRef, and the backdrop press
// consults shouldDismissOnBackdropTap(reading, now). The dismiss layer is
// parametrised per branch: the RESULT view passes handleClose (so a
// dismiss fires BOTH hideDefinition and PluginManager.closePluginView),
// the SETTINGS panel passes closeSettings (non-destructive Back), and the
// RECOGNIZING branch renders no layer at all.

// The observer node the passthrough mock emits (carries onToolDown).
const fireToolDown = (tree: ReactTestRenderer, toolType: string): void => {
  const observer = tree.root.find(
    n => typeof n.props.onToolDown === 'function',
  );
  observer.props.onToolDown({nativeEvent: {toolType}});
};

// The transparent backdrop Pressable under the card (style={{flex: 1}}).
const pressBackdrop = (tree: ReactTestRenderer): void => {
  const layer = tree.root.find(
    n =>
      n.type === 'Pressable' &&
      n.props.style &&
      n.props.style.flex === 1,
  );
  layer.props.onPress();
};

const hasDismissLayer = (tree: ReactTestRenderer): boolean =>
  tree.root.findAll(n => typeof n.props.onToolDown === 'function').length > 0;

describe('DefinitionPopup — pen-only tap-outside-to-close (#32)', () => {
  test('a stylus tap outside closes: hideDefinition + closePluginView (handleClose reuse)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    expect(collectText(tree)).toContain('hello');
    act(() => fireToolDown(tree, 'stylus'));
    act(() => pressBackdrop(tree));
    // hideDefinition -> nothing visible; closePluginView -> overlay closed.
    expect(collectText(tree)).toBe('');
    expect(closePluginView).toHaveBeenCalledTimes(1);
  });

  test('a finger tap outside does nothing (popup stays open, no close)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    act(() => fireToolDown(tree, 'finger'));
    act(() => pressBackdrop(tree));
    expect(collectText(tree)).toContain('hello');
    expect(closePluginView).not.toHaveBeenCalled();
  });

  test('a backdrop press with no prior toolDown does not close (fail-safe null)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    act(() => pressBackdrop(tree));
    expect(collectText(tree)).toContain('hello');
    expect(closePluginView).not.toHaveBeenCalled();
  });

  test('the tool signal is one-shot: a later press without a fresh toolDown does not close', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    act(() => fireToolDown(tree, 'stylus'));
    act(() => pressBackdrop(tree)); // reads stylus -> closes, then clears ref
    expect(closePluginView).toHaveBeenCalledTimes(1);
    // Reopen and press again WITHOUT a fresh toolDown: the ref is null now.
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    act(() => pressBackdrop(tree));
    expect(collectText(tree)).toContain('hello');
    expect(closePluginView).toHaveBeenCalledTimes(1); // still just the one
  });

  test('a stale stylus reading (older than the recency window) does not close', () => {
    // The reading is stamped at toolDown; if the press arrives after the
    // recency window it must be treated as stale and NOT close — guards a
    // pen value left over from an earlier gesture. Drive Date.now directly.
    const nowSpy = jest.spyOn(Date, 'now');
    try {
      const tree = renderPopup();
      act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
      nowSpy.mockReturnValue(1000); // toolDown stamped at t=1000
      act(() => fireToolDown(tree, 'stylus'));
      nowSpy.mockReturnValue(1000 + BACKDROP_TAP_RECENCY_MS + 1); // just past
      act(() => pressBackdrop(tree));
      expect(collectText(tree)).toContain('hello');
      expect(closePluginView).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('a stylus tap outside the Settings panel goes Back (closeSettings), not a hard close', async () => {
    setPopupActions(
      fakeActions(async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}})),
    );
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    // Open Settings via the gear — it stashes the current result as resume.
    await act(async () => findByLabel(tree, 'Settings')[0].props.onPress());
    await flush();
    expect(hasDismissLayer(tree)).toBe(true);
    act(() => fireToolDown(tree, 'stylus'));
    await act(async () => pressBackdrop(tree));
    await flush();
    // closeSettings re-emitted the stashed result — back on the definition,
    // popup still visible. handleClose was NOT taken: the overlay never
    // closed and the popup did not hide.
    expect(currentKind()).toBe('result');
    expect(collectText(tree)).toContain('hello');
    expect(closePluginView).not.toHaveBeenCalled();
  });

  test('the dismiss layer renders in the settings and result branches but NOT recognizing', async () => {
    setPopupActions(
      fakeActions(async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}})),
    );
    const tree = renderPopup();
    // Recognizing has nothing to dismiss to (Close only) — no layer.
    act(() => showRecognizing());
    expect(hasDismissLayer(tree)).toBe(false);
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    expect(hasDismissLayer(tree)).toBe(true);
    // Settings mounts SettingsPanel, whose async effects (dict prefs /
    // keep-sources) must be flushed so their setState lands inside act.
    await act(async () => showSettings());
    await flush();
    expect(hasDismissLayer(tree)).toBe(true);
  });

  test('when the native observer is unavailable, no layer renders and Close still works', () => {
    getObserverMock.mockReturnValue(null);
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    expect(hasDismissLayer(tree)).toBe(false);
    // The existing top-right Close button is unaffected.
    const closeBtn = tree.root.findByProps({
      accessibilityRole: 'button',
      accessibilityLabel: 'Close',
    });
    act(() => closeBtn.props.onPress());
    expect(collectText(tree)).toBe('');
    expect(closePluginView).toHaveBeenCalledTimes(1);
  });
});

// --- Region probe (#37 FR0) ----------------------------------------
//
// The popup renders inside a firmware-granted overlay region, not the
// screen, and whether the firmware honours the registered regionType /
// 720x540 is unverified on-device. The backdrop's onLayout reports that
// grant; these tests pin the emitted format, the once-per-distinct-region
// latch, and the boundary guard on the native event.

// The backdrop is the only node carrying onLayout.
const findLayoutTarget = (tree: ReactTestRenderer) =>
  tree.root.findAll(n => typeof n.props.onLayout === 'function')[0];

const fireLayout = (
  tree: ReactTestRenderer,
  width: number,
  height: number,
): void => {
  act(() => {
    findLayoutTarget(tree).props.onLayout({
      nativeEvent: {layout: {x: 0, y: 0, width, height}},
    });
  });
};

describe('DefinitionPopup — granted-region probe', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  // MUST restore, or the leaked spy swallows output for the rest of the
  // suite.
  afterEach(() => {
    logSpy.mockRestore();
  });

  // Only the probe's own lines — the popup shares console.log with the
  // rest of the app's [tag] logging.
  const regionLines = (): string[] =>
    logSpy.mock.calls
      .map(args => String(args[0]))
      .filter(line => line.startsWith('[region]'));

  test('logs the measured region, in dp, with the request for comparison', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    fireLayout(tree, 672, 492);
    expect(regionLines()).toEqual([
      '[region] view=672x492dp requested=720x540 card=640',
    ]);
  });

  test('the same region laying out again does NOT log a second time', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    fireLayout(tree, 672, 492);
    fireLayout(tree, 672, 492);
    expect(regionLines()).toHaveLength(1);
  });

  test('a DIFFERENT region logs again (the doc-select grant may differ)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    fireLayout(tree, 672, 492);
    fireLayout(tree, 1356, 1824);
    expect(regionLines()).toEqual([
      '[region] view=672x492dp requested=720x540 card=640',
      '[region] view=1356x1824dp requested=720x540 card=640',
    ]);
  });

  test('fractional RN layout values are rounded', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    fireLayout(tree, 671.4, 491.6);
    expect(regionLines()).toEqual([
      '[region] view=671x492dp requested=720x540 card=640',
    ]);
  });

  test('a malformed native event neither throws nor logs', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    const onLayout = findLayoutTarget(tree).props.onLayout;
    expect(() =>
      act(() => {
        onLayout({});
        onLayout({nativeEvent: {}});
        onLayout({nativeEvent: {layout: {width: 'x', height: 12}}});
        onLayout({nativeEvent: {layout: {width: 12}}});
      }),
    ).not.toThrow();
    expect(regionLines()).toHaveLength(0);
  });

  test('the probe also attaches in the recognizing and settings kinds', async () => {
    setPopupActions(
      fakeActions(async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}})),
    );
    const tree = renderPopup();
    act(() => showRecognizing());
    fireLayout(tree, 672, 492);
    // Settings mounts SettingsPanel, whose async effects must settle
    // inside act.
    await act(async () => showSettings());
    await flush();
    fireLayout(tree, 800, 600);
    expect(regionLines()).toEqual([
      '[region] view=672x492dp requested=720x540 card=640',
      '[region] view=800x600dp requested=720x540 card=640',
    ]);
  });

  test('hide -> show does not re-log the same region (the ref outlives the branch)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    fireLayout(tree, 672, 492);
    // The hidden state renders no backdrop, so nothing can leak a 0x0
    // line; on re-show the backdrop lays out again at the same size, but
    // only the BRANCH remounted — the component, and so the latch, did
    // not.
    act(() => hideDefinition());
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    fireLayout(tree, 672, 492);
    expect(regionLines()).toHaveLength(1);
  });

  test('toggling maximize emits NO second [region] line', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    fireLayout(tree, 672, 492);
    // The backdrop's own size does not change when the card resizes, and
    // the handler never setStates — a toggle costs no extra probe work.
    act(() => findByLabel(tree, 'Maximize window')[0].props.onPress());
    act(() => findByLabel(tree, 'Restore window')[0].props.onPress());
    expect(regionLines()).toHaveLength(1);
  });
});

// --- Maximize toggle (#37 FR2) -------------------------------------
//
// NOTE ON WHAT THESE CAN PROVE: react-native is mocked to host strings
// with StyleSheet.create as identity, so Yoga never runs. These pin that
// the right style OBJECTS are attached to the right elements — never that
// the resolved layout is correct. On-device verification is separate.

const flattenStyle = (s: unknown): Record<string, unknown> => {
  if (Array.isArray(s)) {
    return Object.assign({}, ...s.map(flattenStyle));
  }
  if (s && typeof s === 'object') {
    return s as Record<string, unknown>;
  }
  return {};
};

// The card is the only white-backed View — in the result and recognizing
// kinds it is DefinitionPopup's, in the settings kind it is
// SettingsPanel's own.
const findCardStyle = (tree: ReactTestRenderer): Record<string, unknown> => {
  const card = tree.root.findAll(
    n =>
      n.type === 'View' &&
      flattenStyle(n.props.style).backgroundColor === '#ffffff',
  );
  expect(card).toHaveLength(1);
  return flattenStyle(card[0].props.style);
};

// The scrolling body. Only one ScrollView renders in the result kind.
const findBodyStyle = (tree: ReactTestRenderer): Record<string, unknown> =>
  flattenStyle(tree.root.findAll(n => n.type === 'ScrollView')[0].props.style);

const tryFindMaxBtn = (
  tree: ReactTestRenderer,
  label: 'Maximize window' | 'Restore window',
) =>
  tree.root.findAllByProps({
    accessibilityRole: 'button',
    accessibilityLabel: label,
  });

const findMaxBtn = (
  tree: ReactTestRenderer,
  label: 'Maximize window' | 'Restore window',
) => tryFindMaxBtn(tree, label)[0];

const maximize = (tree: ReactTestRenderer): void =>
  act(() => findMaxBtn(tree, 'Maximize window').props.onPress());

describe('DefinitionPopup — maximize toggle', () => {
  test('the result header renders the toggle, in the Normal state', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    expect(tryFindMaxBtn(tree, 'Maximize window')).toHaveLength(1);
    expect(tryFindMaxBtn(tree, 'Restore window')).toHaveLength(0);
    expect(collectText(tree)).toContain('□');
  });

  test('pressing it flips the label and the glyph (the state flipped)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    maximize(tree);
    expect(tryFindMaxBtn(tree, 'Maximize window')).toHaveLength(0);
    expect(tryFindMaxBtn(tree, 'Restore window')).toHaveLength(1);
    expect(collectText(tree)).toContain('▣');
  });

  test('round-trip: pressing again restores (a true boolean, not a latch)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    maximize(tree);
    act(() => findMaxBtn(tree, 'Restore window').props.onPress());
    expect(tryFindMaxBtn(tree, 'Maximize window')).toHaveLength(1);
    expect(tryFindMaxBtn(tree, 'Restore window')).toHaveLength(0);
  });

  test('the toggle is NOT rendered during the recognizing kind', () => {
    // Same rule as the font stepper: nothing to size, and the state is
    // transient.
    const tree = renderPopup();
    act(() => showRecognizing());
    expect(tryFindMaxBtn(tree, 'Maximize window')).toHaveLength(0);
    expect(tryFindMaxBtn(tree, 'Restore window')).toHaveLength(0);
  });

  test('the toggle renders in the not-found result state too', () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('zzz')));
    expect(tryFindMaxBtn(tree, 'Maximize window')).toHaveLength(1);
  });

  test('the Normal card is unregressed — still the fixed 640 x 520', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    expect(findCardStyle(tree)).toEqual(
      expect.objectContaining({width: 640, maxHeight: 520}),
    );
  });

  test('maximized layers cardMaximized over card (incl. maxHeight 100%)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    maximize(tree);
    // maxHeight:'100%' is load-bearing — without it card's maxHeight:520
    // clamps the flexed height and the card grows wider but not taller.
    expect(findCardStyle(tree)).toEqual(
      expect.objectContaining({
        width: '100%',
        maxHeight: '100%',
        flex: 1,
      }),
    );
  });

  test('the body ScrollView never carries a zero flex basis, in EITHER size', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    // THE load-bearing assertion in this suite. props.style composes OVER
    // ScrollView's own baseVertical, so anything that lands a zero basis
    // here — `flex: 1`, `flex: '1 1 0%'`, or a bare flexBasis: 0 / '0%' —
    // makes the Normal card render the definition at height 0. Pinning
    // flexGrow/flexShrink alone would NOT catch that: it is the absence of
    // a basis that matters, so assert both shorthand and longhand out.
    expect(findBodyStyle(tree)).toEqual(
      expect.objectContaining({flexGrow: 1, flexShrink: 1}),
    );
    expect(findBodyStyle(tree).flex).toBeUndefined();
    expect(findBodyStyle(tree).flexBasis).toBeUndefined();
    maximize(tree);
    expect(findBodyStyle(tree)).toEqual(
      expect.objectContaining({flexGrow: 1, flexShrink: 1}),
    );
    expect(findBodyStyle(tree).flex).toBeUndefined();
    expect(findBodyStyle(tree).flexBasis).toBeUndefined();
  });

  test('the settings body carries the same no-zero-basis guard', async () => {
    // SettingsPanel's own ScrollView is the second place the trap exists,
    // and it had no guard at all. Same rule, same reason.
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    await act(async () => pressLabel(tree, 'Settings'));
    await flush();
    const body = findBodyStyle(tree);
    // marginTop:4 identifies this as settingsBody rather than a nested
    // ScrollView further down the panel.
    expect(body).toEqual(
      expect.objectContaining({marginTop: 4, flexGrow: 1, flexShrink: 1}),
    );
    expect(body.flex).toBeUndefined();
    expect(body.flexBasis).toBeUndefined();
  });

  test('the recognizing card carries the maximized size (no frame snap)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    maximize(tree);
    act(() => showRecognizing());
    // The control is hidden here, but the geometry is carried: otherwise
    // a second lookup renders small then large — two full repaints.
    expect(findCardStyle(tree)).toEqual(expect.objectContaining({flex: 1}));
  });

  test('the state survives hide -> show (session-only, no reset on close)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    maximize(tree);
    act(() => hideDefinition());
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    expect(tryFindMaxBtn(tree, 'Restore window')).toHaveLength(1);
  });

  test('a NEW headword does not reset it (the reset effects skip it)', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    maximize(tree);
    act(() => showDefinition(found('WordNet', 'world', 'the earth')));
    expect(collectText(tree)).toContain('the earth');
    expect(tryFindMaxBtn(tree, 'Restore window')).toHaveLength(1);
  });

  test('Settings opens at the same size, and Back returns still maximized', async () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    maximize(tree);
    await act(async () => pressLabel(tree, 'Settings'));
    await flush();
    expect(currentKind()).toBe('settings');
    // SettingsPanel owns its own card; the prop must reach it.
    expect(findCardStyle(tree)).toEqual(expect.objectContaining({flex: 1}));
    await act(async () => pressLabel(tree, 'Back'));
    await flush();
    expect(currentKind()).toBe('result');
    expect(tryFindMaxBtn(tree, 'Restore window')).toHaveLength(1);
    expect(findCardStyle(tree)).toEqual(expect.objectContaining({flex: 1}));
  });

  test('Settings stays Normal-sized when the popup is not maximized', async () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    await act(async () => pressLabel(tree, 'Settings'));
    await flush();
    expect(findCardStyle(tree)).toEqual(
      expect.objectContaining({width: 640, maxHeight: 520}),
    );
    expect(findCardStyle(tree).flex).toBeUndefined();
  });

  test('toggling mid-stream keeps the pending sections intact', () => {
    const tree = renderPopup();
    act(() => showDefinition(loading('hello', ['WordNet', 'User'])));
    maximize(tree);
    const text = collectText(tree);
    expect(text).toContain('Loading…');
    expect(text).toContain('WordNet');
    expect(text).toContain('User');
  });

  test('toggling does not remount the OCR field (typed text survives)', () => {
    const tree = renderPopup();
    act(() =>
      showDefinition(found('WordNet', 'rain', 'water'), 'OCR: rain', true),
    );
    enterEdit(tree);
    act(() => findByLabel(tree, 'OCR')[0].props.onChangeText('helo'));
    maximize(tree);
    // A conditional wrapper around the card would remount the TextInput,
    // losing the correction and re-firing autoFocus.
    expect(findByLabel(tree, 'OCR')[0].props.value).toBe('helo');
  });

  test('toggling does not remount the add-definition form', () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('zzz')));
    act(() => pressLabel(tree, 'Add definition'));
    act(() => findByLabel(tree, 'Definition')[0].props.onChangeText('my def'));
    maximize(tree);
    expect(findByLabel(tree, 'Definition')).toHaveLength(1);
    expect(findByLabel(tree, 'Definition')[0].props.value).toBe('my def');
  });

  test('saving a new definition still works while maximized', async () => {
    // The form rendering large is not the same as it SUBMITTING while
    // large — the toggle must not disturb the save path.
    const addUserEntry = jest.fn(async () => undefined);
    const relookup = jest.fn(async () => undefined);
    setPopupActions(addActions(addUserEntry, relookup));
    const tree = renderPopup();
    act(() => showDefinition(notFound('photon')));
    maximize(tree);
    act(() => pressLabel(tree, 'Add definition'));
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

  test('an OCR edit cancelled by a new result stays maximized, in display mode', () => {
    const tree = renderPopup();
    act(() => showDefinition(notFound('helo'), 'OCR: helo', true));
    maximize(tree);
    enterEdit(tree);
    expect(findByLabel(tree, 'OCR')).toHaveLength(1);
    // A new result arrives (the relookup landed) — editing resets to
    // display mode, but the window size is NOT part of that reset.
    act(() =>
      showDefinition(found('WordNet', 'hello', 'a greeting'), 'OCR: hello', true),
    );
    expect(findByLabel(tree, 'OCR')).toHaveLength(0);
    expect(findByLabel(tree, 'Edit recognized text')).toHaveLength(1);
    expect(tryFindMaxBtn(tree, 'Restore window')).toHaveLength(1);
    expect(findCardStyle(tree)).toEqual(expect.objectContaining({flex: 1}));
  });
});

// --- #32 pen-dismiss x #37 maximize -------------------------------------
//
// The two features were tested in complete isolation. The dismiss layer is
// StyleSheet.absoluteFill — position:absolute, so it is out of flow and the
// card resizing cannot move or reorder it, and Yoga positions an absolute
// child against the parent's PADDING box, so the 24dp ring left around a
// maximized card is inside the layer, not outside it. That is the claim
// these two pin.

describe('DefinitionPopup — pen-dismiss while maximized (#32 x #37)', () => {
  test('a stylus tap outside still closes when maximized', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    maximize(tree);
    expect(hasDismissLayer(tree)).toBe(true);
    act(() => fireToolDown(tree, 'stylus'));
    act(() => pressBackdrop(tree));
    expect(collectText(tree)).toBe('');
    expect(closePluginView).toHaveBeenCalledTimes(1);
  });

  test('a stylus tap outside the MAXIMIZED settings panel goes Back, not close', async () => {
    setPopupActions(
      fakeActions(async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}})),
    );
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    maximize(tree);
    await act(async () => pressLabel(tree, 'Settings'));
    await flush();
    expect(hasDismissLayer(tree)).toBe(true);
    act(() => fireToolDown(tree, 'stylus'));
    await act(async () => pressBackdrop(tree));
    await flush();
    // Non-destructive Back, exactly as at the Normal size: the overlay
    // never closed, and the restored result is still maximized.
    expect(currentKind()).toBe('result');
    expect(closePluginView).not.toHaveBeenCalled();
    expect(tryFindMaxBtn(tree, 'Restore window')).toHaveLength(1);
  });
});

// --- Body-text scaling: fontSize AND lineHeight -------------------------
//
// Every scalable body style carries a FIXED lineHeight (definition 24,
// example 22, synonyms 20). Scaling only fontSize meant that at L the
// definition was 25.5dp of type inside a 24dp line box — Roboto's line
// box is 1.171em, so consecutive lines collided. These pin that both
// numbers now move together, which keeps the leading ratio constant at
// every level.
//
// (Yoga never runs here and no text is measured — these prove the right
// numbers reach the right styles, not that the result looks right.)

// Press A+ n times.
const bump = (tree: ReactTestRenderer, n: number): void => {
  act(() => {
    for (let i = 0; i < n; i++) {
      findByLabel(tree, 'Increase text size')[0].props.onPress();
    }
  });
};

// The flattened style of the first Text whose style ARRAY includes the
// given base style object — i.e. what that element actually renders at.
const scaledOf = (
  tree: ReactTestRenderer,
  base: object,
): {fontSize?: number; lineHeight?: number} => {
  const node = tree.root.findAll(
    n => Array.isArray(n.props.style) && n.props.style.includes(base),
  )[0];
  return Object.assign(
    {},
    ...(node.props.style as unknown[]).filter(s => s && typeof s === 'object'),
  );
};

// A WordNet body carrying both an example and a synonym list, so one
// fixture exercises every Tier-1 style in senseBlocks.
const aiEntry =
  'AI\n' +
  '     n 1: an agency of the United States Army responsible for ' +
  'providing intelligence [syn: {Army Intelligence}]\n' +
  '     2: the branch of computer science that deal with writing ' +
  'computer programs that can solve problems creatively; ' +
  '"workers in AI hope to imitate intelligence" ' +
  '[syn: {artificial intelligence}]';

describe('scaleText', () => {
  test('scales fontSize and lineHeight together when the base has both', () => {
    expect(scaleText(popupStyles.definition, 2)).toEqual({
      fontSize: 34,
      lineHeight: 48,
    });
  });

  test('OMITS the lineHeight key entirely when the base has none', () => {
    // Load-bearing: returning {lineHeight: undefined} would compose OVER
    // the base under StyleSheet.flatten (and under the Object.assign in
    // `scaledOf` above) and ERASE a lineHeight the base did define.
    const result = scaleText(popupStyles.phonetic, 2);
    expect(result).toEqual({fontSize: 32});
    expect('lineHeight' in result).toBe(false);
  });

  test('a scale of 1 is the identity on both numbers', () => {
    expect(scaleText(popupStyles.definition, 1)).toEqual({
      fontSize: 17,
      lineHeight: 24,
    });
  });
});

describe('DefinitionPopup — lineHeight scales with the body font size', () => {
  // [S, M, L, XL, 2X]
  const SCALES = [1, 1.25, 1.5, 1.75, 2];

  test('definition: fontSize and lineHeight both scale, at every level', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    SCALES.forEach((scale, k) => {
      const tree2 = renderPopup();
      act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
      bump(tree2, k);
      expect(scaledOf(tree2, popupStyles.definition)).toEqual(
        expect.objectContaining({fontSize: 17 * scale, lineHeight: 24 * scale}),
      );
    });
    expect(scaledOf(tree, popupStyles.definition).lineHeight).toBe(24);
  });

  test('the leading RATIO is invariant across levels (the actual property)', () => {
    // Stronger than five magic numbers: whatever the scale table says,
    // lineHeight/fontSize must never drift, because that ratio is what
    // stops lines colliding.
    SCALES.forEach((_scale, k) => {
      const tree = renderPopup();
      act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
      bump(tree, k);
      const {fontSize, lineHeight} = scaledOf(tree, popupStyles.definition);
      expect(lineHeight! / fontSize!).toBeCloseTo(24 / 17, 10);
    });
  });

  test('example and synonyms scale their lineHeight too (senseBlocks)', () => {
    SCALES.forEach((scale, k) => {
      const tree = renderPopup();
      act(() => showDefinition(found('WordNet', 'AI', aiEntry, 'wordnet')));
      bump(tree, k);
      expect(scaledOf(tree, popupStyles.example)).toEqual(
        expect.objectContaining({fontSize: 15 * scale, lineHeight: 22 * scale}),
      );
      expect(scaledOf(tree, popupStyles.synonyms)).toEqual(
        expect.objectContaining({fontSize: 14 * scale, lineHeight: 20 * scale}),
      );
    });
  });

  test('the synonyms LABEL borrows synonyms sizing — never NaN', () => {
    // synonymsLabel has no fontSize of its own; scaling it directly
    // would yield NaN, which Android renders as invisible text.
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'AI', aiEntry, 'wordnet')));
    bump(tree, 2);
    const label = scaledOf(tree, popupStyles.synonymsLabel);
    expect(label.fontSize).toBe(21);
    expect(Number.isNaN(label.fontSize)).toBe(false);
  });

  test('thesaurusList scales its lineHeight (DefinitionPopup call site)', async () => {
    setPopupActions(
      fakeActions(async () => ({
        lang: 'en',
        omw: {synonyms: ['glad'], antonyms: ['sad']},
      })),
    );
    const tree = renderPopup();
    act(() => showDefinition(wordnetHit('happy', 'feeling joy')));
    await act(async () =>
      tree.root
        .findAll(
          n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress,
        )[0]
        .props.onPress(),
    );
    await flush();
    bump(tree, 2);
    expect(scaledOf(tree, popupStyles.thesaurusList)).toEqual(
      expect.objectContaining({fontSize: 25.5, lineHeight: 36}),
    );
  });

  test('phonetic scales fontSize but gains NO lineHeight', () => {
    // It has none at base; RN derives the line box from the font and
    // grows it correctly. Inventing one here would clip the glyphs.
    const tree = renderPopup();
    act(() =>
      showDefinition({
        queriedFor: 'hello',
        hits: [
          {
            source: 'WordNet',
            entry: {
              word: 'hello',
              definition: 'a greeting',
              format: 'plain',
              phonetic: 'huh-LOH',
            },
          },
        ],
        loading: [],
      }),
    );
    bump(tree, 2);
    const phon = scaledOf(tree, popupStyles.phonetic);
    expect(phon.fontSize).toBe(24);
    expect(phon.lineHeight).toBeUndefined();
  });
});

// --- Font stepper bounds are DERIVED, not hard-coded ---------------------
//
// canShrink/canGrow used to compare against the literal endpoints 'S' and
// 'L'. That is invisible with three levels and catastrophic the moment a
// fourth is appended: A+ would grey out at L and every level above it
// would be unreachable. These pin the bound to the step functions, so the
// literals cannot come back.

const canGrowNow = (tree: ReactTestRenderer): boolean =>
  !findByLabel(tree, 'Increase text size')[0].props.disabled;

const canShrinkNow = (tree: ReactTestRenderer): boolean =>
  !findByLabel(tree, 'Decrease text size')[0].props.disabled;

describe('DefinitionPopup — font stepper bounds', () => {
  // One below the number of levels — DERIVED, so appending a level
  // updates this test rather than silently under-testing the new range.
  const STEPS_TO_TOP = FONT_SIZES.length - 1;

  test('A+ stays enabled at every level below the top, then greys once', () => {
    // THE REGRESSION TEST. A literal endpoint (`fontSize !== 'L'`) fails
    // this the moment the level list grows past that literal.
    for (let k = 0; k < STEPS_TO_TOP; k++) {
      const tree = renderPopup();
      act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
      bump(tree, k);
      expect(canGrowNow(tree)).toBe(true);
    }
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    bump(tree, STEPS_TO_TOP);
    expect(canGrowNow(tree)).toBe(false);
  });

  test('A- mirrors it: enabled at every level above the bottom', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    // At the bottom A- is greyed...
    expect(canShrinkNow(tree)).toBe(false);
    // ...and enabled at every level above it.
    for (let k = 1; k <= STEPS_TO_TOP; k++) {
      const tree2 = renderPopup();
      act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
      bump(tree2, k);
      expect(canShrinkNow(tree2)).toBe(true);
    }
  });

  test('pressing A+ past the top is a no-op, not an overflow', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    bump(tree, STEPS_TO_TOP + 3);
    // stepUp clamps on the array bound; the size must not run off the end
    // (which would make FONT_SCALE[size] undefined and the fontSize NaN).
    const {fontSize} = scaledOf(tree, popupStyles.definition);
    expect(fontSize).toBe(17 * 2);
    expect(canGrowNow(tree)).toBe(false);
  });
});

// --- Five body-text levels, the indicator, and the damped headings ------

// The level shown in the middle of the stepper. Located by the
// fontSizeIndicator style rather than by text, because 'L' is a substring
// of 'XL' and a collectText/toContain assertion would pass vacuously.
const findLevelLabel = (tree: ReactTestRenderer): string => {
  const slot = tree.root.findAll(
    n => n.props.style === popupStyles.fontSizeIndicator,
  )[0];
  return String(slot.findAll(n => n.type === 'Text')[0].props.children);
};

const LEVEL_LABELS = ['S', 'M', 'L', 'XL', '2X'];

// A result carrying a phonetic, so one fixture exercises the whole
// headword > body > phonetic hierarchy.
const withPhonetic = (word: string, definition: string): LookupResult => ({
  queriedFor: word,
  hits: [
    {
      source: 'WordNet',
      entry: {word, definition, format: 'plain', phonetic: 'huh-LOH'},
    },
  ],
  loading: [],
});

// Render, show `result`, and step up `k` times.
const atLevel = (k: number, result?: LookupResult): ReactTestRenderer => {
  const tree = renderPopup();
  act(() => {
    showDefinition(result ?? found('WordNet', 'hello', 'a greeting'));
  });
  bump(tree, k);
  return tree;
};

describe('DefinitionPopup — five font levels', () => {
  test('the indicator names each level, and XXL renders as 2X', () => {
    LEVEL_LABELS.forEach((label, k) => {
      expect(findLevelLabel(atLevel(k))).toBe(label);
    });
  });

  test('the indicator holds exactly one Text, never wider than 2 capitals', () => {
    // Pins the 32dp fit constraint: at fontSize 18 two capitals measure
    // ~21dp inside the 32dp slot, three ~32dp and would spill into the
    // + circle. A future 'XXL' label fails here rather than on-device.
    LEVEL_LABELS.forEach((_label, k) => {
      const tree = atLevel(k);
      const slot = tree.root.findAll(
        n => n.props.style === popupStyles.fontSizeIndicator,
      );
      expect(slot).toHaveLength(1);
      expect(slot[0].findAll(n => n.type === 'Text')).toHaveLength(1);
      // Character count as a PROXY for width — it is not a measurement.
      // Two narrow capitals fit with ~10dp to spare, three ('XXL') fill
      // the box exactly; but 'WW' is also two characters and would
      // overflow. It holds for the five labels that exist.
      expect(findLevelLabel(tree).length).toBeLessThanOrEqual(2);
    });
  });

  test('the definition fontSize walks the exact scale table', () => {
    // Includes that S/M/L are UNREGRESSED — the new levels only append.
    const expected = [17, 21.25, 25.5, 29.75, 34];
    expected.forEach((size, k) => {
      expect(scaledOf(atLevel(k), popupStyles.definition).fontSize).toBe(size);
    });
  });

  test('the new levels are reachable end-to-end, not just tabulated', () => {
    const tree = atLevel(4);
    expect(findLevelLabel(tree)).toBe('2X');
    expect(scaledOf(tree, popupStyles.definition)).toEqual(
      expect.objectContaining({fontSize: 34, lineHeight: 48}),
    );
  });

  test('the headword scales at HALF the body rate', () => {
    // 28 * (1 + (scale-1)/2). Full rate would reach 56 at 2X and ellipse
    // a 13-character word in the Normal card.
    const expected = [28, 31.5, 35, 38.5, 42];
    expected.forEach((size, k) => {
      expect(scaledOf(atLevel(k), popupStyles.word).fontSize).toBe(size);
    });
  });

  test('headword > body > phonetic holds at ALL five levels', () => {
    // The invariant, not five magic numbers: this survives any future
    // edit to the scale table, which five hard-coded triples would not.
    LEVEL_LABELS.forEach((_label, k) => {
      const tree = atLevel(k, withPhonetic('hello', 'a greeting'));
      const word = scaledOf(tree, popupStyles.word).fontSize!;
      const body = scaledOf(tree, popupStyles.definition).fontSize!;
      const phon = scaledOf(tree, popupStyles.phonetic).fontSize!;
      expect(word).toBeGreaterThan(body);
      expect(body).toBeGreaterThan(phon);
    });
  });

  test('the thesaurus section heading holds its ratio to its own list', async () => {
    // FULL body rate, not the headword's damped one. Damping is a
    // horizontal-space remedy for the header row; this label sits in the
    // scrolling body and wraps freely, and damping it would shrink it
    // relative to its own list at every level (0.94x at S down to 0.71x
    // at 2X) — manufacturing the very "heading half the size of its
    // content" problem it was meant to prevent.
    const expected = [16, 20, 24, 28, 32];
    for (let k = 0; k < expected.length; k++) {
      setPopupActions(
        fakeActions(async () => ({
          lang: 'en',
          omw: {synonyms: ['glad'], antonyms: ['sad']},
        })),
      );
      const tree = renderPopup();
      act(() => showDefinition(wordnetHit('happy', 'feeling joy')));
      await act(async () =>
        tree.root
          .findAll(
            n => n.props.accessibilityLabel === 'Thesaurus' && n.props.onPress,
          )[0]
          .props.onPress(),
      );
      await flush();
      bump(tree, k);
      const label = scaledOf(tree, popupStyles.thesaurusLabel).fontSize!;
      const list = scaledOf(tree, popupStyles.thesaurusList).fontSize!;
      expect(label).toBe(expected[k]);
      // The invariant that actually holds and means something: the
      // heading/list relationship is scale-INVARIANT. (The bound this
      // replaces — label >= list * 0.7 — was reverse-engineered from the
      // answer: at 2X it read 24 >= 23.8 and caught nothing.)
      expect(label / list).toBeCloseTo(16 / 17, 5);
    }
  });

  test('chrome stays FIXED at 2X — badges, status, and button labels', () => {
    // Each of these renders with its bare style object, no scaling layer.
    // Catches an over-eager "scale everything" refactor: scaling notFound
    // alone would invert it against the add-definition form below it.
    const tree = atLevel(4, {
      queriedFor: 'hello',
      hits: [
        {source: 'WordNet', entry: {word: 'hello', definition: 'a', format: 'plain'}},
        {source: 'User', entry: {word: 'hello', definition: 'b', format: 'plain'}},
      ],
      loading: [],
    });
    const rendersBare = (base: object): boolean =>
      tree.root.findAll(n => n.props.style === base).length > 0;
    expect(rendersBare(popupStyles.sourceBadge)).toBe(true);
    expect(rendersBare(popupStyles.closeLabel)).toBe(true);
    expect(rendersBare(popupStyles.fontSizeLabel)).toBe(true);

    const nf = atLevel(4, notFound('zzz'));
    expect(
      nf.root.findAll(n => n.props.style === popupStyles.notFound),
    ).not.toHaveLength(0);
  });
});

describe('DefinitionPopup — font level and maximize are orthogonal', () => {
  test('toggling maximize does not disturb the font level', () => {
    const tree = atLevel(4);
    expect(scaledOf(tree, popupStyles.definition).fontSize).toBe(34);
    act(() => findByLabel(tree, 'Maximize window')[0].props.onPress());
    expect(scaledOf(tree, popupStyles.definition).fontSize).toBe(34);
    act(() => findByLabel(tree, 'Restore window')[0].props.onPress());
    expect(scaledOf(tree, popupStyles.definition).fontSize).toBe(34);
    expect(findLevelLabel(tree)).toBe('2X');
  });

  test('stepping the font level does not disturb the window size', () => {
    const tree = renderPopup();
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    act(() => findByLabel(tree, 'Maximize window')[0].props.onPress());
    bump(tree, 4);
    expect(findCardStyle(tree)).toEqual(
      expect.objectContaining({width: '100%', maxHeight: '100%', flex: 1}),
    );
    expect(findLevelLabel(tree)).toBe('2X');
  });

  test('the level survives hide -> show, and a new headword', () => {
    const tree = atLevel(4);
    act(() => hideDefinition());
    act(() => showDefinition(found('WordNet', 'hello', 'a greeting')));
    expect(findLevelLabel(tree)).toBe('2X');
    // The headword reset effect clears tab/thesaurus/copyStatus — not
    // the font level.
    act(() => showDefinition(found('WordNet', 'world', 'the earth')));
    expect(collectText(tree)).toContain('the earth');
    expect(findLevelLabel(tree)).toBe('2X');
  });
});

// --- The line-box property, and the paths scaled() now owns ------------

describe('scalable body styles leave room for the font line box', () => {
  test('every scalable style clears the line-box ratio at EVERY level', () => {
    // The claim this whole milestone rests on, stated as a property
    // rather than as today's constants. Because scaling is proportional,
    // lineHeight/fontSize is level-invariant — so checking the BASE
    // style checks all five levels at once, and a style added tomorrow
    // at fontSize 20 / lineHeight 20 fails here instead of on-device.
    //
    // 1.171 is Roboto's metric line box (ascent .927 + descent .244).
    // Note what this does and does not assert: on RN 0.79 a lineHeight
    // below it does NOT clip — CustomLineHeightSpan implements the CSS
    // half-leading model and deliberately lets glyphs draw outside their
    // box — it means consecutive lines encroach. It is a leading
    // criterion, not a clipping one.
    const LINE_BOX = 1.171;
    const scalable = [
      popupStyles.definition,
      popupStyles.example,
      popupStyles.synonyms,
      popupStyles.thesaurusList,
    ];
    for (const style of scalable) {
      expect(style.lineHeight / style.fontSize).toBeGreaterThanOrEqual(
        LINE_BOX,
      );
    }
  });
});

describe('DefinitionPopup — the WordNet and FVDP body paths scale too', () => {
  // A mutation sweep found that reverting senseBlocks' definition to
  // unscaled left the whole suite green: scaledOf picks the FIRST match,
  // and the plain-format fixtures used almost everywhere resolve to
  // SourceSection's node, never senseBlocks'. A wordnet fixture is the
  // only way to reach the most-rendered string in the app.
  test('the WordNet definition body scales — the most-rendered string', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(found('WordNet', 'AI', aiEntry, 'wordnet'));
    });
    bump(tree, 4);
    expect(scaledOf(tree, popupStyles.definition)).toEqual(
      expect.objectContaining({fontSize: 34, lineHeight: 48}),
    );
  });

  test('the WordNet sense index scales', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(found('WordNet', 'AI', aiEntry, 'wordnet'));
    });
    bump(tree, 4);
    expect(scaledOf(tree, popupStyles.senseIndex).fontSize).toBe(32);
  });

  test('the synonyms LABEL takes its size from synonyms, at every level', () => {
    // One of the two sites scaled() cannot own — it registers
    // synonymsLabel (weight + colour, no size) but borrows synonyms'
    // size — so it is guarded here instead.
    [1, 1.25, 1.5, 1.75, 2].forEach((scale, k) => {
      const tree = renderPopup();
      act(() => {
        showDefinition(found('WordNet', 'AI', aiEntry, 'wordnet'));
      });
      bump(tree, k);
      const label = scaledOf(tree, popupStyles.synonymsLabel);
      expect(label.fontSize).toBe(14 * scale);
      expect(label.lineHeight).toBe(20 * scale);
    });
  });
});
