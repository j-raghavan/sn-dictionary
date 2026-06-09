// Verify-then-delete StarDict import orchestration (TF5-FR3/FR4/FR6 +
// ADR-0006). The parse+insert is now NATIVE; here a FAKE runNativeImport
// seeds a known entries set into a host better-sqlite3 slug DB so the JS
// verify / discard / audit / delete logic runs against REAL sqlite. All
// the safety contracts (count-match, mismatch->discard+sources-left,
// space-shortfall->no-op, re-add/replace, audit-then-delete ordering,
// committed-state verify) are unchanged from the JS-import era — only
// the parse+insert moved to native, so the JS-buildDict/.syn/body-decode
// cases are gone.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {ensureImportsTable, findImportByNameLang} from '../src/core/dict/sqlite/importAudit';
import {
  estimateImportBytes,
  importStardict,
  type ImportPorts,
} from '../src/core/dict/sqlite/importStardict';
import {
  CREATE_ENTRIES_TABLE,
  SELECT_ENTRY_BY_KEY,
} from '../src/core/dict/sqlite/schema';
import type {SqliteDb} from '../src/core/dict/sqlite/db';
import type {RunNativeImport} from '../src/core/dict/sqlite/nativeImport';

const SIDECAR = JSON.stringify({name: 'My Dict', language: 'en'});
const DICT_BYTES = 1000;

type Harness = {
  ports: ImportPorts;
  runNativeImport: jest.Mock;
  statDictSize: jest.Mock;
  deleteFile: jest.Mock;
  deleteFolder: jest.Mock;
  slugFiles: Map<string, SqliteDb>;
  discard: jest.Mock;
  audit: SqliteDb;
};

type Opts = {
  sidecarText?: string;
  space?: number;
  // Override the .dict size the statDictSize port reports (default
  // DICT_BYTES).
  dictSize?: number;
  sourcePaths?: string[];
  // The rows the fake native importer "inserts" into the slug DB and
  // the count it reports (default: keyed entries below).
  nativeRows?: Array<{key: string; word: string; definition: string; format: string}>;
  // Override the count the native side REPORTS (to force a verify
  // mismatch even when rows are inserted) and/or make it throw.
  nativeReports?: number;
  nativeThrows?: Error;
  // Wire the FR3 subfolder cleanup (sourceFolder + deleteFolder).
  sourceFolder?: string;
};

const DEFAULT_ROWS = [
  {key: 'apple', word: 'apple', definition: 'a fruit', format: 'plain'},
  {key: 'banana', word: 'Banana', definition: 'a yellow fruit', format: 'plain'},
];

const makeHarness = async (opts: Opts = {}): Promise<Harness> => {
  const audit = await createSeededDb(async d => {
    await ensureImportsTable(d);
  });
  // filename -> the slug DB the (fake) native importer wrote.
  const slugFiles = new Map<string, SqliteDb>();
  const deleteFile = jest.fn(async () => undefined);
  const deleteFolder = jest.fn(async () => true);
  const discard = jest.fn(async (filename: string) => {
    slugFiles.delete(filename);
  });
  // The .dict-size port the space guard reads (native stat on-device).
  const statDictSize = jest.fn(async () => opts.dictSize ?? DICT_BYTES);

  const rows = opts.nativeRows ?? DEFAULT_ROWS;

  // Fake native import: seed `rows` into a fresh slug DB keyed by the
  // resolved dbPath's trailing filename, and resolve the reported count.
  const runNativeImport = jest.fn<ReturnType<RunNativeImport>, Parameters<RunNativeImport>>(
    async ({dbPath}) => {
      if (opts.nativeThrows) {
        throw opts.nativeThrows;
      }
      const filename = dbPath.split('/').pop() as string;
      const db = await createSeededDb(async d => {
        await d.run(CREATE_ENTRIES_TABLE);
        for (const r of rows) {
          await d.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
            r.key,
            r.word,
            r.definition,
            r.format,
          ]);
        }
      });
      slugFiles.set(filename, db);
      return {entryCount: opts.nativeReports ?? rows.length};
    },
  );

  const ports: ImportPorts = {
    runNativeImport,
    resolveSlugDbPath: filename => `plugins/sndictdfltbasev1/${filename}`,
    sidecarText: opts.sidecarText ?? SIDECAR,
    ifoPath: 'dict.ifo',
    idxPath: 'dict.idx',
    dictPath: 'dict.dict',
    // Real .dict size comes from this async port (native stat on-device);
    // the fake returns a known size so the space guard still fires.
    statDictSize,
    deleteFile,
    sourcePaths: opts.sourcePaths ?? ['dict.ifo', 'dict.idx', 'dict.dict', 'meta.json'],
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
    now: () => '2026-06-07T00:00:00Z',
  };
  if (opts.space !== undefined) {
    const space = opts.space;
    ports.getAvailableSpace = async () => space;
  }
  if (opts.sourceFolder !== undefined) {
    ports.sourceFolder = opts.sourceFolder;
    ports.deleteFolder = deleteFolder;
  }
  return {
    ports,
    runNativeImport,
    statDictSize,
    deleteFile,
    deleteFolder,
    slugFiles,
    discard,
    audit,
  };
};

describe('importStardict — happy path', () => {
  it('reopenForVerify is called with the SAME filename the native import wrote', async () => {
    const h = await makeHarness();
    const reopenSpy = jest.fn(h.ports.slugDb.reopenForVerify);
    h.ports.slugDb.reopenForVerify = reopenSpy;
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(true);
    // The native import wrote to resolveSlugDbPath(filename); verify
    // reopens by that same filename.
    expect(reopenSpy).toHaveBeenCalledTimes(1);
    expect(reopenSpy.mock.calls[0][0]).toBe('my-dict.en.db');
  });

  it('runs the native import, verifies COUNT, deletes sources, audits with now()', async () => {
    const h = await makeHarness();
    const res = await importStardict(h.ports);

    expect(res).toEqual({
      ok: true,
      filename: 'my-dict.en.db',
      entryCount: 2,
      name: 'My Dict',
      lang: 'en',
    });
    // The native import was called with the source paths + resolved dbPath.
    expect(h.runNativeImport).toHaveBeenCalledWith(
      expect.objectContaining({
        ifoPath: 'dict.ifo',
        idxPath: 'dict.idx',
        dictPath: 'dict.dict',
        dbPath: 'plugins/sndictdfltbasev1/my-dict.en.db',
      }),
    );
    // Rows landed in the slug DB.
    const slug = h.slugFiles.get('my-dict.en.db')!;
    const row = await slug.query(SELECT_ENTRY_BY_KEY, ['apple']);
    expect(row).toEqual([{word: 'apple', definition: 'a fruit', format: 'plain', phonetic: null}]);
    // All source files deleted; audit written with the deterministic stamp.
    expect(h.deleteFile).toHaveBeenCalledTimes(4);
    expect(await findImportByNameLang(h.audit, 'My Dict', 'en')).toEqual({
      name: 'My Dict',
      lang: 'en',
      entry_count: 2,
      imported_at: '2026-06-07T00:00:00Z',
      filename: 'my-dict.en.db',
    });
  });

  it('passes the sidecar format override to the native import', async () => {
    const h = await makeHarness({
      sidecarText: JSON.stringify({name: 'H Dict', language: 'en', format: 'html'}),
    });
    await importStardict(h.ports);
    expect(h.runNativeImport).toHaveBeenCalledWith(
      expect.objectContaining({format: 'html'}),
    );
  });

  it('passes NO format override when the sidecar omits it — the native importer derives it from the .ifo sametypesequence (h -> html), NOT a hardcoded plain', async () => {
    // SIDECAR sets only name + language (no `format`). Forcing 'plain' here
    // would shadow an HTML StarDict's own sametypesequence=h and render its
    // <i>/<ol>/<li> markup as literal text (the fr-en-strdict bug).
    const h = await makeHarness();
    await importStardict(h.ports);
    expect(h.runNativeImport.mock.calls[0][0].format).toBeUndefined();
  });

  it('forwards the optional .syn path to the native import', async () => {
    const h = await makeHarness();
    h.ports.synPath = 'dict.syn';
    await importStardict(h.ports);
    expect(h.runNativeImport).toHaveBeenCalledWith(
      expect.objectContaining({synPath: 'dict.syn'}),
    );
  });
});

describe('importStardict — audit-then-delete data safety', () => {
  it('audit write fails AFTER verify -> slug DB discarded, sources RETAINED', async () => {
    const h = await makeHarness();
    h.ports.audit = {
      ...h.audit,
      query: h.audit.query.bind(h.audit),
      run: h.audit.run.bind(h.audit),
      transaction: async () => {
        throw new Error('audit db locked');
      },
      close: h.audit.close.bind(h.audit),
    };
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('audit db locked');
    }
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
  });

  it('delete fails AFTER audit -> audit row PRESENT + slug DB NOT discarded', async () => {
    const h = await makeHarness();
    h.deleteFile.mockImplementation(async () => {
      throw new Error('deleteFile: permission denied');
    });
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(false);
    const audited = await findImportByNameLang(h.audit, 'My Dict', 'en');
    expect(audited).not.toBeNull();
    expect(h.discard).not.toHaveBeenCalled();
    expect(h.slugFiles.has('my-dict.en.db')).toBe(true);
  });

  it('happy path writes the audit row BEFORE deleting sources (ordering)', async () => {
    const order: string[] = [];
    const h = await makeHarness();
    const realTxn = h.audit.transaction.bind(h.audit);
    h.ports.audit = {
      ...h.audit,
      query: h.audit.query.bind(h.audit),
      run: h.audit.run.bind(h.audit),
      transaction: async fn => {
        order.push('audit');
        return realTxn(fn);
      },
      close: h.audit.close.bind(h.audit),
    };
    h.deleteFile.mockImplementation(async () => {
      order.push('delete');
    });
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(true);
    expect(order[0]).toBe('audit');
    expect(order.slice(1).every(e => e === 'delete')).toBe(true);
  });
});

describe('importStardict — failure isolation (sources LEFT)', () => {
  it('invalid sidecar JSON -> {ok:false}, nothing imported/deleted', async () => {
    const h = await makeHarness({sidecarText: '{not json'});
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(false);
    expect(h.runNativeImport).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.discard).not.toHaveBeenCalled();
  });

  it('sidecar failing validation -> {ok:false}, nothing imported', async () => {
    const h = await makeHarness({sidecarText: JSON.stringify({language: 'en'})});
    const res = await importStardict(h.ports);
    expect(res).toEqual({ok: false, reason: expect.stringContaining('name')});
    expect(h.runNativeImport).not.toHaveBeenCalled();
  });

  it('verify count mismatch -> discard slug db, sources LEFT', async () => {
    // Native inserts 2 rows but REPORTS 5 -> committed (2) !== expected (5).
    const h = await makeHarness({nativeReports: 5});
    const res = await importStardict(h.ports);
    expect(res).toEqual({
      ok: false,
      reason: 'verify failed: committed 2 rows, expected 5',
    });
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('verify reads committed-not-cached state (reopen sees the written rows)', async () => {
    // The fake native import writes the slug DB; reopenForVerify reads
    // THAT committed DB (a distinct handle in the real adapter). A
    // reopen that returns a 0-row DB would mismatch.
    const h = await makeHarness();
    h.ports.slugDb.reopenForVerify = async () =>
      createSeededDb(async d => {
        await d.run(CREATE_ENTRIES_TABLE); // 0 rows -> mismatch vs 2
      });
    const res = await importStardict(h.ports);
    expect(res).toEqual({
      ok: false,
      reason: 'verify failed: committed 0 rows, expected 2',
    });
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('a COUNT result set with no rows is treated as -1 (mismatch)', async () => {
    const h = await makeHarness();
    h.ports.slugDb.reopenForVerify = async () =>
      ({query: async () => []} as unknown as SqliteDb);
    const res = await importStardict(h.ports);
    expect(res).toEqual({
      ok: false,
      reason: 'verify failed: committed -1 rows, expected 2',
    });
    expect(h.discard).toHaveBeenCalledWith('my-dict.en.db');
  });

  it('native import THROWING -> {ok:false}, discard, sources LEFT', async () => {
    const h = await makeHarness({nativeThrows: new Error('parse error: truncated .idx')});
    const warn = jest.fn();
    const res = await importStardict(h.ports, {warn});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('truncated .idx');
    }
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('throw BEFORE a slug filename is assigned -> no discard attempted', async () => {
    const h = await makeHarness();
    h.ports.audit.query = async () => {
      throw new Error('audit unavailable');
    };
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(false);
    expect(h.discard).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('discard throwing during cleanup does not mask the original error', async () => {
    const h = await makeHarness({nativeThrows: new Error('boom')});
    h.ports.slugDb.discard = jest.fn(async () => {
      throw new Error('discard also failed');
    });
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('boom');
    }
    expect(h.deleteFile).not.toHaveBeenCalled();
  });
});

describe('importStardict — re-add + coexist', () => {
  it('re-importing the same name+lang replaces the audit row (one row)', async () => {
    const h = await makeHarness();
    await importStardict(h.ports);
    const res2 = await importStardict(h.ports);
    expect(res2.ok).toBe(true);
    const all = await h.audit.query(
      'SELECT name, lang FROM imports WHERE name=? AND lang=?',
      ['My Dict', 'en'],
    );
    expect(all).toHaveLength(1);
  });

  it('a different dict coexists (own filename + own audit row)', async () => {
    const h = await makeHarness();
    await importStardict(h.ports);
    h.ports.sidecarText = JSON.stringify({name: 'Other', language: 'de'});
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
  it('sizes the estimate from statDictSize (real .dict size, not a hardcoded 0)', async () => {
    // The fix: the guard reads the size from the port. A LARGE .dict
    // (50 MB) with too little free space must be refused — a hardcoded 0
    // would estimate 0 and never trip.
    const dictSize = 50_000_000;
    const required = estimateImportBytes(dictSize);
    const h = await makeHarness({dictSize, space: required - 1});
    const warn = jest.fn();
    const res = await importStardict(h.ports, {warn});
    expect(res).toEqual({
      ok: false,
      reason: `[import] insufficient space: need ${required}, have ${required - 1}`,
    });
    expect(h.statDictSize).toHaveBeenCalledTimes(1);
    expect(h.runNativeImport).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it('insufficient space -> {ok:false} tagged, nothing imported or deleted', async () => {
    const required = estimateImportBytes(DICT_BYTES);
    const h = await makeHarness({space: required - 1});
    const warn = jest.fn();
    const res = await importStardict(h.ports, {warn});
    expect(res).toEqual({
      ok: false,
      reason: `[import] insufficient space: need ${required}, have ${required - 1}`,
    });
    expect(h.statDictSize).toHaveBeenCalled();
    expect(h.runNativeImport).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('sufficient space -> import proceeds', async () => {
    const required = estimateImportBytes(DICT_BYTES);
    const h = await makeHarness({space: required + 1000});
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(true);
    expect(h.statDictSize).toHaveBeenCalled();
  });

  it('skipped when no free-space probe is installed (guard no-op)', async () => {
    // No getAvailableSpace -> checkSpace returns early; the import
    // proceeds regardless of the .dict size.
    const h = await makeHarness(); // no `space` -> no getAvailableSpace
    expect(h.ports.getAvailableSpace).toBeUndefined();
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(true);
    expect(h.runNativeImport).toHaveBeenCalled();
  });
});

describe('importStardict — subfolder cleanup (FR3)', () => {
  it('removes the StarDict subfolder after a verified import', async () => {
    const h = await makeHarness({
      sourcePaths: ['/d/Fr/x.ifo', '/d/Fr/x.idx', '/d/Fr/x.dict', '/d/Fr/meta.json'],
      sourceFolder: '/d/Fr',
    });
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(true);
    expect(h.deleteFolder).toHaveBeenCalledWith('/d/Fr');
  });

  it('does not remove the subfolder on a failed import (verify mismatch)', async () => {
    const h = await makeHarness({nativeReports: 99, sourceFolder: '/d/Fr'});
    const res = await importStardict(h.ports);
    expect(res.ok).toBe(false);
    expect(h.deleteFolder).not.toHaveBeenCalled();
  });
});
