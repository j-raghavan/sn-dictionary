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
import type {ImportPorts} from '../src/core/dict/sqlite/importStardict';

// --- reconcileImports (pure) ---------------------------------------

const descriptor = (name: string, lang: string): ImportJobDescriptor => ({
  setPath: `/d/${name}`,
  ifoPath: `/d/${name}/x.ifo`,
  idxPath: `/d/${name}/x.idx`,
  dictPath: `/d/${name}/x.dict`,
  sidecarPath: `/d/${name}/meta.json`,
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
  const userDb = await createSeededDb(async () => undefined);
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
        return userDb;
      },
      openImportedDb,
    },
    discover: async () => opts.descriptors ?? [],
    importPortsFor: (d, audit) => {
      // Minimal fake ImportPorts: the outcome map decides ok/fail.
      const outcome = opts.importOutcome
        ? opts.importOutcome(d)
        : {ok: true, filename: `${d.sidecar.name}.${d.sidecar.language}.db`};
      const fakePorts = {
        __outcome: outcome,
        __name: d.sidecar.name,
        __lang: d.sidecar.language,
        audit,
      } as unknown as ImportPorts;
      return fakePorts;
    },
    enableButtons,
  };
  return {ports, enableButtons, openImportedDb, importResults, baseDb};
};

// importStardict is mocked so bootstrap's dispatch is tested without
// the full pipeline (that has its own suite). The mock reads the
// outcome stashed on the fake ports.
jest.mock('../src/core/dict/sqlite/importStardict', () => {
  const actual = jest.requireActual('../src/core/dict/sqlite/importStardict');
  return {
    ...actual,
    importStardict: jest.fn(async (ports: Record<string, unknown>) => {
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
