// Converts the staged OMW / WordNet-LMF source (dict/omw/omw-source.xml,
// staged by scripts/fetchOmw.mjs) into the 4-column TSV that
// scripts/buildBaseDb.mjs + parseOmwTsv consume:
//
//   key <TAB> lang <TAB> rel <TAB> target
//
// Two relation kinds are emitted (THESAURUS_RELATIONS):
//   synonym — co-members of the same synset (every lemma in a synset
//             is a synonym of every other lemma in it).
//   antonym — explicit SenseRelation relType="antonym" links.
//
// WN-LMF shape (English WordNet 2023, OMW format):
//   <Lexicon language="en">
//     <LexicalEntry id="...">
//       <Lemma writtenForm="happy" .../>
//       <Sense id="..." synset="..." >
//         <SenseRelation relType="antonym" target="<senseId>"/>
//       </Sense>
//     </LexicalEntry>
//     <Synset id="..."> ... </Synset>
//   </Lexicon>
//
// Sense -> synset and sense -> lemma maps are built first, then synsets
// are expanded into pairwise synonyms and sense-relations into
// antonyms. This is a build script (not jest-tested, outside src/
// coverage), kept deliberately simple: regex extraction over the XML
// rather than a full DOM dep. `key` is left raw here — parseOmwTsv
// re-folds it with normalizeKey at consume time, so casing is handled
// in exactly one place.

import {readFile, writeFile, stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const OMW_DIR = join(PROJECT_ROOT, 'dict', 'omw');
const SOURCE_XML = join(OMW_DIR, 'omw-source.xml');
const OUT_TSV = join(OMW_DIR, 'omw.tsv');

const log = msg => process.stderr.write(`${msg}\n`);

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : undefined;
};

const main = async () => {
  try {
    await stat(SOURCE_XML);
  } catch {
    throw new Error(
      `Missing OMW source: ${SOURCE_XML}. Run \`npm run fetch:omw\` first.`,
    );
  }

  const xml = await readFile(SOURCE_XML, 'utf-8');
  const lang = attr(xml.match(/<Lexicon\b[^>]*>/)?.[0] ?? '', 'language') ?? 'en';

  // sense id -> lemma writtenForm; synset id -> [lemmas]; sense id -> synset
  const senseToLemma = new Map();
  const synsetToLemmas = new Map();
  const senseToSynset = new Map();
  // antonym pairs as [senseId, targetSenseId]
  const antonymPairs = [];

  const entryRe = /<LexicalEntry\b[^>]*>([\s\S]*?)<\/LexicalEntry>/g;
  let entry;
  while ((entry = entryRe.exec(xml)) !== null) {
    const body = entry[1];
    const lemma = attr(body.match(/<Lemma\b[^>]*>/)?.[0] ?? '', 'writtenForm');
    if (!lemma) {
      continue;
    }
    const senseRe = /<Sense\b([^>]*)>([\s\S]*?)<\/Sense>|<Sense\b([^>]*)\/>/g;
    let sense;
    while ((sense = senseRe.exec(body)) !== null) {
      const openAttrs = sense[1] ?? sense[3] ?? '';
      const senseId = attr(openAttrs, 'id');
      const synset = attr(openAttrs, 'synset');
      if (!senseId) {
        continue;
      }
      senseToLemma.set(senseId, lemma);
      if (synset) {
        senseToSynset.set(senseId, synset);
        const arr = synsetToLemmas.get(synset) ?? [];
        arr.push(lemma);
        synsetToLemmas.set(synset, arr);
      }
      const inner = sense[2] ?? '';
      const relRe = /<SenseRelation\b[^>]*>/g;
      let rel;
      while ((rel = relRe.exec(inner)) !== null) {
        if (attr(rel[0], 'relType') === 'antonym') {
          const target = attr(rel[0], 'target');
          if (target) {
            antonymPairs.push([senseId, target]);
          }
        }
      }
    }
  }

  const lines = [];

  // Synonyms: every ordered pair of distinct lemmas within a synset,
  // but BOUNDED so the TSV (and the baked base.db) stay small. The
  // unbounded pairwise expansion produces ~0.6-1.5M rows / 15-30MB;
  // capping per key + deduping pairs keeps it single-digit MB. The popup
  // shows a handful of synonyms — 10 per key is plenty.
  const SYNONYM_CAP = 10;
  const synCount = new Map(); // key (lemma a) -> synonyms emitted so far
  const emittedPairs = new Set(); // "a\tb" so duplicates across synsets don't double-count
  let synonymRows = 0;
  const distinctKeys = new Set();
  for (const lemmas of synsetToLemmas.values()) {
    for (const a of lemmas) {
      for (const b of lemmas) {
        if (a === b) {
          continue;
        }
        const pair = `${a}\t${b}`;
        if (emittedPairs.has(pair)) {
          continue;
        }
        const have = synCount.get(a) ?? 0;
        if (have >= SYNONYM_CAP) {
          continue;
        }
        emittedPairs.add(pair);
        synCount.set(a, have + 1);
        distinctKeys.add(a);
        lines.push(`${a}\t${lang}\tsynonym\t${b}`);
        synonymRows++;
      }
    }
  }

  // Antonyms: resolve sense ids back to lemmas. UNCAPPED — they're tiny
  // (a few thousand) and semantically load-bearing.
  let antonymRows = 0;
  for (const [fromSense, toSense] of antonymPairs) {
    const from = senseToLemma.get(fromSense);
    const to = senseToLemma.get(toSense);
    if (from && to) {
      lines.push(`${from}\t${lang}\tantonym\t${to}`);
      antonymRows++;
      distinctKeys.add(from);
    }
  }

  const out = lines.join('\n') + '\n';
  await writeFile(OUT_TSV, out, 'utf-8');
  log(
    `[build:omw] wrote ${OUT_TSV} (lang=${lang}): ` +
      `${synonymRows} synonym rows (cap ${SYNONYM_CAP}/key), ` +
      `${antonymRows} antonym rows, ${distinctKeys.size} distinct keys, ` +
      `${Buffer.byteLength(out, 'utf-8')} bytes`,
  );
};

main().catch(err => {
  log(err?.message ?? String(err));
  process.exit(1);
});
