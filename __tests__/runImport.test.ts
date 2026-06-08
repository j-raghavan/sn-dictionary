// FR4: the format-agnostic import spine. These assert the shared
// verify-then-delete / audit / data-safety contracts ONCE, against a
// fake produceSlugDb seam (so the spine is covered independently of any
// concrete format). The StarDict + CSV produce-steps get their own
// parse tests elsewhere; importStardict.test.ts additionally exercises
// the spine through the native produce-step.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {ensureImportsTable, findImportByNameLang} from '../src/core/dict/sqlite/importAudit';
import {runImport, type RunImportPorts} from '../src/core/dict/sqlite/runImport';
import {CREATE_ENTRIES_TABLE, INSERT_CSV_ENTRY} from '../src/core/dict/sqlite/schema';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const SIDECAR = JSON.stringify({name: 'My Dict', language: 'en'});

type Opts = {
  sidecarText?: string;
  // The rows the fake produce-step "inserts" + the count it reports.
  rows?: Array<{key: string; word: string; definition: string}>;
  // Override the reported count (to force a verify mismatch).
  reports?: number;
  produceThrows?: Error;
  space?: number;
  required?: number;
  sourcePaths?: string[];
  deleteThrowsOn?: string;
};

type Harness = {
  ports: RunImportPorts;
  produceSlugDb: jest.Mock;
  deleteFile: jest.Mock;
  discard: jest.Mock;
  slugFiles: Map<string, SqliteDb>;
  audit: SqliteDb;
};

const DEFAULT_ROWS = [
  {key: 'apple', word: 'apple', definition: 'a fruit'},
  {key: 'banana', word: 'Banana', definition: 'a yellow fruit'},
];

const makeHarness = async (opts: Opts = {}): Promise<Harness> => {
  const audit = await createSeededDb(async d => {
    await ensureImportsTable(d);
  });
  const slugFiles = new Map<string, SqliteDb>();
  const deleteFile = jest.fn(async (path: string) => {
    if (opts.deleteThrowsOn === path) {
      throw new Error(`delete failed: ${path}`);
    }
  });
  const discard = jest.fn(async (filename: string) => {
    slugFiles.delete(filename);
  });
  const rows = opts.rows ?? DEFAULT_ROWS;

  const produceSlugDb = jest.fn(async (filename: string) => {
    if (opts.produceThrows) {
      throw opts.produceThrows;
    }
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      for (const r of rows) {
        await d.run(INSERT_CSV_ENTRY, [r.key, r.word, r.definition, 'plain', null]);
      }
    });
    slugFiles.set(filename, db);
    return {entryCount: opts.reports ?? rows.length};
  });

  const ports: RunImportPorts = {
    sidecarText: opts.sidecarText ?? SIDECAR,
    produceSlugDb,
    deleteFile,
    sourcePaths: opts.sourcePaths ?? ['a.csv', 'a.meta.json'],
    slugDb: {
      reopenForVerify: async filename => {
        const db = slugFiles.get(filename);
        if (!db) {
          throw new Error(`no slug db for ${filename}`);
        }
        return db;
      },
      discard,
    },
    audit,
    now: () => '2026-06-08T00:00:00Z',
  };
  if (opts.space !== undefined && opts.required !== undefined) {
    const {space, required} = opts;
    ports.getAvailableSpace = async () => space;
    ports.estimateRequiredBytes = async () => required;
  }
  return {ports, produceSlugDb, deleteFile, discard, slugFiles, audit};
};

describe('runImport — happy path', () => {
  it('produces, verifies COUNT, audits, then deletes the sources', async () => {
    const h = await makeHarness();
    const res = await runImport(h.ports);
    expect(res).toEqual({
      ok: true,
      filename: 'my-dict.en.db',
      entryCount: 2,
      name: 'My Dict',
      lang: 'en',
    });
    // Audit row written.
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toMatchObject({
      entry_count: 2,
      filename: 'my-dict.en.db',
    });
    // Sources deleted; slug DB kept.
    expect(h.deleteFile.mock.calls.map(c => c[0])).toEqual(['a.csv', 'a.meta.json']);
    expect(h.discard).not.toHaveBeenCalled();
  });
});

describe('runImport — data safety', () => {
  it('invalid sidecar JSON -> {ok:false}, nothing produced or deleted', async () => {
    const h = await makeHarness({sidecarText: '{not json'});
    const res = await runImport(h.ports);
    expect(res.ok).toBe(false);
    expect(h.produceSlugDb).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('space shortfall -> {ok:false}, no produce/delete', async () => {
    const h = await makeHarness({space: 100, required: 1000});
    const res = await runImport(h.ports);
    expect(res).toEqual({
      ok: false,
      reason: '[import] insufficient space: need 1000, have 100',
    });
    expect(h.produceSlugDb).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('ample space -> proceeds', async () => {
    const h = await makeHarness({space: 10000, required: 1000});
    expect((await runImport(h.ports)).ok).toBe(true);
  });

  it('verify mismatch -> discards the slug DB and LEAVES the sources', async () => {
    const h = await makeHarness({reports: 99}); // claims 99, only 2 committed
    const res = await runImport(h.ports);
    expect(res.ok).toBe(false);
    expect((res as {reason: string}).reason).toMatch(/verify failed: committed 2 rows, expected 99/);
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
    expect(h.deleteFile).not.toHaveBeenCalled();
    // No audit row.
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toBeNull();
  });

  it('produce throws BEFORE audit -> discards + leaves sources (retryable)', async () => {
    const h = await makeHarness({produceThrows: new Error('parse boom')});
    const res = await runImport(h.ports);
    expect(res.ok).toBe(false);
    expect((res as {reason: string}).reason).toMatch(/import failed: parse boom/);
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('deleteFile failure AFTER audit -> does NOT discard the recorded DB (latch)', async () => {
    // Audit is committed before the first deleteFile; a delete throw past
    // that point must leave the durably-recorded slug DB intact.
    const h = await makeHarness({deleteThrowsOn: 'a.csv'});
    const res = await runImport(h.ports);
    expect(res.ok).toBe(false);
    // The slug DB is NOT discarded (committedAndAudited latch).
    expect(h.discard).not.toHaveBeenCalled();
    // The audit row survives -> next discovery self-heals the leftover source.
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toMatchObject({
      filename: 'my-dict.en.db',
    });
  });
});
