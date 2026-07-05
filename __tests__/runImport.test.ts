// FR4: the format-agnostic import spine. These assert the shared
// verify-then-delete / audit / data-safety contracts ONCE, against a
// fake produceSlugDb seam (so the spine is covered independently of any
// concrete format). The StarDict + CSV produce-steps get their own
// parse tests elsewhere; importStardict.test.ts additionally exercises
// the spine through the native produce-step.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  ensureImportsTable,
  findImportByNameLang,
  upsertImport,
} from '../src/core/dict/sqlite/importAudit';
import {runImport, type RunImportPorts} from '../src/core/dict/sqlite/runImport';
import {
  CREATE_ENTRIES_TABLE,
  IMPORTER_VERSION,
  INSERT_CSV_ENTRY,
} from '../src/core/dict/sqlite/schema';
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
  // The StarDict subfolder to remove after the files (FR3). Omit to model
  // a loose CSV (no folder cleanup).
  sourceFolder?: string;
  // Make deleteFolder throw / resolve false (still a success import).
  deleteFolderThrows?: Error;
  // F4: keep the source files after a verified import (skip the delete).
  keepSources?: boolean;
  // F4-FR9: a `.refresh` sentinel path + its (best-effort) deleter.
  refreshPath?: string;
  deleteRefreshThrows?: Error;
  // A/B slot: build into this filename instead of resolving one (refresh).
  targetFilename?: string;
};

type Harness = {
  ports: RunImportPorts;
  produceSlugDb: jest.Mock;
  deleteFile: jest.Mock;
  deleteFolder: jest.Mock;
  discard: jest.Mock;
  deleteRefreshSentinel: jest.Mock;
  slugFiles: Map<string, SqliteDb>;
  audit: SqliteDb;
  deleteOrder: string[];
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
  // Records the order of file vs folder deletes so a test can assert the
  // folder is removed AFTER the files.
  const deleteOrder: string[] = [];
  const deleteFile = jest.fn(async (path: string) => {
    deleteOrder.push(`file:${path}`);
    if (opts.deleteThrowsOn === path) {
      throw new Error(`delete failed: ${path}`);
    }
  });
  const deleteFolder = jest.fn(async (path: string) => {
    deleteOrder.push(`folder:${path}`);
    if (opts.deleteFolderThrows) {
      throw opts.deleteFolderThrows;
    }
    return true;
  });
  const discard = jest.fn(async (filename: string) => {
    slugFiles.delete(filename);
  });
  const deleteRefreshSentinel = jest.fn(async (path: string) => {
    deleteOrder.push(`refresh:${path}`);
    if (opts.deleteRefreshThrows) {
      throw opts.deleteRefreshThrows;
    }
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
  if (opts.sourceFolder !== undefined) {
    ports.sourceFolder = opts.sourceFolder;
    ports.deleteFolder = deleteFolder;
  }
  if (opts.keepSources !== undefined) {
    ports.keepSources = opts.keepSources;
  }
  if (opts.refreshPath !== undefined) {
    ports.refreshPath = opts.refreshPath;
    ports.deleteRefreshSentinel = deleteRefreshSentinel;
  }
  if (opts.targetFilename !== undefined) {
    ports.targetFilename = opts.targetFilename;
  }
  return {
    ports,
    produceSlugDb,
    deleteFile,
    deleteFolder,
    discard,
    deleteRefreshSentinel,
    slugFiles,
    audit,
    deleteOrder,
  };
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
    // Sources deleted; the built slug DB is retained (the spine pre-cleans the
    // target before produce, but never discards the verified DB afterward).
    expect(h.deleteFile.mock.calls.map(c => c[0])).toEqual(['a.csv', 'a.meta.json']);
    expect(h.slugFiles.has('my-dict.en.db')).toBe(true);
  });

  it('stamps the audit row with the current IMPORTER_VERSION', async () => {
    const h = await makeHarness();
    await runImport(h.ports);
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toMatchObject({
      importer_version: IMPORTER_VERSION,
    });
  });
});

describe('runImport — version stamp failure semantics', () => {
  it('a FAILED produce over a seeded old row leaves version + filename untouched', async () => {
    // Seed a stale prior row (older stamp, different filename). A failing
    // import (produce throws BEFORE the audit write) must NOT overwrite it —
    // the prior row is the retryable record.
    const h = await makeHarness({produceThrows: new Error('parse boom')});
    await upsertImport(h.audit, {
      name: 'My Dict',
      lang: 'en',
      entry_count: 5,
      imported_at: 'old',
      filename: 'prior.en.db',
      importer_version: 0,
    });
    const res = await runImport(h.ports);
    expect(res.ok).toBe(false);
    // The old row survives verbatim (old stamp, old filename) — nothing
    // re-stamped, so a later successful retry is what advances the version.
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toMatchObject({
      importer_version: 0,
      filename: 'prior.en.db',
      imported_at: 'old',
    });
  });
});

describe('runImport — A/B slot targetFilename (refresh)', () => {
  it('honors targetFilename: produce builds into it, resolveSlugCollision NOT consulted, audit records it', async () => {
    // Seed a DIFFERENT dict already owning the natural slug name — normally
    // resolveSlugCollision would suffix to 'my-dict-2.en.db'. With an injected
    // target, that resolution is bypassed entirely.
    const h = await makeHarness({targetFilename: 'my-dict.en.alt.db'});
    await upsertImport(h.audit, {
      name: 'Other',
      lang: 'en',
      entry_count: 1,
      imported_at: 't',
      filename: 'my-dict.en.db',
      importer_version: IMPORTER_VERSION,
    });
    const res = await runImport(h.ports);
    expect(res).toMatchObject({ok: true, filename: 'my-dict.en.alt.db'});
    // produce received the target (not a collision-suffixed name).
    expect(h.produceSlugDb).toHaveBeenCalledWith('my-dict.en.alt.db');
    // The audit row records the target filename (the atomic swap pointer).
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toMatchObject({
      filename: 'my-dict.en.alt.db',
      importer_version: IMPORTER_VERSION,
    });
  });

  it('a failed produce discards the TARGET filename (never a prior/served file)', async () => {
    const h = await makeHarness({
      targetFilename: 'my-dict.en.alt.db',
      produceThrows: new Error('parse boom'),
    });
    const res = await runImport(h.ports);
    expect(res.ok).toBe(false);
    // The discard targets the build slot — the served file is never touched.
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.alt.db');
  });
});

describe('runImport — spine start-clean (C4)', () => {
  it('pre-cleans the build target via discard BEFORE produce', async () => {
    const h = await makeHarness();
    await runImport(h.ports);
    // discard(target) ran, and it ran BEFORE produceSlugDb (invocation order).
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
    expect(h.discard.mock.invocationCallOrder[0]).toBeLessThan(
      h.produceSlugDb.mock.invocationCallOrder[0],
    );
  });

  it('a discard failure is swallowed — produce still runs and the import succeeds', async () => {
    const h = await makeHarness();
    h.discard.mockImplementationOnce(async () => {
      throw new Error('pre-clean unlink failed');
    });
    const res = await runImport(h.ports);
    expect(res.ok).toBe(true);
    expect(h.produceSlugDb).toHaveBeenCalledWith('my-dict.en.db');
  });
});

describe('runImport — isCancelled (Remove-vs-refresh race, NEW-3)', () => {
  it('cancelled just before the upsert -> discards target, NO audit row, ok:false', async () => {
    const h = await makeHarness();
    h.ports.isCancelled = () => true;
    const res = await runImport(h.ports);
    expect(res).toEqual({
      ok: false,
      reason: 'cancelled: dict removed during import',
    });
    // No audit row written (the removed dict is not resurrected)...
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toBeNull();
    // ...and the verified-but-unrecorded target was discarded.
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
    expect(h.slugFiles.has('my-dict.en.db')).toBe(false);
  });

  it('isCancelled false -> normal success (audit written)', async () => {
    const h = await makeHarness();
    h.ports.isCancelled = () => false;
    const res = await runImport(h.ports);
    expect(res.ok).toBe(true);
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).not.toBeNull();
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
    // The verified slug DB survives (committedAndAudited latch — a post-audit
    // delete failure never discards it; the pre-clean discard ran before build).
    expect(h.slugFiles.has('my-dict.en.db')).toBe(true);
    // The audit row survives -> next discovery self-heals the leftover source.
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toMatchObject({
      filename: 'my-dict.en.db',
    });
  });
});

describe('runImport — source folder cleanup (FR3)', () => {
  it('removes the source folder AFTER the files on a verified import', async () => {
    const h = await makeHarness({
      sourcePaths: ['/d/Fr/x.ifo', '/d/Fr/x.idx', '/d/Fr/x.dict'],
      sourceFolder: '/d/Fr',
    });
    const res = await runImport(h.ports);
    expect(res.ok).toBe(true);
    expect(h.deleteFolder).toHaveBeenCalledWith('/d/Fr');
    // Folder delete comes strictly after every file delete.
    expect(h.deleteOrder).toEqual([
      'file:/d/Fr/x.ifo',
      'file:/d/Fr/x.idx',
      'file:/d/Fr/x.dict',
      'folder:/d/Fr',
    ]);
  });

  it('does NOT call deleteFolder when no sourceFolder is set (loose CSV)', async () => {
    const h = await makeHarness(); // CSV: no sourceFolder
    const res = await runImport(h.ports);
    expect(res.ok).toBe(true);
    expect(h.deleteFolder).not.toHaveBeenCalled();
  });

  it('a deleteFolder throw is isolated: import still succeeds, DB not discarded', async () => {
    const h = await makeHarness({
      sourceFolder: '/d/Fr',
      deleteFolderThrows: new Error('directory not empty'),
    });
    const res = await runImport(h.ports, {warn: jest.fn()});
    // The verified+audited import is unaffected by the folder-cleanup fail.
    expect(res).toMatchObject({ok: true, filename: 'my-dict.en.db'});
    expect(h.slugFiles.has('my-dict.en.db')).toBe(true);
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toMatchObject({
      filename: 'my-dict.en.db',
    });
  });

  it('never removes the folder on a FAILED import (verify mismatch)', async () => {
    const h = await makeHarness({reports: 99, sourceFolder: '/d/Fr'});
    const res = await runImport(h.ports);
    expect(res.ok).toBe(false);
    expect(h.deleteFolder).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });
});

describe('runImport — F4 opt-in source deletion (keepSources)', () => {
  it('keep=true: writes the audit row + keeps the slug DB, but SKIPS deleteFile/deleteFolder (AC1)', async () => {
    const h = await makeHarness({
      keepSources: true,
      sourcePaths: ['/d/Fr/x.ifo', '/d/Fr/x.idx', '/d/Fr/x.dict'],
      sourceFolder: '/d/Fr',
    });
    const res = await runImport(h.ports);
    expect(res).toMatchObject({ok: true, filename: 'my-dict.en.db'});
    // Audit row written (the import is durably recorded)...
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toMatchObject({
      entry_count: 2,
      filename: 'my-dict.en.db',
    });
    // ...slug DB kept (the verified DB is never discarded)...
    expect(h.slugFiles.has('my-dict.en.db')).toBe(true);
    // ...and NO source deletion happened (the whole point of keep).
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.deleteFolder).not.toHaveBeenCalled();
  });

  it('keep=false: deletes sources + writes the audit row (AC2 — today behaviour)', async () => {
    const h = await makeHarness({keepSources: false});
    const res = await runImport(h.ports);
    expect(res.ok).toBe(true);
    expect(h.deleteFile.mock.calls.map(c => c[0])).toEqual(['a.csv', 'a.meta.json']);
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toMatchObject({
      filename: 'my-dict.en.db',
    });
  });

  it('keep unset defaults to delete (legacy callers unchanged)', async () => {
    const h = await makeHarness(); // no keepSources
    await runImport(h.ports);
    expect(h.deleteFile).toHaveBeenCalled();
  });

  it('verify-failure parity: keep=true leaves sources + discards the half DB (AC6)', async () => {
    const h = await makeHarness({keepSources: true, reports: 99});
    const res = await runImport(h.ports);
    expect(res.ok).toBe(false);
    // Identical to keep=false failure: sources untouched, DB discarded.
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toBeNull();
  });

  it('keep=true still removes a .refresh sentinel after a verified refresh (FR9)', async () => {
    const h = await makeHarness({
      keepSources: true,
      refreshPath: '/d/Fr/.refresh',
    });
    const res = await runImport(h.ports);
    expect(res.ok).toBe(true);
    // Sources kept, but the sentinel is deleted so it doesn't loop.
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.deleteRefreshSentinel).toHaveBeenCalledWith('/d/Fr/.refresh');
  });

  it('a deleteRefreshSentinel failure is isolated: import still succeeds', async () => {
    const h = await makeHarness({
      keepSources: true,
      refreshPath: '/d/Fr/.refresh',
      deleteRefreshThrows: new Error('sentinel gone'),
    });
    const res = await runImport(h.ports, {warn: jest.fn()});
    expect(res).toMatchObject({ok: true, filename: 'my-dict.en.db'});
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toMatchObject({
      filename: 'my-dict.en.db',
    });
  });

  it('does NOT remove the sentinel on a FAILED import (verify mismatch)', async () => {
    const h = await makeHarness({
      keepSources: true,
      refreshPath: '/d/Fr/.refresh',
      reports: 99,
    });
    const res = await runImport(h.ports);
    expect(res.ok).toBe(false);
    expect(h.deleteRefreshSentinel).not.toHaveBeenCalled();
  });
});
