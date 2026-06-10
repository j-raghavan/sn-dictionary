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
} from '../src/core/dict/stardict/dictEntry';

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
