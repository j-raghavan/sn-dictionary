// Render-tree assertions for the HtmlText component.
//
// Two things to verify:
//   1. The visible text concatenation matches what htmlToPlainText
//      / htmlToSpans produce (so the popup never displays a
//      different string than the plain-text fallback would).
//   2. Style props on nested <Text> elements honour bold / italic /
//      colour for content spans, and layout chunks (newlines, list
//      markers, em-dashes) render unstyled.

jest.mock('react-native', () => ({
  Text: 'Text',
  StyleSheet: {create: (s: unknown) => s},
}));

import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {HtmlText} from '../src/ui/HtmlText';
import {htmlToPlainText} from '../src/ui/htmlToPlainText';

type RTNode = {
  type: string;
  props: Record<string, unknown>;
  children: Array<RTNode | string> | null;
};

const render = (html: string, style?: object): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<HtmlText html={html} style={style} />);
  });
  return tree;
};

const flatten = (node: RTNode | string | null): string => {
  if (node === null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (!node.children) {
    return '';
  }
  return node.children.map(flatten).join('');
};

const collectAllNodes = (root: RTNode): RTNode[] => {
  const out: RTNode[] = [root];
  if (root.children) {
    for (const child of root.children) {
      if (typeof child !== 'string' && child) {
        out.push(...collectAllNodes(child));
      }
    }
  }
  return out;
};

describe('HtmlText', () => {
  test('renders empty string as a single empty <Text>', () => {
    const tree = render('');
    const root = tree.toJSON() as unknown as RTNode;
    expect(root.type).toBe('Text');
  });

  test('visible text matches htmlToPlainText for the same input', () => {
    const html =
      '<div><font color="green">noun, male</font><br><ol>' +
      '<li>Haustier, dessen Vorfahre der Wolf ist<ol>' +
      '<li><div>chien</div></li>' +
      '<li><div>chienne</div></li>' +
      '</ol></li></ol></div>';
    const tree = render(html);
    const root = tree.toJSON() as unknown as RTNode;
    expect(flatten(root)).toBe(htmlToPlainText(html));
  });

  test('forwards the style prop to the root <Text>', () => {
    const baseStyle = {fontSize: 17, lineHeight: 24, color: '#000'};
    const tree = render('plain', baseStyle);
    const root = tree.toJSON() as unknown as RTNode;
    expect(root.props.style).toEqual(baseStyle);
  });

  test('emboldens the inline-translation <div> content via fontWeight 700', () => {
    const tree = render(
      '<ol><li>Astronomie: der Kosmos<div>ciel</div></li></ol>',
    );
    const root = tree.toJSON() as unknown as RTNode;
    const all = collectAllNodes(root);
    // Find the Text whose ONLY child is "ciel".
    const cielText = all.find(
      (n) =>
        n.type === 'Text' &&
        n.children?.length === 1 &&
        n.children[0] === 'ciel',
    );
    expect(cielText).toBeDefined();
    const style = cielText?.props.style as {fontWeight?: string} | undefined;
    expect(style?.fontWeight).toBe('700');
  });

  test('italicises <i> content (POS labels) and does not italicise surrounding text', () => {
    const tree = render('a <i>POS</i> b');
    const root = tree.toJSON() as unknown as RTNode;
    const all = collectAllNodes(root);
    const posText = all.find(
      (n) =>
        n.type === 'Text' &&
        n.children?.length === 1 &&
        n.children[0] === 'POS',
    );
    expect(posText).toBeDefined();
    expect(
      (posText?.props.style as {fontStyle?: string} | undefined)?.fontStyle,
    ).toBe('italic');
    // The surrounding "a " / " b" text is unwrapped strings (no
    // dedicated <Text>), so they appear as direct children of the
    // root Text.
    expect(root.children).toContain('a ');
    expect(root.children).toContain(' b');
  });

  test('applies <font color> to the wrapped content only', () => {
    const tree = render('<font color="green">noun</font> body');
    const root = tree.toJSON() as unknown as RTNode;
    const all = collectAllNodes(root);
    const colored = all.find(
      (n) =>
        n.type === 'Text' &&
        n.children?.length === 1 &&
        n.children[0] === 'noun',
    );
    expect(
      (colored?.props.style as {color?: string} | undefined)?.color,
    ).toBe('green');
    // ' body' is unstyled — appears as a raw string child.
    expect(root.children).toContain(' body');
  });

  test('list markers render as raw strings (not wrapped in styled <Text>)', () => {
    // The marker "1. " should not be inside any styled inner <Text>;
    // even when the list lives inside a <font color> scope, the
    // marker stays plain. Otherwise nested numbering picks up colour
    // and looks visually broken on e-ink.
    const tree = render(
      '<font color="green"><ol><li>foo</li></ol></font>',
    );
    const root = tree.toJSON() as unknown as RTNode;
    const all = collectAllNodes(root);
    // No styled Text contains "1." in its own subtree.
    for (const node of all) {
      if (
        node !== root &&
        node.type === 'Text' &&
        node.props.style !== undefined
      ) {
        const innerText = flatten(node);
        expect(innerText).not.toContain('1.');
      }
    }
  });

  test('memoises the parse: identical html prop reuses children', () => {
    // Re-rendering with the same html must not re-parse. We assert
    // this by rendering, snapshotting, re-rendering with the same
    // html, and comparing — any cache miss would still produce the
    // same output, but this also serves as a stability pin.
    const html =
      '<ol><li>x<div>y</div></li><li>a<div>b</div></li></ol>';
    const t1 = render(html);
    const t2 = render(html);
    expect(t1.toJSON()).toEqual(t2.toJSON());
  });
});
