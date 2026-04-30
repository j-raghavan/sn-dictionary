// Builds the StarDict triple for sample/demo dictionaries shipped at
// assets/sample-dicts/<name>/. Run with `npm run build:sample-dicts`.
// Outputs are committed to the repo so users can copy a sample
// dictionary onto their device without first running our build.
//
// Format: idxoffsetbits=32, sametypesequence=m, .dict gzipped to .dict.dz.
// Mirrors the writer logic in src/core/dict/stardict/writeStardict.ts —
// kept self-contained here so this script doesn't need a TS toolchain.

import {writeFile, mkdir, readdir, readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const SAMPLES_DIR = join(PROJECT_ROOT, 'assets', 'sample-dicts');

const writeU32BE = (target, value) => {
  target.push(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
};

const buildStardict = (entries, bookname) => {
  const sortedWords = Object.keys(entries).sort();
  const idxBuilder = [];
  const dictParts = [];
  let offset = 0;
  for (const word of sortedWords) {
    const defBytes = Buffer.from(entries[word], 'utf-8');
    const wordBytes = Buffer.from(word, 'utf-8');
    for (const b of wordBytes) {
      idxBuilder.push(b);
    }
    idxBuilder.push(0);
    writeU32BE(idxBuilder, offset);
    writeU32BE(idxBuilder, defBytes.length);
    dictParts.push(defBytes);
    offset += defBytes.length;
  }
  const rawDict = Buffer.concat(dictParts);
  const dict = gzipSync(rawDict);
  const idx = Buffer.from(idxBuilder);
  const ifoText =
    "StarDict's dict ifo file\n" +
    'version=2.4.2\n' +
    `bookname=${bookname}\n` +
    `wordcount=${sortedWords.length}\n` +
    `idxfilesize=${idx.length}\n` +
    'idxoffsetbits=32\n' +
    'sametypesequence=m\n';
  return {
    ifo: Buffer.from(ifoText, 'utf-8'),
    idx,
    dict,
  };
};

const writeSampleFolder = async (folderName, entries, bookname) => {
  const dir = join(SAMPLES_DIR, folderName);
  await mkdir(dir, {recursive: true});
  const {ifo, idx, dict} = buildStardict(entries, bookname);
  const baseName = folderName;
  await writeFile(join(dir, `${baseName}.ifo`), ifo);
  await writeFile(join(dir, `${baseName}.idx`), idx);
  await writeFile(join(dir, `${baseName}.dict.dz`), dict);
  await writeFile(
    join(dir, 'meta.json'),
    JSON.stringify({name: bookname}, null, 2) + '\n',
  );
  console.log(
    `wrote ${folderName}: ${Object.keys(entries).length} entries (${ifo.length}+${idx.length}+${dict.length} bytes)`,
  );
};

// Sample 1: tech jargon. Hand-curated terms a Supernote user is
// plausibly looking up while reading technical PDFs / taking notes.
// Distinct from WordNet — these are domain-specific phrases plus
// abbreviations that WordNet either lacks or covers in a different
// register.
const techJargon = {
  // Programming / software
  API: 'Application Programming Interface — a contract describing how one program component talks to another.',
  CRUD: 'Create, Read, Update, Delete — the four basic persistent-storage operations.',
  REST: 'Representational State Transfer — an HTTP-based architectural style for stateless client-server APIs.',
  GraphQL: 'A query language and runtime for APIs that lets clients request exactly the data shape they need.',
  WebSocket: 'A full-duplex protocol over a single TCP connection, used for low-latency bidirectional messaging.',
  webhook: 'An HTTP callback fired by a service when an event occurs, delivered to a URL the consumer registered.',
  idempotent: 'A request that can safely be retried — repeated calls produce the same effect as a single call.',
  monorepo: 'A single version-controlled repository housing multiple related projects or packages.',
  microservice: 'An independently-deployable service that owns one bounded slice of a system\'s functionality.',
  pagination: 'Splitting a result set into discrete pages, typically with a cursor or offset parameter.',
  // Data / ML
  embedding: 'A dense vector representation of a discrete item (word, image, user) in a learned feature space.',
  tokenizer: 'A component that splits a string into the discrete units (tokens) a model consumes.',
  inference: 'The forward pass of a trained model — taking inputs and producing outputs at deploy time.',
  finetune: 'To continue training a pretrained model on a smaller, domain-specific dataset.',
  RAG: 'Retrieval-Augmented Generation — answering with an LLM grounded in retrieved documents rather than parametric memory alone.',
  // Devops / infra
  observability: 'The discipline of making a system\'s internal state inferable from its external outputs (logs, metrics, traces).',
  // Networking
  CDN: 'Content Delivery Network — a geographically distributed cache that serves assets from a node near the user.',
  TTL: 'Time To Live — a duration after which a cached item is considered stale and discarded.',
  // E-ink / hardware
  digitizer: 'The hardware layer that converts pen-on-screen contact into digital coordinates.',
  EPD: 'Electrophoretic Paper Display — the e-ink panel technology used by readers like the Supernote.',
  ghosting: 'Faint residual imagery from a previous frame visible after a partial e-ink refresh.',
  // Stack / abstractions
  middleware: 'Code that runs in the request/response pipeline between the network layer and the application handler.',
  shim: 'A small adapter layer that intercepts an API call and reshapes it for an underlying implementation.',
  polyfill: 'Code that implements a newer language or platform feature on an older runtime that lacks it.',
  // Process
  postmortem: 'A blameless written analysis of an incident, focused on root cause and prevention rather than blame.',
  YAGNI: 'You Aren\'t Gonna Need It — a heuristic against speculative features.',
  bikeshedding: 'Disproportionate attention to a trivial detail relative to its importance.',
  yakshave: 'A chain of dependent tasks one must complete before getting back to the original goal.',
};

await writeSampleFolder('sn-tech-jargon', techJargon, 'Tech Jargon');

// Discoverability: emit an index README at assets/sample-dicts/ so a
// user browsing the repo knows what each subfolder contains.
const subdirs = (await readdir(SAMPLES_DIR, {withFileTypes: true}))
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();
const indexLines = ['# Sample dictionaries', ''];
for (const sub of subdirs) {
  const metaPath = join(SAMPLES_DIR, sub, 'meta.json');
  let display = sub;
  try {
    const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
    if (typeof meta.name === 'string' && meta.name.length > 0) {
      display = meta.name;
    }
  } catch {
    /* ignore */
  }
  indexLines.push(`- **${sub}/** — ${display}`);
}
indexLines.push('');
indexLines.push(
  'Drop any of these folders into `MyStyle/SnDict/` on your Supernote and the plugin will discover it on next launch.',
);
indexLines.push('');
await writeFile(join(SAMPLES_DIR, 'README.md'), indexLines.join('\n'));
console.log(`wrote ${join(SAMPLES_DIR, 'README.md')}`);
