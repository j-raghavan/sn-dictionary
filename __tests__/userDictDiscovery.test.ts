// StarDict-only discovery returning import-job descriptors (TF5-FR1).
// Discovery LOCATES the triple + validates the meta.json sidecar; it
// does not read dictionary bytes or build sources. CSV/JSON/MDX and the
// flat root layout are gone.

import {
  discoverUserDicts,
  DEFAULT_USER_DICT_ROOT,
  type FileEntry,
} from '../src/core/dict/userDictDiscovery';

const ROOT = '/root';
const fileEntry = (path: string, type: 0 | 1): FileEntry => ({path, type});

// Build a fileUtils + fetchFn pair. `tree` maps a directory path to its
// entries; `meta` maps a meta.json file path to its raw text.
const makeDeps = (
  tree: Record<string, FileEntry[]>,
  meta: Record<string, string>,
) => {
  const listFiles = jest.fn(async (path: string) => tree[path] ?? []);
  const fetchFn = jest.fn(async (url: string) => {
    const path = url.replace(/^file:\/\//, '');
    const text = meta[path];
    if (text === undefined) {
      return {ok: false, status: 404} as Response;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    } as unknown as Response;
  });
  const warnings: string[] = [];
  const logs: string[] = [];
  const logger = {
    warn: (m: string) => warnings.push(m),
    log: (m: string) => logs.push(m),
  };
  return {
    deps: {
      fileUtils: {exists: jest.fn(async () => true), listFiles},
      rootPath: ROOT,
      fetchFn: fetchFn as unknown as typeof fetch,
      logger,
    },
    listFiles,
    fetchFn,
    warnings,
    logs,
  };
};

const folder = (name: string) => fileEntry(`${ROOT}/${name}`, 0);
const triple = (dir: string) => [
  fileEntry(`${dir}/base.ifo`, 1),
  fileEntry(`${dir}/base.idx`, 1),
  fileEntry(`${dir}/base.dict.dz`, 1),
];

describe('discoverUserDicts — StarDict-only descriptors', () => {
  it('returns a descriptor for a complete triple + valid meta.json', async () => {
    const dir = `${ROOT}/dune`;
    const {deps} = makeDeps(
      {
        [ROOT]: [folder('dune')],
        [dir]: [...triple(dir), fileEntry(`${dir}/meta.json`, 1)],
      },
      {[`${dir}/meta.json`]: JSON.stringify({name: 'Dune', language: 'en'})},
    );
    const out = await discoverUserDicts(deps);
    expect(out).toEqual([
      {
        setPath: dir,
        ifoPath: `${dir}/base.ifo`,
        idxPath: `${dir}/base.idx`,
        dictPath: `${dir}/base.dict.dz`,
        synPath: undefined,
        sidecarPath: `${dir}/meta.json`,
        sidecar: {name: 'Dune', language: 'en'},
      },
    ]);
  });

  it('captures an optional .syn path', async () => {
    const dir = `${ROOT}/hi`;
    const {deps} = makeDeps(
      {
        [ROOT]: [folder('hi')],
        [dir]: [
          ...triple(dir),
          fileEntry(`${dir}/base.syn`, 1),
          fileEntry(`${dir}/meta.json`, 1),
        ],
      },
      {[`${dir}/meta.json`]: JSON.stringify({name: 'Hindi', language: 'hi'})},
    );
    const out = await discoverUserDicts(deps);
    expect(out[0].synPath).toBe(`${dir}/base.syn`);
  });

  it('accepts a plain .dict (non-dz) member', async () => {
    const dir = `${ROOT}/plain`;
    const {deps} = makeDeps(
      {
        [ROOT]: [folder('plain')],
        [dir]: [
          fileEntry(`${dir}/d.ifo`, 1),
          fileEntry(`${dir}/d.idx`, 1),
          fileEntry(`${dir}/d.dict`, 1),
          fileEntry(`${dir}/meta.json`, 1),
        ],
      },
      {[`${dir}/meta.json`]: JSON.stringify({name: 'Plain', language: 'en'})},
    );
    const out = await discoverUserDicts(deps);
    expect(out[0].dictPath).toBe(`${dir}/d.dict`);
  });

  it('sorts descriptors by sidecar name (case-insensitive)', async () => {
    const a = `${ROOT}/a`;
    const z = `${ROOT}/z`;
    const {deps} = makeDeps(
      {
        [ROOT]: [folder('z'), folder('a')],
        [a]: [...triple(a), fileEntry(`${a}/meta.json`, 1)],
        [z]: [...triple(z), fileEntry(`${z}/meta.json`, 1)],
      },
      {
        [`${a}/meta.json`]: JSON.stringify({name: 'Zeta', language: 'en'}),
        [`${z}/meta.json`]: JSON.stringify({name: 'alpha', language: 'en'}),
      },
    );
    const out = await discoverUserDicts(deps);
    expect(out.map(d => d.sidecar.name)).toEqual(['alpha', 'Zeta']);
  });
});

describe('discoverUserDicts — skip + isolation', () => {
  it('skips a folder with an incomplete triple (logs)', async () => {
    const dir = `${ROOT}/partial`;
    const {deps, warnings} = makeDeps(
      {
        [ROOT]: [folder('partial')],
        [dir]: [fileEntry(`${dir}/base.ifo`, 1), fileEntry(`${dir}/meta.json`, 1)],
      },
      {[`${dir}/meta.json`]: JSON.stringify({name: 'P', language: 'en'})},
    );
    expect(await discoverUserDicts(deps)).toEqual([]);
    expect(warnings.some(w => w.includes('no complete StarDict triple'))).toBe(
      true,
    );
  });

  it('skips a folder with no meta.json (logs)', async () => {
    const dir = `${ROOT}/nometa`;
    const {deps, warnings} = makeDeps(
      {[ROOT]: [folder('nometa')], [dir]: triple(dir)},
      {},
    );
    expect(await discoverUserDicts(deps)).toEqual([]);
    expect(warnings.some(w => w.includes('no meta.json sidecar'))).toBe(true);
  });

  it('skips a folder whose meta.json is invalid JSON (logs)', async () => {
    const dir = `${ROOT}/badjson`;
    const {deps, warnings} = makeDeps(
      {
        [ROOT]: [folder('badjson')],
        [dir]: [...triple(dir), fileEntry(`${dir}/meta.json`, 1)],
      },
      {[`${dir}/meta.json`]: '{not json'},
    );
    expect(await discoverUserDicts(deps)).toEqual([]);
    expect(warnings.some(w => w.includes('not valid JSON'))).toBe(true);
  });

  it('skips a folder whose sidecar fails validation (logs reason)', async () => {
    const dir = `${ROOT}/badmeta`;
    const {deps, warnings} = makeDeps(
      {
        [ROOT]: [folder('badmeta')],
        [dir]: [...triple(dir), fileEntry(`${dir}/meta.json`, 1)],
      },
      {[`${dir}/meta.json`]: JSON.stringify({language: 'en'})}, // missing name
    );
    expect(await discoverUserDicts(deps)).toEqual([]);
    expect(warnings.some(w => w.includes('invalid'))).toBe(true);
  });

  it('skips a folder whose meta.json read throws (logs)', async () => {
    const dir = `${ROOT}/readfail`;
    const {deps, warnings} = makeDeps(
      {
        [ROOT]: [folder('readfail')],
        [dir]: [...triple(dir), fileEntry(`${dir}/meta.json`, 1)],
      },
      {}, // meta path 404s -> fetch !ok -> read throws
    );
    expect(await discoverUserDicts(deps)).toEqual([]);
    expect(warnings.some(w => w.includes('meta.json read threw'))).toBe(true);
  });

  it('one bad folder does not break a good sibling', async () => {
    const good = `${ROOT}/good`;
    const bad = `${ROOT}/bad`;
    const {deps} = makeDeps(
      {
        [ROOT]: [folder('good'), folder('bad')],
        [good]: [...triple(good), fileEntry(`${good}/meta.json`, 1)],
        [bad]: [fileEntry(`${bad}/base.ifo`, 1)], // partial
      },
      {[`${good}/meta.json`]: JSON.stringify({name: 'Good', language: 'en'})},
    );
    const out = await discoverUserDicts(deps);
    expect(out.map(d => d.sidecar.name)).toEqual(['Good']);
  });

  it('isolates a folder whose descriptor build throws unexpectedly', async () => {
    // A malformed file entry (non-string path) makes the internal
    // path helpers throw — the outer guard must log + continue, never
    // breaking discovery (the "never throws" contract).
    const good = `${ROOT}/good`;
    const {deps, warnings} = makeDeps(
      {
        [ROOT]: [folder('boom'), folder('good')],
        [`${ROOT}/boom`]: [{path: null as unknown as string, type: 1}],
        [good]: [...triple(good), fileEntry(`${good}/meta.json`, 1)],
      },
      {[`${good}/meta.json`]: JSON.stringify({name: 'Good', language: 'en'})},
    );
    const out = await discoverUserDicts(deps);
    expect(out.map(d => d.sidecar.name)).toEqual(['Good']);
    expect(warnings.some(w => w.includes('build threw'))).toBe(true);
  });

  it('continues past a folder whose listFiles throws', async () => {
    const good = `${ROOT}/good`;
    const listFiles = jest.fn(async (path: string) => {
      if (path === `${ROOT}/boom`) {
        throw new Error('io error');
      }
      if (path === ROOT) {
        return [folder('boom'), folder('good')];
      }
      if (path === good) {
        return [...triple(good), fileEntry(`${good}/meta.json`, 1)];
      }
      return [];
    });
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        new TextEncoder().encode(JSON.stringify({name: 'Good', language: 'en'}))
          .buffer,
    })) as unknown as typeof fetch;
    const warnings: string[] = [];
    const out = await discoverUserDicts({
      fileUtils: {exists: jest.fn(async () => true), listFiles},
      rootPath: ROOT,
      fetchFn,
      logger: {log: () => {}, warn: m => warnings.push(m)},
    });
    expect(out.map(d => d.sidecar.name)).toEqual(['Good']);
    expect(warnings.some(w => w.includes('listFiles threw'))).toBe(true);
  });

  it('skips an empty subfolder (logs)', async () => {
    const {deps, warnings} = makeDeps(
      {[ROOT]: [folder('empty')], [`${ROOT}/empty`]: []},
      {},
    );
    expect(await discoverUserDicts(deps)).toEqual([]);
    expect(warnings.some(w => w.includes('is empty'))).toBe(true);
  });
});

describe('discoverUserDicts — root handling', () => {
  it('returns [] when the root is not listable (never throws)', async () => {
    const out = await discoverUserDicts({
      fileUtils: {
        exists: jest.fn(async () => false),
        listFiles: jest.fn(async () => {
          throw new Error('Dir is not exists');
        }),
      },
      rootPath: ROOT,
      fetchFn: jest.fn() as unknown as typeof fetch,
      logger: {log: () => {}, warn: () => {}},
    });
    expect(out).toEqual([]);
  });

  it('returns [] when the root is empty', async () => {
    const {deps} = makeDeps({[ROOT]: []}, {});
    expect(await discoverUserDicts(deps)).toEqual([]);
  });

  it('returns [] when no fetch implementation is available', async () => {
    // Force the no-fetch branch: fetchFn undefined AND globalThis.fetch
    // absent (the runtime fallback the impl reaches for).
    const savedFetch = globalThis.fetch;
    // @ts-expect-error intentionally clearing the global for the test
    delete globalThis.fetch;
    const warnings: string[] = [];
    try {
      const out = await discoverUserDicts({
        fileUtils: {
          exists: jest.fn(async () => true),
          listFiles: jest.fn(async () => [folder('x')]),
        },
        rootPath: ROOT,
        fetchFn: undefined,
        logger: {log: () => {}, warn: m => warnings.push(m)},
      });
      expect(out).toEqual([]);
      expect(warnings.some(w => w.includes('no fetch implementation'))).toBe(true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('ignores root-level files (no flat layout)', async () => {
    const {deps} = makeDeps(
      {
        [ROOT]: [
          fileEntry(`${ROOT}/Dune.csv`, 1),
          fileEntry(`${ROOT}/medical.json`, 1),
        ],
      },
      {},
    );
    expect(await discoverUserDicts(deps)).toEqual([]);
  });

  it('defaults the root to DEFAULT_USER_DICT_ROOT and tolerates no logger', async () => {
    // Omit logger to exercise the default no-op logger branch.
    const listFiles = jest.fn(async () => []);
    await discoverUserDicts({
      fileUtils: {exists: jest.fn(async () => true), listFiles},
      fetchFn: jest.fn() as unknown as typeof fetch,
    });
    expect(listFiles).toHaveBeenCalledWith(DEFAULT_USER_DICT_ROOT);
  });

  it('tolerates no logger on a warn path (default no-op warn)', async () => {
    // A folder that gets skipped triggers logger.warn; with no logger
    // supplied this exercises the default no-op warn arrow.
    const dir = `${ROOT}/nometa`;
    const listFiles = jest.fn(async (path: string) => {
      if (path === ROOT) {
        return [folder('nometa')];
      }
      if (path === dir) {
        return triple(dir); // no meta.json -> warn + skip
      }
      return [];
    });
    const out = await discoverUserDicts({
      fileUtils: {exists: jest.fn(async () => true), listFiles},
      rootPath: ROOT,
      fetchFn: jest.fn() as unknown as typeof fetch,
    });
    expect(out).toEqual([]);
  });

  it('handles bare (slash-less, dot-less) file + folder paths', async () => {
    // Exercises the extOf/basenameOf no-slash and no-dot branches: a
    // folder whose path has no slash, holding a triple with bare names
    // and a dot-less extra file.
    const {deps} = makeDeps(
      {
        // The root lists a folder whose path is itself slash-less.
        [ROOT]: [{path: 'bare', type: 0}],
        bare: [
          {path: 'd.ifo', type: 1},
          {path: 'd.idx', type: 1},
          {path: 'd.dict', type: 1},
          {path: 'README', type: 1}, // dot-less -> extOf '' branch
          {path: 'meta.json', type: 1},
        ],
      },
      {'meta.json': JSON.stringify({name: 'Bare', language: 'en'})},
    );
    const out = await discoverUserDicts(deps);
    expect(out).toHaveLength(1);
    expect(out[0].sidecar.name).toBe('Bare');
    expect(out[0].setPath).toBe('bare');
  });
});
