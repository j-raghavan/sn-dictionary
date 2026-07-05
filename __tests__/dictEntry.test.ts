// Unit table for the StarDict .dict entry splitter (issue #28). When a
// dict declares sametypesequence, an entry's .dict bytes ARE the raw
// payload. When it does NOT, each entry is `<type-char-byte><payload>`
// optionally followed by a single 0x00 terminator — that prefix/trailer
// is metadata and must be stripped before the body is decoded, else a
// stray 'm'/'h' char and a NUL leak into every definition. The Kotlin
// importer mirrors this helper byte-for-byte (device-only-bug guard).

import {
  splitDictEntry,
  formatFromTypeChar,
  dictBodyOverrun,
  sanitizeDefinition,
} from '../src/core/dict/stardict/dictEntry';
import corpus from './_fixtures/renderParityCorpus.json';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('splitDictEntry', () => {
  test('sametypesequence PRESENT: whole slice is the payload; typeChar IS sts[0]', () => {
    const raw = enc('a fruit');
    const {payload, typeChar} = splitDictEntry('m', raw);
    expect(dec(payload)).toBe('a fruit');
    // typeChar derives from sts[0] (not null), so the format derivation
    // call site honours the .ifo-level type even with no sidecar override.
    expect(typeChar).toBe('m');
  });

  test('sametypesequence PRESENT preserves a leading char that is NOT a type prefix', () => {
    // With sts present there is no per-entry prefix, so a body that
    // happens to start with 'm' must survive intact.
    const raw = enc('marble: a stone');
    const {payload} = splitDictEntry('m', raw);
    expect(dec(payload)).toBe('marble: a stone');
  });

  // CASE A: present, single char sts (the WordNet/base.db path).
  test('CASE A: single-char sts present -> payload == whole slice', () => {
    const raw = enc('definition body');
    expect(dec(splitDictEntry('m', raw).payload)).toBe('definition body');
  });

  // CASE B: absent sts -> strip leading type byte (+ one trailing NUL).
  test('CASE B: sts absent WITH trailing NUL -> strip type byte + one NUL', () => {
    const raw = new Uint8Array([...enc('m'), ...enc('a fruit'), 0x00]);
    const {payload, typeChar} = splitDictEntry(null, raw);
    expect(dec(payload)).toBe('a fruit');
    expect(typeChar).toBe('m');
  });

  test('CASE B: sts absent WITHOUT trailing NUL (last entry) -> strip type byte only', () => {
    const raw = new Uint8Array([...enc('h'), ...enc('<b>x</b>')]);
    const {payload, typeChar} = splitDictEntry(null, raw);
    expect(dec(payload)).toBe('<b>x</b>');
    expect(typeChar).toBe('h');
  });

  test('CASE B: strips EXACTLY ONE trailing NUL, leaving any earlier NUL intact', () => {
    const raw = new Uint8Array([...enc('m'), ...enc('a'), 0x00, 0x00]);
    const {payload} = splitDictEntry(null, raw);
    // One trailing NUL stripped; the inner NUL stays.
    expect(Array.from(payload)).toEqual([...enc('a'), 0x00]);
  });

  test('empty slice -> {empty payload, null typeChar} (no indexing crash)', () => {
    const {payload, typeChar} = splitDictEntry(null, new Uint8Array(0));
    expect(payload.length).toBe(0);
    expect(typeChar).toBeNull();
  });

  test('empty slice with sts present -> {empty payload, null typeChar}', () => {
    const {payload, typeChar} = splitDictEntry('m', new Uint8Array(0));
    expect(payload.length).toBe(0);
    expect(typeChar).toBeNull();
  });

  // CASE C: multi-char sts is out of scope for field-splitting; the
  // whole slice is the payload and the format derives from sts[0]. Must
  // not crash.
  test('CASE C: multi-char sts -> whole slice payload, no crash, typeChar = sts[0]', () => {
    const raw = enc('xy body');
    const {payload, typeChar} = splitDictEntry('mh', raw);
    expect(dec(payload)).toBe('xy body');
    // Field-splitting is out of scope, but the format still derives from
    // the FIRST char of the sequence.
    expect(typeChar).toBe('m');
    expect(formatFromTypeChar(typeChar)).toBe('plain');
  });

  // PR #31 regression guard: an .ifo-level sametypesequence must drive
  // the render format (no per-entry prefix, no sidecar override).
  test("sts present 'h' -> typeChar 'h' -> format html (v1.3.0 HTML behaviour)", () => {
    const raw = enc('<b>bold body</b>');
    const {payload, typeChar} = splitDictEntry('h', raw);
    expect(dec(payload)).toBe('<b>bold body</b>'); // whole slice, unstripped
    expect(typeChar).toBe('h');
    expect(formatFromTypeChar(typeChar)).toBe('html');
  });

  test("sts present 'm' -> typeChar 'm' -> format plain", () => {
    const raw = enc('plain body');
    const {typeChar} = splitDictEntry('m', raw);
    expect(typeChar).toBe('m');
    expect(formatFromTypeChar(typeChar)).toBe('plain');
  });

  test('sts-absent type byte is ASCII (single byte) even before a multibyte body', () => {
    const raw = new Uint8Array([...enc('m'), ...enc('café 咖啡'), 0x00]);
    const {payload, typeChar} = splitDictEntry(null, raw);
    expect(dec(payload)).toBe('café 咖啡');
    expect(typeChar).toBe('m');
  });
});

describe('formatFromTypeChar', () => {
  test("'h' -> html", () => {
    expect(formatFromTypeChar('h')).toBe('html');
  });

  test("'m' -> plain", () => {
    expect(formatFromTypeChar('m')).toBe('plain');
  });

  test('null -> plain', () => {
    expect(formatFromTypeChar(null)).toBe('plain');
  });

  test('any other char -> plain (never wordnet)', () => {
    expect(formatFromTypeChar('g')).toBe('plain');
    expect(formatFromTypeChar('x')).toBe('plain');
  });
});

describe('dictBodyOverrun', () => {
  test('real star_trungviet corpus: .idx overruns the .dict body by 103 bytes', () => {
    // The .idx's furthest (offset+length) reaches 23256270 while the
    // inflated .dict body is 23256167 bytes (both pinned from the corpus).
    expect(
      dictBodyOverrun(corpus.overrun.maxOffsetEnd, corpus.overrun.bodySize),
    ).toBe(103);
  });

  test('no overrun when the .idx fits the body exactly', () => {
    expect(dictBodyOverrun(23256167, 23256167)).toBe(0);
  });

  test('clamps at 0 — an .idx that under-reaches is not "negative overrun"', () => {
    expect(dictBodyOverrun(100, 500)).toBe(0);
  });
});

describe('sanitizeDefinition (real star_trungviet corrupt entries)', () => {
  const {leading, trailing, bothEdge} = corpus.trungvietFffd;

  test('strips a single leading U+FFFD', () => {
    expect(sanitizeDefinition(leading.raw)).toBe(leading.sanitized);
    expect(leading.raw.startsWith('�')).toBe(true);
    expect(leading.sanitized.startsWith('�')).toBe(false);
  });

  test('strips a single trailing U+FFFD but preserves a leading space', () => {
    // The trailing-corrupt entry opens with a real space; only the FFFD
    // edge goes, the space stays.
    expect(sanitizeDefinition(trailing.raw)).toBe(trailing.sanitized);
    expect(trailing.sanitized.startsWith(' ')).toBe(true);
    expect(trailing.sanitized.endsWith('�')).toBe(false);
  });

  test('strips a RUN of U+FFFD at both edges (two leading, one trailing)', () => {
    expect(bothEdge.raw.startsWith('��')).toBe(true);
    expect(sanitizeDefinition(bothEdge.raw)).toBe(bothEdge.sanitized);
    expect(bothEdge.sanitized).not.toMatch(/^�|�$/);
  });

  test('a clean definition is returned unchanged', () => {
    const clean = (corpus.trungvietClean as Record<string, string>)['中国'];
    expect(sanitizeDefinition(clean)).toBe(clean);
  });

  test('preserves INTERIOR U+FFFD (real source corruption, not an edge artefact)', () => {
    // The corpus has no natural interior-only case, so this pins the
    // regex's edge-anchored contract directly: a replacement char between
    // real content must survive — dropping it would silently reflow text.
    expect(sanitizeDefinition('a�b')).toBe('a�b');
    // Edges still strip while the interior one stays.
    expect(sanitizeDefinition('�a�b�')).toBe('a�b');
  });
});
