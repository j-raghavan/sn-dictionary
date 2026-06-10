// StarDict .dict entry splitter (issue #28). Shared by the host reader
// (stardictDict.lookupDict) and the host base.db builder
// (buildBaseDb.entriesFromParsedDict); the Kotlin StarDictImporter
// mirrors this helper byte-for-byte so device imports stay
// byte-identical (the device-only-bug guard).
//
// StarDict stores an entry's body two ways:
//   - sametypesequence PRESENT: every entry uses that single type
//     sequence, so the .dict bytes for an entry ARE the raw payload —
//     no per-entry type prefix, no terminator. (WordNet/base.db: 'm'.)
//   - sametypesequence ABSENT: each entry is `<type-char-byte><payload>`
//     and, when it is NOT the last entry, a single 0x00 terminator.
//     That leading ASCII type byte and the trailing NUL are METADATA —
//     leaving them in leaks a stray 'm'/'h' char and a control byte into
//     every definition (the issue-#28 bug).
//
// We strip on the raw BYTES, before UTF-8 decode, so a multibyte body
// is never mis-sliced. The type char is a single ASCII byte by spec.

import type {DefinitionFormat} from '../../lookup';

export type SplitDictEntry = {
  // The body bytes, with any sts-absent type prefix and one trailing
  // 0x00 removed. Decode this (UTF-8) to get the definition string.
  payload: Uint8Array;
  // The single ASCII type char read from an sts-ABSENT entry (e.g. 'm',
  // 'h'), or null when sts is present, the slice is empty, or sts is
  // multi-char (field-splitting is out of scope — see CASE C).
  typeChar: string | null;
};

export const splitDictEntry = (
  sametypesequence: string | null,
  raw: Uint8Array,
): SplitDictEntry => {
  // Empty slice: nothing to strip or read. Guard before any indexing so
  // a zero-length .dict record can't crash on raw[0].
  if (raw.length === 0) {
    return {payload: raw, typeChar: null};
  }
  // sts PRESENT: the whole slice is the payload regardless of how many
  // type chars the field declares. Multi-char field-splitting is out of
  // scope (CASE C) — we still return the whole slice and never derive a
  // typeChar from it (format comes from sts[0] at the call site).
  if (sametypesequence !== null && sametypesequence.length > 0) {
    return {payload: raw, typeChar: null};
  }
  // sts ABSENT: first byte is the ASCII type char; the rest is the body,
  // minus exactly one trailing 0x00 when present (the inter-entry
  // terminator — the last entry has none).
  const typeChar = String.fromCharCode(raw[0]);
  let end = raw.length;
  if (raw[end - 1] === 0x00) {
    end -= 1;
  }
  return {payload: raw.subarray(1, end), typeChar};
};

// Map a StarDict type char to the popup's render format. 'h' is HTML;
// everything else (incl. 'm' and null) is plain. NEVER 'wordnet' — that
// is reserved for the bundled base build, which sets it explicitly.
export const formatFromTypeChar = (
  typeChar: string | null,
): DefinitionFormat => (typeChar === 'h' ? 'html' : 'plain');
