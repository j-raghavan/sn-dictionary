// Regression guard against the v1.0.5-shipped Phase 2a defect: real
// dictzip(1)-produced .dict.dz files segment a single deflate stream
// using Z_FULL_FLUSH between chunks, so individual chunks lack
// BFINAL=1. Without appending a synthetic stored-empty-block end
// marker, pako.inflateRaw silently returns undefined and the popup
// throws "Cannot read property 'length' of undefined" at lookup time.
//
// This test loads the real WordNet base.dict.dz from disk and asserts
// a known word's definition matches expected text. If the dict files
// aren't staged (CI on a fresh checkout, contributor without a
// fetched dict), the test is skipped — its purpose is to backstop
// the synthetic-fixture tests with a real-world round trip.

import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createDictReader} from '../src/core/dict/stardict/dictReader';
import {parseIdx} from '../src/core/dict/stardict/parseIdx';
import {parseIfo} from '../src/core/dict/stardict/parseIfo';
import {decodeUtf8} from '../src/sdk/utf8';

const DICT_DIR = join(__dirname, '..', 'dict', 'wordnet');
const IFO = join(DICT_DIR, 'base.ifo');
const IDX = join(DICT_DIR, 'base.idx');
const DICT = join(DICT_DIR, 'base.dict.dz');

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

describe('dictReader against real WordNet base.dict.dz', () => {
  let allPresent = false;
  beforeAll(async () => {
    allPresent =
      (await exists(IFO)) && (await exists(IDX)) && (await exists(DICT));
  });

  test('inflates and decodes a known headword end-to-end', async () => {
    if (!allPresent) {
      // Skip with a marker — the real dict isn't always available
      // (e.g. fresh clone before `npm run fetch:dict`).
      console.log('skipping: dict/wordnet/ files not staged');
      return;
    }
    const ifoBytes = new Uint8Array(await readFile(IFO));
    const idxBytes = new Uint8Array(await readFile(IDX));
    const dictBytes = new Uint8Array(await readFile(DICT));
    const meta = parseIfo(ifoBytes);
    const entries = await parseIdx(idxBytes, meta.idxoffsetbits);
    const reader = createDictReader(dictBytes);

    // Find a deterministic, well-known headword. WordNet has 'apple'.
    const apple = entries.find(e => e.word === 'apple');
    expect(apple).toBeDefined();
    if (!apple) {
      return; // narrow type for TS
    }
    const slice = reader.slice(apple.offset, apple.length);
    const definition = decodeUtf8(slice);
    // The exact body wording can vary by WordNet release, but the
    // entry must (a) inflate without throwing — the bug we just
    // fixed had pako.inflateRaw return undefined, surfacing as a
    // TypeError before this point — and (b) be non-empty UTF-8 text
    // mentioning "fruit" or "tree" (universal across WordNet revs).
    expect(definition.length).toBeGreaterThan(20);
    expect(definition.toLowerCase()).toMatch(/fruit|tree/);
  });

  test('inflates an entry from a chunk far into the file (cross-chunk regression)', async () => {
    if (!allPresent) {
      return;
    }
    const ifoBytes = new Uint8Array(await readFile(IFO));
    const idxBytes = new Uint8Array(await readFile(IDX));
    const dictBytes = new Uint8Array(await readFile(DICT));
    const meta = parseIfo(ifoBytes);
    const entries = await parseIdx(idxBytes, meta.idxoffsetbits);
    const reader = createDictReader(dictBytes);

    // Pick an entry whose .dict offset lands somewhere far from the
    // start, exercising chunks deep in the file (where inflate state
    // would diverge if the BFINAL sentinel weren't appended).
    const lastEntry = entries[entries.length - 1];
    const slice = reader.slice(lastEntry.offset, lastEntry.length);
    const definition = decodeUtf8(slice);
    expect(definition.length).toBeGreaterThan(0);
  });
});
