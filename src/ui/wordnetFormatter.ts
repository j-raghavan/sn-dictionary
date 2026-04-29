// WordNet entry parser. Takes the raw definition text shipped in
// `.dict.dz` (sametypesequence='m', plain UTF-8) and structures it
// into POS-tagged numbered senses with extracted synonyms and
// examples. Pure JS; no React, no SDK; used by DefinitionPopup so the
// renderer can lay out each sense in its own visually-distinct block
// instead of dumping a wall of text.
//
// Format observed in WordNet 2.x StarDict (dict.org / huzheng mirror):
//
//   anatomy
//        n 1: the branch of morphology that deals with the structure
//             of animals [syn: {general anatomy}]
//        2: alternative names for the body of a human being;
//           "Leonardo studied the human body"; "the flesh is weak"
//           [syn: {human body}, {physical body}, ...]
//        v 1: ...
//
// Parser is forgiving: anything it can't classify into a sense is
// surfaced via `parseFailed = true` so the popup can fall back to
// rendering the raw text. Custom dictionaries that don't follow
// WordNet conventions therefore still display.

export type WordNetSense = {
  pos?: string; // 'n' | 'v' | 'adj' | 'adv' | 'a' | 'r' (WordNet abbreviations)
  index: number; // 1-based sense number within its POS block
  definition: string; // definition text with synonyms / examples extracted out
  examples: string[]; // quoted-string examples lifted from the text
  synonyms: string[]; // [syn: {a}, {b}] entries, with braces stripped
};

export type ParsedWordNetEntry = {
  word: string;
  senses: WordNetSense[];
  parseFailed: boolean; // true when no senses were recognised — caller falls back to raw
  raw: string;
};

const POS_TOKENS = new Set(['n', 'v', 'adj', 'adv', 'a', 'r']);

// Three sense-line shapes seen in WordNet 2.x output:
//   "     n 1: text"  -> first sense of a POS block (most common)
//   "     2: text"    -> subsequent sense, inherits the POS of the block
//   "     n : text"   -> single-sense entries (omit the number; treat as 1)
const SENSE_POS_AND_NUM = /^\s+([a-z]+)\s+(\d+):\s*(.*)$/;
const SENSE_POS_ONLY = /^\s+([a-z]+)\s+:\s*(.*)$/;
const SENSE_NUM_ONLY = /^\s+(\d+):\s*(.*)$/;

type SenseStart = {pos?: string; index: number; rest: string};

const matchSenseStart = (line: string): SenseStart | null => {
  const fullMatch = line.match(SENSE_POS_AND_NUM);
  if (fullMatch && POS_TOKENS.has(fullMatch[1])) {
    return {
      pos: fullMatch[1],
      index: parseInt(fullMatch[2], 10),
      rest: fullMatch[3],
    };
  }
  const posOnly = line.match(SENSE_POS_ONLY);
  if (posOnly && POS_TOKENS.has(posOnly[1])) {
    return {pos: posOnly[1], index: 1, rest: posOnly[2]};
  }
  const numOnly = line.match(SENSE_NUM_ONLY);
  if (numOnly) {
    return {index: parseInt(numOnly[1], 10), rest: numOnly[2]};
  }
  return null;
};

const extractSynonyms = (text: string): string[] => {
  const synBlock = text.match(/\[syn:\s*([^\]]+)\]/);
  if (!synBlock) {
    return [];
  }
  return Array.from(synBlock[1].matchAll(/\{([^}]+)\}/g)).map(m =>
    m[1].replace(/\s+/g, ' ').trim(),
  );
};

const extractExamples = (text: string): string[] =>
  Array.from(text.matchAll(/"([^"]+)"/g)).map(m => m[1].trim());

const stripSynonymsAndExamples = (text: string): string =>
  text
    .replace(/\[syn:\s*[^\]]+\]/g, '')
    .replace(/;?\s*"[^"]+"/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*$/g, '')
    .trim();

export const parseWordNetEntry = (raw: string): ParsedWordNetEntry => {
  const lines = raw.split('\n');
  if (lines.length === 0) {
    return {word: '', senses: [], parseFailed: true, raw};
  }

  const word = lines[0].trim();
  type WorkingSense = {pos?: string; index: number; chunks: string[]};
  const working: WorkingSense[] = [];
  let currentPos: string | undefined;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      continue;
    }
    const senseStart = matchSenseStart(line);
    if (senseStart) {
      if (senseStart.pos !== undefined) {
        currentPos = senseStart.pos;
      }
      working.push({
        pos: currentPos,
        index: senseStart.index,
        chunks: [senseStart.rest],
      });
    } else if (working.length > 0) {
      working[working.length - 1].chunks.push(line.trim());
    }
  }

  const senses: WordNetSense[] = working.map(ws => {
    const flat = ws.chunks.join(' ');
    return {
      pos: ws.pos,
      index: ws.index,
      definition: stripSynonymsAndExamples(flat),
      examples: extractExamples(flat),
      synonyms: extractSynonyms(flat),
    };
  });

  return {
    word,
    senses,
    parseFailed: senses.length === 0,
    raw,
  };
};

const POS_LABELS: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  a: 'adjective',
  r: 'adverb',
};

export const labelForPos = (pos?: string): string =>
  pos ? POS_LABELS[pos] ?? pos : '';
