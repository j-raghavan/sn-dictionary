// Parser for the marker-delimited layout used by the "Từ điển Pháp -
// Việt - Pháp" (PhapVietPhap) StarDict and its siblings — a plain
// (sametypesequence='m') dict whose bodies pack POS blocks, numbered
// senses, and bilingual examples onto a SINGLE line with `*`, `-`, `=`,
// `+`, and `#` markers instead of HTML. Structured here so SourceSection
// can lay each POS/sense/example out in its own block the way the
// WordNet path does, instead of dumping the marker soup verbatim.
//
// Observed layout (froncer, real corpus):
//   * ngoại động từ - cau lại; chúm lại =Froncer les sourcils+ cau mày
//     =Froncer les lèvres+ chúm môi - khâu nhíu lại # phản nghĩa =Défroncer.
//   ^ POS      sense-1 gloss  ^example(source+translation)  sense-2  ^note
//
// The same `-` sense list also carries the NhatVietNhat / TrungViet
// layout, where a sense opens with a braced term:
//   - {いく} - {ゆく} - {go} , sự đi, sức sống; …
//     ^ headword forms   ^ term, then its gloss after ` , `
// A term with Latin letters is a sense ("1. go — sự đi, …"); a kana /
// kanji term with nothing after it is a form of the headword, gathered
// into a forms line above the senses.
//
// Forgiving like parseWordNetEntry: anything that doesn't structure sets
// parseFailed so the popup falls back to raw text. The detector is
// conservative (see looksLikeFvdp) so other plain dicts never enter this
// path — verified 0 false positives across the VN-EN Wiktionary, the
// Sachxy en-vi and the HanNgu corpora.

export type FvdpExample = {source: string; translation: string};
export type FvdpSense = {term?: string; gloss: string; examples: FvdpExample[]};
export type FvdpSection =
  // pos may be ''; forms is set only when the section has any.
  // firstIndex, when set, is the number of the first sense: a section
  // after a `#` note carries on the numbering of the section before it.
  | {
      kind: 'pos';
      pos: string;
      forms?: string[];
      firstIndex?: number;
      senses: FvdpSense[];
    }
  | {kind: 'note'; label: string; body: string};
type FvdpPosSection = Extract<FvdpSection, {kind: 'pos'}>;
export type ParsedFvdpEntry = {
  sections: FvdpSection[];
  parseFailed: boolean;
  raw: string;
};

// A `=source+translation` example pair. The trailing `[^\s:=+]` requires a
// real translation char right after the `+`, which EXCLUDES the TrungViet
// `=中文+:...` shape (`+` immediately followed by `:`) so that dict's
// `-`-leading entries never trip the detector.
export const FVDP_EXAMPLE_PAIR = /[=][^=+\n]+\+\s*[^\s:=+]/;

// A `-` sense that opens on a braced term — `- {go} , sự đi`.
const FVDP_TERM_LEAD = /^\s*-\s*\{[^}]*\}/;

// Conservative gate. FVDP bodies are single-line; a `*`-led entry is
// unambiguously FVDP, and a `-`-led entry qualifies only when it opens on
// a braced term or carries a genuine example pair (guarding against
// other `-`-list dicts, e.g. NhatVietNhat's bare `- học viên, học sinh`).
// The no-newline check is load-bearing: WordNet / multi-line bodies are
// never FVDP.
export const looksLikeFvdp = (s: string): boolean =>
  !s.includes('\n') &&
  (/^\s*\*\s/.test(s) ||
    FVDP_TERM_LEAD.test(s) ||
    (/^\s*-/.test(s) && FVDP_EXAMPLE_PAIR.test(s)));

// The forms line, shared by FvdpText and the copy text.
export const fvdpFormsLine = (forms: string[]): string => forms.join(' · ');

const isSpace = (ch: string): boolean => /\s/.test(ch);

// A `-` acting as a sense separator: at the start of its scope or
// preceded by whitespace (` - ` / leading `-`), or glued to the `}` of a
// braced term (`{to pauperize}- {…}`, a TrungViet / NhatVietNhat slip).
// Excludes intra-word hyphens (`soi-même`, `vice-roi`) where a letter
// precedes the dash.
const isBoundaryDash = (s: string, i: number): boolean =>
  s[i] === '-' && (i === 0 || isSpace(s[i - 1]) || s[i - 1] === '}');

// Index of the first position `at` accepts; the length when none does.
const indexWhere = (t: string, at: (i: number) => boolean): number => {
  for (let i = 0; i < t.length; i++) {
    if (at(i)) {
      return i;
    }
  }
  return t.length;
};

// Index of the first `=` or boundary `-` — the point where the POS label
// ends and the sense stream begins. Length when the section is POS-only.
const firstSenseBoundary = (t: string): number =>
  indexWhere(t, (i) => t[i] === '=' || isBoundaryDash(t, i));

// Index of the first boundary `-` — where a `#` note ends and any senses
// after it begin. Length when the note runs to the end.
const firstBoundaryDash = (t: string): number =>
  indexWhere(t, (i) => isBoundaryDash(t, i));

// Split a sense stream into per-sense chunks at each boundary `-` outside
// a braced term, so chân chấu's `- {Saw - teeth}` stays one sense.
const splitSenses = (stream: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < stream.length; i++) {
    if (stream[i] === '{') {
      depth++;
    } else if (stream[i] === '}') {
      depth = Math.max(0, depth - 1);
    }
    if (depth === 0 && isBoundaryDash(stream, i)) {
      if (i > start) {
        parts.push(stream.slice(start, i));
      }
      start = i + 1;
    }
  }
  if (start < stream.length) {
    parts.push(stream.slice(start));
  }
  return parts;
};

// Split the example run (everything from a sense's first `=`) into pairs.
// `=` never appears intra-token in the bilingual bodies, so a plain split
// is safe; each pair breaks at its FIRST `+` into source / translation.
const parseExamples = (run: string): FvdpExample[] => {
  const out: FvdpExample[] = [];
  for (const chunk of run.split('=')) {
    const c = chunk.trim();
    if (c === '') {
      continue;
    }
    const plus = c.indexOf('+');
    if (plus < 0) {
      out.push({source: c, translation: ''});
    } else {
      out.push({
        source: c.slice(0, plus).trim(),
        translation: c.slice(plus + 1).trim(),
      });
    }
  }
  return out;
};

// A sense's leading `{term}` and the text after it, with the ` , ` that
// separates the term from its gloss dropped.
const LEADING_TERM = /^\{([^}]*)\}\s*,?/;

const parseSense = (part: string): FvdpSense | null => {
  const t = part.trim();
  const lead = LEADING_TERM.exec(t);
  const term = lead ? lead[1].trim() : '';
  const rest = lead ? t.slice(lead[0].length).trim() : t;
  const eq = rest.indexOf('=');
  const gloss = (eq < 0 ? rest : rest.slice(0, eq)).trim();
  const examples = eq < 0 ? [] : parseExamples(rest.slice(eq));
  if (term === '' && gloss === '' && examples.length === 0) {
    return null;
  }
  return term === '' ? {gloss, examples} : {term, gloss, examples};
};

// Latin, Latin-1 / Extended-A/B, and the Vietnamese Extended Additional
// block.
const HAS_LATIN = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/;

// Hiragana, katakana, CJK ideographs (Extension A and the unified block)
// and the CJK compatibility ideographs.
const HAS_KANA_OR_KANJI = /[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF]/;

// A bare kana / kanji term (`{いく}`) names a form of the headword rather
// than a sense: it has no gloss or examples of its own. Digit or
// punctuation scraps (Hoa's `{000}`, にわり's `{20%}`) are not forms.
const isHeadwordForm = (sense: FvdpSense): sense is FvdpSense & {term: string} =>
  sense.term !== undefined &&
  !HAS_LATIN.test(sense.term) &&
  HAS_KANA_OR_KANJI.test(sense.term) &&
  sense.gloss === '' &&
  sense.examples.length === 0;

// A `*` (or implicit pos='') section: POS label up to the first sense
// boundary, then the senses. pos='' when the text opens straight into a
// `-`/`=` sense (the leading-marker preamble case).
const parsePosSection = (
  text: string,
): FvdpPosSection => {
  const t = text.trim();
  const boundary = firstSenseBoundary(t);
  const pos = t.slice(0, boundary).trim();
  const forms: string[] = [];
  const senses: FvdpSense[] = [];
  for (const part of splitSenses(t.slice(boundary))) {
    const sense = parseSense(part);
    if (sense && isHeadwordForm(sense)) {
      forms.push(sense.term);
    } else if (sense) {
      senses.push(sense);
    }
  }
  return forms.length > 0
    ? {kind: 'pos', pos, forms, senses}
    : {kind: 'pos', pos, senses};
};

const parseNoteSection = (
  text: string,
): {kind: 'note'; label: string; body: string} => {
  const t = text.trim();
  const eq = t.indexOf('=');
  if (eq < 0) {
    return {kind: 'note', label: t, body: ''};
  }
  return {kind: 'note', label: t.slice(0, eq).trim(), body: t.slice(eq + 1).trim()};
};

type Segment = {marker: '*' | '#' | null; text: string};

// Break the entry at boundary-anchored `*` / `#` markers (start-of-string
// or whitespace on the left, whitespace on the right). The leading
// null-marker segment is the preamble (text before the first marker).
const segment = (raw: string): Segment[] => {
  const segs: Segment[] = [];
  let marker: '*' | '#' | null = null;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '*' && ch !== '#') {
      continue;
    }
    const leftOk = i === 0 || isSpace(raw[i - 1]);
    const rightOk = i + 1 >= raw.length || isSpace(raw[i + 1]);
    if (leftOk && rightOk) {
      segs.push({marker, text: raw.slice(start, i)});
      marker = ch;
      start = i + 1;
    }
  }
  segs.push({marker, text: raw.slice(start)});
  return segs;
};

// A pos section worth keeping without a POS label: it has senses or
// headword forms.
const hasContent = (s: FvdpPosSection): boolean =>
  s.senses.length > 0 || s.forms !== undefined;

const lastPosSection = (
  sections: FvdpSection[],
): FvdpPosSection | undefined =>
  sections.filter((s): s is FvdpPosSection => s.kind === 'pos').pop();

export const parseFvdpEntry = (raw: string): ParsedFvdpEntry => {
  if (!looksLikeFvdp(raw)) {
    return {sections: [], parseFailed: true, raw};
  }
  const sections: FvdpSection[] = [];
  for (const seg of segment(raw)) {
    if (seg.marker === '#') {
      // A note runs to its first boundary dash. Senses after it
      // (abattement's `# phản nghĩa =Energie, … joie - giảm miễn (thuế)
      // =…`) are not part of the note: they form their own pos='' section.
      const end = firstBoundaryDash(seg.text);
      const note = parseNoteSection(seg.text.slice(0, end));
      if (note.label !== '' || note.body !== '') {
        sections.push(note);
      }
      const after = parsePosSection(seg.text.slice(end));
      if (hasContent(after)) {
        const before = lastPosSection(sections);
        if (before) {
          after.firstIndex = (before.firstIndex ?? 1) + before.senses.length;
        }
        sections.push(after);
      }
    } else if (seg.marker === '*') {
      const sec = parsePosSection(seg.text);
      // Keep a POS section with a real label even when it has zero senses
      // (a terse block in a multi-POS entry, e.g. détersif's `* tính từ
      // * danh từ giống đực - …`) — dropping it silently loses that POS
      // heading. A truly empty section (no pos, no senses) is skipped; a
      // whole entry that structures nothing still falls back to verbatim
      // via the parseFailed check below (structured === 0).
      if (sec.senses.length > 0 || sec.pos !== '') {
        sections.push(sec);
      }
    } else if (/^\s*[-=]/.test(seg.text)) {
      // Preamble that opens straight into a sense (rông's vi-direction
      // `-`-list) — an implicit pos='' section. Its pos is ALWAYS '' (the
      // `/^\s*[-=]/` gate puts the first sense boundary at index 0), so
      // only senses or headword forms keep it — no `pos !== ''` branch
      // here. A forms-only entry (にれ's `- {楡}`) is its forms line.
      const sec = parsePosSection(seg.text);
      if (hasContent(sec)) {
        sections.push(sec);
      }
    }
  }
  const structured = sections.reduce(
    (n, s) =>
      n + (s.kind === 'pos' ? s.senses.length + (s.forms?.length ?? 0) : 1),
    0,
  );
  return {sections, parseFailed: structured === 0, raw};
};

// Serialize a parsed FVDP entry to plain text, mirroring FvdpText's
// on-screen layout so the Copy action matches what the user sees (the
// copy-matches-screen invariant): the POS label heads its block, senses
// are numbered, each example is an indented "source — translation" line,
// and a note section reads "label: body". Pure — no React, no styles.
export const fvdpEntryToPlainText = (parsed: ParsedFvdpEntry): string =>
  parsed.sections.map(sectionToPlainText).join('\n');

const sectionToPlainText = (section: FvdpSection): string => {
  if (section.kind === 'note') {
    return section.body ? `${section.label}: ${section.body}` : section.label;
  }
  const lines: string[] = [];
  if (section.forms) {
    lines.push(fvdpFormsLine(section.forms));
  }
  if (section.pos !== '') {
    lines.push(section.pos);
  }
  const first = section.firstIndex ?? 1;
  section.senses.forEach((sense, i) => {
    const text = sense.term
      ? [sense.term, sense.gloss].filter(Boolean).join(' — ')
      : sense.gloss;
    lines.push(`${i + first}. ${text}`.trim());
    for (const ex of sense.examples) {
      lines.push(ex.translation ? `  ${ex.source} — ${ex.translation}` : `  ${ex.source}`);
    }
  });
  return lines.join('\n');
};
