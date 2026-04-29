import {
  parseWordNetEntry,
  labelForPos,
} from '../src/ui/wordnetFormatter';

const ANATOMY = `anatomy
     n 1: the branch of morphology that deals with the structure of
          animals [syn: {general anatomy}]
     2: alternative names for the body of a human being; "Leonardo
        studied the human body"; "he has a strong physique"; "the
        spirit is willing but the flesh is weak" [syn: {human body},
         {physical body}, {material body}, {soma}, {build}, {figure},
         {physique}, {shape}, {bod}, {chassis}, {frame}, {form}, {flesh}]
     3: a detailed analysis; "he studied the anatomy of crime"`;

const AI_ENTRY = `AI
     n 1: an agency of the United States Army responsible for
          providing timely and relevant and accurate and
          synchronized intelligence to tactical and operational
          and strategic level commanders [syn: {Army Intelligence}]
     2: the branch of computer science that deal with writing
        computer programs that can solve problems creatively;
        "workers in AI hope to imitate or duplicate intelligence
        in computers and robots" [syn: {artificial intelligence}]
     3: a sloth that has three long claws on each forefoot [syn: {three-toed
        sloth}, {Bradypus tridactylus}]
     4: the introduction of semen into the oviduct or uterus by some
        means other than sexual intercourse [syn: {artificial
        insemination}]`;

const WORD_ENTRY = `word
     n 1: a unit of language that native speakers can identify; "words
          are the blocks from which sentences are made"
     2: a brief statement; "he didn't say a word about it"
     v 1: put into words or an expression; "He formulated his concerns" [syn: {give voice}, {formulate}, {phrase}, {articulate}]`;

const SINGLE_SENSE_ENTRY = `dictionary
     n : a reference book containing an alphabetical list of words
         with information about them [syn: {lexicon}]`;

describe('parseWordNetEntry', () => {
  test('parses anatomy: 3 noun senses, synonyms, examples in sense 2 and 3', () => {
    const parsed = parseWordNetEntry(ANATOMY);
    expect(parsed.parseFailed).toBe(false);
    expect(parsed.word).toBe('anatomy');
    expect(parsed.senses).toHaveLength(3);

    expect(parsed.senses[0]).toMatchObject({
      pos: 'n',
      index: 1,
      definition: expect.stringContaining('branch of morphology'),
      synonyms: ['general anatomy'],
      examples: [],
    });

    expect(parsed.senses[1].pos).toBe('n');
    expect(parsed.senses[1].index).toBe(2);
    expect(parsed.senses[1].examples).toHaveLength(3);
    expect(parsed.senses[1].synonyms).toEqual(
      expect.arrayContaining([
        'human body',
        'physical body',
        'soma',
        'flesh',
      ]),
    );
    // The definition should NOT contain the raw [syn: ...] or the quoted examples.
    expect(parsed.senses[1].definition).not.toContain('[syn:');
    expect(parsed.senses[1].definition).not.toContain('"');

    expect(parsed.senses[2]).toMatchObject({
      pos: 'n',
      index: 3,
      examples: ['he studied the anatomy of crime'],
    });
  });

  test('parses AI: 4 senses, each with one synonym group', () => {
    const parsed = parseWordNetEntry(AI_ENTRY);
    expect(parsed.parseFailed).toBe(false);
    expect(parsed.senses).toHaveLength(4);
    expect(parsed.senses.map(s => s.synonyms)).toEqual([
      ['Army Intelligence'],
      ['artificial intelligence'],
      ['three-toed sloth', 'Bradypus tridactylus'],
      ['artificial insemination'],
    ]);
    // The "Artificial Intelligence" sense should be discoverable
    // even though it is sense #2.
    const csSense = parsed.senses.find(s =>
      s.synonyms.includes('artificial intelligence'),
    );
    expect(csSense).toBeDefined();
    expect(csSense?.definition).toContain('computer science');
  });

  test('parses multi-POS word entry: noun senses then verb senses, sense indexes reset per POS', () => {
    const parsed = parseWordNetEntry(WORD_ENTRY);
    expect(parsed.parseFailed).toBe(false);
    expect(parsed.senses).toHaveLength(3);
    expect(parsed.senses[0]).toMatchObject({pos: 'n', index: 1});
    expect(parsed.senses[1]).toMatchObject({pos: 'n', index: 2});
    expect(parsed.senses[2]).toMatchObject({pos: 'v', index: 1});
    expect(parsed.senses[2].synonyms).toEqual(
      expect.arrayContaining(['give voice', 'formulate', 'phrase']),
    );
  });

  test('parses a single-sense entry (dictionary)', () => {
    const parsed = parseWordNetEntry(SINGLE_SENSE_ENTRY);
    expect(parsed.parseFailed).toBe(false);
    expect(parsed.senses).toHaveLength(1);
    expect(parsed.senses[0]).toMatchObject({
      pos: 'n',
      definition: expect.stringContaining('alphabetical list of words'),
      synonyms: ['lexicon'],
    });
  });

  test('strips wrapping whitespace from synonyms that span multiple lines', () => {
    const parsed = parseWordNetEntry(AI_ENTRY);
    const sloth = parsed.senses[2];
    expect(sloth.synonyms).toContain('three-toed sloth');
    // Should not contain runs of internal whitespace from line wrapping
    expect(sloth.synonyms.every(s => !/\s{2,}/.test(s))).toBe(true);
  });

  test('flags parseFailed=true when input has no recognisable senses', () => {
    const garbage = 'just a single line with no structure';
    const parsed = parseWordNetEntry(garbage);
    expect(parsed.parseFailed).toBe(true);
    expect(parsed.senses).toEqual([]);
    expect(parsed.raw).toBe(garbage);
  });

  test('handles empty input gracefully', () => {
    const parsed = parseWordNetEntry('');
    expect(parsed.parseFailed).toBe(true);
    expect(parsed.senses).toEqual([]);
  });

  test('treats unknown POS tokens as continuation lines (does not invent a fake POS)', () => {
    const weird = `something
     xyz 1: this looks like a sense start with an unknown pos
     and continues here`;
    const parsed = parseWordNetEntry(weird);
    expect(parsed.parseFailed).toBe(true);
  });

  test('skips blank lines without breaking sense continuity', () => {
    const withBlanks = `gap

     n 1: first definition

     2: second definition`;
    const parsed = parseWordNetEntry(withBlanks);
    expect(parsed.senses).toHaveLength(2);
    expect(parsed.senses[1].pos).toBe('n');
  });
});

describe('labelForPos', () => {
  test('maps the WordNet abbreviation to a human-readable label', () => {
    expect(labelForPos('n')).toBe('noun');
    expect(labelForPos('v')).toBe('verb');
    expect(labelForPos('adj')).toBe('adjective');
    expect(labelForPos('a')).toBe('adjective');
    expect(labelForPos('adv')).toBe('adverb');
    expect(labelForPos('r')).toBe('adverb');
  });

  test('falls through unknown tokens unchanged', () => {
    expect(labelForPos('?')).toBe('?');
  });

  test('returns empty string when no POS is given', () => {
    expect(labelForPos(undefined)).toBe('');
  });
});
