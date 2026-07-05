// Render-tree assertions for FvdpText. Inputs are REAL parsed corpus
// entries (parseFvdpEntry over renderParityCorpus.json) so the renderer
// is exercised against the same trees the popup will see, not hand-built
// ones. Verifies: POS badge shown/omitted, sense numbering, the
// "source — translation" example line, the note's bold label, and that
// fontScale threads through body text while chrome (the POS badge) stays
// at its base size.

jest.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  StyleSheet: {create: (s: unknown) => s},
}));

import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {FvdpText} from '../src/ui/fvdpBlocks';
import {parseFvdpEntry, type ParsedFvdpEntry} from '../src/ui/fvdpFormatter';
import {popupStyles} from '../src/ui/popupStyles';
import corpus from './_fixtures/renderParityCorpus.json';

const fvdp = corpus.fvdp as Record<string, string>;

type RTNode = {
  type: string;
  props: Record<string, unknown>;
  children: Array<RTNode | string> | null;
};

const render = (word: string, fontScale = 1): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  const parsed = parseFvdpEntry(fvdp[word]);
  act(() => {
    tree = create(<FvdpText parsed={parsed} fontScale={fontScale} />);
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

const textNodesWith = (root: RTNode, text: string): RTNode[] =>
  collectAllNodes(root).filter(
    (n) => n.type === 'Text' && flatten(n) === text,
  );

// The style prop is either a plain style object or an array of them; the
// last fontSize entry wins (RN merge order). Mirror that here.
const effectiveFontSize = (style: unknown): number | undefined => {
  const layers = Array.isArray(style) ? style : [style];
  let size: number | undefined;
  for (const layer of layers) {
    if (layer && typeof layer === 'object' && 'fontSize' in layer) {
      size = (layer as {fontSize?: number}).fontSize;
    }
  }
  return size;
};

describe('FvdpText', () => {
  test('renders the POS badge for a named POS section', () => {
    const root = render('froncer').toJSON() as unknown as RTNode;
    const badge = textNodesWith(root, 'ngoại động từ');
    expect(badge).toHaveLength(1);
    // The badge carries the posBadge chrome style (identity-compared).
    expect(badge[0].props.style).toBe(popupStyles.posBadge);
  });

  test('numbers senses 1-based and renders each gloss', () => {
    const root = render('froncer').toJSON() as unknown as RTNode;
    expect(textNodesWith(root, '1.')).toHaveLength(1);
    expect(textNodesWith(root, '2.')).toHaveLength(1);
    expect(textNodesWith(root, 'cau lại, chau lại; chúm lại')).toHaveLength(1);
    expect(textNodesWith(root, 'khâu nhíu lại')).toHaveLength(1);
  });

  test('renders each example as "source — translation"', () => {
    const root = render('froncer').toJSON() as unknown as RTNode;
    expect(
      textNodesWith(root, 'Froncer les sourcils — cau (chau) mày'),
    ).toHaveLength(1);
    expect(textNodesWith(root, 'Froncer les lèvres — chúm môi')).toHaveLength(1);
  });

  test('renders the note as "label: body" with a bold label', () => {
    const root = render('froncer').toJSON() as unknown as RTNode;
    const label = textNodesWith(root, 'phản nghĩa: ');
    expect(label).toHaveLength(1);
    expect(effectiveFontSize(label[0].props.style)).toBeDefined();
    // The label's own style layer carries the bold synonymsLabel weight.
    const layers = label[0].props.style as Array<{fontWeight?: string}>;
    expect(layers.some((l) => l && l.fontWeight === '600')).toBe(true);
    // The body text sits alongside the label inside the note <Text>.
    const note = collectAllNodes(root).find(
      (n) => n.type === 'Text' && flatten(n) === 'phản nghĩa: Défroncer.',
    );
    expect(note).toBeDefined();
  });

  test('omits the POS badge when pos is "" (rông preamble section)', () => {
    const root = render('rông').toJSON() as unknown as RTNode;
    const badges = collectAllNodes(root).filter(
      (n) => n.type === 'Text' && n.props.style === popupStyles.posBadge,
    );
    expect(badges).toHaveLength(0);
    // But the senses still render (numbered from 1).
    expect(textNodesWith(root, '1.')).toHaveLength(1);
    expect(textNodesWith(root, 'xem nhà_rông')).toHaveLength(1);
  });

  test('renders a zero-sense POS badge (détersif) instead of dropping it', () => {
    // The adjective block (`tính từ`) has a label but no senses — its
    // heading must still render, alongside the noun block's sense.
    const root = render('détersif').toJSON() as unknown as RTNode;
    expect(textNodesWith(root, 'tính từ')).toHaveLength(1);
    expect(textNodesWith(root, 'danh từ giống đực')).toHaveLength(1);
    expect(textNodesWith(root, 'như détergent')).toHaveLength(1);
  });

  test('a gloss-only example (no translation) renders just the source', () => {
    // rông sense 1 (`xem nhà_rông`) has no examples; sense 2 (`ronde`) has
    // one full pair. Use `a` section 2's gloss-only senses to confirm no
    // stray em-dash is emitted for translation-less content.
    const root = render('a').toJSON() as unknown as RTNode;
    expect(textNodesWith(root, 'ampe')).toHaveLength(1);
    // No node combines a gloss with a dangling " — ".
    for (const n of collectAllNodes(root)) {
      if (n.type === 'Text') {
        expect(flatten(n)).not.toMatch(/ — $/);
      }
    }
  });

  test('an empty-gloss sense renders no gloss line; a translation-less example shows just the source', () => {
    // These degenerate shapes come out of the forgiving parser (e.g. a
    // plus-less example -> empty translation). Feed the renderer the
    // structured tree directly to pin the two edge branches.
    const parsed: ParsedFvdpEntry = {
      sections: [
        {
          kind: 'pos',
          pos: '',
          senses: [{gloss: '', examples: [{source: 'src only', translation: ''}]}],
        },
      ],
      parseFailed: false,
      raw: '',
    };
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<FvdpText parsed={parsed} fontScale={1} />);
    });
    const root = tree.toJSON() as unknown as RTNode;
    const all = collectAllNodes(root);
    // No definition-styled gloss node (gloss was empty).
    expect(
      all.some(
        (n) => n.type === 'Text' && flatten(n) !== '' && flatten(n) !== '1.'
          && flatten(n) !== 'src only',
      ),
    ).toBe(false);
    // The example shows the source with NO em-dash / empty translation.
    const example = textNodesWith(root, 'src only');
    expect(example).toHaveLength(1);
    expect(flatten(example[0])).not.toContain('—');
  });

  test('fontScale scales body text but leaves the POS badge at base size', () => {
    const scale = 2;
    const root = render('froncer', scale).toJSON() as unknown as RTNode;
    const gloss = textNodesWith(root, 'khâu nhíu lại')[0];
    expect(effectiveFontSize(gloss.props.style)).toBe(
      popupStyles.definition.fontSize * scale,
    );
    const example = textNodesWith(root, 'Froncer les lèvres — chúm môi')[0];
    expect(effectiveFontSize(example.props.style)).toBe(
      popupStyles.example.fontSize * scale,
    );
    const index = textNodesWith(root, '1.')[0];
    expect(effectiveFontSize(index.props.style)).toBe(
      popupStyles.senseIndex.fontSize * scale,
    );
    // Chrome: the POS badge is NOT scaled.
    const badge = textNodesWith(root, 'ngoại động từ')[0];
    expect(effectiveFontSize(badge.props.style)).toBe(
      popupStyles.posBadge.fontSize,
    );
  });
});
