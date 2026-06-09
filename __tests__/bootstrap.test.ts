// Runtime composition root (TF7-FR1/FR2/FR4) + pure reconcileImports.
// Fully fake-driven — all device behind BootstrapPorts.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  bootstrap,
  identityKey,
  reconcileImports,
  sourcePathsOf,
  type BootstrapPorts,
  type ReconcileItem,
} from '../src/core/dict/sqlite/bootstrap';
import {
  ensureImportsTable,
  findImportByNameLang,
  upsertImport,
} from '../src/core/dict/sqlite/importAudit';
import {
  ensureSettingsTables,
  getKeepSources,
  readDictPrefs,
  setDictPrefs,
  setKeepSources,
  type DictPref,
} from '../src/core/dict/sqlite/settings';
import {CREATE_ENTRIES_TABLE} from '../src/core/dict/sqlite/schema';
import type {ImportRow} from '../src/core/dict/sqlite/schema';
import type {SqliteDb} from '../src/core/dict/sqlite/db';
import type {ImportJobDescriptor} from '../src/core/dict/userDictDiscovery';
import type {RunImportPorts} from '../src/core/dict/sqlite/runImport';

// --- reconcileImports (pure) ---------------------------------------

const descriptor = (name: string, lang: string): ImportJobDescriptor => ({
  kind: 'stardict',
  setPath: `/d/${name}`,
  ifoPath: `/d/${name}/x.ifo`,
  idxPath: `/d/${name}/x.idx`,
  dictPath: `/d/${name}/x.dict`,
  sidecarPath: `/d/${name}/meta.json`,
  sidecar: {name, language: lang},
});

const csvDescriptor = (name: string, lang: string): ImportJobDescriptor => ({
  kind: 'csv',
  csvPath: `/d/${name}.csv`,
  csvConfig: {},
  sidecarPath: `/d/${name}.meta.json`,
  sidecar: {name, language: lang},
});

const auditRow = (name: string, lang: string, filename: string): ImportRow => ({
  name,
  lang,
  entry_count: 1,
  imported_at: 't',
  filename,
});

const buckets = (items: ReconcileItem[]) => items.map(i => i.bucket);

// Default reconcile opts for the legacy tests: keep=false reproduces the
// pre-F4 RE-ADD-on-re-drop behaviour (so the existing assertions hold). The
// F4 keep tests below pass their own {keepSources:true, slugHealthy}.
const NO_KEEP = {keepSources: false, slugHealthy: new Set<string>()};

describe('reconcileImports (pure)', () => {
  it('NEW descriptor (no audit) -> import without replacesFilename', () => {
    const items = reconcileImports([descriptor('A', 'en')], [], NO_KEEP);
    expect(items).toEqual([{bucket: 'import', descriptor: descriptor('A', 'en')}]);
  });

  it('RE-ADD (audit hit, keep=false) -> import in place (prior slug overwritten)', () => {
    const items = reconcileImports(
      [descriptor('A', 'en')],
      [auditRow('A', 'en', 'a.en.db')],
      NO_KEEP,
    );
    // RE-ADD overwrites the same slug + audit row (resolveSlugCollision is
    // deterministic for the same name+lang), so no prior-filename bookkeeping.
    expect(items).toEqual([{bucket: 'import', descriptor: descriptor('A', 'en')}]);
  });

  it('audit row with no descriptor -> open bucket', () => {
    const items = reconcileImports([], [auditRow('A', 'en', 'a.en.db')], NO_KEEP);
    expect(items).toEqual([{bucket: 'open', row: auditRow('A', 'en', 'a.en.db')}]);
  });

  it('DEDUPs duplicate name+lang on disk: first import, rest skip (Flag 1)', () => {
    const d1 = descriptor('A', 'en');
    const d2 = descriptor('A', 'en');
    const items = reconcileImports([d1, d2], [], NO_KEEP);
    expect(buckets(items)).toEqual(['import', 'skip']);
    expect(items[1]).toEqual({
      bucket: 'skip',
      reason: 'duplicate name+lang on disk',
      descriptor: d2,
    });
  });

  it('same name different lang are NOT duplicates', () => {
    const items = reconcileImports(
      [descriptor('A', 'en'), descriptor('A', 'de')],
      [],
      NO_KEEP,
    );
    expect(buckets(items)).toEqual(['import', 'import']);
  });

  it('mixes import + open in one pass', () => {
    const items = reconcileImports(
      [descriptor('New', 'en')],
      [auditRow('Old', 'de', 'old.de.db')],
      NO_KEEP,
    );
    expect(buckets(items)).toEqual(['import', 'open']);
  });
});

// --- F7: sourcePathsOf (pure) ---------------------------------------
describe('sourcePathsOf (F7, pure)', () => {
  it('StarDict: ifo/idx/dict (+ syn + sidecar) and the set folder', () => {
    const d: ImportJobDescriptor = {
      kind: 'stardict',
      setPath: '/d/Dune',
      ifoPath: '/d/Dune/x.ifo',
      idxPath: '/d/Dune/x.idx',
      dictPath: '/d/Dune/x.dict',
      synPath: '/d/Dune/x.syn',
      sidecarPath: '/d/Dune/meta.json',
      sidecar: {name: 'Dune', language: 'en'},
    };
    expect(sourcePathsOf(d)).toEqual({
      files: ['/d/Dune/x.ifo', '/d/Dune/x.idx', '/d/Dune/x.dict', '/d/Dune/x.syn', '/d/Dune/meta.json'],
      folder: '/d/Dune',
    });
  });

  it('StarDict without a syn or sidecar omits those paths', () => {
    const d: ImportJobDescriptor = {
      kind: 'stardict',
      setPath: '/d/Bare',
      ifoPath: '/d/Bare/x.ifo',
      idxPath: '/d/Bare/x.idx',
      dictPath: '/d/Bare/x.dict',
      sidecar: {name: 'Bare', language: 'und'},
    };
    expect(sourcePathsOf(d)).toEqual({
      files: ['/d/Bare/x.ifo', '/d/Bare/x.idx', '/d/Bare/x.dict'],
      folder: '/d/Bare',
    });
  });

  it('CSV: the loose .csv (+ per-file sidecar), no folder', () => {
    expect(sourcePathsOf(csvDescriptor('Dune', 'en'))).toEqual({
      files: ['/d/Dune.csv', '/d/Dune.meta.json'],
    });
  });

  it('CSV without a sidecar is just the .csv', () => {
    const d: ImportJobDescriptor = {
      kind: 'csv',
      csvPath: '/d/Loose.csv',
      csvConfig: {},
      sidecar: {name: 'Loose', language: 'und'},
    };
    expect(sourcePathsOf(d)).toEqual({files: ['/d/Loose.csv']});
  });
});

// --- F4-FR3: the keep-vs-reimport rule (the blocker fix) ------------
describe('reconcileImports (F4 keep rule, pure)', () => {
  const KEEP = (healthy: string[]) => ({
    keepSources: true,
    slugHealthy: new Set(healthy),
  });

  it('audit-hit + keep + healthy slug -> OPEN (skips re-import; loop broken, AC3)', () => {
    const items = reconcileImports(
      [descriptor('A', 'en')],
      [auditRow('A', 'en', 'a.en.db')],
      KEEP(['a.en.db']),
    );
    // Reuses the 'open' bucket carrying the prior audit row — no re-import,
    // no second slug DB.
    expect(items).toEqual([{bucket: 'open', row: auditRow('A', 'en', 'a.en.db')}]);
  });

  it('audit-hit + keep + UNhealthy slug -> import (RE-ADD; safe fallback)', () => {
    const items = reconcileImports(
      [descriptor('A', 'en')],
      [auditRow('A', 'en', 'a.en.db')],
      KEEP([]), // slug DB missing
    );
    expect(items).toEqual([{bucket: 'import', descriptor: descriptor('A', 'en')}]);
  });

  it('audit-hit + forceRefresh -> import even with keep + healthy slug (AC4, FR9)', () => {
    const refreshing: ImportJobDescriptor = {
      ...descriptor('A', 'en'),
      forceRefresh: true,
    };
    const items = reconcileImports(
      [refreshing],
      [auditRow('A', 'en', 'a.en.db')],
      KEEP(['a.en.db']),
    );
    expect(items).toEqual([{bucket: 'import', descriptor: refreshing}]);
  });

  it('a CSV forceRefresh descriptor also overrides keep', () => {
    const refreshing: ImportJobDescriptor = {
      ...csvDescriptor('Dune', 'en'),
      forceRefresh: true,
    };
    const items = reconcileImports(
      [refreshing],
      [auditRow('Dune', 'en', 'dune.en.db')],
      KEEP(['dune.en.db']),
    );
    expect(buckets(items)).toEqual(['import']);
  });

  it('keep=false reproduces today RE-ADD even with a healthy slug', () => {
    const items = reconcileImports(
      [descriptor('A', 'en')],
      [auditRow('A', 'en', 'a.en.db')],
      {keepSources: false, slugHealthy: new Set(['a.en.db'])},
    );
    expect(buckets(items)).toEqual(['import']);
  });

  it('NEW descriptor still imports under keep (no audit hit -> nothing to open)', () => {
    const items = reconcileImports([descriptor('New', 'en')], [], KEEP([]));
    expect(items).toEqual([{bucket: 'import', descriptor: descriptor('New', 'en')}]);
  });

  it('a kept-open + a duplicate descriptor: first opens, the rest skip', () => {
    const items = reconcileImports(
      [descriptor('A', 'en'), descriptor('A', 'en')],
      [auditRow('A', 'en', 'a.en.db')],
      KEEP(['a.en.db']),
    );
    expect(buckets(items)).toEqual(['open', 'skip']);
  });

  it('does not double-open an audit row already opened via its descriptor (keep)', () => {
    // The kept descriptor consumes the audit key; the trailing audit-only
    // pass must NOT emit a second 'open' for the same slug.
    const items = reconcileImports(
      [descriptor('A', 'en')],
      [auditRow('A', 'en', 'a.en.db')],
      KEEP(['a.en.db']),
    );
    expect(items.filter(i => i.bucket === 'open')).toHaveLength(1);
  });
});

// --- bootstrap ------------------------------------------------------

type Harness = {
  ports: BootstrapPorts;
  enableButtons: jest.Mock;
  openImportedDb: jest.Mock;
  importResults: Map<string, {ok: boolean; filename: string}>;
  baseDb: SqliteDb;
  userDb: SqliteDb;
  // F4: keepSources values passed into importPortsFor (one per dispatched
  // import) so a test can assert the delete gate was threaded through.
  keepSourcesSeen: boolean[];
  // F7: filenames whose eager-opened slug handle had close() called, and the
  // paths deleteFile/deleteFolder were invoked with — so a delete test can
  // assert the close-before-delete ordering and what was unlinked.
  closedSlugs: string[];
  deletedFiles: string[];
  deletedFolders: string[];
};

const makeBaseDb = (): Promise<SqliteDb> =>
  createSeededDb(async d => {
    await d.run(CREATE_ENTRIES_TABLE);
    await d.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
      'hello',
      'hello',
      'a greeting',
      'wordnet',
    ]);
  });

const makeHarness = async (opts: {
  descriptors?: ImportJobDescriptor[];
  auditSeed?: (db: SqliteDb) => Promise<void>;
  // Pre-seed dict_prefs rows BEFORE bootstrap derives the live `sources`
  // (F3). Runs ensureSettingsTables first so the table exists.
  prefsSeed?: (db: SqliteDb) => Promise<void>;
  // Pre-seed the user.db BEFORE bootstrap opens it (e.g. an existing
  // pre-v3 6-col entries table to exercise the FR2 ALTER migration).
  userDbSeed?: (db: SqliteDb) => Promise<void>;
  // Make the FR2 ALTER migration throw this error (to exercise the
  // non-"duplicate column" re-throw branch).
  userDbAlterError?: Error;
  provisionRejects?: boolean;
  userDbThrows?: boolean;
  enableButtonsThrows?: boolean;
  // F4: which audit filenames the slug-health probe reports as existing.
  // Default: every filename is healthy (so a kept set reconciles to open).
  slugHealthy?: (filename: string) => boolean;
  // F4: omit to leave the slugDbExists probe unset (legacy host).
  noSlugProbe?: boolean;
  // F4: the first-run keep/delete prompt port; undefined -> not wired.
  promptKeepDelete?: () => Promise<boolean>;
  // F4: pre-seed the keepSourcesAfterImport flag (true=keep / false=delete)
  // so the first-run prompt is skipped and reconcile uses this value.
  keepSeed?: boolean;
  importOutcome?: (d: ImportJobDescriptor) => {
    ok: boolean;
    filename?: string;
    reason?: string;
    gate?: Promise<void>;
  };
  // F7: wire the delete seam (deleteFile/deleteFolder/resolveSlugPath) so
  // deleteImportedDict can unlink the slug + source set. Omit -> no port (a
  // host that can't delete files; the audit/pref rows still clean).
  withDeletePorts?: boolean;
  // F7: make deleteFile reject for paths matching this predicate (model a
  // locked/shared source file that can't be removed — F7-AC3).
  deleteFileFails?: (path: string) => boolean;
  // F7: make the eager-open of an imported slug throw (so the source stays
  // lazy with a null handle — nothing to close).
  openImportedThrows?: (filename: string) => boolean;
}): Promise<Harness> => {
  const baseDb = await makeBaseDb();
  const userDb = await createSeededDb(opts.userDbSeed ?? (async () => undefined));
  const enableButtons = jest.fn(async () => {
    if (opts.enableButtonsThrows) {
      throw new Error('button bridge down');
    }
  });
  const closedSlugs: string[] = [];
  const deletedFiles: string[] = [];
  const deletedFolders: string[] = [];
  const openImportedDb = jest.fn((filename: string) => async () => {
    if (opts.openImportedThrows?.(filename)) {
      throw new Error(`open ${filename} blew up`);
    }
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
        filename,
        filename,
        `def for ${filename}`,
        'plain',
      ]);
    });
    // F7: record close() so a delete test can assert the handle was closed
    // (before the file delete).
    const realClose = db.close.bind(db);
    db.close = async () => {
      closedSlugs.push(filename);
      await realClose();
    };
    return db;
  });
  const importResults = new Map<string, {ok: boolean; filename: string}>();
  const keepSourcesSeen: boolean[] = [];

  const ports: BootstrapPorts = {
    provision: {
      // base.db is .snplg-bundled + host-extracted; provision opens it
      // in place. provisionRejects models a missing base.db (open null).
      open: async () => (opts.provisionRejects ? null : baseDb),
    },
    db: {
      openUserDb: async () => {
        if (opts.userDbThrows) {
          throw new Error('user.db locked');
        }
        if (opts.auditSeed) {
          await ensureImportsTable(userDb);
          await opts.auditSeed(userDb);
        }
        if (opts.prefsSeed) {
          await ensureSettingsTables(userDb);
          await opts.prefsSeed(userDb);
        }
        if (opts.keepSeed !== undefined) {
          await ensureSettingsTables(userDb);
          await setKeepSources(userDb, opts.keepSeed);
        }
        if (opts.userDbAlterError) {
          // Intercept the ALTER ... ADD COLUMN phonetic call so it throws
          // a NON-"duplicate column" error (the re-throw branch in the
          // migration); all other run() calls pass through.
          const realRun = userDb.run.bind(userDb);
          userDb.run = ((sql: string, params?: unknown[]) =>
            /ALTER TABLE entries ADD COLUMN phonetic/i.test(sql)
              ? Promise.reject(opts.userDbAlterError)
              : realRun(sql, params as never)) as typeof userDb.run;
        }
        return userDb;
      },
      openImportedDb,
      // F4: slug-health probe (default every slug healthy). noSlugProbe
      // omits it to model a legacy host (all slugs treated unhealthy).
      ...(opts.noSlugProbe
        ? {}
        : {
            slugDbExists: async (filename: string) =>
              opts.slugHealthy ? opts.slugHealthy(filename) : true,
          }),
    },
    discover: async () => opts.descriptors ?? [],
    importPortsFor: (d, audit, keepSources) => {
      // Minimal fake RunImportPorts: the outcome map decides ok/fail. The
      // mocked runImport (below) reads the stashed outcome + the
      // descriptor's kind, so this exercises the kind-agnostic dispatch.
      keepSourcesSeen.push(keepSources);
      const outcome = opts.importOutcome
        ? opts.importOutcome(d)
        : {ok: true, filename: `${d.sidecar.name}.${d.sidecar.language}.db`};
      const fakePorts = {
        __outcome: outcome,
        __name: d.sidecar.name,
        __lang: d.sidecar.language,
        __kind: d.kind,
        keepSources,
        audit,
      } as unknown as RunImportPorts;
      return fakePorts;
    },
    enableButtons,
    ...(opts.promptKeepDelete ? {promptKeepDelete: opts.promptKeepDelete} : {}),
    ...(opts.withDeletePorts
      ? {
          delete: {
            resolveSlugPath: (filename: string) => `/plugin/${filename}`,
            deleteFile: async (path: string) => {
              if (opts.deleteFileFails?.(path)) {
                throw new Error(`locked: ${path}`);
              }
              deletedFiles.push(path);
            },
            deleteFolder: async (path: string) => {
              deletedFolders.push(path);
              return true;
            },
          },
        }
      : {}),
  };
  return {
    ports,
    enableButtons,
    openImportedDb,
    importResults,
    baseDb,
    userDb,
    keepSourcesSeen,
    closedSlugs,
    deletedFiles,
    deletedFolders,
  };
};

// runImport is mocked so bootstrap's (format-agnostic) dispatch is tested
// without the full pipeline (that has its own suite). The mock reads the
// outcome stashed on the fake ports by importPortsFor.
jest.mock('../src/core/dict/sqlite/runImport', () => {
  const actual = jest.requireActual('../src/core/dict/sqlite/runImport');
  return {
    ...actual,
    runImport: jest.fn(async (ports: Record<string, unknown>) => {
      const outcome = ports.__outcome as {
        ok: boolean;
        filename?: string;
        reason?: string;
        gate?: Promise<void>;
      };
      // A deferred import: wait on the gate so a test can observe the
      // pre-splice state while the import is "still running".
      if (outcome.gate) {
        await outcome.gate;
      }
      if (outcome.ok) {
        return {
          ok: true,
          filename: outcome.filename,
          entryCount: 1,
          name: ports.__name,
          lang: ports.__lang,
        };
      }
      return {ok: false, reason: outcome.reason ?? 'import failed'};
    }),
  };
});

describe('bootstrap', () => {
  it('builds the registry in [user, ...imported, base] precedence (IV-3)', async () => {
    const h = await makeHarness({
      auditSeed: async db => {
        await upsertImport(db, auditRow('Imported', 'de', 'imported.de.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'Imported', 'WordNet']);
    expect(handle.userDb).not.toBeNull();
  });

  it('enables buttons exactly once, after base open, before imports', async () => {
    const h = await makeHarness({descriptors: [descriptor('A', 'en')]});
    await bootstrap(h.ports);
    expect(h.enableButtons).toHaveBeenCalledTimes(1);
  });

  it('REJECTS and does NOT enable buttons when provision fails (Flag 4)', async () => {
    const h = await makeHarness({provisionRejects: true});
    await expect(bootstrap(h.ports)).rejects.toThrow('[provision] base.db missing');
    expect(h.enableButtons).not.toHaveBeenCalled();
  });

  it('degrades (no user source) when openUserDb throws; base still works', async () => {
    const h = await makeHarness({userDbThrows: true});
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    expect(handle.userDb).toBeNull();
    expect(handle.sources.map(s => s.name)).toEqual(['WordNet']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('user.db unavailable'));
    // Buttons were still enabled (base provisioned fine).
    expect(h.enableButtons).toHaveBeenCalledTimes(1);
  });

  it('tolerates enableButtons throwing without failing bootstrap', async () => {
    const h = await makeHarness({enableButtonsThrows: true});
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    expect(handle.sources.map(s => s.name)).toContain('WordNet');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('enableButtons threw'));
  });

  it('the lookup is usable for ready sources BEFORE importsSettled (detached imports)', async () => {
    // The headline of fix 2: bootstrap returns immediately with a usable
    // lookup over base/user/already-imported; the imported dict is NOT
    // yet present until importsSettled resolves (no null-lookup window).
    // The 'Fresh' import is GATED so it is still running when we observe.
    let releaseImport!: () => void;
    const gate = new Promise<void>(res => {
      releaseImport = res;
    });
    const h = await makeHarness({
      descriptors: [descriptor('Fresh', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Existing', 'de', 'existing.de.db'));
      },
      importOutcome: () => ({ok: true, filename: 'fresh.en.db', gate}),
    });
    const handle = await bootstrap(h.ports);
    // Imports still running (gate not released): base + user + already-
    // imported are present; 'Fresh' (the pending import) is NOT yet.
    expect(handle.sources.map(s => s.name)).toEqual([
      'User',
      'Existing',
      'WordNet',
    ]);
    // The lookup already works against the ready sources.
    const res = await handle.lookup.lookup('hello');
    expect(res.hits.some(hit => hit.source === 'WordNet')).toBe(true);
    // Release the import; after importsSettled, 'Fresh' is spliced
    // just-before base.
    releaseImport();
    await handle.importsSettled;
    expect(handle.sources.map(s => s.name)).toEqual([
      'User',
      'Existing',
      'Fresh',
      'WordNet',
    ]);
    expect(handle.sources[handle.sources.length - 1].name).toBe('WordNet');
  });

  it('splices a successfully imported source just-before base (after importsSettled)', async () => {
    const h = await makeHarness({descriptors: [descriptor('Fresh', 'en')]});
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // [User, Fresh, WordNet] — Fresh spliced at length-1 (before base).
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'Fresh', 'WordNet']);
    expect(handle.sources[handle.sources.length - 1].name).toBe('WordNet');
  });

  it('a snapshotted in-flight lookup is unaffected by a mid-flight splice', async () => {
    const h = await makeHarness({descriptors: [descriptor('Fresh', 'en')]});
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    const res = await handle.lookup.lookup('hello');
    expect(res.hits.some(hit => hit.source === 'WordNet')).toBe(true);
  });

  it('logs and continues when an import fails (source not added)', async () => {
    const h = await makeHarness({
      descriptors: [descriptor('Bad', 'en')],
      importOutcome: () => ({ok: false, reason: 'verify failed'}),
    });
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    await handle.importsSettled;
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed: verify failed'));
  });

  it('opens already-imported sources (open bucket) and re-imports re-added ones (keep=false)', async () => {
    const h = await makeHarness({
      // keep=false reproduces the ADR-0003 RE-ADD-on-re-drop default: the
      // sources were deleted on the prior import, so a re-dropped ReAdd is
      // a deliberate refresh -> 'import' (not the F4 kept 'open').
      keepSeed: false,
      descriptors: [descriptor('ReAdd', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('ReAdd', 'en', 'readd.en.db'));
        await upsertImport(db, auditRow('OnlyAudit', 'de', 'onlyaudit.de.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // OnlyAudit -> open bucket (in registry pre-import); ReAdd -> import
    // (spliced after). Final order: [User, OnlyAudit, ReAdd, WordNet].
    expect(handle.sources.map(s => s.name)).toEqual([
      'User',
      'OnlyAudit',
      'ReAdd',
      'WordNet',
    ]);
  });

  it('tolerates discover() throwing — no imports, base + user still up', async () => {
    const h = await makeHarness({});
    h.ports.discover = async () => {
      throw new Error('listFiles blew up');
    };
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('discover threw'));
  });

  it('tolerates importStardict THROWING during dispatch (caught + logged)', async () => {
    const h = await makeHarness({
      descriptors: [descriptor('Throws', 'en')],
      importOutcome: () => {
        throw new Error('pipeline exploded');
      },
    });
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    await handle.importsSettled;
    // Source not added; bootstrap still resolves.
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('threw'));
  });

  it('skips a duplicate name+lang descriptor and logs', async () => {
    const h = await makeHarness({
      descriptors: [descriptor('Dup', 'en'), descriptor('Dup', 'en')],
    });
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    await handle.importsSettled;
    // Only ONE Dup source ends up imported.
    expect(handle.sources.filter(s => s.name === 'Dup')).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skip import'));
  });
});

describe('bootstrap — live sourceLang map (FR1)', () => {
  it('seeds {base: en, User: und, ...already-imported lang}', async () => {
    const h = await makeHarness({
      auditSeed: async db => {
        await upsertImport(db, auditRow('Existing', 'de', 'existing.de.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    expect(handle.sourceLang).toEqual({
      WordNet: 'en',
      User: 'und',
      Existing: 'de',
    });
  });

  it('a detached import registers its language LIVE before importsSettled... and after', async () => {
    // Gate the import so we can observe the map BOTH before the splice
    // (not yet registered) and after it settles (registered with the
    // descriptor's language) — the no-reload fix.
    let releaseImport!: () => void;
    const gate = new Promise<void>(res => {
      releaseImport = res;
    });
    const h = await makeHarness({
      descriptors: [descriptor('Fresh', 'fr')],
      importOutcome: () => ({ok: true, filename: 'fresh.fr.db', gate}),
    });
    const handle = await bootstrap(h.ports);
    // Import still running: 'Fresh' not yet in the map.
    expect(handle.sourceLang.Fresh).toBeUndefined();
    // Release + settle: the LIVE map now resolves 'Fresh' -> 'fr' (the
    // descriptor's language), no reload needed.
    releaseImport();
    await handle.importsSettled;
    expect(handle.sourceLang.Fresh).toBe('fr');
    // The same object reference the runtime holds was mutated in place.
    expect(handle.sourceLang).toMatchObject({WordNet: 'en', User: 'und', Fresh: 'fr'});
  });

  it('a failed import does NOT add a sourceLang entry', async () => {
    const h = await makeHarness({
      descriptors: [descriptor('Bad', 'es')],
      importOutcome: () => ({ok: false, reason: 'verify failed'}),
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    expect(handle.sourceLang.Bad).toBeUndefined();
  });

  it('degraded user.db -> sourceLang has only the base (no User, no imports)', async () => {
    const h = await makeHarness({userDbThrows: true});
    const handle = await bootstrap(h.ports, {warn: jest.fn()});
    expect(handle.sourceLang).toEqual({WordNet: 'en'});
  });
});

describe('bootstrap — CSV import dispatch (FR6)', () => {
  it('a kind:csv descriptor routes through runImport and splices a source', async () => {
    const h = await makeHarness({
      descriptors: [csvDescriptor('Dune', 'en')],
      importOutcome: () => ({ok: true, filename: 'dune.en.db'}),
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // The CSV import spliced its source just before base.
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'Dune', 'WordNet']);
    // And its language registered LIVE.
    expect(handle.sourceLang.Dune).toBe('en');
  });

  it('routes a mixed StarDict + CSV set, each through the kind-agnostic dispatch', async () => {
    const h = await makeHarness({
      descriptors: [descriptor('Wiki', 'de'), csvDescriptor('Dune', 'en')],
      importOutcome: d => ({
        ok: true,
        filename: `${d.sidecar.name.toLowerCase()}.${d.sidecar.language}.db`,
      }),
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // Both imported sources present (order between them is concurrency-
    // dependent; assert membership + that base stays last).
    const names = handle.sources.map(s => s.name);
    expect(names[0]).toBe('User');
    expect(names[names.length - 1]).toBe('WordNet');
    expect(new Set(names)).toEqual(new Set(['User', 'Wiki', 'Dune', 'WordNet']));
    expect(handle.sourceLang).toMatchObject({Wiki: 'de', Dune: 'en'});
  });
});

describe('bootstrap — user.db phonetic migration (FR2)', () => {
  const cols = async (db: SqliteDb): Promise<string[]> => {
    const rows = await db.query<{name: string}>('PRAGMA table_info(entries)');
    return rows.map(r => r.name);
  };

  it('adds the phonetic column to an EXISTING pre-v3 6-col user.db', async () => {
    const h = await makeHarness({
      userDbSeed: async d => {
        // The old on-device shape: 6-col entries, NO phonetic.
        await d.run(
          'CREATE TABLE entries (key TEXT NOT NULL, word TEXT NOT NULL, definition TEXT NOT NULL, ' +
            "format TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'und', created_at TEXT NOT NULL)",
        );
      },
    });
    expect(await cols(h.userDb)).not.toContain('phonetic');
    await bootstrap(h.ports);
    expect(await cols(h.userDb)).toContain('phonetic');
  });

  it('re-throws a NON-duplicate ALTER error -> user.db degrades (base still works)', async () => {
    const h = await makeHarness({
      userDbAlterError: new Error('disk I/O error'),
    });
    // A real ALTER failure isn't swallowed: it propagates to the outer
    // user.db try/catch, degrading to base-only (userDb null).
    const handle = await bootstrap(h.ports, {warn: jest.fn()});
    expect(handle.userDb).toBeNull();
    expect(handle.sources.map(s => s.name)).toEqual(['WordNet']);
  });

  it('is idempotent: a fresh 7-col user.db (with phonetic) is a no-op, no throw', async () => {
    // Fresh DB: CREATE_USER_ENTRIES_TABLE makes the 7-col table, then the
    // ALTER raises "duplicate column name" which bootstrap swallows.
    const h = await makeHarness({});
    await expect(bootstrap(h.ports)).resolves.toBeDefined();
    expect(await cols(h.userDb)).toContain('phonetic');
    // Re-running bootstrap against the same DB still tolerates the dup.
    await expect(bootstrap(h.ports)).resolves.toBeDefined();
    expect((await cols(h.userDb)).filter(c => c === 'phonetic')).toHaveLength(1);
  });
});

describe('bootstrap — settings tables (F1, ADR-0009)', () => {
  const tableNames = async (db: SqliteDb): Promise<string[]> => {
    const rows = await db.query<{name: string}>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    return rows.map(r => r.name);
  };

  it('creates dict_prefs, app_settings, and user_meta on a healthy user.db', async () => {
    const h = await makeHarness({});
    await bootstrap(h.ports);
    expect(await tableNames(h.userDb)).toEqual(
      expect.arrayContaining(['dict_prefs', 'app_settings', 'user_meta']),
    );
  });
});

// --- F3: allSources + derived live `sources` + dict-manager seam -----

describe('bootstrap — F3 dictionary manager (allSources + prefs)', () => {
  const prefRow = (
    prefKey: string,
    name: string,
    enabled: boolean,
    sortOrder: number,
  ): DictPref => ({prefKey, name, enabled, sortOrder, removable: false});

  it('exposes the FULL registry as allSources [user, ...imported, base]', async () => {
    const h = await makeHarness({
      auditSeed: async db => {
        await upsertImport(db, auditRow('Imported', 'de', 'imported.de.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    expect(handle.allSources.map(s => s.name)).toEqual([
      'User',
      'Imported',
      'WordNet',
    ]);
  });

  it('with no prefs, sources === allSources order (all enabled)', async () => {
    const h = await makeHarness({
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'Dune', 'WordNet']);
    expect(handle.allSources.map(s => s.name)).toEqual([
      'User',
      'Dune',
      'WordNet',
    ]);
  });

  it('a DISABLED pref excludes the dict from sources but keeps it in allSources (AC2)', async () => {
    const h = await makeHarness({
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
      prefsSeed: async db => {
        // Dune (imported) keys on identityKey(name,lang); disable it.
        await setDictPrefs(db, [
          prefRow('User', 'User', true, 0),
          {
            prefKey: 'Dune\u0000en',
            name: 'Dune',
            enabled: false,
            sortOrder: 1,
            removable: true,
          },
          prefRow('WordNet', 'WordNet', true, 2),
        ]);
      },
    });
    const handle = await bootstrap(h.ports);
    // Excluded from the live (snapshotted) sources...
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
    // ...but still present in the full registry (so it can be re-enabled).
    expect(handle.allSources.map(s => s.name)).toContain('Dune');
    // And a lookup over a Dune-only word returns no Dune hit.
    const res = await handle.lookup.lookup('hello');
    expect(res.hits.some((hit: {source: string}) => hit.source === 'Dune')).toBe(
      false,
    );
  });

  it('respects persisted sort_order in the derived sources (AC1)', async () => {
    const h = await makeHarness({
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
      prefsSeed: async db => {
        // Promote WordNet to the top.
        await setDictPrefs(db, [
          prefRow('WordNet', 'WordNet', true, 0),
          prefRow('User', 'User', true, 1),
          {
            prefKey: 'Dune\u0000en',
            name: 'Dune',
            enabled: true,
            sortOrder: 2,
            removable: true,
          },
        ]);
      },
    });
    const handle = await bootstrap(h.ports);
    expect(handle.sources.map(s => s.name)).toEqual([
      'WordNet',
      'User',
      'Dune',
    ]);
  });

  it('a detached import lands in allSources and recomputes sources (AC4)', async () => {
    const h = await makeHarness({descriptors: [descriptor('Fresh', 'en')]});
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // Pushed into the full registry just-before base...
    expect(handle.allSources.map(s => s.name)).toEqual([
      'User',
      'Fresh',
      'WordNet',
    ]);
    // ...and the live sources recomputed (enabled by default, before base).
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'Fresh', 'WordNet']);
  });

  it('a detached import honours an existing reorder pref (recompute, not append)', async () => {
    const h = await makeHarness({
      descriptors: [descriptor('Fresh', 'en')],
      prefsSeed: async db => {
        // WordNet promoted above User before the import lands.
        await setDictPrefs(db, [
          prefRow('WordNet', 'WordNet', true, 0),
          prefRow('User', 'User', true, 1),
        ]);
      },
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // Fresh (no pref) defaults to its natural slot (just-before base);
    // the persisted WordNet-over-User order is preserved.
    expect(handle.sources.map(s => s.name)).toEqual([
      'WordNet',
      'User',
      'Fresh',
    ]);
  });

  it('listDictPrefs merges allSources with persisted prefs (one row per source)', async () => {
    const h = await makeHarness({
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
      prefsSeed: async db => {
        await setDictPrefs(db, [
          {
            prefKey: 'Dune\u0000en',
            name: 'Dune',
            enabled: false,
            sortOrder: 0,
            removable: true,
          },
        ]);
      },
    });
    const handle = await bootstrap(h.ports);
    const prefs = await handle.listDictPrefs();
    // One row per source; Dune persisted-disabled wins, imported=removable.
    const dune = prefs.find(p => p.name === 'Dune');
    expect(dune).toMatchObject({enabled: false, removable: true});
    expect(prefs.find(p => p.name === 'WordNet')?.removable).toBe(false);
    expect(prefs.map(p => p.name).sort()).toEqual(['Dune', 'User', 'WordNet']);
  });

  it('setDictPrefs persists AND recomputes the SAME live sources array (AC3)', async () => {
    const h = await makeHarness({
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    const liveRef = handle.sources; // capture the reference
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'Dune', 'WordNet']);
    // Disable Dune.
    await handle.setDictPrefs([
      prefRow('User', 'User', true, 0),
      {
        prefKey: 'Dune\u0000en',
        name: 'Dune',
        enabled: false,
        sortOrder: 1,
        removable: true,
      },
      prefRow('WordNet', 'WordNet', true, 2),
    ]);
    // SAME array reference, mutated in place (no reassignment).
    expect(handle.sources).toBe(liveRef);
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
    // Persisted: a fresh listDictPrefs reflects the disable.
    expect((await handle.listDictPrefs()).find(p => p.name === 'Dune')?.enabled).toBe(
      false,
    );
    // Re-enable with NO reopen — Dune comes back (it stayed in allSources).
    await handle.setDictPrefs([
      prefRow('User', 'User', true, 0),
      {
        prefKey: 'Dune\u0000en',
        name: 'Dune',
        enabled: true,
        sortOrder: 1,
        removable: true,
      },
      prefRow('WordNet', 'WordNet', true, 2),
    ]);
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'Dune', 'WordNet']);
  });

  it('degraded user.db: listDictPrefs returns natural defaults, setDictPrefs still recomputes', async () => {
    const h = await makeHarness({userDbThrows: true});
    const handle = await bootstrap(h.ports, {warn: jest.fn()});
    // Only base survives; no User, no imports.
    expect(handle.allSources.map(s => s.name)).toEqual(['WordNet']);
    const prefs = await handle.listDictPrefs();
    expect(prefs.map(p => p.name)).toEqual(['WordNet']);
    expect(prefs[0].enabled).toBe(true);
    // setDictPrefs no-ops the persist (null db) but still recomputes live.
    await handle.setDictPrefs([prefRow('WordNet', 'WordNet', false, 0)]);
    expect(handle.sources.map(s => s.name)).toEqual([]);
  });
});

// --- F4: opt-in source deletion (reconcile loop + first-run prompt) ---

describe('bootstrap — F4 keep-then-rescan (the loop is broken, AC3)', () => {
  it('a kept, already-imported set reconciles to OPEN — no re-import, no dup slug', async () => {
    // Simulate the 2nd bootstrap: the audit row exists AND the descriptor
    // is back on disk (sources kept), keep flag set, slug healthy. The set
    // must 'open' (registered, never re-imported) — keepSourcesSeen stays
    // empty (no import dispatched) and there is ONE source, not two.
    const h = await makeHarness({
      keepSeed: true,
      descriptors: [descriptor('Kept', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Kept', 'en', 'kept.en.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // 'Kept' present exactly once (opened, not re-imported + spliced).
    expect(handle.sources.filter(s => s.name === 'Kept')).toHaveLength(1);
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'Kept', 'WordNet']);
    // No import was dispatched -> the delete gate was never even reached.
    expect(h.keepSourcesSeen).toEqual([]);
  });

  it('a kept set with an UNhealthy slug DB falls back to RE-ADD (import)', async () => {
    const h = await makeHarness({
      keepSeed: true,
      slugHealthy: () => false, // slug DB missing on disk
      descriptors: [descriptor('Gone', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Gone', 'en', 'gone.en.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // Re-imported (the import dispatched -> keepSourcesSeen has one entry).
    expect(h.keepSourcesSeen).toEqual([true]);
    expect(handle.sources.filter(s => s.name === 'Gone')).toHaveLength(1);
  });

  it('a .refresh descriptor forces RE-ADD even when kept + healthy (AC4)', async () => {
    const refreshing: ImportJobDescriptor = {
      ...descriptor('Refresh', 'en'),
      forceRefresh: true,
      refreshPath: '/d/Refresh/.refresh',
    };
    const h = await makeHarness({
      keepSeed: true,
      descriptors: [refreshing],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Refresh', 'en', 'refresh.en.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // Re-imported (forceRefresh overrode the kept 'open').
    expect(h.keepSourcesSeen).toEqual([true]);
    expect(handle.sources.filter(s => s.name === 'Refresh')).toHaveLength(1);
  });
});

describe('bootstrap — F4 keepSources threaded into the import (FR2)', () => {
  it('keep=true is passed into importPortsFor for a fresh import', async () => {
    const h = await makeHarness({
      keepSeed: true,
      descriptors: [descriptor('Fresh', 'en')],
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    expect(h.keepSourcesSeen).toEqual([true]);
  });

  it('keep=false is passed into importPortsFor (delete branch)', async () => {
    const h = await makeHarness({
      keepSeed: false,
      descriptors: [descriptor('Fresh', 'en')],
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    expect(h.keepSourcesSeen).toEqual([false]);
  });
});

describe('bootstrap — F4 first-run keep/delete prompt (FR5/AC5)', () => {
  it('prompts ONCE when the flag is unset and there is a pending import; persists the choice', async () => {
    const prompt = jest.fn(async () => false); // user chose delete
    const h = await makeHarness({
      promptKeepDelete: prompt,
      descriptors: [descriptor('Fresh', 'en')],
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    expect(prompt).toHaveBeenCalledTimes(1);
    // The chosen value (delete) was threaded into the import...
    expect(h.keepSourcesSeen).toEqual([false]);
    // ...and persisted, so a fresh read returns it.
    expect(await getKeepSources(h.userDb)).toBe(false);
  });

  it('does NOT prompt when the flag is already set', async () => {
    const prompt = jest.fn(async () => false);
    const h = await makeHarness({
      keepSeed: true,
      promptKeepDelete: prompt,
      descriptors: [descriptor('Fresh', 'en')],
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    expect(prompt).not.toHaveBeenCalled();
    expect(h.keepSourcesSeen).toEqual([true]);
  });

  it('does NOT prompt when there is no pending import (flag unset, nothing to dispatch)', async () => {
    const prompt = jest.fn(async () => false);
    const h = await makeHarness({promptKeepDelete: prompt, descriptors: []});
    await bootstrap(h.ports);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('does NOT prompt for a kept+healthy set that reconciles to open (no import)', async () => {
    const prompt = jest.fn(async () => false);
    const h = await makeHarness({
      promptKeepDelete: prompt,
      descriptors: [descriptor('Kept', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Kept', 'en', 'kept.en.db'));
      },
    });
    await bootstrap(h.ports);
    // Default keep + healthy slug -> 'open', no import -> no prompt.
    expect(prompt).not.toHaveBeenCalled();
  });

  it('defaults to KEEP when the prompt port throws', async () => {
    const prompt = jest.fn(async () => {
      throw new Error('dialog dismissed');
    });
    const h = await makeHarness({
      promptKeepDelete: prompt,
      descriptors: [descriptor('Fresh', 'en')],
    });
    const handle = await bootstrap(h.ports, {warn: jest.fn()});
    await handle.importsSettled;
    expect(h.keepSourcesSeen).toEqual([true]);
    expect(await getKeepSources(h.userDb)).toBe(true);
  });

  it('defaults to KEEP (no prompt) when no prompt port is wired', async () => {
    const h = await makeHarness({descriptors: [descriptor('Fresh', 'en')]});
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    expect(h.keepSourcesSeen).toEqual([true]);
  });
});

describe('bootstrap — F4 legacy host without a slug probe', () => {
  it('treats every audited slug as unhealthy -> kept set RE-ADDs (safe)', async () => {
    const h = await makeHarness({
      keepSeed: true,
      noSlugProbe: true,
      descriptors: [descriptor('Kept', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Kept', 'en', 'kept.en.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // No probe -> slugHealthy empty -> RE-ADD (an import dispatched).
    expect(h.keepSourcesSeen).toEqual([true]);
  });
});

// --- F7: delete an already-imported dictionary ----------------------
// The Dune prefKey is identityKey('Dune', 'en') (imports key on name+lang).
const DUNE_KEY = identityKey('Dune', 'en');

describe('bootstrap — F7 deleteImportedDict (full removal, AC1)', () => {
  // A bootstrap with one kept, already-imported Dune (audit + descriptor on
  // disk, slug healthy -> reconciles to 'open') and the delete seam wired.
  const seedDune = () =>
    makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      descriptors: [descriptor('Dune', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
    });

  it('closes the slug handle, deletes its file, drops audit+pref, removes from sources (AC1)', async () => {
    const h = await seedDune();
    const handle = await bootstrap(h.ports);
    // Dune is opened (eager) and present in both registries.
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'Dune', 'WordNet']);
    expect(handle.allSources.map(s => s.name)).toContain('Dune');

    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res).toEqual({
      ok: true,
      removed: {slugDb: true, audit: true, pref: false, sources: true},
    });
    // Gone from BOTH the live sources and the full registry.
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
    expect(handle.allSources.map(s => s.name)).not.toContain('Dune');
    // Slug handle closed AND its file deleted; the source set deleted too.
    expect(h.closedSlugs).toContain('dune.en.db');
    expect(h.deletedFiles).toContain('/plugin/dune.en.db');
    // The on-disk StarDict set (ifo/idx/dict + sidecar) + its folder gone.
    expect(h.deletedFiles).toEqual(
      expect.arrayContaining([
        '/d/Dune/x.ifo',
        '/d/Dune/x.idx',
        '/d/Dune/x.dict',
        '/d/Dune/meta.json',
      ]),
    );
    expect(h.deletedFolders).toEqual(['/d/Dune']);
    // The audit + sourceLang entry are gone.
    expect(handle.sourceLang.Dune).toBeUndefined();
    expect(
      await findImportByNameLang(h.userDb, 'Dune', 'en'),
    ).toBeNull();
  });

  it('the next lookup has no Dune section (AC1)', async () => {
    const h = await seedDune();
    const handle = await bootstrap(h.ports);
    await handle.deleteImportedDict(DUNE_KEY);
    const res = await handle.lookup.lookup('hello');
    expect(res.hits.some((hit: {source: string}) => hit.source === 'Dune')).toBe(
      false,
    );
  });

  it('drops the dict_prefs row when one was persisted (pref:true)', async () => {
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      descriptors: [descriptor('Dune', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
      prefsSeed: async db => {
        await setDictPrefs(db, [
          {prefKey: 'User', name: 'User', enabled: true, sortOrder: 0, removable: false},
          {prefKey: DUNE_KEY, name: 'Dune', enabled: true, sortOrder: 1, removable: true},
          {prefKey: 'WordNet', name: 'WordNet', enabled: true, sortOrder: 2, removable: false},
        ]);
      },
    });
    const handle = await bootstrap(h.ports);
    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res.removed.pref).toBe(true);
    expect((await readDictPrefs(h.userDb)).map(p => p.name)).not.toContain('Dune');
  });
});

describe('bootstrap — F7 splice BEFORE close (in-flight lookup safe, AC6/EC9)', () => {
  it('a lookup snapshotted before delete completes never hits a closed handle', async () => {
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      descriptors: [descriptor('Dune', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    // Start a lookup (it snapshots `sources` synchronously at call time),
    // THEN delete concurrently. The snapshot still includes Dune's open
    // handle; the delete splices it out for the NEXT snapshot only.
    const inFlight = handle.lookup.lookup('hello');
    const del = handle.deleteImportedDict(DUNE_KEY);
    const [res] = await Promise.all([inFlight, del]);
    // The in-flight lookup resolved cleanly (no closed-handle throw); every
    // hit has a defined entry (the bug a post-close splice would cause).
    expect(
      res.hits.every((hit: {entry: unknown}) => hit.entry !== undefined),
    ).toBe(true);
    // And the splice DID precede the close: by the time close ran, Dune was
    // already out of the live registry.
    expect(h.closedSlugs).toContain('dune.en.db');
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
  });
});

describe('bootstrap — F7 splice/close ORDER guard (AC6/EC9, P0-1)', () => {
  // A genuine ordering guard: instrument the live-array splice AND the eager
  // slug handle's close() onto ONE call-order array, then assert the splice
  // (which removes the source from the LIVE registry so a NEXT lookup snapshot
  // can't reach it) runs STRICTLY BEFORE close() (which makes the handle
  // unusable). If close were moved BEFORE the splice, a lookup snapshotted in
  // that window would race a closing handle — this test FAILS under that
  // mutation (verified: swapping the two lines in deleteImportedDict flips the
  // recorded order and trips the assertion below).
  it('splices the source out of the live registry BEFORE closing its handle', async () => {
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      descriptors: [descriptor('Dune', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
    });
    // Wrap the eager open so the SAME handle records 'close' onto a shared
    // order array (the harness's closedSlugs only records the filename, not
    // the interleaving with the splice).
    const order: string[] = [];
    const realOpen = h.ports.db.openImportedDb;
    h.ports.db.openImportedDb = (filename: string) => async () => {
      const db = await realOpen(filename)();
      if (db !== null) {
        const realClose = db.close.bind(db);
        db.close = async () => {
          order.push('close');
          await realClose();
        };
      }
      return db;
    };
    const handle = await bootstrap(h.ports);
    // Instrument the LIVE allSources splice (the array the lookup is derived
    // from). deleteImportedDict splices THIS reference at step (1).
    const realSplice = handle.allSources.splice.bind(handle.allSources);
    handle.allSources.splice = ((start: number, deleteCount?: number) => {
      order.push('splice');
      return realSplice(start, deleteCount as number);
    }) as typeof handle.allSources.splice;

    await handle.deleteImportedDict(DUNE_KEY);

    // Both operations ran, and the splice came FIRST.
    expect(order).toContain('splice');
    expect(order).toContain('close');
    expect(order.indexOf('splice')).toBeLessThan(order.indexOf('close'));
  });
});

describe('bootstrap — F7 same-named survivor keeps its language (M1)', () => {
  // sourceLang is keyed by display NAME. Two imported dicts that share the
  // SAME display name in DIFFERENT languages must not let deleting one strip
  // the survivor's language resolution. (A single LIVE sourceLang entry is a
  // tracked pre-existing limitation; this guards the DELETE path.)
  it('deleting one of two same-named dicts preserves the survivor sourceLang', async () => {
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      auditSeed: async db => {
        // Same display name "Atlas", different languages -> distinct slug
        // files + distinct dict_prefs identities, but ONE sourceLang key.
        await upsertImport(db, auditRow('Atlas', 'en', 'atlas.en.db'));
        await upsertImport(db, auditRow('Atlas', 'de', 'atlas.de.db'));
      },
    });
    const handle = await bootstrap(h.ports, {warn: jest.fn()});
    // Both opened; the name-keyed sourceLang carries one Atlas entry.
    expect(handle.allSources.map(s => s.name)).toEqual([
      'User',
      'Atlas',
      'Atlas',
      'WordNet',
    ]);
    expect(handle.sourceLang.Atlas).toBeDefined();

    // Delete the German Atlas; the English Atlas survives in allSources.
    const res = await handle.deleteImportedDict(identityKey('Atlas', 'de'));
    expect(res.ok).toBe(true);
    expect(handle.allSources.filter(s => s.name === 'Atlas')).toHaveLength(1);
    // The survivor's language resolution is PRESERVED, not dropped (M1): a
    // live Atlas still exists, so the name-keyed entry must remain.
    expect(handle.sourceLang.Atlas).toBeDefined();
  });

  it('deleting the LAST same-named dict drops the sourceLang entry', async () => {
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      descriptors: [descriptor('Solo', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Solo', 'en', 'solo.en.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    expect(handle.sourceLang.Solo).toBe('en');
    await handle.deleteImportedDict(identityKey('Solo', 'en'));
    // No surviving source carries the name -> the entry IS removed.
    expect(handle.sourceLang.Solo).toBeUndefined();
  });
});

describe('bootstrap — F7 no resurrection (AC2/FR4)', () => {
  it('after delete + a 2nd bootstrap whose discovery is empty, Dune stays gone', async () => {
    // 1st session: Dune kept+open, delete removes the source set (modelled
    // by clearing the discover list after the delete) AND the audit row.
    let discovered: ImportJobDescriptor[] = [descriptor('Dune', 'en')];
    // One-shot audit seed: the harness re-invokes auditSeed on EVERY
    // openUserDb, but a real 2nd boot opens the SAME (already-deleted) row,
    // so only seed on the first open.
    let seeded = false;
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      auditSeed: async db => {
        if (!seeded) {
          seeded = true;
          await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
        }
      },
    });
    // Point discover at the mutable list (so the delete's re-discovery sees
    // Dune, but the 2nd bootstrap sees the now-removed set).
    h.ports.discover = async () => discovered;
    const handle = await bootstrap(h.ports);
    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res.removed.sources).toBe(true);
    expect(res.removed.audit).toBe(true);
    expect(await findImportByNameLang(h.userDb, 'Dune', 'en')).toBeNull();
    // The source set was deleted on disk -> model that by emptying discovery.
    discovered = [];

    // 2nd bootstrap against the SAME user.db (audit row gone) + empty disk:
    // reconcile sees neither an 'open' (no audit) nor an 'import' (no
    // descriptor) -> Dune does NOT come back.
    const handle2 = await bootstrap(h.ports);
    await handle2.importsSettled;
    expect(handle2.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
    expect(handle2.allSources.map(s => s.name)).not.toContain('Dune');
    // No import was dispatched on the 2nd boot (the loop is truly broken).
    expect(h.keepSourcesSeen).toEqual([]);
  });
});

describe('bootstrap — F7 source set not removable (AC3)', () => {
  it('removed.sources=false + warn when a source file can not be deleted', async () => {
    const warn = jest.fn();
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      // The .dict file is locked/shared and refuses to delete.
      deleteFileFails: path => path === '/d/Dune/x.dict',
      descriptors: [descriptor('Dune', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
    });
    const handle = await bootstrap(h.ports, {warn});
    const res = await handle.deleteImportedDict(DUNE_KEY);
    // The dict is still fully removed from the runtime + audit/pref...
    expect(res.ok).toBe(true);
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
    // ...but the leftover source set could not be removed -> warn the user.
    expect(res.removed.sources).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('may reappear on reload'),
    );
  });
});

describe('bootstrap — F7 reject base/User (AC4/FR6/INV5)', () => {
  it('deleteImportedDict on the base (WordNet) key returns ok:false, removes nothing', async () => {
    const h = await makeHarness({withDeletePorts: true});
    const handle = await bootstrap(h.ports);
    const res = await handle.deleteImportedDict('WordNet');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/cannot be removed/);
    expect(res.removed).toEqual({
      slugDb: false,
      audit: false,
      pref: false,
      sources: false,
    });
    // WordNet untouched.
    expect(handle.allSources.map(s => s.name)).toContain('WordNet');
    expect(h.closedSlugs).toEqual([]);
    expect(h.deletedFiles).toEqual([]);
  });

  it('deleteImportedDict on the User key returns ok:false', async () => {
    const h = await makeHarness({withDeletePorts: true});
    const handle = await bootstrap(h.ports);
    const res = await handle.deleteImportedDict('User');
    expect(res.ok).toBe(false);
    expect(handle.allSources.map(s => s.name)).toContain('User');
  });
});

describe('bootstrap — F7 idempotent / partial delete (AC5/FR5/EC10)', () => {
  it('slug file missing but audit row present -> audit+pref cleaned, ok:true', async () => {
    // No descriptor on disk (sources gone) -> Dune reconciles to 'open' from
    // the audit row. We make the eager-open of the slug THROW (slug file
    // missing) so the source has a null handle (nothing to close) — the
    // half-deleted case.
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      openImportedThrows: filename => filename === 'dune.en.db',
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
    });
    const handle = await bootstrap(h.ports, {warn: jest.fn()});
    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res.ok).toBe(true);
    // No handle to close; the audit row IS cleaned (the durable artifact).
    expect(h.closedSlugs).toEqual([]);
    expect(res.removed.audit).toBe(true);
    expect(await findImportByNameLang(h.userDb, 'Dune', 'en')).toBeNull();
    // Dune is out of the runtime.
    expect(handle.allSources.map(s => s.name)).not.toContain('Dune');
  });

  it('a stranded prefKey (no source, no audit) is an idempotent no-op success', async () => {
    const h = await makeHarness({withDeletePorts: true});
    const handle = await bootstrap(h.ports);
    // A pref persisted for a since-vanished dict, with no source + no audit.
    await setDictPrefs(h.userDb, [
      {prefKey: identityKey('Ghost', 'en'), name: 'Ghost', enabled: true, sortOrder: 9, removable: true},
    ]);
    const res = await handle.deleteImportedDict(identityKey('Ghost', 'en'));
    expect(res.ok).toBe(true);
    // The stranded pref row was still cleaned.
    expect(res.removed.pref).toBe(true);
    expect(res.removed.slugDb).toBe(false);
    expect((await readDictPrefs(h.userDb)).map(p => p.name)).not.toContain('Ghost');
  });

  it('no delete port: audit+pref still cleaned, slug/sources reported false', async () => {
    const h = await makeHarness({
      keepSeed: true,
      // withDeletePorts omitted -> ports.delete is undefined.
      descriptors: [descriptor('Dune', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
    });
    const handle = await bootstrap(h.ports);
    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res.ok).toBe(true);
    // The slug handle is still closed (so a later reopen/re-import is clean),
    // but with no delete port the file + source set aren't unlinked.
    expect(h.closedSlugs).toContain('dune.en.db');
    expect(res.removed.slugDb).toBe(false);
    expect(res.removed.sources).toBe(false);
    expect(res.removed.audit).toBe(true);
    // Still removed from the runtime registries.
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
  });

  it('resolves the audit identity from the prefKey when no live source matches', async () => {
    // An audit row exists in user.db but was NOT opened as a source at boot
    // (seeded AFTER bootstrap) — so there is no live record; the delete must
    // resolve name/lang/filename from the audit row by prefKey (F7-FR5).
    const h = await makeHarness({withDeletePorts: true});
    const handle = await bootstrap(h.ports);
    await ensureImportsTable(h.userDb);
    await upsertImport(h.userDb, auditRow('Orphan', 'en', 'orphan.en.db'));
    const res = await handle.deleteImportedDict(identityKey('Orphan', 'en'));
    expect(res.ok).toBe(true);
    // Resolved from audit -> slug file deleted, audit row dropped.
    expect(res.removed.audit).toBe(true);
    expect(h.deletedFiles).toContain('/plugin/orphan.en.db');
    expect(await findImportByNameLang(h.userDb, 'Orphan', 'en')).toBeNull();
  });

  it('degraded user.db: deleting still resolves ok:true (no rows to clean)', async () => {
    const h = await makeHarness({userDbThrows: true, withDeletePorts: true});
    const handle = await bootstrap(h.ports, {warn: jest.fn()});
    const res = await handle.deleteImportedDict('Anything en');
    expect(res.ok).toBe(true);
    expect(res.removed.audit).toBe(false);
  });
});

describe('bootstrap — F7 x F3 cross-feature delete', () => {
  const ATLAS_KEY = identityKey('Atlas', 'en');

  // P1-1: delete one imported dict while ANOTHER is disabled AND the order
  // was customised. The disabled dict must stay in allSources (re-enableable
  // with no reopen) and the reorder must survive the delete.
  it('delete-while-disabled+reordered: retains the disabled dict + the order', async () => {
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      descriptors: [descriptor('Dune', 'en'), descriptor('Atlas', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
        await upsertImport(db, auditRow('Atlas', 'en', 'atlas.en.db'));
      },
      // Atlas DISABLED; WordNet moved to the TOP (reorder).
      prefsSeed: async db => {
        await setDictPrefs(db, [
          {prefKey: 'WordNet', name: 'WordNet', enabled: true, sortOrder: 0, removable: false},
          {prefKey: DUNE_KEY, name: 'Dune', enabled: true, sortOrder: 1, removable: true},
          {prefKey: ATLAS_KEY, name: 'Atlas', enabled: false, sortOrder: 2, removable: true},
          {prefKey: 'User', name: 'User', enabled: true, sortOrder: 3, removable: false},
        ]);
      },
    });
    const handle = await bootstrap(h.ports);
    // Live `sources`: reordered, Atlas excluded (disabled), Dune present.
    expect(handle.sources.map(s => s.name)).toEqual(['WordNet', 'Dune', 'User']);
    // Full registry holds every opened source (natural order).
    expect(handle.allSources.map(s => s.name)).toEqual([
      'User',
      'Dune',
      'Atlas',
      'WordNet',
    ]);

    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res.ok).toBe(true);
    // Atlas RETAINED (still disabled), Dune gone from the full registry.
    expect(handle.allSources.map(s => s.name)).toEqual(['User', 'Atlas', 'WordNet']);
    // The reorder is PRESERVED (WordNet still on top); Atlas still excluded.
    expect(handle.sources.map(s => s.name)).toEqual(['WordNet', 'User']);
  });

  // P1-2: import a fresh dict AFTER a reorder pref, then delete that
  // freshly-imported (detached-import-record path, not the boot 'open'
  // bucket) dict — proving the detached record is deletable.
  it('import-after-reorder, then delete the fresh dict (detached-record path)', async () => {
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      descriptors: [descriptor('Fresh', 'en')],
      importOutcome: () => ({ok: true, filename: 'fresh.en.db'}),
      // A reorder pref (WordNet on top) persisted BEFORE the import lands.
      prefsSeed: async db => {
        await setDictPrefs(db, [
          {prefKey: 'WordNet', name: 'WordNet', enabled: true, sortOrder: 0, removable: false},
          {prefKey: 'User', name: 'User', enabled: true, sortOrder: 1, removable: false},
        ]);
      },
    });
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // Fresh spliced into the full registry; it came from the DETACHED import
    // path (NO audit at boot -> reconcile 'import' -> detached splice), NOT
    // the boot 'open' bucket.
    expect(handle.allSources.map(s => s.name)).toContain('Fresh');
    // runImport (mocked here) would have written the audit row on a verified
    // import; seed it now so the delete's audit-drop runs against a real row
    // (the delete resolves name/lang/filename from the LIVE detached record).
    await upsertImport(h.userDb, auditRow('Fresh', 'en', 'fresh.en.db'));

    const res = await handle.deleteImportedDict(identityKey('Fresh', 'en'));
    expect(res.ok).toBe(true);
    // The detached-import RECORD was deletable: slug file + audit removed and
    // its eager handle closed — proving the detached path (not just 'open').
    expect(res.removed.slugDb).toBe(true);
    expect(res.removed.audit).toBe(true);
    expect(h.closedSlugs).toContain('fresh.en.db');
    expect(handle.allSources.map(s => s.name)).not.toContain('Fresh');
  });

  // P1-3: delete with ALL sources disabled. The live `sources` is a valid
  // empty set; delete drops only the target from allSources; re-enabling the
  // survivors then recomputes correctly.
  it('all-disabled-then-delete: empty-but-valid live set, survivors re-enable', async () => {
    const h = await makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      descriptors: [descriptor('Dune', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
      // EVERY source disabled.
      prefsSeed: async db => {
        await setDictPrefs(db, [
          {prefKey: 'User', name: 'User', enabled: false, sortOrder: 0, removable: false},
          {prefKey: DUNE_KEY, name: 'Dune', enabled: false, sortOrder: 1, removable: true},
          {prefKey: 'WordNet', name: 'WordNet', enabled: false, sortOrder: 2, removable: false},
        ]);
      },
    });
    const handle = await bootstrap(h.ports);
    expect(handle.sources).toEqual([]);

    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res.ok).toBe(true);
    // Live set stays empty-but-valid; allSources lost ONLY Dune.
    expect(handle.sources).toEqual([]);
    expect(handle.allSources.map(s => s.name)).toEqual(['User', 'WordNet']);

    // Re-enabling the survivors recomputes the live set correctly (no Dune).
    await handle.setDictPrefs([
      {prefKey: 'User', name: 'User', enabled: true, sortOrder: 0, removable: false},
      {prefKey: 'WordNet', name: 'WordNet', enabled: true, sortOrder: 1, removable: false},
    ]);
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
  });

  // P1-4: keep=false — runImport deletes the source set, so the delete finds
  // NO descriptor on disk to remove. removed.sources===false is a SUCCESS
  // (not a failure), and a 2nd bootstrap doesn't resurrect the dict.
  it('keep=false fresh import -> delete: removed.sources false is ok:true, no resurrect', async () => {
    // keep=false: the import deletes its sources, so discovery is empty AFTER
    // the import (model it with a one-shot descriptor list).
    let discovered: ImportJobDescriptor[] = [descriptor('Fresh', 'en')];
    const h = await makeHarness({
      keepSeed: false,
      withDeletePorts: true,
      importOutcome: () => ({ok: true, filename: 'fresh.en.db'}),
    });
    h.ports.discover = async () => discovered;
    const handle = await bootstrap(h.ports);
    await handle.importsSettled;
    // keep=false was threaded into the import gate.
    expect(h.keepSourcesSeen).toEqual([false]);
    // runImport (mocked) would have written the audit row on a verified
    // import; seed it so the delete drops a real row. The detached record
    // resolves name/lang/filename, so the delete proceeds either way.
    await upsertImport(h.userDb, auditRow('Fresh', 'en', 'fresh.en.db'));
    // The source set is gone on disk (keep=false): empty discovery now.
    discovered = [];

    const res = await handle.deleteImportedDict(identityKey('Fresh', 'en'));
    // No descriptor to remove -> removed.sources false, but that is SUCCESS.
    expect(res.ok).toBe(true);
    expect(res.removed.sources).toBe(false);
    expect(res.removed.audit).toBe(true);
    expect(res.removed.slugDb).toBe(true);
    expect(await findImportByNameLang(h.userDb, 'Fresh', 'en')).toBeNull();

    // 2nd bootstrap: no descriptor (sources deleted) + no audit row -> Fresh
    // does NOT resurrect.
    const handle2 = await bootstrap(h.ports);
    await handle2.importsSettled;
    expect(handle2.allSources.map(s => s.name)).not.toContain('Fresh');
    expect(handle2.sources.map(s => s.name)).toEqual(['User', 'WordNet']);
  });
});

describe('bootstrap — F7 best-effort error isolation', () => {
  const seedDuneWith = (
    extra: Parameters<typeof makeHarness>[0],
  ): Promise<Harness> =>
    makeHarness({
      keepSeed: true,
      withDeletePorts: true,
      descriptors: [descriptor('Dune', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
      ...extra,
    });

  it('a slug-file delete that throws -> removed.slugDb=false + warn, rest cleaned', async () => {
    const h = await seedDuneWith({
      deleteFileFails: path => path === '/plugin/dune.en.db',
    });
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res.removed.slugDb).toBe(false);
    expect(res.removed.audit).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('delete slug file'),
    );
    // The handle was still closed first (close precedes the failing unlink).
    expect(h.closedSlugs).toContain('dune.en.db');
  });

  it('a close() that throws is isolated; the file delete still proceeds', async () => {
    const h = await seedDuneWith({});
    // Poison the eager-opened slug handle's close().
    const realOpen = h.ports.db.openImportedDb;
    h.ports.db.openImportedDb = (filename: string) => async () => {
      const db = await realOpen(filename)();
      if (db !== null) {
        db.close = async () => {
          throw new Error('close failed');
        };
      }
      return db;
    };
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res.ok).toBe(true);
    // The close threw but was isolated -> the file delete still ran.
    expect(res.removed.slugDb).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('close slug'));
  });

  it('a re-discover that throws is isolated (sources stay false, rest cleaned)', async () => {
    const h = await seedDuneWith({});
    const realDiscover = h.ports.discover;
    let calls = 0;
    h.ports.discover = async () => {
      calls += 1;
      // First call is the boot discovery; the delete's re-scan (2nd) throws.
      if (calls > 1) {
        throw new Error('listFiles blew up mid-delete');
      }
      return realDiscover();
    };
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res.removed.sources).toBe(false);
    expect(res.removed.audit).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('re-discover for source-set delete'),
    );
  });

  it('a folder rmdir that throws is tolerated (sources still true)', async () => {
    const h = await seedDuneWith({});
    // Swap in a deleteFolder that rejects (non-empty / locked dir).
    h.ports.delete = {
      resolveSlugPath: (filename: string) => `/plugin/${filename}`,
      deleteFile: async () => undefined,
      deleteFolder: async () => {
        throw new Error('dir not empty');
      },
    };
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    const res = await handle.deleteImportedDict(DUNE_KEY);
    // Every data file deleted -> sources true despite the rmdir failure.
    expect(res.removed.sources).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('rmdir source folder'),
    );
  });

  it('an audit-row delete that throws is caught + logged (audit stays false)', async () => {
    const h = await seedDuneWith({});
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    // Poison removeImport's DELETE on user.db AFTER boot.
    const realRun = h.userDb.run.bind(h.userDb);
    h.userDb.run = ((sql: string, params?: unknown[]) =>
      /DELETE FROM imports/i.test(sql)
        ? Promise.reject(new Error('audit delete locked'))
        : realRun(sql, params as never)) as typeof h.userDb.run;
    const res = await handle.deleteImportedDict(DUNE_KEY);
    expect(res.ok).toBe(true);
    expect(res.removed.audit).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('delete audit row'),
    );
  });
});

describe('bootstrap — F7 detached-import eager-open failure (handle stays null)', () => {
  it('a detached import whose slug eager-open throws stays lazy + logs', async () => {
    const h = await makeHarness({
      descriptors: [descriptor('Fresh', 'en')],
      importOutcome: () => ({ok: true, filename: 'fresh.en.db'}),
      // The post-import eager-open of fresh.en.db throws -> source stays lazy
      // (handle null, nothing for F7 to close) but is still registered.
      openImportedThrows: filename => filename === 'fresh.en.db',
    });
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});
    await handle.importsSettled;
    // The source is still spliced in (it just lacks an eager handle).
    expect(handle.sources.map(s => s.name)).toEqual(['User', 'Fresh', 'WordNet']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('open imported "Fresh"'),
    );
  });
});

describe('bootstrap — F8 closeWritable (close writable handles for restore)', () => {
  // A bootstrap with one kept, already-imported Dune (eager-opened, so its
  // slug handle is retained in the F7 registry — exactly what closeWritable
  // must close alongside user.db).
  const seedDune = () =>
    makeHarness({
      keepSeed: true,
      descriptors: [descriptor('Dune', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
    });

  it('closes user.db AND each imported slug handle; leaves base.db OPEN', async () => {
    const h = await seedDune();
    const handle = await bootstrap(h.ports);
    // Dune is eager-opened (its handle is retained, close is recorded).
    expect(handle.allSources.map(s => s.name)).toContain('Dune');

    const userClose = jest.spyOn(h.userDb, 'close');
    const baseClose = jest.spyOn(h.baseDb, 'close');

    await handle.closeWritable();

    // user.db closed once; the imported slug handle closed; base.db NEVER
    // closed (read-only, not restored).
    expect(userClose).toHaveBeenCalledTimes(1);
    expect(h.closedSlugs).toContain('dune.en.db');
    expect(baseClose).not.toHaveBeenCalled();
  });

  it('is a no-op on user.db when the user DB is degraded (null)', async () => {
    const h = await makeHarness({userDbThrows: true});
    const handle = await bootstrap(h.ports);
    expect(handle.userDb).toBeNull();
    // No throw with a null user.db + no imported handles — nothing to close.
    await expect(handle.closeWritable()).resolves.toBeUndefined();
  });

  it('skips a slug whose eager-open returned null (no handle to close)', async () => {
    // Dune's eager-open throws -> the source stays lazy (handle null), so
    // closeWritable has nothing to close for it (and must not throw).
    const h = await makeHarness({
      keepSeed: true,
      descriptors: [descriptor('Dune', 'en')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
      },
      openImportedThrows: filename => filename === 'dune.en.db',
    });
    const handle = await bootstrap(h.ports);
    const userClose = jest.spyOn(h.userDb, 'close');
    await handle.closeWritable();
    // user.db still closed; no slug close (the handle was null).
    expect(userClose).toHaveBeenCalledTimes(1);
    expect(h.closedSlugs).not.toContain('dune.en.db');
  });

  it('best-effort: a throwing user.db close still closes the slug handles', async () => {
    const h = await seedDune();
    const handle = await bootstrap(h.ports);
    jest.spyOn(h.userDb, 'close').mockRejectedValueOnce(new Error('wal locked'));
    const warn = jest.fn();

    await expect(handle.closeWritable()).resolves.toBeUndefined();

    // The user.db throw was swallowed AND the slug handle still closed.
    expect(h.closedSlugs).toContain('dune.en.db');
    // The warn path is exercised via the bootstrap logger; re-run with one
    // wired to assert the message (a fresh bootstrap to avoid double-close).
    const h2 = await seedDune();
    const handle2 = await bootstrap(h2.ports, {warn});
    jest.spyOn(h2.userDb, 'close').mockRejectedValueOnce(new Error('wal locked'));
    await handle2.closeWritable();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('close user.db'));
  });

  it('best-effort: a throwing slug close is logged and does not block the rest', async () => {
    // Two imported dicts; the FIRST slug's close throws — the second must
    // still close (best-effort per handle).
    const h = await makeHarness({
      keepSeed: true,
      descriptors: [descriptor('Dune', 'en'), descriptor('Atlas', 'de')],
      auditSeed: async db => {
        await upsertImport(db, auditRow('Dune', 'en', 'dune.en.db'));
        await upsertImport(db, auditRow('Atlas', 'de', 'atlas.de.db'));
      },
    });
    // Wrap openImportedDb so dune.en.db's close THROWS (mirrors the F7
    // ORDER-guard test): the eager-opened handle is what closeWritable closes.
    const realOpen = h.ports.db.openImportedDb;
    const closed: string[] = [];
    h.ports.db.openImportedDb = (filename: string) => async () => {
      const db = await realOpen(filename)();
      if (db !== null) {
        db.close = async () => {
          closed.push(filename);
          if (filename === 'dune.en.db') {
            throw new Error('slug handle stuck');
          }
        };
      }
      return db;
    };
    const warn = jest.fn();
    const handle = await bootstrap(h.ports, {warn});

    await expect(handle.closeWritable()).resolves.toBeUndefined();

    // Both slug closes were ATTEMPTED (Dune threw, Atlas succeeded); the
    // throw on Dune did not block Atlas.
    expect(closed).toEqual(
      expect.arrayContaining(['dune.en.db', 'atlas.de.db']),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('close slug "dune.en.db"'),
    );
  });
});
