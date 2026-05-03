// Orchestrator: takes the StarDict file buffers, parses them, and
// exposes a case-insensitive lookup that returns the raw definition
// text for a word (or null when not found). Stays format-pure: no
// React, no SDK, no I/O — easy to unit-test.
//
// Async build: the index-build pass over the parsed .idx (and the
// optional .syn merge) is the dominant CPU cost on first lookup of
// a large user dict. Awaiting parseIdx/parseSyn lets *those* yield;
// the local merge loops here also yield every YIELD_PERIOD entries
// to keep the JS thread responsive while user dicts warm up.
//
// Random-access dict: the .dict / .dict.dz body is held behind a
// DictReader so dictzip-encoded files can inflate per-lookup chunks
// instead of the whole body up-front. See dictReader.ts.

import type {IfoMeta} from './parseIfo';
import {parseIfo} from './parseIfo';
import type {IdxEntry} from './parseIdx';
import {parseIdx} from './parseIdx';
import {parseSyn} from './parseSyn';
import type {DictReader} from './dictReader';
import {createDictReader} from './dictReader';
import {decodeUtf8} from '../../../sdk/utf8';
import {normalizeKey} from '../normalizeKey';
import {shouldYield, yieldToEventLoop} from '../yieldOften';

export type ParsedDict = {
  meta: IfoMeta;
  // Lowercase word -> the first matching .idx entry. We index
  // case-insensitively so "Hello", "HELLO", and "hello" all hit the
  // same record. Synonyms from .syn (if present) are merged into the
  // same map pointing at their canonical .idx entry. If the source
  // has duplicate-key collisions, the first one wins (deterministic).
  index: Map<string, IdxEntry>;
  dictReader: DictReader;
};

export type DictHit = {
  canonicalWord: string;
  definition: string;
};

export const buildDict = async (
  ifoBytes: Uint8Array,
  idxBytes: Uint8Array,
  dictBytes: Uint8Array,
  // Optional .syn synonym index. Each .syn entry is (synonym word ->
  // index into the .idx entries array); we resolve those to the
  // canonical IdxEntry and merge into the lookup map. Critical for
  // cross-script lookups (e.g. Wiktionary Hindi-English's Latin
  // transliterations live in .syn, not .idx).
  synBytes?: Uint8Array,
): Promise<ParsedDict> => {
  const meta = parseIfo(ifoBytes);
  const entries = await parseIdx(idxBytes, meta.idxoffsetbits);
  const dictReader = createDictReader(dictBytes);
  const index = new Map<string, IdxEntry>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const key = normalizeKey(e.word);
    if (key.length > 0 && !index.has(key)) {
      index.set(key, e);
    }
    if (shouldYield(i)) {
      await yieldToEventLoop();
    }
  }
  if (synBytes && synBytes.length > 0) {
    const synEntries = await parseSyn(synBytes);
    for (let i = 0; i < synEntries.length; i++) {
      const syn = synEntries[i];
      const target = entries[syn.originalWordIndex];
      if (target === undefined) {
        // Out-of-range index — skip silently rather than failing the
        // whole dict. A handful of bad synonym pointers shouldn't
        // dead-end an otherwise-fine dictionary.
        continue;
      }
      const key = normalizeKey(syn.word);
      if (key.length > 0 && !index.has(key)) {
        // Synonym keys point at the SAME canonical .idx entry, so the
        // popup's headerWord (entry.word) shows the original headword,
        // not the synonym alias the user typed.
        index.set(key, target);
      }
      if (shouldYield(i)) {
        await yieldToEventLoop();
      }
    }
  }
  return {meta, index, dictReader};
};

export const lookupDict = (
  dict: ParsedDict,
  word: string,
): DictHit | null => {
  const key = normalizeKey(word);
  if (!key) {
    return null;
  }
  const entry = dict.index.get(key);
  if (!entry) {
    return null;
  }
  const slice = dict.dictReader.slice(entry.offset, entry.length);
  const definition = decodeUtf8(slice);
  return {canonicalWord: entry.word, definition};
};
