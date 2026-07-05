// Cross-platform replacement for the previous bash-based
// scripts/fetchBaseDict.sh. Node-only so Windows contributors (who do
// not have bash on PATH by default) can run `npm run prepare:dict`
// without WSL or Git Bash.
//
// Fetches the base StarDict bundle (Princeton WordNet, ~10MB tar.bz2)
// from the dict.org community mirror and stages the three files under
// dict/wordnet/{base.ifo, base.idx, base.dict.dz}. Idempotent — skips
// the download if all three target files already exist.
//
// Extraction is done IN-PROCESS (unbzip2-stream -> node-tar), not by
// shelling out to the platform's `tar`. The system tar was a portability
// hazard: the Windows runner image's bundled tar.exe hangs extracting
// bzip2 in CI, and a spawned tar with an inherited stdio can block. A
// pure-Node pipe extracts identically on every host with no external
// binary and no TTY coupling.
//
// License note: this StarDict pack repackages Princeton WordNet 2.x,
// which is distributed under the WordNet license (BSD-style, free for
// any use including redistribution). See:
//   https://wordnet.princeton.edu/license-and-commercial-use

import {mkdir, rm, rename, stat, readFile} from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import bz2 from 'unbzip2-stream';
import {extract as tarExtract} from 'tar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DICT_DIR = join(PROJECT_ROOT, 'dict', 'wordnet');
// dict.org community mirror does not serve HTTPS, so the integrity
// guarantee is the pinned SHA-256 below (verified before extraction).
// To rotate the archive: download once, run `shasum -a 256` on it,
// and update both URL and EXPECTED_SHA256.
const URL =
  'http://download.huzheng.org/dict.org/stardict-dictd_www.dict.org_wn-2.4.2.tar.bz2';
const EXPECTED_SHA256 =
  '27dfc985076b4b70706bfc50172f2645bb8371f61ad6fc3c08ed093ef2bdb2ef';
const ARCHIVE_NAME = 'stardict-wordnet.tar.bz2';
const EXPECTED_SUBDIR = 'stardict-dictd_www.dict.org_wn-2.4.2';

const COLORS = {
  Red: '\x1b[31m',
  Green: '\x1b[32m',
  Yellow: '\x1b[33m',
  Blue: '\x1b[34m',
};
const RESET = '\x1b[0m';

const writeColor = (message, color) => {
  const code = COLORS[color];
  if (code) {
    process.stderr.write(`${code}${message}${RESET}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
};

const exists = async (path) => {
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
  const bytes = await readFile(path);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `Archive integrity check failed at ${path}\n` +
        `  expected sha256: ${expected}\n` +
        `  actual sha256:   ${actual}\n` +
        'Aborting to avoid extracting an untrusted bundle.',
    );
  }
};

// Decompress the .tar.bz2 and unpack it under `cwd`, entirely in-process:
// read stream -> bzip2 decompressor -> tar extractor. pipeline() rejects
// on any stage error and resolves only once every entry is written.
const extractTarBz2 = (cwd, archive) =>
  pipeline(createReadStream(join(cwd, archive)), bz2(), tarExtract({cwd}));

const main = async () => {
  const ifoPath = join(DICT_DIR, 'base.ifo');
  const idxPath = join(DICT_DIR, 'base.idx');
  const dictPath = join(DICT_DIR, 'base.dict.dz');

  if ((await exists(ifoPath)) && (await exists(idxPath)) && (await exists(dictPath))) {
    writeColor(
      `WordNet StarDict already present at ${DICT_DIR} — skipping download`,
      'Yellow',
    );
    return;
  }

  await mkdir(DICT_DIR, {recursive: true});

  const archivePath = join(DICT_DIR, ARCHIVE_NAME);
  writeColor(`Downloading WordNet StarDict from ${URL} ...`, 'Blue');
  await download(URL, archivePath);

  writeColor(`Verifying SHA-256 against pinned digest ...`, 'Blue');
  await verifyDigest(archivePath, EXPECTED_SHA256);

  writeColor('Extracting ...', 'Blue');
  await extractTarBz2(DICT_DIR, ARCHIVE_NAME);

  // Normalise file names so the build script doesn't depend on the
  // archive's internal naming convention.
  const stagingDir = join(DICT_DIR, EXPECTED_SUBDIR);
  await rename(join(stagingDir, 'dictd_www.dict.org_wn.ifo'), ifoPath);
  await rename(join(stagingDir, 'dictd_www.dict.org_wn.idx'), idxPath);
  await rename(join(stagingDir, 'dictd_www.dict.org_wn.dict.dz'), dictPath);

  // Tidy up the staging dir + archive.
  await rm(stagingDir, {recursive: true, force: true});
  await rm(archivePath, {force: true});

  writeColor(
    `Staged: base.ifo / base.idx / base.dict.dz at ${DICT_DIR}`,
    'Green',
  );
};

main().catch((err) => {
  writeColor(err?.message ?? String(err), 'Red');
  process.exit(1);
});
