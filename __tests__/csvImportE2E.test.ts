// FR7: end-to-end CSV sideload. Wires the REAL production modules over
// the shipped sample CSVs (assets/sample-dicts): discovery LOCATES a
// loose *.csv -> runImport drives the shared spine -> the CSV
// produce-step parses + inserts into a slug DB -> a SqliteDictSource
// over that slug resolves the headwords. No mocks of the pipeline — only
// the filesystem (in-memory fileUtils + a fetch over the real bytes) and
// the slug-DB lifecycle (temp-file better-sqlite3) are host shims.

import {readFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  discoverUserDicts,
  type FileEntry,
} from '../src/core/dict/userDictDiscovery';
import {runImport, type RunImportPorts} from '../src/core/dict/sqlite/runImport';
import {produceCsvSlugDb} from '../src/core/dict/sqlite/importCsvRows';
import {createSqliteDictSource} from '../src/core/dict/sqlite/sqliteDictSource';
import {ensureImportsTable} from '../src/core/dict/sqlite/importAudit';
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
      discard: async () => undefined,
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
});
