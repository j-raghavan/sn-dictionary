#!/usr/bin/env node
// Real-StarDict regression runner.
//
// Pipeline:
//   1. Read the manifest (__tests__/integration/manifest.ts) by
//      requiring it via tsx-style at-runtime parsing. Avoid: we
//      duplicate the manifest's URL+SHA list here as a small
//      JS-only mirror to skip the TS dep at runtime. Source of
//      truth stays in manifest.ts; this mirror is checked at
//      startup and fails loudly on drift.
//   2. For each manifest dict:
//      - Skip if cache hit (sha matches existing zip).
//      - Otherwise download, sha-verify, extract into a stable
//        layout: .cache/integration-dicts/<name>/stardict.{ifo,idx,dict.dz}.
//   3. Spawn jest with SNDICT_INTEGRATION=1 and a path filter that
//      runs only the integration suite. Inherit stdio so jest's
//      output is the user's output.
//   4. On clean exit, by default DELETE the .cache/integration-dicts/
//      tree so a developer running locally doesn't accumulate ~12 MB
//      of zips after one run. Pass --keep to retain (useful when
//      iterating on assertions).
//
// Failure semantics: any of "manifest drift", "download fails",
// "sha mismatch", "zip lacks expected layout", or "jest exits
// non-zero" exits this script non-zero. The release workflow runs
// this as a gate, so a non-zero exit blocks the release.

import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWriteStream, existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CACHE_DIR = join(REPO_ROOT, '.cache', 'integration-dicts');

// Mirror of __tests__/integration/manifest.ts. Kept JS-only so this
// script doesn't need ts-node. Drift between the two is checked at
// startup: we read manifest.ts as text and grep the SHA pins.
const MANIFEST_MIRROR = [
  {
    name: 'wikdict-de-fr',
    url: 'https://download.wikdict.com/dictionaries/stardict/wikdict-de-fr.zip',
    sha256: '2c4d1710086f4d65e00fb0e00a8beaac424d24f842722a5afd1e3f8546e523e3',
  },
  {
    name: 'wikdict-fr-de',
    url: 'https://download.wikdict.com/dictionaries/stardict/wikdict-fr-de.zip',
    sha256: '81658ead31852e926e4c739799b92da7958e72d749f6c6a6b391e95ab2b0d587',
  },
  {
    name: 'wikdict-de-en',
    url: 'https://download.wikdict.com/dictionaries/stardict/wikdict-de-en.zip',
    sha256: 'c94ed34a7e925c1f7f0be1ff08b7032534eb2475352111fd46c1dc183d9390f2',
  },
];

const args = new Set(process.argv.slice(2));
const KEEP_CACHE = args.has('--keep');

const log = (msg) => console.log(`[integration] ${msg}`);
const fail = (msg) => {
  console.error(`[integration] ✗ ${msg}`);
  process.exit(1);
};

// Mirror-vs-source drift check. If someone updates manifest.ts but
// not this script (or vice-versa), surface it now rather than after
// downloads complete with the wrong content.
const verifyManifestDrift = () => {
  const manifestPath = join(REPO_ROOT, '__tests__', 'integration', 'manifest.ts');
  const text = readFileSync(manifestPath, 'utf-8');
  for (const {name, sha256} of MANIFEST_MIRROR) {
    if (!text.includes(name)) {
      fail(`manifest.ts missing entry for "${name}" (mirror drift in scripts/runIntegrationTests.mjs)`);
    }
    if (!text.includes(sha256)) {
      fail(`manifest.ts SHA pin for "${name}" doesn't match runner mirror — update one to match the other`);
    }
  }
};

const sha256Of = (path) => {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
};

const downloadTo = async (url, dest) => {
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error(`fetch ${url} returned an empty body`);
  }
  await new Promise((resolve, reject) => {
    const out = createWriteStream(dest);
    out.on('finish', resolve);
    out.on('error', reject);
    // Web Streams reader → Node writable.
    const reader = res.body.getReader();
    const pump = async () => {
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        if (!out.write(value)) {
          await new Promise((r) => out.once('drain', r));
        }
      }
      out.end();
    };
    pump().catch(reject);
  });
};

// Extract a single-top-level-folder zip into <destDir>/ such that the
// stardict.* files end up directly under destDir. We use the system
// `unzip` because it's available on every CI runner we care about
// (ubuntu-latest, macOS-latest) and pulling in a node zip lib for
// one consumer would be overkill.
const extractZip = (zipPath, destDir) => {
  return new Promise((resolve, reject) => {
    // -j flag: junk paths (flatten); writes all files into destDir
    // regardless of how deep they were nested in the zip. Wikdict
    // wraps everything in one folder, so flattening lands us with
    // stardict.ifo / stardict.idx / stardict.dict.dz directly under
    // destDir — exactly what the test expects.
    const child = spawn('unzip', ['-q', '-o', '-j', zipPath, '-d', destDir], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`unzip exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
};

const ensureDictReady = async ({name, url, sha256}) => {
  const dictDir = join(CACHE_DIR, name);
  const zipPath = join(CACHE_DIR, `${name}.zip`);
  const stardictIfo = join(dictDir, 'stardict.ifo');

  // Hot path: already extracted AND archive matches the SHA pin.
  if (existsSync(stardictIfo) && existsSync(zipPath)) {
    if (sha256Of(zipPath) === sha256) {
      log(`${name} cache hit (sha verified)`);
      return;
    }
    log(`${name} cache mismatch — re-downloading`);
  }

  mkdirSync(dictDir, {recursive: true});
  await downloadTo(url, zipPath);

  const actual = sha256Of(zipPath);
  if (actual !== sha256) {
    fail(
      `${name} SHA mismatch:\n  expected ${sha256}\n  actual   ${actual}\n` +
        `Either upstream rebuilt the dict (update manifest.ts pin), or the download\n` +
        `was corrupted in transit. Re-run after investigating.`,
    );
  }
  await extractZip(zipPath, dictDir);
  if (!existsSync(stardictIfo)) {
    fail(
      `${name} extract did not produce stardict.ifo at ${dictDir}.\n` +
        `Check the zip's internal layout — the runner expects a single\n` +
        `top-level folder with stardict.{ifo,idx,dict.dz}.`,
    );
  }
  log(`${name} ready`);
};

const runJest = () =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        'jest',
        '--testPathPattern',
        '__tests__/integration/',
        '--passWithNoTests',
      ],
      {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        env: {...process.env, SNDICT_INTEGRATION: '1'},
      },
    );
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`jest exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });

const cleanup = () => {
  if (KEEP_CACHE) {
    log(`keeping cache at ${CACHE_DIR} (--keep specified)`);
    return;
  }
  if (existsSync(CACHE_DIR)) {
    rmSync(CACHE_DIR, {recursive: true, force: true});
    log(`cache cleaned`);
  }
};

const main = async () => {
  verifyManifestDrift();
  mkdirSync(CACHE_DIR, {recursive: true});

  for (const dict of MANIFEST_MIRROR) {
    try {
      await ensureDictReady(dict);
    } catch (e) {
      fail(`${dict.name}: ${e.message}`);
    }
  }

  // Run jest. Cleanup runs regardless of jest's exit code so we don't
  // leave zips behind on CI if a test fails.
  let jestError = null;
  try {
    await runJest();
  } catch (e) {
    jestError = e;
  }
  cleanup();
  if (jestError) {
    fail(jestError.message);
  }
  log('all integration tests passed');
};

main().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
