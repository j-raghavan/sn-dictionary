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
import {parseOmwTsv} from '../src/core/dict/sqlite/buildThesaurus.ts';
import {buildMobyRows} from '../src/core/dict/sqlite/buildMobyThesaurus.ts';
import {parseIfo} from '../src/core/dict/stardict/parseIfo.ts';
import {parseIdx} from '../src/core/dict/stardict/parseIdx.ts';
import {createDictReader} from '../src/core/dict/stardict/dictReader.ts';
import {decodeUtf8} from '../src/sdk/utf8.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DICT_DIR = join(PROJECT_ROOT, 'dict', 'wordnet');
const OMW_FILE = join(PROJECT_ROOT, 'dict', 'omw', 'omw.tsv');
const MOBY_DIR = join(PROJECT_ROOT, 'dict', 'moby');
const OUT_DIR = join(PROJECT_ROOT, 'build');
const OUT_FILE = join(OUT_DIR, 'base.db');

// Load the staged Moby StarDict triple (dict/moby/thesaurus-ee.*) and
// shape it into OmwRow[] via the reused parsers + buildMobyRows. Moby
// is OPTIONAL (like OMW): a missing dict/moby/ returns [] so an
// OMW-only / entries-only build still works. The .dict is plain
// (uncompressed) — createDictReader handles it directly.
const loadMobyRows = async () => {
  const ifoPath = join(MOBY_DIR, 'thesaurus-ee.ifo');
  const idxPath = join(MOBY_DIR, 'thesaurus-ee.idx');
  const dictPath = join(MOBY_DIR, 'thesaurus-ee.dict');
  let ifoBytes;
  let idxBytes;
  let dictBytes;
  try {
    [ifoBytes, idxBytes, dictBytes] = await Promise.all([
      readFile(ifoPath),
      readFile(idxPath),
      readFile(dictPath),
    ]);
  } catch {
    log(`[build:base-db] Moby thesaurus absent (${MOBY_DIR}) — skipping`);
    return [];
  }
  const meta = parseIfo(ifoBytes);
  const idx = await parseIdx(idxBytes, meta.idxoffsetbits);
  const reader = createDictReader(dictBytes);
  const entries = idx.map(({word, offset, length}) => ({
    word,
    block: decodeUtf8(reader.slice(offset, length)),
  }));
  const rows = buildMobyRows(entries);
  log(
    `[build:base-db] Moby thesaurus: ${rows.length} relations ` +
      `(${entries.length} headwords)`,
  );
  return rows;
};

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

  // OMW thesaurus is optional: warn-skip if dict/omw/omw.tsv is absent
  // so an entries-only build still works (run `npm run prepare:omw`
  // to stage it).
  let omwRows = [];
  try {
    const omwText = await readFile(OMW_FILE, 'utf-8');
    omwRows = parseOmwTsv(omwText);
    log(`[build:base-db] OMW thesaurus: ${omwRows.length} relations`);
  } catch {
    log(`[build:base-db] OMW thesaurus absent (${OMW_FILE}) — building entries only`);
  }

  // Moby English Thesaurus (issue #26): public-domain synonyms staged
  // by `npm run fetch:moby` into dict/moby/. Optional like OMW; the
  // rows share OMW's {key, lang:'en', rel:'synonym', target} shape and
  // are CONCATENATED so they merge into the same thesaurus table and
  // dedup against OMW via the existing assembleThesaurus at query time.
  const mobyRows = await loadMobyRows();
  const thesaurusRows = omwRows.concat(mobyRows);

  await mkdir(OUT_DIR, {recursive: true});
  // Fresh build: start from an empty file so reruns are deterministic.
  const raw = new Database(OUT_FILE);
  raw.exec('PRAGMA journal_mode = DELETE');
  raw.exec('DROP TABLE IF EXISTS entries');
  raw.exec('DROP TABLE IF EXISTS thesaurus');
  raw.exec('DROP TABLE IF EXISTS meta');
  const db = wrap(raw);

  const {insertedCount, expectedCount} = await buildBaseDbFromTriple(
    db,
    ifoBytes,
    idxBytes,
    dictBytes,
    SCHEMA_VERSION,
    thesaurusRows,
  );

  if (insertedCount !== expectedCount) {
    throw new Error(
      `[build:base-db] row count mismatch: inserted ${insertedCount}, expected ${expectedCount}`,
    );
  }

  // Compact the file so the shipped asset is as small as possible.
  raw.exec('VACUUM');
  raw.close();

  log(
    `[build:base-db] wrote ${OUT_FILE} (${insertedCount} entries, ` +
      `${thesaurusRows.length} thesaurus relations ` +
      `[OMW ${omwRows.length} + Moby ${mobyRows.length}], ` +
      `schema v${SCHEMA_VERSION})`,
  );
};

main().catch(err => {
  console.error(err.message ?? err);
  process.exit(1);
});
