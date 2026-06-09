// Runtime composition root (TF7-FR1/FR2/FR4) + pure reconcileImports.
// Fully fake-driven — all device behind BootstrapPorts.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  bootstrap,
  reconcileImports,
  type BootstrapPorts,
  type ReconcileItem,
} from '../src/core/dict/sqlite/bootstrap';
import {ensureImportsTable, upsertImport} from '../src/core/dict/sqlite/importAudit';
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

describe('reconcileImports (pure)', () => {
  it('NEW descriptor (no audit) -> import without replacesFilename', () => {
    const items = reconcileImports([descriptor('A', 'en')], []);
    expect(items).toEqual([{bucket: 'import', descriptor: descriptor('A', 'en')}]);
  });

  it('RE-ADD (audit hit) -> import with replacesFilename = prior slug', () => {
    const items = reconcileImports(
      [descriptor('A', 'en')],
      [auditRow('A', 'en', 'a.en.db')],
    );
    expect(items).toEqual([
      {bucket: 'import', descriptor: descriptor('A', 'en'), replacesFilename: 'a.en.db'},
    ]);
  });

  it('audit row with no descriptor -> open bucket', () => {
    const items = reconcileImports([], [auditRow('A', 'en', 'a.en.db')]);
    expect(items).toEqual([{bucket: 'open', row: auditRow('A', 'en', 'a.en.db')}]);
  });

  it('DEDUPs duplicate name+lang on disk: first import, rest skip (Flag 1)', () => {
    const d1 = descriptor('A', 'en');
    const d2 = descriptor('A', 'en');
    const items = reconcileImports([d1, d2], []);
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
    );
    expect(buckets(items)).toEqual(['import', 'import']);
  });

  it('mixes import + open in one pass', () => {
    const items = reconcileImports(
      [descriptor('New', 'en')],
      [auditRow('Old', 'de', 'old.de.db')],
    );
    expect(buckets(items)).toEqual(['import', 'open']);
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
  // Pre-seed the user.db BEFORE bootstrap opens it (e.g. an existing
  // pre-v3 6-col entries table to exercise the FR2 ALTER migration).
  userDbSeed?: (db: SqliteDb) => Promise<void>;
  // Make the FR2 ALTER migration throw this error (to exercise the
  // non-"duplicate column" re-throw branch).
  userDbAlterError?: Error;
  provisionRejects?: boolean;
  userDbThrows?: boolean;
  enableButtonsThrows?: boolean;
  importOutcome?: (d: ImportJobDescriptor) => {
    ok: boolean;
    filename?: string;
    reason?: string;
    gate?: Promise<void>;
  };
}): Promise<Harness> => {
  const baseDb = await makeBaseDb();
  const userDb = await createSeededDb(opts.userDbSeed ?? (async () => undefined));
  const enableButtons = jest.fn(async () => {
    if (opts.enableButtonsThrows) {
      throw new Error('button bridge down');
    }
  });
  const openImportedDb = jest.fn((filename: string) => async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run('INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)', [
        filename,
        filename,
        `def for ${filename}`,
        'plain',
      ]);
    });
    return db;
  });
  const importResults = new Map<string, {ok: boolean; filename: string}>();

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
    },
    discover: async () => opts.descriptors ?? [],
    importPortsFor: (d, audit) => {
      // Minimal fake RunImportPorts: the outcome map decides ok/fail. The
      // mocked runImport (below) reads the stashed outcome + the
      // descriptor's kind, so this exercises the kind-agnostic dispatch.
      const outcome = opts.importOutcome
        ? opts.importOutcome(d)
        : {ok: true, filename: `${d.sidecar.name}.${d.sidecar.language}.db`};
      const fakePorts = {
        __outcome: outcome,
        __name: d.sidecar.name,
        __lang: d.sidecar.language,
        __kind: d.kind,
        audit,
      } as unknown as RunImportPorts;
      return fakePorts;
    },
    enableButtons,
  };
  return {ports, enableButtons, openImportedDb, importResults, baseDb, userDb};
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

  it('opens already-imported sources (open bucket) and re-imports re-added ones', async () => {
    const h = await makeHarness({
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
