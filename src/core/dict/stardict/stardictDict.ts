// Orchestrator: takes the three StarDict file buffers, parses them, and
// exposes a case-insensitive lookup that returns the raw definition
// text for a word (or null when not found). Stays format-pure: no
// React, no SDK, no I/O — easy to unit-test.

import type {IfoMeta} from './parseIfo';
import {parseIfo} from './parseIfo';
import type {IdxEntry} from './parseIdx';
import {parseIdx} from './parseIdx';
import {decompressDict} from './decompressDict';
import {decodeUtf8} from '../../../sdk/utf8';

export type ParsedDict = {
  meta: IfoMeta;
  // Lowercase word -> the first matching .idx entry. We index
  // case-insensitively so "Hello", "HELLO", and "hello" all hit the
  // same record. If the source has duplicate-key collisions across
  // case variants, the first one in .idx order wins (deterministic).
  index: Map<string, IdxEntry>;
  dictBytes: Uint8Array;
};

export type DictHit = {
  canonicalWord: string;
  definition: string;
};

export const buildDict = (
  ifoBytes: Uint8Array,
  idxBytes: Uint8Array,
  dictBytes: Uint8Array,
): ParsedDict => {
  const meta = parseIfo(ifoBytes);
  const entries = parseIdx(idxBytes, meta.idxoffsetbits);
  const decompressed = decompressDict(dictBytes);
  const index = new Map<string, IdxEntry>();
  for (const e of entries) {
    const key = e.word.toLowerCase();
    if (!index.has(key)) {
      index.set(key, e);
    }
  }
  return {meta, index, dictBytes: decompressed};
};

export const lookupDict = (
  dict: ParsedDict,
  word: string,
): DictHit | null => {
  const key = word.trim().toLowerCase();
  if (!key) {
    return null;
  }
  const entry = dict.index.get(key);
  if (!entry) {
    return null;
  }
  const slice = dict.dictBytes.subarray(
    entry.offset,
    entry.offset + entry.length,
  );
  const definition = decodeUtf8(slice);
  return {canonicalWord: entry.word, definition};
};
