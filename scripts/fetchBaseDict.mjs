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
// Extraction shells out to `tar -xjf`. macOS/Linux always ship a tar
// with bzip2 support; Windows 10 1803+ (April 2018) ships a libarchive-
// based tar.exe that also supports bzip2, so this works on every host
// the project targets.
//
// License note: this StarDict pack repackages Princeton WordNet 2.x,
// which is distributed under the WordNet license (BSD-style, free for
// any use including redistribution). See:
//   https://wordnet.princeton.edu/license-and-commercial-use

import {mkdir, rm, rename, stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DICT_DIR = join(PROJECT_ROOT, 'dict', 'wordnet');
const URL =
  'http://download.huzheng.org/dict.org/stardict-dictd_www.dict.org_wn-2.4.2.tar.bz2';
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

const runTar = (cwd, archive) =>
  new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xjf', archive], {cwd, stdio: 'inherit'});
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
  });

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

  writeColor('Extracting ...', 'Blue');
  await runTar(DICT_DIR, ARCHIVE_NAME);

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
