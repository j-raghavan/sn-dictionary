// Routing tests for SourceSection: which body renderer each format (and,
// for 'plain', each sub-case) selects. The predicates and renderers are
// unit-tested elsewhere (htmlParser / fvdpFormatter / fvdpBlocks / HtmlText
// tests); this pins the DECISION ORDER in the 'plain' branch — real HTML
// first, then the FVDP marker layout, then verbatim text — plus the badge.

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: {create: (s: unknown) => s},
}));

import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {SourceSection} from '../src/ui/SourceSection';
import type {SourceHit} from '../src/core/lookup';
import type {DefinitionFormat} from '../src/core/lookup';
import corpus from './_fixtures/renderParityCorpus.json';

type RTNode = {
  type: string;
  props: Record<string, unknown>;
  children: Array<RTNode | string> | null;
};

const hitOf = (definition: string, format: DefinitionFormat): SourceHit => ({
  source: 'TestDict',
  entry: {word: 'w', definition, format},
});

const render = (
  hit: SourceHit,
  showBadge = false,
): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <SourceSection
        hit={hit}
        showBadge={showBadge}
        showDivider={false}
        fontScale={1}
      />,
    );
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

const collect = (root: RTNode): RTNode[] => {
  const out: RTNode[] = [root];
  if (root.children) {
    for (const child of root.children) {
      if (typeof child !== 'string' && child) {
        out.push(...collect(child));
      }
    }
  }
  return out;
};

const fvdp = corpus.fvdp as Record<string, string>;

describe('SourceSection body routing', () => {
  test("'plain' body with a matched HTML pair routes to HtmlText", () => {
    const root = render(
      hitOf('a <b>bold</b> word', 'plain'),
    ).toJSON() as unknown as RTNode;
    // HtmlText strips the tags to visible text and bolds the inner span.
    expect(flatten(root)).toBe('a bold word');
    const bold = collect(root).find(
      (n) => n.type === 'Text' && flatten(n) === 'bold',
    );
    expect(
      (bold?.props.style as {fontWeight?: string} | undefined)?.fontWeight,
    ).toBe('700');
  });

  test("'plain' body in the FVDP marker layout routes to FvdpText", () => {
    const root = render(hitOf(fvdp.froncer, 'plain')).toJSON() as unknown as RTNode;
    const nodes = collect(root);
    // FvdpText emits the POS badge + numbered senses + em-dash examples.
    expect(nodes.some((n) => n.type === 'Text' && flatten(n) === 'ngoại động từ')).toBe(true);
    expect(
      nodes.some(
        (n) =>
          n.type === 'Text' &&
          flatten(n) === 'Froncer les sourcils — cau (chau) mày',
      ),
    ).toBe(true);
  });

  test("'plain' body that is neither HTML nor FVDP renders verbatim", () => {
    const def = 'a greeting used for most purposes';
    const root = render(hitOf(def, 'plain')).toJSON() as unknown as RTNode;
    // A single Text carrying the exact definition, no restructuring.
    const texts = collect(root).filter((n) => n.type === 'Text');
    expect(texts).toHaveLength(1);
    expect(flatten(texts[0])).toBe(def);
  });

  test("'wordnet' format routes to SenseList", () => {
    const wn = 'w\n     n 1: a test definition';
    const root = render(hitOf(wn, 'wordnet')).toJSON() as unknown as RTNode;
    // SenseList renders a sense index "1." that verbatim text never would.
    expect(
      collect(root).some((n) => n.type === 'Text' && flatten(n) === '1.'),
    ).toBe(true);
  });

  test("'html' format routes to HtmlText", () => {
    const root = render(
      hitOf('<i>POS</i> body', 'html'),
    ).toJSON() as unknown as RTNode;
    const pos = collect(root).find(
      (n) => n.type === 'Text' && flatten(n) === 'POS',
    );
    expect(
      (pos?.props.style as {fontStyle?: string} | undefined)?.fontStyle,
    ).toBe('italic');
  });

  test('the source badge renders only when showBadge is set', () => {
    const withBadge = render(hitOf('x', 'plain'), true).toJSON() as unknown as RTNode;
    expect(
      collect(withBadge).some(
        (n) => n.type === 'Text' && flatten(n) === 'TestDict',
      ),
    ).toBe(true);

    const withoutBadge = render(hitOf('x', 'plain'), false).toJSON() as unknown as RTNode;
    expect(
      collect(withoutBadge).some(
        (n) => n.type === 'Text' && flatten(n) === 'TestDict',
      ),
    ).toBe(false);
  });
});
