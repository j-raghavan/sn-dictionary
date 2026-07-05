// FR7: end-to-end CSV sideload. Wires the REAL production modules over
// the shipped sample CSVs (assets/sample-dicts): discovery LOCATES a
// loose *.csv -> runImport drives the shared spine -> the CSV
// produce-step parses + inserts into a slug DB -> a SqliteDictSource
// over that slug resolves the headwords. No mocks of the pipeline — only
// the filesystem (in-memory fileUtils + a fetch over the real bytes) and
// the slug-DB lifecycle (temp-file better-sqlite3) are host shims.

import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// A device-faithful SlugDbLifecycle.discard for the temp-file slugs: unlink the
// file so the spine's pre-clean actually starts the build target clean (the
// production discard deletes the slug file too).
const unlinkSlug = (path: string | undefined): void => {
  if (path !== undefined) {
    rmSync(path, {force: true});
  }
};
import {
  discoverUserDicts,
  type FileEntry,
} from '../src/core/dict/userDictDiscovery';
import {runImport, type RunImportPorts} from '../src/core/dict/sqlite/runImport';
import {produceCsvSlugDb} from '../src/core/dict/sqlite/importCsvRows';
import {createSqliteDictSource} from '../src/core/dict/sqlite/sqliteDictSource';
import {
  ensureImportsTable,
  findImportByNameLang,
} from '../src/core/dict/sqlite/importAudit';
import {slugDbFilename} from '../src/core/dict/sqlite/importSidecar';
import {IMPORTER_VERSION} from '../src/core/dict/sqlite/schema';
import type {SqliteDb} from '../src/core/dict/sqlite/db';
import {
  createSeededDb,
  openBetterSqliteDb,
} from './_helpers/betterSqliteDb';
import type {ImportJobDescriptor} from '../src/core/dict/userDictDiscovery';

const ROOT = '/sd';
const SAMPLES = 'assets/sample-dicts';

// A fileUtils + fetch pair backed by the real sample files: listFiles
// returns the loose CSVs at the root; fetch reads the actual bytes off
// disk (so CP1252 / CRLF / quoting all flow through unchanged).
const makeDeps = (csvNames: string[]) => {
  const rootEntries: FileEntry[] = csvNames.map(n => ({
    path: `${ROOT}/${n}`,
    type: 1,
  }));
  const fileUtils = {
    exists: async () => true,
    listFiles: async (path: string) =>
      path === ROOT ? rootEntries : ([] as FileEntry[]),
  };
  const fetchFn = (async (url: string) => {
    const name = url.replace(`file://${ROOT}/`, '');
    if (!csvNames.includes(name)) {
      return {ok: false, status: 404} as Response;
    }
    const bytes = readFileSync(join(SAMPLES, name));
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return {fileUtils, fetchFn};
};

// Import a discovered CSV descriptor through the REAL runImport spine +
// the CSV produce-step, into a temp-file slug DB. Returns a
// SqliteDictSource over the committed slug (a distinct reopened handle).
const importCsv = async (
  descriptor: Extract<ImportJobDescriptor, {kind: 'csv'}>,
  fetchFn: typeof fetch,
) => {
  const dir = mkdtempSync(join(tmpdir(), 'csve2e-'));
  const slugPaths = new Map<string, string>();
  const audit = await createSeededDb(async d => {
    await ensureImportsTable(d);
  });

  const ports: RunImportPorts = {
    sidecarText: JSON.stringify(descriptor.sidecar),
    produceSlugDb: filename =>
      produceCsvSlugDb(
        {
          loadBytes: async () => {
            const res = await fetchFn(`file://${descriptor.csvPath}`);
            if (!res.ok) {
              throw new Error(`fetch ${descriptor.csvPath} -> ${res.status}`);
            }
            return res.arrayBuffer();
          },
          openWritableSlug: async name => {
            const path = join(dir, name);
            slugPaths.set(name, path);
            const db = await openBetterSqliteDb(path)();
            if (db === null) {
              throw new Error('null slug');
            }
            return db;
          },
        },
        descriptor.csvConfig,
        filename,
      ),
    deleteFile: async () => undefined,
    sourcePaths: [descriptor.csvPath],
    slugDb: {
      reopenForVerify: async filename => {
        const db = await openBetterSqliteDb(slugPaths.get(filename)!)();
        if (db === null) {
          throw new Error('null reopen');
        }
        return db;
      },
      discard: async filename => unlinkSlug(slugPaths.get(filename)),
    },
    audit,
    now: () => '2026-06-08T00:00:00Z',
  };

  const result = await runImport(ports);
  if (!result.ok) {
    throw new Error(`import failed: ${result.reason}`);
  }
  const source = createSqliteDictSource({
    name: descriptor.sidecar.name,
    openDb: openBetterSqliteDb(slugPaths.get(result.filename)!),
  });
  return {result, source};
};

describe('CSV sideload — end to end (FR7)', () => {
  it('imports the shipped Dune.csv and resolves its headwords', async () => {
    const {fileUtils, fetchFn} = makeDeps(['Dune.csv']);
    const descriptors = await discoverUserDicts({fileUtils, fetchFn, rootPath: ROOT});
    expect(descriptors).toHaveLength(1);
    const d = descriptors[0];
    expect(d.kind).toBe('csv');
    expect(d.sidecar.name).toBe('Dune');

    const {result, source} = await importCsv(
      d as Extract<ImportJobDescriptor, {kind: 'csv'}>,
      fetchFn,
    );
    expect(result.entryCount).toBeGreaterThan(100);

    // ARRAKIS — definition NOT trimmed (leading space preserved).
    expect(await source.lookup('ARRAKIS')).toEqual({
      word: 'ARRAKIS',
      definition: ' the planet known as Dune; third planet of Canopus.',
      format: 'plain',
    });
    // aql — case-insensitive, quoted field unquoted.
    const aql = await source.lookup('aql');
    expect(aql?.word).toBe('AQL');
    expect(aql?.definition).toContain('the test of reason');
    // muad'dib — ASCII apostrophe query matches the CP1252 0x92 headword.
    const muad = await source.lookup("muad'dib");
    expect(muad?.word).toBe('MUAD’DIB');
    expect(muad?.definition).toContain('kangaroo mouse');
  });

  it('imports the shipped cooking-terms.csv and resolves its headwords', async () => {
    const {fileUtils, fetchFn} = makeDeps(['cooking-terms.csv']);
    const descriptors = await discoverUserDicts({fileUtils, fetchFn, rootPath: ROOT});
    expect(descriptors).toHaveLength(1);

    const {source} = await importCsv(
      descriptors[0] as Extract<ImportJobDescriptor, {kind: 'csv'}>,
      fetchFn,
    );
    expect((await source.lookup('roux'))?.definition).toBe(
      'a cooked mixture of fat (usually butter) and flour used to thicken sauces',
    );
    const deglaze = await source.lookup('deglaze');
    expect(deglaze?.definition).toContain('dissolve and lift caramelised');
  });

  it('a stale-CSV auto-refresh converges (verifies clean) in ONE in-place re-import', async () => {
    // The importer_version bug: an old slug DB is re-imported in place (same
    // slug filename) at bootstrap. The CSV produce-step opens the EXISTING
    // slug r/w, so without a DELETE-before-insert the rows DOUBLE and the
    // spine's COUNT verify FAILS — the DB would only converge on the NEXT
    // bootstrap. This drives the REAL spine twice over ONE shared slug path +
    // audit and proves the SECOND import verifies clean immediately.
    const {fileUtils, fetchFn} = makeDeps(['cooking-terms.csv']);
    const descriptors = await discoverUserDicts({fileUtils, fetchFn, rootPath: ROOT});
    const descriptor = descriptors[0] as Extract<
      ImportJobDescriptor,
      {kind: 'csv'}
    >;

    // One shared slug dir + audit db across both imports (as bootstrap reuses
    // them). resolveSlugCollision returns the SAME filename for the same
    // (name, lang), so the 2nd import overwrites the 1st slug in place.
    const dir = mkdtempSync(join(tmpdir(), 'csve2e-refresh-'));
    const slugPaths = new Map<string, string>();
    const audit = await createSeededDb(async d => {
      await ensureImportsTable(d);
    });
    const portsFor = (): RunImportPorts => ({
      sidecarText: JSON.stringify(descriptor.sidecar),
      produceSlugDb: filename =>
        produceCsvSlugDb(
          {
            loadBytes: async () => {
              const res = await fetchFn(`file://${descriptor.csvPath}`);
              if (!res.ok) {
                throw new Error(`fetch ${descriptor.csvPath} -> ${res.status}`);
              }
              return res.arrayBuffer();
            },
            openWritableSlug: async name => {
              const path = join(dir, name);
              slugPaths.set(name, path);
              const db = await openBetterSqliteDb(path)();
              if (db === null) {
                throw new Error('null slug');
              }
              return db;
            },
          },
          descriptor.csvConfig,
          filename,
        ),
      deleteFile: async () => undefined,
      keepSources: true,
      sourcePaths: [descriptor.csvPath],
      slugDb: {
        reopenForVerify: async filename => {
          const db = await openBetterSqliteDb(slugPaths.get(filename)!)();
          if (db === null) {
            throw new Error('null reopen');
          }
          return db;
        },
        discard: async filename => unlinkSlug(slugPaths.get(filename)),
      },
      audit,
      now: () => '2026-06-08T00:00:00Z',
    });

    // 1st import (simulates the OLD build) — verifies clean.
    const first = await runImport(portsFor());
    expect(first.ok).toBe(true);
    const firstCount = (first as {entryCount: number}).entryCount;

    // 2nd import into the SAME slug (the auto-refresh) — MUST verify clean in
    // this single pass, with exactly the same row count (no doubling).
    const second = await runImport(portsFor());
    expect(second.ok).toBe(true);
    expect((second as {entryCount: number}).entryCount).toBe(firstCount);

    // The slug holds the single (non-doubled) set...
    const slug = (await openBetterSqliteDb(
      slugPaths.get((second as {filename: string}).filename)!,
    )()) as SqliteDb;
    const n = (
      await slug.query<{n: number}>('SELECT COUNT(*) AS n FROM entries')
    )[0].n;
    await slug.close();
    expect(n).toBe(firstCount);

    // ...and the audit row is stamped with the current pipeline version.
    expect(
      await findImportByNameLang(
        audit,
        descriptor.sidecar.name,
        descriptor.sidecar.language,
      ),
    ).toMatchObject({
      importer_version: IMPORTER_VERSION,
    });
  });

  it('spine start-clean: a DIRTY-but-openable slot verifies clean in ONE pass with a NO-OP discard (R3-2)', async () => {
    // The stronger half of the dirty-slot guarantee: even when the spine's
    // FILE-level discard is a NO-OP (the slot is openable, just holds stale
    // rows), produceCsvSlugDb's own ROW-level DELETE FROM start-cleans it, so
    // the committed count is exactly the new rows in ONE pass (verify passes).
    const {fileUtils, fetchFn} = makeDeps(['cooking-terms.csv']);
    const descriptors = await discoverUserDicts({fileUtils, fetchFn, rootPath: ROOT});
    const descriptor = descriptors[0] as Extract<
      ImportJobDescriptor,
      {kind: 'csv'}
    >;

    const dir = mkdtempSync(join(tmpdir(), 'csve2e-dirty-'));
    const slugPaths = new Map<string, string>();
    const audit = await createSeededDb(async d => {
      await ensureImportsTable(d);
    });

    // Pre-dirty the exact slot the fresh import will build into with a stale row
    // from a "previous generation".
    const slugName = slugDbFilename(
      descriptor.sidecar.name,
      descriptor.sidecar.language,
    );
    const slugPath = join(dir, slugName);
    const seed = (await openBetterSqliteDb(slugPath)()) as SqliteDb;
    await seed.run(
      'CREATE TABLE IF NOT EXISTS entries (key TEXT NOT NULL, word TEXT NOT NULL, definition TEXT NOT NULL, format TEXT NOT NULL, phonetic TEXT)',
    );
    await seed.run(
      'INSERT INTO entries (key, word, definition, format, phonetic) VALUES (?, ?, ?, ?, ?)',
      ['stale', 'stale', 'old generation row', 'plain', null],
    );
    await seed.close();

    const ports: RunImportPorts = {
      sidecarText: JSON.stringify(descriptor.sidecar),
      produceSlugDb: filename =>
        produceCsvSlugDb(
          {
            loadBytes: async () => {
              const res = await fetchFn(`file://${descriptor.csvPath}`);
              return res.arrayBuffer();
            },
            openWritableSlug: async name => {
              const path = join(dir, name);
              slugPaths.set(name, path);
              const db = (await openBetterSqliteDb(path)()) as SqliteDb;
              return db;
            },
          },
          descriptor.csvConfig,
          filename,
        ),
      deleteFile: async () => undefined,
      keepSources: true,
      sourcePaths: [descriptor.csvPath],
      slugDb: {
        reopenForVerify: async filename => {
          const db = await openBetterSqliteDb(slugPaths.get(filename)!)();
          if (db === null) {
            throw new Error('null reopen');
          }
          return db;
        },
        // NO-OP discard: the FILE is never unlinked, so start-clean can only
        // come from the produce-step's DELETE FROM.
        discard: async () => undefined,
      },
      audit,
      now: () => '2026-06-08T00:00:00Z',
    };

    const result = await runImport(ports);
    expect(result.ok).toBe(true);
    const committed = (result as {entryCount: number}).entryCount;

    const slug = (await openBetterSqliteDb(slugPath)()) as SqliteDb;
    const n = (
      await slug.query<{n: number}>('SELECT COUNT(*) AS n FROM entries')
    )[0].n;
    const staleLeft = await slug.query('SELECT 1 FROM entries WHERE key = ?', [
      'stale',
    ]);
    await slug.close();
    // Exactly the new rows (verify matched), and the stale leftover is gone.
    expect(n).toBe(committed);
    expect(staleLeft).toHaveLength(0);
  });
});
