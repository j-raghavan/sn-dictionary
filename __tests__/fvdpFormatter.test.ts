// Parser + detector tests for the FVDP (PhapVietPhap) marker layout.
// Fixtures are REAL corpus entries (renderParityCorpus.json), not
// hand-authored — the repo lesson is that hand-authored fixtures hid the
// sametypesequence blindspot (#28). The detector's precision is the load-
// bearing property: it must fire on the FVDP dict and NEVER on the other
// plain (sametypesequence=m) dicts, so its negatives are real TrungViet
// entries.

import {
  parseFvdpEntry,
  fvdpEntryToPlainText,
  looksLikeFvdp,
  FVDP_EXAMPLE_PAIR,
} from '../src/ui/fvdpFormatter';
import corpus from './_fixtures/renderParityCorpus.json';

const fvdp = corpus.fvdp as Record<string, string>;
const clean = corpus.trungvietClean as Record<string, string>;

describe('looksLikeFvdp — precision', () => {
  test.each(Object.keys(fvdp))('accepts the FVDP entry %s', (word) => {
    expect(looksLikeFvdp(fvdp[word])).toBe(true);
  });

  test.each(Object.keys(clean))(
    'rejects the TrungViet plain entry %s (0 false positives)',
    (word) => {
      expect(looksLikeFvdp(clean[word])).toBe(false);
    },
  );

  test('rejects a multi-line body (the no-newline gate is load-bearing)', () => {
    // A `*`-led body that spans lines is WordNet-shaped, not FVDP.
    expect(looksLikeFvdp('* line one\n* line two')).toBe(false);
  });

  test('rejects plain prose', () => {
    expect(looksLikeFvdp('a greeting used for most purposes')).toBe(false);
  });

  test('a `-`-led body without an example pair is not FVDP', () => {
    // TrungViet-style `- {word} , gloss` lists carry no =src+trans pair.
    expect(looksLikeFvdp('- {word} , a gloss, another gloss')).toBe(false);
  });
});

describe('FVDP_EXAMPLE_PAIR — the `:` exclusion', () => {
  test('matches a real =source+translation pair', () => {
    expect(FVDP_EXAMPLE_PAIR.test(fvdp.froncer)).toBe(true);
  });

  test('does NOT match the TrungViet `=中文+:...` shape (guards the detector)', () => {
    // The `+` immediately followed by `:` is excluded by the trailing
    // [^\s:=+], so a `-`-led entry carrying that shape stays non-FVDP.
    expect(FVDP_EXAMPLE_PAIR.test('-foo =中文+: bar')).toBe(false);
  });
});

describe('parseFvdpEntry — real corpus trees', () => {
  test('froncer: one POS section (2 senses, 2 examples) + a note', () => {
    const parsed = parseFvdpEntry(fvdp.froncer);
    expect(parsed.parseFailed).toBe(false);
    expect(parsed.sections).toEqual([
      {
        kind: 'pos',
        pos: 'ngoại động từ',
        senses: [
          {
            gloss: 'cau lại, chau lại; chúm lại',
            examples: [
              {source: 'Froncer les sourcils', translation: 'cau (chau) mày'},
              {source: 'Froncer les lèvres', translation: 'chúm môi'},
            ],
          },
          {gloss: 'khâu nhíu lại', examples: []},
        ],
      },
      {kind: 'note', label: 'phản nghĩa', body: 'Défroncer.'},
    ]);
  });

  test('abaissement: 4 senses under one POS, then an antonym note', () => {
    const parsed = parseFvdpEntry(fvdp.abaissement);
    expect(parsed.parseFailed).toBe(false);
    expect(parsed.sections).toHaveLength(2);
    const [pos, note] = parsed.sections;
    expect(pos).toMatchObject({kind: 'pos', pos: 'danh từ giống đực'});
    expect(pos.kind === 'pos' && pos.senses).toHaveLength(4);
    expect(pos.kind === 'pos' && pos.senses[0].examples).toHaveLength(5);
    expect(note).toMatchObject({kind: 'note', label: 'phản nghĩa'});
    expect(note.kind === 'note' && note.body).toContain('Elévation');
  });

  test('abandon: a mid-entry `#` closes the POS block; its body keeps the tail', () => {
    const parsed = parseFvdpEntry(fvdp.abandon);
    expect(parsed.sections).toHaveLength(2);
    const [pos, note] = parsed.sections;
    // The single sense before the `#` — the `#` boundary ends the POS
    // block even though marker-like `-`/`=` text follows it.
    expect(pos).toMatchObject({
      kind: 'pos',
      pos: 'danh từ giống đực',
      senses: [
        {
          gloss: 'sự bỏ, sự từ bỏ, sự ruồng bỏ',
          examples: [
            {source: 'Abandon de privilèges', translation: 'sự từ bỏ đặc quyền'},
          ],
        },
      ],
    });
    // Everything after the note's first `=` is verbatim body — including
    // the trailing `=…+…` fragments that are NOT re-parsed as examples.
    expect(note).toMatchObject({kind: 'note', label: 'phản nghĩa'});
    expect(note.kind === 'note' && note.body).toContain('Acquisition');
    expect(note.kind === 'note' && note.body).toContain("=vivre dans l'abandon+");
  });

  test('a: three distinct POS sections', () => {
    const parsed = parseFvdpEntry(fvdp.a);
    expect(parsed.parseFailed).toBe(false);
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections.map((s) => s.kind === 'pos' && s.pos)).toEqual([
      'danh từ giống đực (không đổi)',
      'viết tắt và ký hiệu của:',
      'tiếp đầu ngữ',
    ]);
    // Section 2's four senses are gloss-only (no example pairs).
    const second = parsed.sections[1];
    expect(second.kind === 'pos' && second.senses.map((x) => x.gloss)).toEqual([
      'nốt nhạc la (thuật ngữ âm nhạc) thuộc Anglo-Saxon và Đức',
      'a (sào)',
      'ampe',
      'angström',
    ]);
  });

  test('détersif: a zero-sense POS label is preserved, not dropped', () => {
    // `* tính từ * danh từ giống đực - như détergent` — the adjective
    // block has a label but no sense stream. It MUST survive (dropping it
    // silently loses the POS), and the noun block keeps its sense. 31 real
    // PhapVietPhap entries have this shape.
    const parsed = parseFvdpEntry(fvdp['détersif']);
    expect(parsed.parseFailed).toBe(false);
    expect(parsed.sections).toEqual([
      {kind: 'pos', pos: 'tính từ', senses: []},
      {
        kind: 'pos',
        pos: 'danh từ giống đực',
        senses: [{gloss: 'như détergent', examples: []}],
      },
    ]);
  });

  test('vice-roi: the simplest entry — one POS, one gloss, no examples', () => {
    expect(parseFvdpEntry(fvdp['vice-roi']).sections).toEqual([
      {
        kind: 'pos',
        pos: 'danh từ giống đực',
        senses: [{gloss: 'phó vương', examples: []}],
      },
    ]);
  });

  test('rông: a leading-`-` preamble becomes an implicit pos="" section', () => {
    const parsed = parseFvdpEntry(fvdp['rông']);
    expect(parsed.parseFailed).toBe(false);
    expect(parsed.sections).toHaveLength(1);
    const section = parsed.sections[0];
    expect(section).toMatchObject({kind: 'pos', pos: ''});
    expect(section.kind === 'pos' && section.senses.map((x) => x.gloss)).toEqual([
      'xem nhà_rông',
      'ronde',
      'monter (en parlant de la marée)',
      'çà et là',
    ]);
    // The last sense (çà et là) carries two bilingual examples.
    expect(section.kind === 'pos' && section.senses[3].examples).toEqual([
      {source: 'Chạy rông', translation: 'courir cà et là; errer'},
      {
        source: 'Thả rông trâu bò',
        translation:
          'laisser les bestiaux errer (çà et là); laisser divaguer les bestiaux',
      },
    ]);
  });

  test('parseFailed when the body is not FVDP (real TrungViet entry)', () => {
    const parsed = parseFvdpEntry(clean['人']);
    expect(parsed.parseFailed).toBe(true);
    expect(parsed.sections).toEqual([]);
  });
});

// Degenerate / malformed shapes the forgiving parser must survive without
// throwing — the "total failure -> verbatim fallback" and "tolerate rare
// over-split" contract. Minimal crafted inputs (NOT layout fixtures): each
// isolates one tolerance branch.
describe('parseFvdpEntry — robustness on degenerate input', () => {
  test('a lone POS label with no senses -> parseFailed (verbatim fallback)', () => {
    // The label-only section is RETAINED (so a multi-POS entry never
    // silently drops a POS heading — see the détersif case), but with no
    // sense/note anywhere the entry structures nothing, so parseFailed
    // gates it back to a verbatim render.
    const parsed = parseFvdpEntry('* danh từ');
    expect(parsed.parseFailed).toBe(true);
    expect(parsed.sections).toEqual([
      {kind: 'pos', pos: 'danh từ', senses: []},
    ]);
  });

  test('a truly empty POS/preamble section (no label, no senses) is skipped', () => {
    // `* *` opens an empty `*` section (no label, no senses) that must be
    // dropped, keeping only the real block. And a bare `-` preamble ahead
    // of the first `*` yields no senses and is likewise skipped.
    const fromStar = parseFvdpEntry('* * n - g =s+t');
    expect(fromStar.sections).toEqual([
      {kind: 'pos', pos: 'n', senses: [{gloss: 'g', examples: [{source: 's', translation: 't'}]}]},
    ]);
    const fromPreamble = parseFvdpEntry('- * n - g =s+t');
    expect(fromPreamble.sections).toEqual([
      {kind: 'pos', pos: 'n', senses: [{gloss: 'g', examples: [{source: 's', translation: 't'}]}]},
    ]);
  });

  test('an example with no `+` keeps the source and an empty translation', () => {
    const parsed = parseFvdpEntry('* n - g =a+b =c');
    const section = parsed.sections[0];
    expect(section.kind === 'pos' && section.senses[0].examples).toEqual([
      {source: 'a', translation: 'b'},
      {source: 'c', translation: ''},
    ]);
  });

  test('an empty (`=`-only) sense is dropped, valid senses survive', () => {
    const parsed = parseFvdpEntry('* n - real =s+t - =');
    const section = parsed.sections[0];
    expect(section.kind === 'pos' && section.senses).toEqual([
      {gloss: 'real', examples: [{source: 's', translation: 't'}]},
    ]);
  });

  test('a whitespace-only sense (double boundary dash) is dropped', () => {
    const parsed = parseFvdpEntry('* n - a =s+t - - b');
    const section = parsed.sections[0];
    expect(section.kind === 'pos' && section.senses.map((x) => x.gloss)).toEqual([
      'a',
      'b',
    ]);
  });

  test('a note with no `=` keeps the whole text as its label and empty body', () => {
    const parsed = parseFvdpEntry('* n - g =s+t # justlabel');
    const note = parsed.sections[1];
    expect(note).toEqual({kind: 'note', label: 'justlabel', body: ''});
  });

  test('a trailing `#` marker with an empty note is dropped, POS section survives', () => {
    // `#` at end-of-string (right-boundary is EOF) opening an empty note.
    const parsed = parseFvdpEntry('* n - g =s+t #');
    expect(parsed.parseFailed).toBe(false);
    expect(parsed.sections).toEqual([
      {
        kind: 'pos',
        pos: 'n',
        senses: [{gloss: 'g', examples: [{source: 's', translation: 't'}]}],
      },
    ]);
  });

  test('a `*` section with only a bare dash (no label, no sense) -> parseFailed', () => {
    // Neither a POS label nor any sense — the section is dropped and the
    // whole entry structures nothing, so it falls back to verbatim.
    const parsed = parseFvdpEntry('* -');
    expect(parsed.parseFailed).toBe(true);
    expect(parsed.sections).toEqual([]);
  });

  test('a `*`/`#` char mid-token is NOT a marker (stays in the gloss)', () => {
    // Only whitespace-flanked `*`/`#` split the entry; `a*b` keeps its
    // asterisk as literal gloss text.
    const parsed = parseFvdpEntry('* n - a*b =s+t');
    expect(parsed.sections).toEqual([
      {
        kind: 'pos',
        pos: 'n',
        senses: [{gloss: 'a*b', examples: [{source: 's', translation: 't'}]}],
      },
    ]);
  });
});

// The clipboard serializer must mirror FvdpText's on-screen structure so
// Copy matches what the user sees (the copy-matches-screen invariant).
describe('fvdpEntryToPlainText', () => {
  test('froncer: POS heading, numbered senses, "source — translation" lines, note', () => {
    const out = fvdpEntryToPlainText(parseFvdpEntry(fvdp.froncer));
    expect(out).toBe(
      [
        'ngoại động từ',
        '1. cau lại, chau lại; chúm lại',
        '  Froncer les sourcils — cau (chau) mày',
        '  Froncer les lèvres — chúm môi',
        '2. khâu nhíu lại',
        'phản nghĩa: Défroncer.',
      ].join('\n'),
    );
  });

  test('détersif: the zero-sense POS label appears on its own line', () => {
    const out = fvdpEntryToPlainText(parseFvdpEntry(fvdp['détersif']));
    expect(out).toBe(['tính từ', 'danh từ giống đực', '1. như détergent'].join('\n'));
  });

  test('an example with no translation renders just the source', () => {
    const out = fvdpEntryToPlainText(parseFvdpEntry('* n - g =src+'));
    expect(out).toBe(['n', '1. g', '  src'].join('\n'));
  });

  test('a pos="" preamble section emits no heading line (rông)', () => {
    const out = fvdpEntryToPlainText(parseFvdpEntry(fvdp['rông']));
    // No POS heading; the numbered senses lead directly.
    expect(out.startsWith('1. xem nhà_rông')).toBe(true);
  });

  test('a note with an empty body serializes to just its label', () => {
    const out = fvdpEntryToPlainText(parseFvdpEntry('* n - g =s+t # justlabel'));
    expect(out).toBe(['n', '1. g', '  s — t', 'justlabel'].join('\n'));
  });
});
