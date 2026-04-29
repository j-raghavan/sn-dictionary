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

const closePluginView = PluginManager.closePluginView as jest.Mock;

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
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      found.push(node);
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
  return found.join(' | ');
};

describe('DefinitionPopup', () => {
  test('renders no visible text when state is invisible', () => {
    expect(collectText(renderPopup())).toBe('');
  });

  test('renders word and definition when state is visible (found)', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition(
        {found: true, entry: {word: 'hello', definition: 'a greeting'}},
        'OCR: hello',
      );
    });
    const text = collectText(tree);
    expect(text).toContain('hello');
    expect(text).toContain('a greeting');
    expect(text).toContain('OCR: hello');
    expect(text).toContain('Close');
  });

  test('renders not-found message when state is visible but lookup failed', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition({found: false, queriedFor: 'xenoglossy'});
    });
    const text = collectText(tree);
    expect(text).toContain('xenoglossy');
    expect(text).toMatch(/no definition found/i);
  });

  test('reverts to invisible after hideDefinition', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition({found: false, queriedFor: 'foo'});
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
      showDefinition({found: false, queriedFor: 'foo'});
    });
    expect(collectText(tree)).toContain('foo');
    const closeBtn = tree.root.findByProps({accessibilityRole: 'button'});
    act(() => {
      closeBtn.props.onPress();
    });
    // Local state is hidden immediately so a subsequent lookup
    // doesn't briefly flash the previous content.
    expect(collectText(tree)).toBe('');
    // Firmware overlay close is requested fire-and-forget.
    expect(closePluginView).toHaveBeenCalledTimes(1);
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
      showDefinition(
        {found: true, entry: {word: 'AI', definition: aiEntry}},
        'OCR: AI',
      );
    });
    const text = collectText(tree);
    // Both senses should be visible in the rendered tree, with the
    // CS sense reachable to the eye even though it's sense #2.
    expect(text).toContain('Army Intelligence');
    expect(text).toContain('artificial intelligence');
    expect(text).toContain('branch of computer science');
    // POS label rendered as the long form
    expect(text).toContain('noun');
    // Numbered senses
    expect(text).toContain('1.');
    expect(text).toContain('2.');
    // Example from sense 2 should be quoted with curly quotes
    expect(text).toContain('workers in AI hope to imitate intelligence');
    // Synonyms label appears
    expect(text).toMatch(/Synonyms/i);
  });

  test('falls back to raw text when the entry does not parse as WordNet format', () => {
    const tree = renderPopup();
    act(() => {
      showDefinition({
        found: true,
        entry: {
          word: 'unstructured',
          definition: 'a single line with no WordNet structure',
        },
      });
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
      showDefinition({found: false, queriedFor: 'foo'});
    });
    const closeBtn = tree.root.findByProps({accessibilityRole: 'button'});
    expect(() => {
      act(() => {
        closeBtn.props.onPress();
      });
    }).not.toThrow();
  });
});
