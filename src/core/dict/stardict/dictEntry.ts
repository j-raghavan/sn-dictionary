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
  // The single ASCII type char that drives the render format: the
  // per-entry prefix byte for an sts-ABSENT entry, or sts[0] when
  // sametypesequence is present (incl. multi-char sts — CASE C — where
  // field-splitting is out of scope but the format still derives from
  // the first char). null only for an empty slice. formatFromTypeChar
  // is the single derivation point.
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
  // type chars the field declares, and the type char IS sts[0] — so an
  // .ifo-level sametypesequence=h dict renders as HTML even with no
  // per-entry prefix and no sidecar override. Multi-char field-splitting
  // (CASE C) is still out of scope: the payload stays the whole slice,
  // but the format derives from sts[0].
  if (sametypesequence !== null && sametypesequence.length > 0) {
    return {payload: raw, typeChar: sametypesequence[0]};
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
