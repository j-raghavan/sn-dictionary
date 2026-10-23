// Render-tree assertions for FvdpText. Inputs are REAL parsed corpus
// entries (parseFvdpEntry over renderParityCorpus.json) so the renderer
// is exercised against the same trees the popup will see, not hand-built
// ones. Verifies: POS badge shown/omitted, inline sense numbering, the
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
import {
  fvdpEntryToPlainText,
  parseFvdpEntry,
  type ParsedFvdpEntry,
} from '../src/ui/fvdpFormatter';
import {popupStyles, scaled} from '../src/ui/popupStyles';
import corpus from './_fixtures/renderParityCorpus.json';

const fvdp = corpus.fvdp as Record<string, string>;
const nhat = corpus.nhatvietnhat as Record<string, string>;

type RTNode = {
  type: string;
  props: Record<string, unknown>;
  children: Array<RTNode | string> | null;
};

const renderRaw = (raw: string, fontScale = 1): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  const parsed = parseFvdpEntry(raw);
  act(() => {
    tree = create(<FvdpText parsed={parsed} fontScale={fontScale} />);
  });
  return tree;
};

const render = (word: string, fontScale = 1): ReactTestRenderer =>
  renderRaw(fvdp[word], fontScale);

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

  test('numbers senses 1-based with each index inline on its gloss line', () => {
    const root = render('froncer').toJSON() as unknown as RTNode;
    expect(textNodesWith(root, '1. cau lại, chau lại; chúm lại')).toHaveLength(1);
    expect(textNodesWith(root, '2. khâu nhíu lại')).toHaveLength(1);
    // The index is a span INSIDE the gloss line, not a header row above
    // it: the only header row left is the POS badge's.
    expect(textNodesWith(root, '1.')).toHaveLength(1);
    const headers = collectAllNodes(root).filter(
      (n) => n.props.style === popupStyles.senseHeader,
    );
    expect(headers.map(flatten)).toEqual(['ngoại động từ']);
  });

  test('trở: a real PhapVietPhap sense reads "1. deuil." on one line', () => {
    const root = render('trở').toJSON() as unknown as RTNode;
    const line = textNodesWith(root, '1. deuil.');
    expect(line).toHaveLength(1);
    expect(textNodesWith(line[0], '1.')).toHaveLength(1);
    expect(textNodesWith(root, '5. entraver.')).toHaveLength(1);
  });

  test('the screen sense lines match the copy text line for line (trở)', () => {
    const parsed = parseFvdpEntry(fvdp['trở']);
    const root = render('trở').toJSON() as unknown as RTNode;
    const copied = fvdpEntryToPlainText(parsed)
      .split('\n')
      .filter((l) => /^\d+\. /.test(l));
    expect(copied).toHaveLength(5);
    for (const l of copied) {
      expect(textNodesWith(root, l)).toHaveLength(1);
    }
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

  test('abattement: the note keeps only its own body; the next sense follows it', () => {
    const root = render('abattement').toJSON() as unknown as RTNode;
    expect(
      textNodesWith(root, 'phản nghĩa: Energie, excitation. Exaltation, joie'),
    ).toHaveLength(1);
    expect(textNodesWith(root, '3. giảm miễn (thuế)')).toHaveLength(1);
    expect(
      textNodesWith(root, 'Un abattement de dix pour cent — giảm thuế mười phần trăm.'),
    ).toHaveLength(1);
  });

  test('agréger: screen lines match the copy text, numbering carried past the note', () => {
    const root = render('agréger').toJSON() as unknown as RTNode;
    const lines = fvdpEntryToPlainText(parseFvdpEntry(fvdp['agréger'])).split('\n');
    expect(lines).toContain('2. kết nạp (vào một tổ chức); tập hợp');
    for (const l of lines) {
      expect(textNodesWith(root, l)).toHaveLength(1);
    }
  });

  test('omits the POS badge when pos is "" (rông preamble section)', () => {
    const root = render('rông').toJSON() as unknown as RTNode;
    const badges = collectAllNodes(root).filter(
      (n) => n.type === 'Text' && n.props.style === popupStyles.posBadge,
    );
    expect(badges).toHaveLength(0);
    // But the senses still render (numbered from 1).
    expect(textNodesWith(root, '1. xem nhà_rông')).toHaveLength(1);
  });

  test('renders a zero-sense POS badge (détersif) instead of dropping it', () => {
    // The adjective block (`tính từ`) has a label but no senses — its
    // heading must still render, alongside the noun block's sense.
    const root = render('détersif').toJSON() as unknown as RTNode;
    expect(textNodesWith(root, 'tính từ')).toHaveLength(1);
    expect(textNodesWith(root, 'danh từ giống đực')).toHaveLength(1);
    expect(textNodesWith(root, '1. như détergent')).toHaveLength(1);
  });

  test('a gloss-only example (no translation) renders just the source', () => {
    // rông sense 1 (`xem nhà_rông`) has no examples; sense 2 (`ronde`) has
    // one full pair. Use `a` section 2's gloss-only senses to confirm no
    // stray em-dash is emitted for translation-less content.
    const root = render('a').toJSON() as unknown as RTNode;
    expect(textNodesWith(root, '3. ampe')).toHaveLength(1);
    // No node combines a gloss with a dangling " — ".
    for (const n of collectAllNodes(root)) {
      if (n.type === 'Text') {
        expect(flatten(n)).not.toMatch(/ — $/);
      }
    }
  });

  test('an empty-gloss sense renders the index alone; a translation-less example shows just the source', () => {
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
    // The sense line is the bare index — no gloss text, no trailing space.
    expect(
      all.some(
        (n) => n.type === 'Text' && flatten(n) !== '' && flatten(n) !== '1.'
          && flatten(n) !== 'src only',
      ),
    ).toBe(false);
    expect(
      all.filter((n) => n.type === 'Text' && flatten(n) === '1.'),
    ).toHaveLength(2); // the definition line and its index span
    // The example shows the source with NO em-dash / empty translation.
    const example = textNodesWith(root, 'src only');
    expect(example).toHaveLength(1);
    expect(flatten(example[0])).not.toContain('—');
  });

  test('fontScale scales body text but leaves the POS badge at base size', () => {
    const scale = 2;
    const root = render('froncer', scale).toJSON() as unknown as RTNode;
    const gloss = textNodesWith(root, '2. khâu nhíu lại')[0];
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

  test('行く: the kana forms head the entry, the term is bold in its sense line', () => {
    const root = renderRaw(nhat['行く']).toJSON() as unknown as RTNode;
    const forms = textNodesWith(root, 'いく · ゆく');
    expect(forms).toHaveLength(1);
    expect(forms[0].props.style).toEqual(scaled(popupStyles.phonetic, 1));
    const line = collectAllNodes(root).find(
      (n) => n.type === 'Text' && flatten(n).startsWith('1. go — sự đi, sức sống;'),
    );
    expect(line).toBeDefined();
    const term = textNodesWith(line as RTNode, ' go');
    expect(term).toHaveLength(1);
    expect(term[0].props.style).toBe(popupStyles.synonymsLabel);
  });

  test('しゅうはけい: screen lines match the copy text', () => {
    const raw = nhat['しゅうはけい'];
    const root = renderRaw(raw).toJSON() as unknown as RTNode;
    const lines = fvdpEntryToPlainText(parseFvdpEntry(raw)).split('\n');
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(textNodesWith(root, l)).toHaveLength(1);
    }
  });

  test('the forms line scales; the term takes its size from the gloss line', () => {
    const scale = 2;
    const root = renderRaw(nhat['しゅうはけい'], scale).toJSON() as unknown as RTNode;
    expect(effectiveFontSize(textNodesWith(root, '周波計')[0].props.style)).toBe(
      popupStyles.phonetic.fontSize * scale,
    );
    const term = textNodesWith(root, ' wavemeter')[0];
    expect(effectiveFontSize(term.props.style)).toBeUndefined();
    const line = textNodesWith(root, '2. wavemeter')[0];
    expect(effectiveFontSize(line.props.style)).toBe(
      popupStyles.definition.fontSize * scale,
    );
  });
});
