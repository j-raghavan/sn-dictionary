// Fetches the Open Multilingual Wordnet (OMW) source distribution into
// dict/omw/ for the thesaurus build (TF4-FR1 data path). Node-only and
// cross-platform, mirroring scripts/fetchBaseDict.mjs (idempotent
// skip, pinned SHA-256 integrity check, tar extraction).
//
// OMW packages WordNet synonym/antonym relations across many
// languages. The English source is Princeton WordNet itself; the
// multilingual layers are contributed wordnets under their own
// per-language licenses (see README "Bundled dictionary content").
//
// This stages the raw OMW archive; scripts/buildOmw.mjs converts it
// into the 4-column dict/omw/omw.tsv (key, lang, rel, target) that
// scripts/buildBaseDb.mjs + parseOmwTsv consume.
//
// To rotate the archive: download once, run `shasum -a 256`, update
// URL + EXPECTED_SHA256.

import {mkdir, rm, stat, readFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const OMW_DIR = join(PROJECT_ROOT, 'dict', 'omw');

// OMW 1.4 English-Wordnet relations distribution. HTTPS, so the SHA is
// a defence-in-depth integrity pin (set once the archive is staged for
// a release; left as a placeholder marker until then).
const URL =
  process.env.SNDICT_OMW_URL ??
  'https://en-word.net/static/english-wordnet-2023.xml.gz';
const EXPECTED_SHA256 = process.env.SNDICT_OMW_SHA256 ?? '';
const ARCHIVE_NAME = 'omw-source.xml.gz';
const STAGED_SOURCE = join(OMW_DIR, ARCHIVE_NAME);

const log = msg => process.stderr.write(`${msg}\n`);

const exists = async path => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const download = async (url, dest) => {
  const res = await fetch(url, {redirect: 'follow'});
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
};

const verifyDigest = async (path, expected) => {
  if (expected === '') {
    log(
      'WARNING: no EXPECTED_SHA256 pinned for the OMW archive — skipping ' +
        'integrity check. Set SNDICT_OMW_SHA256 before a release build.',
    );
    return;
  }
  const bytes = await readFile(path);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `OMW archive integrity check failed at ${path}\n` +
        `  expected sha256: ${expected}\n` +
        `  actual sha256:   ${actual}`,
    );
  }
};

const gunzip = (src, dest) =>
  new Promise((resolve, reject) => {
    // -c writes to stdout; -k keeps the source. Redirect via a stream.
    const out = createWriteStream(dest);
    const child = spawn('gunzip', ['-c', src]);
    child.stdout.pipe(out);
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`gunzip exited with code ${code}`));
    });
  });

const main = async () => {
  const sourceXml = join(OMW_DIR, 'omw-source.xml');
  if (await exists(sourceXml)) {
    log(`OMW source already present at ${sourceXml} — skipping download`);
    return;
  }

  await mkdir(OMW_DIR, {recursive: true});

  log(`Downloading OMW source from ${URL} ...`);
  await download(URL, STAGED_SOURCE);

  log('Verifying SHA-256 against pinned digest ...');
  await verifyDigest(STAGED_SOURCE, EXPECTED_SHA256);

  log('Decompressing ...');
  await gunzip(STAGED_SOURCE, sourceXml);
  await rm(STAGED_SOURCE, {force: true});

  log(`Staged OMW source at ${sourceXml}. Run \`npm run build:omw\` next.`);
};

main().catch(err => {
  log(err?.message ?? String(err));
  process.exit(1);
});
