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
import {entryToPlainText} from '../src/ui/copyText';
import {popupStyles} from '../src/ui/popupStyles';
import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  CREATE_ALIASES_TABLE,
  CREATE_ENTRIES_TABLE,
  INSERT_STARDICT_ENTRY,
} from '../src/core/dict/sqlite/schema';
import {selectByKey} from '../src/core/dict/sqlite/sqliteDictSource';
import type {EntryPart} from '../src/core/lookup';

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

// #46: a key that reaches several entries carries them as `parts`. Each
// part renders through the same routing as a single entry would, and a
// part whose headword differs from the entry's gets a headword label.
describe('SourceSection — an entry with several parts (#46)', () => {
  const partsHit = (parts: EntryPart[]): SourceHit => ({
    source: 'TestDict',
    entry: {...parts[0], parts},
  });
  // The part blocks are the section's direct children; a labelled part
  // opens with a header row holding its headword. (FVDP and WordNet sense
  // headers sit deeper, inside the body.)
  const partBlocks = (root: RTNode): RTNode[] =>
    (root.children ?? []).filter(
      (n): n is RTNode =>
        typeof n !== 'string' &&
        Array.isArray(n.props.style) &&
        (n.props.style as unknown[]).includes(popupStyles.sense),
    );
  const labels = (root: RTNode): string[] =>
    partBlocks(root)
      .map(b => b.children?.[0])
      .filter(
        (n): n is RTNode =>
          typeof n !== 'string' && n?.props.style === popupStyles.senseHeader,
      )
      .map(flatten);
  const flatOf = (hit: SourceHit): string =>
    flatten(render(hit).toJSON() as unknown as RTNode);

  test('the two real PhapVietPhap "an" records, looked up, each render as FVDP', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run(CREATE_ALIASES_TABLE);
      for (const [i, body] of corpus.merged.pvpAn.entries()) {
        await d.run(INSERT_STARDICT_ENTRY, [i + 1, 'an', 'an', body, 'plain']);
      }
    });
    const entry = (await selectByKey(db, 'an'))!;
    await db.close();
    expect(entry.parts).toHaveLength(2);
    const hit: SourceHit = {source: 'PhapVietPhap', entry};
    const root = render(hit).toJSON() as unknown as RTNode;
    // Both bodies took the FVDP path: their part-of-speech badges render.
    const texts = collect(root).filter(n => n.type === 'Text').map(flatten);
    expect(texts).toContain('danh từ giống đực');
    // Each part renders exactly as it would alone; same headword, so no label.
    const alone = entry.parts!.map(p => flatOf(hitOf(p.definition, p.format)));
    expect(flatten(root)).toBe(alone.join(''));
    expect(labels(root)).toEqual([]);
    // Copy: each part as it would copy alone, a blank line apart.
    expect(entryToPlainText(hit)).toBe(
      entry.parts!.map(p => entryToPlainText(hitOf(p.definition, p.format))).join('\n\n'),
    );
  });

  test('fr-fr "suis" labels the part whose headword differs (être), not the first', () => {
    const [suivre, etre] = corpus.merged.frfrSuis;
    const hit = partsHit([
      {...suivre, format: 'html'},
      {...etre, format: 'html'},
    ]);
    const root = render(hit).toJSON() as unknown as RTNode;
    expect(labels(root)).toEqual(['être']);
    expect(entryToPlainText(hit)).toBe(
      `${entryToPlainText(hitOf(suivre.definition, 'html'))}\n\nêtre\n` +
        entryToPlainText(hitOf(etre.definition, 'html')),
    );
  });

  test('JMdict かみ parts all carry the matched alias, so none is labelled', () => {
    // JMdict bodies name their own kanji; the lookup gives every part the
    // matched alias as its headword.
    const hit = partsHit(
      ['<b>紙</b> paper', '<b>神</b> god', '<b>髪</b> hair'].map(definition => ({
        word: 'かみ',
        definition,
        format: 'html' as const,
      })),
    );
    expect(labels(render(hit).toJSON() as unknown as RTNode)).toEqual([]);
    expect(entryToPlainText(hit)).not.toMatch(/^かみ$/m);
  });

  test('mixed html + plain parts each keep their own format: the plain one is not escaped', () => {
    const hit = partsHit([
      {word: 'w', definition: '<b>bold</b>', format: 'html'},
      {word: 'w', definition: 'x < y & z', format: 'plain'},
    ]);
    const root = render(hit).toJSON() as unknown as RTNode;
    expect(flatten(root)).toBe('boldx < y & z');
    expect(entryToPlainText(hit)).toBe('bold\n\nx < y & z');
  });

  test('later parts sit behind the sense divider, and the label scales with the body', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <SourceSection
          hit={partsHit([
            {word: 'a', definition: 'one', format: 'plain'},
            {word: 'b', definition: 'two', format: 'plain'},
          ])}
          showBadge={false}
          showDivider={false}
          fontScale={2}
        />,
      );
    });
    const root = tree.toJSON() as unknown as RTNode;
    const blocks = partBlocks(root);
    expect(blocks.map(b => (b.props.style as unknown[]).includes(popupStyles.senseDivider))).toEqual([
      false,
      true,
    ]);
    expect(labels(root)).toEqual(['b']);
    const label = collect(root).find(n => flatten(n) === 'b' && n.type === 'Text')!;
    expect(label.props.style).toEqual([popupStyles.senseIndex, {fontSize: 32}]);
  });
});
