// Stages the public-domain Moby English Thesaurus StarDict triple into
// dict/moby/ for the thesaurus build (issue #26). Node-only and
// cross-platform, mirroring scripts/fetchOmw.mjs (idempotent skip,
// optional pinned SHA-256 integrity check).
//
// Moby Thesaurus (Grady Ward) is PUBLIC DOMAIN; this StarDict packaging
// is tabo's "English Thesaurus" (Hu Zheng / huzheng.org mirror). The
// staged triple is thesaurus-ee.{ifo,idx,dict} — a plain (uncompressed)
// .dict, sametypesequence=m. scripts/buildBaseDb.mjs reads it via the
// reused StarDict parsers + buildMobyRows and folds the synonyms into
// base.db's `thesaurus` table alongside OMW.
//
// Source resolution (in order):
//   1. SNDICT_MOBY_URL (or the pinned huzheng.org URL) — a StarDict
//      .tar.bz2; verified against SNDICT_MOBY_SHA256 when pinned.
//   2. Fallback: the local spec/Saurus-stardict.zip ("Saurus Stardict/
//      thesaurus-ee.*") — used when the remote is unreachable / offline.
//      `spec/` is gitignored, so this path is a developer convenience.
//
// dict/moby/ is gitignored (regenerable). Run `npm run build:base-db`
// next; the build warn-skips Moby if dict/moby/ is absent.

import {mkdir, rm, stat, readFile, writeFile, copyFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const gunzipAsync = promisify(gunzip);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const MOBY_DIR = join(PROJECT_ROOT, 'dict', 'moby');
const SPEC_ZIP = join(PROJECT_ROOT, 'spec', 'Saurus-stardict.zip');

// The three staged StarDict files (StarDict basename `thesaurus-ee`).
const BASENAME = 'thesaurus-ee';
const PARTS = ['ifo', 'idx', 'dict'];
const targetPath = ext => join(MOBY_DIR, `${BASENAME}.${ext}`);

// Pinned mirror of tabo's "English Thesaurus" (Moby; public domain). The
// original download.huzheng.org host went permanently offline (~Nov 2023);
// stardict.uber.space serves the byte-identical tarball. The Internet
// Archive Wayback Machine is the durable fallback (override SNDICT_MOBY_URL):
//   https://web.archive.org/web/2id_/http://download.huzheng.org/dict.org/stardict-thesaurus-ee-2.4.2.tar.bz2
// The pinned SHA-256 guarantees integrity regardless of mirror, so a moved
// mirror is a one-line SNDICT_MOBY_URL override, not a re-pin. The tarball
// ships thesaurus-ee.{ifo,idx,dict.dz}; the .dict.dz is decompressed to a
// plain thesaurus-ee.dict on stage (so dict/moby/ matches the local-zip
// layout the build reads).
const DEFAULT_URL =
  'https://stardict.uber.space/dict.org/stardict-thesaurus-ee-2.4.2.tar.bz2';
const DEFAULT_SHA256 =
  '91f0b221d16a7fb67befddae6487f08d7b76dfe0342a4e6b01677167115ee135';
const URL = process.env.SNDICT_MOBY_URL ?? DEFAULT_URL;
const EXPECTED_SHA256 = process.env.SNDICT_MOBY_SHA256 ?? DEFAULT_SHA256;

const log = msg => process.stderr.write(`${msg}\n`);

const exists = async path => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const allStaged = async () => {
  for (const ext of PARTS) {
    if (!(await exists(targetPath(ext)))) {
      return false;
    }
  }
  return true;
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
      'WARNING: no EXPECTED_SHA256 pinned for the Moby archive — skipping ' +
        'integrity check. Set SNDICT_MOBY_SHA256 before a release build.',
    );
    return;
  }
  const bytes = await readFile(path);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `Moby archive integrity check failed at ${path}\n` +
        `  expected sha256: ${expected}\n` +
        `  actual sha256:   ${actual}`,
    );
  }
};

// Run an extractor (tar / unzip) writing into `cwd`. Rejects on a
// non-zero exit so a corrupt archive fails the stage rather than
// silently leaving dict/moby/ half-populated.
const run = (cmd, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {cwd, stdio: ['ignore', 'ignore', 'inherit']});
    child.on('error', reject);
    child.on('close', code =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });

// Decompress a dictzip .dict.dz into a plain .dict. dictzip is a gzip
// member with a random-access FEXTRA subfield that zlib transparently
// skips, so a full gunzip yields the byte-identical uncompressed .dict.
const gunzipTo = async (src, dest) => {
  await writeFile(dest, await gunzipAsync(await readFile(src)));
};

// Copy the three StarDict files out of an extracted directory tree into
// dict/moby/, regardless of the (possibly nested / space-containing)
// folder the archive used. The .dict may arrive plain (local zip) or as
// .dict.dz (the canonical tarball) — the latter is decompressed. Throws
// if any part is missing.
const collectInto = async sourceDir => {
  for (const ext of PARTS) {
    if (ext === 'dict') {
      const plain = await findFile(sourceDir, `${BASENAME}.dict`);
      if (plain) {
        await copyFile(plain, targetPath('dict'));
        continue;
      }
      const dz = await findFile(sourceDir, `${BASENAME}.dict.dz`);
      if (!dz) {
        throw new Error(`Extracted archive is missing ${BASENAME}.dict[.dz]`);
      }
      await gunzipTo(dz, targetPath('dict'));
      continue;
    }
    const found = await findFile(sourceDir, `${BASENAME}.${ext}`);
    if (!found) {
      throw new Error(`Extracted archive is missing ${BASENAME}.${ext}`);
    }
    await copyFile(found, targetPath(ext));
  }
};

// Shallow-then-deep search for `name` under `dir` (the StarDict files
// sit one folder deep in both the zip and the tarball).
const findFile = async (dir, name) => {
  const {readdir} = await import('node:fs/promises');
  const entries = await readdir(dir, {withFileTypes: true});
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isFile() && e.name === name) {
      return full;
    }
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = await findFile(join(dir, e.name), name);
      if (hit) {
        return hit;
      }
    }
  }
  return null;
};

const stageFromZip = async zipPath => {
  log(`Extracting Moby StarDict from local zip ${zipPath} ...`);
  const work = join(tmpdir(), `sndict-moby-${process.pid}`);
  await rm(work, {recursive: true, force: true});
  await mkdir(work, {recursive: true});
  await run('unzip', ['-q', '-o', zipPath, '-d', work]);
  await collectInto(work);
  await rm(work, {recursive: true, force: true});
};

const stageFromUrl = async url => {
  log(`Downloading Moby StarDict from ${url} ...`);
  const work = join(tmpdir(), `sndict-moby-${process.pid}`);
  await rm(work, {recursive: true, force: true});
  await mkdir(work, {recursive: true});
  const archive = join(work, 'moby-source.tar.bz2');
  await download(url, archive);
  log('Verifying SHA-256 against pinned digest ...');
  await verifyDigest(archive, EXPECTED_SHA256);
  log('Extracting ...');
  await run('tar', ['-xjf', archive, '-C', work], work);
  await collectInto(work);
  await rm(work, {recursive: true, force: true});
};

const main = async () => {
  if (await allStaged()) {
    log(`Moby StarDict already present at ${MOBY_DIR} — skipping`);
    return;
  }

  await mkdir(MOBY_DIR, {recursive: true});

  if (URL !== '') {
    try {
      await stageFromUrl(URL);
      log(`Staged Moby StarDict at ${MOBY_DIR}. Run \`npm run build:base-db\` next.`);
      return;
    } catch (err) {
      log(`Remote Moby fetch failed (${err?.message ?? err}); trying local zip.`);
    }
  }

  if (await exists(SPEC_ZIP)) {
    await stageFromZip(SPEC_ZIP);
    log(
      `Staged Moby StarDict at ${MOBY_DIR} from the local spec zip ` +
        `(Moby Thesaurus by Grady Ward — public domain). ` +
        `Run \`npm run build:base-db\` next.`,
    );
    return;
  }

  throw new Error(
    'No Moby source available: set SNDICT_MOBY_URL to a StarDict ' +
      `archive, or place the StarDict zip at ${SPEC_ZIP}.`,
  );
};

main().catch(err => {
  log(err?.message ?? String(err));
  process.exit(1);
});
