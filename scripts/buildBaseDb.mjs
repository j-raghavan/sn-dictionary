// Generate the bundled base.db (TF3-FR1/FR2) from the staged WordNet
// StarDict triple at dict/wordnet/{base.ifo,base.idx,base.dict.dz}.
//
// Reuses the project's TypeScript core (src/core/dict/sqlite/buildBaseDb.ts
// -> buildDict, decodeUtf8, schema DDL) through scripts/tsLoader.mjs,
// so the build and the unit tests run identical row-shaping logic. The
// output DB is written with better-sqlite3 directly (this is a build
// script, not the runtime port).
//
// Run: node --import ./scripts/registerTsLoader.mjs scripts/buildBaseDb.mjs
// (wired as `npm run build:base-db`). The generated build/base.db is
// gitignored — it's a regenerable binary, never committed.

import {readFile, stat, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';

import {
  buildBaseDbFromTriple,
  SCHEMA_VERSION,
} from '../src/core/dict/sqlite/buildBaseDb.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DICT_DIR = join(PROJECT_ROOT, 'dict', 'wordnet');
const OUT_DIR = join(PROJECT_ROOT, 'build');
const OUT_FILE = join(OUT_DIR, 'base.db');

const log = (...args) => console.log(...args);

const ensureFile = async path => {
  try {
    await stat(path);
  } catch {
    throw new Error(
      `Missing source file: ${path}. Run \`npm run fetch:dict\` first.`,
    );
  }
};

// Minimal SqliteDb over a better-sqlite3 handle — same shape as the
// test adapter, inlined here so the build script depends only on
// better-sqlite3 + the TS core (Designer: open the DB directly).
const wrap = db => ({
  async query(sql, params = []) {
    return db.prepare(sql).all(...params);
  },
  async run(sql, params = []) {
    const info = db.prepare(sql).run(...params);
    return {changes: Number(info.changes)};
  },
  async transaction(fn) {
    db.exec('BEGIN');
    try {
      await fn(wrap(db));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },
  async close() {
    db.close();
  },
});

const main = async () => {
  const ifoPath = join(DICT_DIR, 'base.ifo');
  const idxPath = join(DICT_DIR, 'base.idx');
  const dictPath = join(DICT_DIR, 'base.dict.dz');
  await ensureFile(ifoPath);
  await ensureFile(idxPath);
  await ensureFile(dictPath);

  const [ifoBytes, idxBytes, dictBytes] = await Promise.all([
    readFile(ifoPath),
    readFile(idxPath),
    readFile(dictPath),
  ]);

  await mkdir(OUT_DIR, {recursive: true});
  // Fresh build: start from an empty file so reruns are deterministic.
  const raw = new Database(OUT_FILE);
  raw.exec('PRAGMA journal_mode = DELETE');
  raw.exec('DROP TABLE IF EXISTS entries');
  raw.exec('DROP TABLE IF EXISTS meta');
  const db = wrap(raw);

  const {insertedCount, expectedCount} = await buildBaseDbFromTriple(
    db,
    ifoBytes,
    idxBytes,
    dictBytes,
    SCHEMA_VERSION,
  );

  if (insertedCount !== expectedCount) {
    throw new Error(
      `[build:base-db] row count mismatch: inserted ${insertedCount}, expected ${expectedCount}`,
    );
  }

  // Compact the file so the shipped asset is as small as possible.
  raw.exec('VACUUM');
  raw.close();

  log(`[build:base-db] wrote ${OUT_FILE} (${insertedCount} entries, schema v${SCHEMA_VERSION})`);
};

main().catch(err => {
  console.error(err.message ?? err);
  process.exit(1);
});
