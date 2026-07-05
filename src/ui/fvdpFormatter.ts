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
// Forgiving like parseWordNetEntry: anything that doesn't structure sets
// parseFailed so the popup falls back to raw text. The detector is
// conservative (see looksLikeFvdp) so non-FVDP plain dicts never enter
// this path — verified 0 false positives across TrungViet, the VN-EN
// Wiktionary, and the Sachxy en-vi corpora.

export type FvdpExample = {source: string; translation: string};
export type FvdpSense = {gloss: string; examples: FvdpExample[]};
export type FvdpSection =
  | {kind: 'pos'; pos: string; senses: FvdpSense[]} // pos may be ''
  | {kind: 'note'; label: string; body: string};
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

// Conservative gate. FVDP bodies are single-line; a `*`-led entry is
// unambiguously FVDP, and a `-`-led entry qualifies only when it also
// carries a genuine example pair (guarding against other `-`-list dicts).
// The no-newline check is load-bearing: WordNet / multi-line bodies are
// never FVDP.
export const looksLikeFvdp = (s: string): boolean =>
  !s.includes('\n') &&
  (/^\s*\*\s/.test(s) || (/^\s*-/.test(s) && FVDP_EXAMPLE_PAIR.test(s)));

const isSpace = (ch: string): boolean => /\s/.test(ch);

// A `-` acting as a sense separator: at the start of its scope or
// preceded by whitespace (` - ` / leading `-`). Excludes intra-word
// hyphens (`soi-même`, `vice-roi`) where a letter precedes the dash.
const isBoundaryDash = (s: string, i: number): boolean =>
  s[i] === '-' && (i === 0 || isSpace(s[i - 1]));

// Index of the first `=` or boundary `-` — the point where the POS label
// ends and the sense stream begins. Length when the section is POS-only.
const firstSenseBoundary = (t: string): number => {
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' || isBoundaryDash(t, i)) {
      return i;
    }
  }
  return t.length;
};

// Split a sense stream into per-sense chunks at each boundary `-`.
const splitSenses = (stream: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < stream.length; i++) {
    if (isBoundaryDash(stream, i)) {
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

const parseSense = (part: string): FvdpSense | null => {
  const t = part.trim();
  if (t === '') {
    return null;
  }
  const eq = t.indexOf('=');
  if (eq < 0) {
    return {gloss: t, examples: []};
  }
  const gloss = t.slice(0, eq).trim();
  const examples = parseExamples(t.slice(eq));
  if (gloss === '' && examples.length === 0) {
    return null;
  }
  return {gloss, examples};
};

// A `*` (or implicit pos='') section: POS label up to the first sense
// boundary, then the senses. pos='' when the text opens straight into a
// `-`/`=` sense (the leading-marker preamble case).
const parsePosSection = (
  text: string,
): {kind: 'pos'; pos: string; senses: FvdpSense[]} => {
  const t = text.trim();
  const boundary = firstSenseBoundary(t);
  const pos = t.slice(0, boundary).trim();
  const senses: FvdpSense[] = [];
  for (const part of splitSenses(t.slice(boundary))) {
    const sense = parseSense(part);
    if (sense) {
      senses.push(sense);
    }
  }
  return {kind: 'pos', pos, senses};
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

export const parseFvdpEntry = (raw: string): ParsedFvdpEntry => {
  if (!looksLikeFvdp(raw)) {
    return {sections: [], parseFailed: true, raw};
  }
  const sections: FvdpSection[] = [];
  for (const seg of segment(raw)) {
    if (seg.marker === '#') {
      const note = parseNoteSection(seg.text);
      if (note.label !== '' || note.body !== '') {
        sections.push(note);
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
      // only a non-empty sense list keeps it — no `pos !== ''` branch here.
      const sec = parsePosSection(seg.text);
      if (sec.senses.length > 0) {
        sections.push(sec);
      }
    }
  }
  const structured = sections.reduce(
    (n, s) => n + (s.kind === 'pos' ? s.senses.length : 1),
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
  if (section.pos !== '') {
    lines.push(section.pos);
  }
  section.senses.forEach((sense, i) => {
    lines.push(`${i + 1}. ${sense.gloss}`.trim());
    for (const ex of sense.examples) {
      lines.push(ex.translation ? `  ${ex.source} — ${ex.translation}` : `  ${ex.source}`);
    }
  });
  return lines.join('\n');
};
