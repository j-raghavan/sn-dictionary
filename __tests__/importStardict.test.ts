// Verify-then-delete StarDict import pipeline (TF5-FR3/FR4/FR6).
// Driven through fake ImportPorts backed by host better-sqlite3 DBs:
// a slug-DB registry (open writes, reopenForVerify reads committed
// state, discard drops the file) + spies on deleteFile / now.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';
import {buildSyn} from './_helpers/synFixture';
import {ensureImportsTable, findImportByNameLang} from '../src/core/dict/sqlite/importAudit';
import {
  estimateImportBytes,
  importStardict,
  type ImportPorts,
  type StardictSet,
} from '../src/core/dict/sqlite/importStardict';
import {SELECT_ENTRY_BY_KEY} from '../src/core/dict/sqlite/schema';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const DEFS = {apple: 'a fruit', Banana: 'a yellow fruit'};
const SIDECAR = JSON.stringify({name: 'My Dict', language: 'en'});

type Harness = {
  ports: ImportPorts;
  deleteFile: jest.Mock;
  slugFiles: Map<string, SqliteDb>;
  discard: jest.Mock;
  audit: SqliteDb;
};

// Build a fake ImportPorts. `set` overrides the StarDict set; `space`
// (when set) installs a getAvailableSpace probe.
const makeHarness = async (
  set: StardictSet,
  opts: {space?: number; sourcePaths?: string[]} = {},
): Promise<Harness> => {
  const audit = await createSeededDb(async d => {
    await ensureImportsTable(d);
  });
  // Each filename maps to its own in-memory DB. open() creates it;
  // reopenForVerify returns the SAME committed DB (better-sqlite3 is
  // synchronous + single-process, so committed state is visible).
  const slugFiles = new Map<string, SqliteDb>();
  const deleteFile = jest.fn(async () => undefined);
  const discard = jest.fn(async (filename: string) => {
    slugFiles.delete(filename);
  });

  const ports: ImportPorts = {
    readSet: async () => set,
    deleteFile,
    sourcePaths: opts.sourcePaths ?? ['dict.ifo', 'dict.idx', 'dict.dict', 'meta.json'],
    slugDb: {
      open: async filename => {
        const db = await createSeededDb(async () => undefined);
        slugFiles.set(filename, db);
        return db;
      },
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
    now: () => '2026-06-07T00:00:00Z',
  };
  if (opts.space !== undefined) {
    const space = opts.space;
    ports.getAvailableSpace = async () => space;
  }
  return {ports, deleteFile, slugFiles, discard, audit};
};

const baseSet = (over: Partial<StardictSet> = {}): StardictSet => {
  const t = buildSyntheticStarDict(DEFS);
  return {ifo: t.ifo, idx: t.idx, dict: t.dict, sidecarText: SIDECAR, ...over};
};

describe('importStardict — happy path', () => {
  it('imports, verifies post-commit COUNT, deletes sources, audits with now()', async () => {
    const h = await makeHarness(baseSet());
    const res = await importStardict(h.ports);

    expect(res).toEqual({
      ok: true,
      filename: 'my-dict.en.db',
      entryCount: 2,
      name: 'My Dict',
      lang: 'en',
    });

    // Rows landed in the slug DB with the imported content.
    const slug = h.slugFiles.get('my-dict.en.db')!;
    const row = await slug.query(SELECT_ENTRY_BY_KEY, ['apple']);
    expect(row).toEqual([{word: 'apple', definition: 'a fruit', format: 'plain'}]);

    // All source files deleted.
    expect(h.deleteFile).toHaveBeenCalledTimes(4);

    // Audit row written with the deterministic timestamp.
    const audited = await findImportByNameLang(h.audit, 'My Dict', 'en');
    expect(audited).toEqual({
      name: 'My Dict',
      lang: 'en',
      entry_count: 2,
      imported_at: '2026-06-07T00:00:00Z',
      filename: 'my-dict.en.db',
    });
  });

  it('stamps entryFormat from the sidecar when present', async () => {
    const sidecar = JSON.stringify({name: 'H Dict', language: 'en', format: 'html'});
    const h = await makeHarness(baseSet({sidecarText: sidecar}));
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(true);
    const slug = h.slugFiles.get('h-dict.en.db')!;
    const row = await slug.query<{format: string}>(SELECT_ENTRY_BY_KEY, ['apple']);
    expect(row[0].format).toBe('html');
  });

  it('counts .syn alias keys as distinct entries (Flag 1)', async () => {
    const t = buildSyntheticStarDict(DEFS);
    const syn = buildSyn(Object.keys(DEFS), {apples: 'apple', pomme: 'apple'});
    const h = await makeHarness({
      ifo: t.ifo,
      idx: t.idx,
      dict: t.dict,
      syn,
      sidecarText: SIDECAR,
    });
    const res = await importStardict(h.ports);
    // 2 headwords + 2 alias keys = 4 distinct Map entries.
    expect(res).toMatchObject({ok: true, entryCount: 4});
    const slug = h.slugFiles.get('my-dict.en.db')!;
    // Alias resolves to the canonical definition.
    const alias = await slug.query(SELECT_ENTRY_BY_KEY, ['apples']);
    expect(alias).toEqual([{word: 'apple', definition: 'a fruit', format: 'plain'}]);
  });
});

describe('importStardict — failure isolation (sources LEFT)', () => {
  it('invalid sidecar JSON -> {ok:false}, nothing deleted', async () => {
    const h = await makeHarness(baseSet({sidecarText: '{not json'}));
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(false);
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.discard).not.toHaveBeenCalled();
  });

  it('sidecar failing validation -> {ok:false}, nothing deleted', async () => {
    const h = await makeHarness(baseSet({sidecarText: JSON.stringify({language: 'en'})}));
    const res = await importStardict(h.ports);
    expect(res).toEqual({ok: false, reason: expect.stringContaining('name')});
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('count mismatch -> discard slug db, sources LEFT', async () => {
    const h = await makeHarness(baseSet());
    // Sabotage verify: reopenForVerify returns a DB whose entries count
    // differs from parsed.index.size.
    h.ports.slugDb.reopenForVerify = async () =>
      createSeededDb(async d => {
        await d.run(
          'CREATE TABLE entries (key TEXT, word TEXT, definition TEXT, format TEXT)',
        );
        // 0 rows -> mismatch vs expected 2.
      });
    const res = await importStardict(h.ports);
    expect(res).toEqual({
      ok: false,
      reason: 'verify failed: committed 0 rows, expected 2',
    });
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('verify reads COMMITTED state, NOT the cached/uncommitted populate handle (Flag 5)', async () => {
    // Model the device contract that the host happy-path fake glosses
    // over (it returns the SAME in-memory handle from open() and
    // reopenForVerify()): a writable populate handle whose writes are
    // NOT yet visible to a separate reader until commit, and a verify
    // handle that sees ONLY committed rows.
    //
    // Here the populate handle BUFFERS its writes and never flushes them
    // to the committed store (simulating a missing/rolled-back commit,
    // or a future refactor that wrongly reuses the uncommitted handle
    // for verify). The committed-view reader therefore sees 0 rows ->
    // COUNT mismatch -> slug DB discarded + ALL sources LEFT. If verify
    // ever read the cached populate handle instead, it would see the 2
    // buffered rows and FALSELY pass — this test forbids that.
    const h = await makeHarness(baseSet());

    // The committed store: starts empty, only mutated on an explicit
    // (here never-invoked) commit. The populate handle writes go to a
    // separate uncommitted buffer.
    const committedRows: unknown[] = [];
    let uncommittedRowCount = 0;

    const writableUncommittedHandle = {
      query: async () => [],
      run: async (sql: string) => {
        if (/^INSERT INTO entries/i.test(sql)) {
          uncommittedRowCount++;
        }
        return {changes: 1};
      },
      // transaction() runs the body (buffering writes) but does NOT
      // surface them to the committed store — the "no commit" case.
      transaction: async (fn: (tx: SqliteDb) => Promise<void>) => {
        await fn(writableUncommittedHandle as unknown as SqliteDb);
      },
      close: async () => undefined,
    } as unknown as SqliteDb;

    const committedViewReader = {
      // Reads ONLY committed state — sees committedRows (empty).
      query: async (sql: string) =>
        /COUNT/i.test(sql) ? [{n: committedRows.length}] : committedRows,
      run: async () => ({changes: 0}),
      transaction: async () => undefined,
      close: async () => undefined,
    } as unknown as SqliteDb;

    h.ports.slugDb.open = async () => writableUncommittedHandle;
    h.ports.slugDb.reopenForVerify = async () => committedViewReader;

    const res = await importStardict(h.ports);

    // The populate handle DID receive the writes (proving the populate
    // step ran) ...
    expect(uncommittedRowCount).toBe(2);
    // ... but verify read the committed view (0 rows) and rejected.
    expect(res).toEqual({
      ok: false,
      reason: 'verify failed: committed 0 rows, expected 2',
    });
    // Safety-critical: half-built DB discarded, sources NOT deleted.
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
    expect(h.deleteFile).not.toHaveBeenCalled();
    // And no audit row was written for the failed import.
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toBeNull();
  });

  it('verify COUNT returning zero rows is treated as -1 (mismatch)', async () => {
    const h = await makeHarness(baseSet());
    // A verify handle whose COUNT query yields NO rows -> committed = -1.
    h.ports.slugDb.reopenForVerify = async () =>
      ({query: async () => []} as unknown as SqliteDb);
    const res = await importStardict(h.ports);
    expect(res).toEqual({
      ok: false,
      reason: 'verify failed: committed -1 rows, expected 2',
    });
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('throw BEFORE a slug filename is assigned -> no discard attempted', async () => {
    const h = await makeHarness(baseSet());
    // resolveSlugCollision reads the audit; make that throw so the
    // failure happens before `filename` is set.
    h.ports.audit.query = async () => {
      throw new Error('audit unavailable');
    };
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(false);
    expect(h.discard).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('discard throwing during cleanup does not mask the original error', async () => {
    const h = await makeHarness(baseSet());
    h.ports.slugDb.reopenForVerify = async () => {
      throw new Error('reopen blew up');
    };
    h.ports.slugDb.discard = jest.fn(async () => {
      throw new Error('discard also failed');
    });
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('reopen blew up');
    }
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('readSet/parse throw -> {ok:false}, sources LEFT', async () => {
    const h = await makeHarness(baseSet());
    h.ports.slugDb.open = async () => {
      throw new Error('disk full');
    };
    const warn = jest.fn();
    const res = await importStardict(h.ports, {warn});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('disk full');
    }
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});

describe('importStardict — re-add + coexist', () => {
  it('re-importing the same name+lang replaces the audit row (one row)', async () => {
    const h = await makeHarness(baseSet());
    await importStardict(h.ports);
    // Second import of same set — reuse the same audit + slug registry.
    const res2 = await importStardict(h.ports);
    expect(res2.ok).toBe(true);
    const all = await h.audit.query(
      'SELECT name, lang FROM imports WHERE name=? AND lang=?',
      ['My Dict', 'en'],
    );
    expect(all).toHaveLength(1);
  });

  it('a different dict coexists (own filename + own audit row)', async () => {
    const h = await makeHarness(baseSet());
    await importStardict(h.ports);

    // Import a second, differently-named dict against the same ports.
    h.ports.readSet = async () =>
      baseSet({sidecarText: JSON.stringify({name: 'Other', language: 'de'})});
    const res2 = await importStardict(h.ports);
    expect(res2).toMatchObject({ok: true, filename: 'other.de.db'});

    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).not.toBeNull();
    expect(await findImportByNameLang(h.audit, 'Other', 'de')).not.toBeNull();
  });
});

describe('estimateImportBytes', () => {
  it('scales the dict byte length with headroom', () => {
    expect(estimateImportBytes(1000)).toBe(2500);
    expect(estimateImportBytes(0)).toBe(0);
  });
});

describe('importStardict — space guard (TF5-FR6)', () => {
  it('insufficient space -> {ok:false} tagged, nothing written or deleted', async () => {
    const set = baseSet();
    const required = estimateImportBytes(set.dict.length);
    const h = await makeHarness(set, {space: required - 1});
    const warn = jest.fn();
    const res = await importStardict(h.ports, {warn});
    expect(res).toEqual({
      ok: false,
      reason: `[import] insufficient space: need ${required}, have ${required - 1}`,
    });
    expect(h.slugFiles.size).toBe(0); // no slug DB opened
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('sufficient space -> import proceeds', async () => {
    const set = baseSet();
    const required = estimateImportBytes(set.dict.length);
    const h = await makeHarness(set, {space: required + 1000});
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(true);
  });
});
