// End-to-end integration test wiring the real production modules
// together over an in-memory filesystem and a react-test-renderer
// popup. Catches the class of bug that unit tests miss — gaps
// between layers, not gaps inside layers.
//
// Examples this test file would have caught:
//   - The v1.0.2 ".syn was being ignored" bug. Unit tests for parsers
//     and the registry both passed; the missing wire was invisible
//     until a real dict loaded on a real device.
//   - The "in-flight mutation race" the reviewer caught pre-merge.
//     Reproducible here without a real plugin host.

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  Pressable: 'Pressable',
  StyleSheet: {create: (s: unknown) => s},
}));

jest.mock('sn-plugin-lib', () => ({
  PluginManager: {closePluginView: jest.fn(() => Promise.resolve(true))},
}));

import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import DefinitionPopup from '../src/ui/DefinitionPopup';
import {
  showDefinition,
  __testing__,
} from '../src/ui/popupController';
import {createMultiDictLookup} from '../src/core/dict/multiDictLookup';
import {createStardictLookup} from '../src/core/dict/stardictLookup';
import {createCsvDictSource} from '../src/core/dict/csvDictSource';
import {discoverUserDicts} from '../src/core/dict/userDictDiscovery';
import type {DictSource} from '../src/core/lookup';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';
import {enc, makeVfs, u8ToArrayBuffer} from './_helpers/inMemoryVfs';

const ROOT = '/storage/emulated/0/MyStyle/SnDict';

const renderPopup = (): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<DefinitionPopup />);
  });
  return tree;
};

const collectText = (tree: ReactTestRenderer): string => {
  const acc: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      acc.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object' && 'children' in node) {
      visit((node as {children: unknown}).children);
    }
  };
  visit(tree.toJSON());
  return acc.join(' | ');
};

const stardictBuffers = (entries: Record<string, string>) => {
  const triple = buildSyntheticStarDict(entries, {gzipDict: true});
  return {
    ifo: u8ToArrayBuffer(triple.ifo),
    idx: u8ToArrayBuffer(triple.idx),
    dict: u8ToArrayBuffer(triple.dict),
  };
};

beforeEach(() => {
  __testing__.reset();
});

describe('end-to-end (discovery → registry → popup)', () => {
  test('user-dropped CSV becomes a popup section after lookup', async () => {
    const vfs = makeVfs({
      [`${ROOT}/medical/words.csv`]: enc('apple,a fruit\n'),
    });
    // 1. Real discovery against the VFS.
    const userDicts = await discoverUserDicts({
      fileUtils: vfs.fileUtils,
      fetchFn: vfs.fetchFn,
      rootPath: ROOT,
    });
    // 2. Real registry composition.
    const lookup = createMultiDictLookup(userDicts);
    // 3. Real popup mounting.
    const tree = renderPopup();
    // 4. Real lookup → controller emit → popup render.
    const result = await lookup.lookup('apple');
    act(() => {
      showDefinition(result);
    });
    // 5. Popup tree contains the definition.
    const text = collectText(tree);
    expect(text).toContain('apple');
    expect(text).toContain('a fruit');
  });

  test('multi-source rendering: both dicts hit, popup shows both sections with badges', async () => {
    const baseTriple = stardictBuffers({apple: 'a fruit (base)'});
    const vfs = makeVfs({
      [`${ROOT}/custom/data.csv`]: enc('apple,a fruit (custom)\n'),
    });
    const userDicts = await discoverUserDicts({
      fileUtils: vfs.fileUtils,
      fetchFn: vfs.fetchFn,
      rootPath: ROOT,
    });
    const baseSource: DictSource = createStardictLookup({
      name: 'WordNet',
      loadBase: async () => ({
        ifo: new Uint8Array(baseTriple.ifo),
        idx: new Uint8Array(baseTriple.idx),
        dict: new Uint8Array(baseTriple.dict),
      }),
    });
    const lookup = createMultiDictLookup([...userDicts, baseSource]);
    const tree = renderPopup();
    const result = await lookup.lookup('apple');
    act(() => {
      showDefinition(result);
    });
    const text = collectText(tree);
    // Both definitions render.
    expect(text).toContain('a fruit (custom)');
    expect(text).toContain('a fruit (base)');
    // Source badges appear because there are ≥2 hits.
    expect(text).toContain('custom');
    expect(text).toContain('WordNet');
  });

  test('not-found: lookup misses every source; popup shows the not-found message', async () => {
    const userDicts = [
      createCsvDictSource({
        name: 'A',
        loadBytes: async () => enc('apple,fruit\n'),
      }),
    ];
    const lookup = createMultiDictLookup(userDicts);
    const tree = renderPopup();
    const result = await lookup.lookup('xyzzy');
    act(() => {
      showDefinition(result);
    });
    expect(collectText(tree)).toMatch(/no definition found/i);
  });

  test('StarDict with .syn: latin transliteration resolves to native-script entry', async () => {
    // Builds the same kind of cross-script lookup as the real
    // Wiktionary Hindi-English dict (Devanagari headwords + Latin
    // transliteration synonyms). Verifies the .syn fix end-to-end.
    const triple = buildSyntheticStarDict({
      'नमस्ते': 'a Hindi greeting',
    });
    // Hand-build a .syn pointing 'namaste' at idx[0] (the only entry).
    const synBytes = new Uint8Array([
      0x6e, 0x61, 0x6d, 0x61, 0x73, 0x74, 0x65, // 'namaste'
      0,
      0, 0, 0, 0, // index 0, big-endian u32
    ]);
    const vfs = makeVfs({
      [`${ROOT}/hindi/dict.ifo`]: u8ToArrayBuffer(triple.ifo),
      [`${ROOT}/hindi/dict.idx`]: u8ToArrayBuffer(triple.idx),
      [`${ROOT}/hindi/dict.dict.dz`]: u8ToArrayBuffer(triple.dict),
      [`${ROOT}/hindi/dict.syn`]: u8ToArrayBuffer(synBytes),
    });
    const userDicts = await discoverUserDicts({
      fileUtils: vfs.fileUtils,
      fetchFn: vfs.fetchFn,
      rootPath: ROOT,
    });
    const lookup = createMultiDictLookup(userDicts);
    const tree = renderPopup();
    const result = await lookup.lookup('namaste');
    act(() => {
      showDefinition(result);
    });
    const text = collectText(tree);
    // The popup header renders the canonical Devanagari word, not
    // the latin synonym alias.
    expect(text).toContain('नमस्ते');
    // And the definition body of the canonical entry.
    expect(text).toContain('a Hindi greeting');
  });

  test('HTML-formatted StarDict: tags are stripped end-to-end', async () => {
    // Mimics a Wiktionary-derived StarDict whose .ifo declares
    // sametypesequence=h. Discovery -> source picks format='html' ->
    // popup runs htmlToPlainText. No tags should leak.
    const triple = buildSyntheticStarDict(
      {hello: '<i>intj</i><br><ol><li>greeting</li></ol>'},
      {sametypesequence: 'h'},
    );
    const vfs = makeVfs({
      [`${ROOT}/wikt/d.ifo`]: u8ToArrayBuffer(triple.ifo),
      [`${ROOT}/wikt/d.idx`]: u8ToArrayBuffer(triple.idx),
      [`${ROOT}/wikt/d.dict`]: u8ToArrayBuffer(triple.dict),
    });
    const userDicts = await discoverUserDicts({
      fileUtils: vfs.fileUtils,
      fetchFn: vfs.fetchFn,
      rootPath: ROOT,
    });
    const lookup = createMultiDictLookup(userDicts);
    const tree = renderPopup();
    const result = await lookup.lookup('hello');
    act(() => {
      showDefinition(result);
    });
    const text = collectText(tree);
    expect(text).not.toMatch(/<\/?[a-z]/i);
    expect(text).toContain('intj');
    expect(text).toContain('• greeting');
  });

  test('mid-flight discovery prepend does not break in-flight lookups (regression)', async () => {
    // Models the index.js startup wiring: a shared sources array
    // that gets mutated when discovery completes. Verifies the
    // in-flight lookup snapshot semantics that the reviewer caught
    // pre-merge of v1.0.2.
    const vfs = makeVfs({
      [`${ROOT}/extra/words.csv`]: enc('apple,fruit (extra)\n'),
    });
    // Slow base source so the in-flight lookup is still going when
    // we mutate.
    const slowBase: DictSource = {
      name: 'Base',
      lookup: jest.fn(
        () =>
          new Promise(resolve =>
            setTimeout(
              () => resolve({word: 'apple', definition: 'fruit (base)', format: 'plain'}),
              25,
            ),
          ),
      ),
    };
    const sources: DictSource[] = [slowBase];
    const lookup = createMultiDictLookup(sources);

    // Kick off the lookup before discovery completes...
    const inFlight = lookup.lookup('apple');
    // ...then prepend the discovered user dict, the way index.js does.
    const userDicts = await discoverUserDicts({
      fileUtils: vfs.fileUtils,
      fetchFn: vfs.fetchFn,
      rootPath: ROOT,
    });
    sources.unshift(...userDicts);

    const result = await inFlight;
    // The in-flight lookup must observe ONLY the sources present
    // at its start (the slow base). No undefined entries leak.
    expect(result.hits).toEqual([
      {source: 'Base', entry: {word: 'apple', definition: 'fruit (base)', format: 'plain'}},
    ]);
    for (const hit of result.hits) {
      expect(hit.entry).toBeDefined();
      expect(typeof hit.entry.definition).toBe('string');
    }

    // The next lookup picks up the prepended user dict.
    const next = await lookup.lookup('apple');
    expect(next.hits.length).toBe(2);
    expect(next.hits[0].source).toBe('extra');
  });
});
