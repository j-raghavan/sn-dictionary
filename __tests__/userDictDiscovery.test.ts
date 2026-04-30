import {
  discoverUserDicts,
  type DiscoveryDeps,
  type FileEntry,
  type FileUtilsLike,
} from '../src/core/dict/userDictDiscovery';
import {buildSyntheticStarDict} from './_helpers/buildSyntheticStarDict';

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

const fileEntry = (path: string, type: 0 | 1): FileEntry => ({path, type});

// In-memory virtual filesystem for the test. listFiles returns the
// children of any directory; fetch resolves file:// URIs against the
// same map.
type Vfs = Record<string, ArrayBuffer | 'dir'>;

const makeVfs = (entries: Vfs): {
  fileUtils: FileUtilsLike;
  fetchFn: typeof fetch;
} => {
  const childrenOf = (dir: string): FileEntry[] => {
    const prefix = dir.endsWith('/') ? dir : dir + '/';
    const seen = new Set<string>();
    const out: FileEntry[] = [];
    for (const path of Object.keys(entries)) {
      if (!path.startsWith(prefix)) {
        continue;
      }
      const tail = path.slice(prefix.length);
      const slash = tail.indexOf('/');
      const childName = slash < 0 ? tail : tail.slice(0, slash);
      if (childName.length === 0 || seen.has(childName)) {
        continue;
      }
      seen.add(childName);
      const childPath = prefix + childName;
      const isDir =
        entries[childPath] === 'dir' ||
        Object.keys(entries).some(p =>
          p !== childPath && p.startsWith(childPath + '/'),
        );
      out.push(fileEntry(childPath, isDir ? 0 : 1));
    }
    return out;
  };
  const fileUtils: FileUtilsLike = {
    exists: jest.fn(async path => path in entries),
    listFiles: jest.fn(async path => {
      if (!(path in entries) && !Object.keys(entries).some(p => p.startsWith(path + '/'))) {
        throw new Error('Dir is not exists');
      }
      return childrenOf(path);
    }),
  };
  const fetchFn = jest.fn(async (url: string) => {
    const path = url.replace(/^file:\/\//, '');
    const data = entries[path];
    if (data === undefined || data === 'dir') {
      return {
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => data,
    } as unknown as Response;
  });
  return {fileUtils, fetchFn: fetchFn as unknown as typeof fetch};
};

const buildLogger = () => ({log: jest.fn(), warn: jest.fn()});

const ROOT = '/storage/emulated/0/MyStyle/SnDict';

const baseDeps = (
  vfs: Vfs,
  overrides: Partial<DiscoveryDeps> = {},
): DiscoveryDeps => {
  const built = makeVfs(vfs);
  return {
    fileUtils: built.fileUtils,
    fetchFn: built.fetchFn,
    logger: buildLogger(),
    rootPath: ROOT,
    ...overrides,
  };
};

const stardictBytes = (entries: Record<string, string>) => {
  const triple = buildSyntheticStarDict(entries);
  return {
    ifo: triple.ifo.buffer.slice(
      triple.ifo.byteOffset,
      triple.ifo.byteOffset + triple.ifo.byteLength,
    ) as ArrayBuffer,
    idx: triple.idx.buffer.slice(
      triple.idx.byteOffset,
      triple.idx.byteOffset + triple.idx.byteLength,
    ) as ArrayBuffer,
    dict: triple.dict.buffer.slice(
      triple.dict.byteOffset,
      triple.dict.byteOffset + triple.dict.byteLength,
    ) as ArrayBuffer,
  };
};

describe('discoverUserDicts', () => {
  test('returns [] when the root dir does not exist', async () => {
    const deps = baseDeps({});
    const result = await discoverUserDicts(deps);
    expect(result).toEqual([]);
    expect((deps.logger?.log as jest.Mock).mock.calls.flat().join(' ')).toMatch(
      /not listable.*Dir is not exists/,
    );
  });

  test('returns [] when the root dir exists but is empty', async () => {
    const deps = baseDeps({[ROOT]: 'dir'});
    expect(await discoverUserDicts(deps)).toEqual([]);
  });

  test('returns [] when the root has only files, no subfolders', async () => {
    const deps = baseDeps({
      [ROOT]: 'dir',
      [`${ROOT}/loose-file.txt`]: enc('hi'),
    });
    expect(await discoverUserDicts(deps)).toEqual([]);
  });

  test('discovers a CSV folder', async () => {
    const deps = baseDeps({
      [`${ROOT}/glossary/words.csv`]: enc('apple,a fruit\n'),
    });
    const sources = await discoverUserDicts(deps);
    expect(sources.length).toBe(1);
    expect(sources[0].name).toBe('glossary');
    expect(await sources[0].lookup('apple')).toEqual({
      word: 'apple',
      definition: 'a fruit',
    });
  });

  test('discovers a JSON folder', async () => {
    const deps = baseDeps({
      [`${ROOT}/myj/data.json`]: enc(JSON.stringify({hello: 'a greeting'})),
    });
    const sources = await discoverUserDicts(deps);
    expect(sources.length).toBe(1);
    expect((await sources[0].lookup('hello'))?.definition).toBe('a greeting');
  });

  test('discovers a StarDict folder', async () => {
    const triple = stardictBytes({apple: 'a fruit (custom)'});
    const deps = baseDeps({
      [`${ROOT}/medical/medical.ifo`]: triple.ifo,
      [`${ROOT}/medical/medical.idx`]: triple.idx,
      [`${ROOT}/medical/medical.dict.dz`]: triple.dict,
    });
    const sources = await discoverUserDicts(deps);
    expect(sources.length).toBe(1);
    expect(sources[0].name).toBe('medical');
    expect((await sources[0].lookup('apple'))?.definition).toBe('a fruit (custom)');
  });

  test('logs and skips an MDX folder (deferred format)', async () => {
    const deps = baseDeps({
      [`${ROOT}/some-mdx/dict.mdx`]: enc('binary'),
    });
    const sources = await discoverUserDicts(deps);
    expect(sources).toEqual([]);
    expect(
      (deps.logger?.warn as jest.Mock).mock.calls.flat().join(' '),
    ).toMatch(/MDX which is not yet supported/);
  });

  test('logs and skips a folder with no recognised dict files', async () => {
    const deps = baseDeps({
      [`${ROOT}/junk/random.txt`]: enc('not a dict'),
    });
    expect(await discoverUserDicts(deps)).toEqual([]);
    expect(
      (deps.logger?.warn as jest.Mock).mock.calls.flat().join(' '),
    ).toMatch(/no recognised dict files/);
  });

  test('logs and skips a folder with a partial StarDict triple', async () => {
    const deps = baseDeps({
      [`${ROOT}/incomplete/m.ifo`]: enc('bookname=test\n'),
      // missing .idx and .dict
    });
    expect(await discoverUserDicts(deps)).toEqual([]);
    expect(
      (deps.logger?.warn as jest.Mock).mock.calls.flat().join(' '),
    ).toMatch(/partial StarDict triple/);
  });

  test('logs and skips a folder containing multiple format markers', async () => {
    const deps = baseDeps({
      [`${ROOT}/mixed/words.csv`]: enc('a,b\n'),
      [`${ROOT}/mixed/data.json`]: enc('{}'),
    });
    expect(await discoverUserDicts(deps)).toEqual([]);
    expect(
      (deps.logger?.warn as jest.Mock).mock.calls.flat().join(' '),
    ).toMatch(/multiple formats present/);
  });

  test('uses meta.json `name` to override the folder display name', async () => {
    const deps = baseDeps({
      [`${ROOT}/folder-name/words.csv`]: enc('apple,fruit\n'),
      [`${ROOT}/folder-name/meta.json`]: enc(JSON.stringify({name: 'Pretty Name'})),
    });
    const sources = await discoverUserDicts(deps);
    expect(sources[0].name).toBe('Pretty Name');
  });

  test('falls back to folder name when meta.json is malformed', async () => {
    const deps = baseDeps({
      [`${ROOT}/folder-name/words.csv`]: enc('apple,fruit\n'),
      [`${ROOT}/folder-name/meta.json`]: enc('{not valid'),
    });
    const sources = await discoverUserDicts(deps);
    expect(sources[0].name).toBe('folder-name');
  });

  test('falls back to folder name when meta.json has no name field', async () => {
    const deps = baseDeps({
      [`${ROOT}/folder-name/words.csv`]: enc('apple,fruit\n'),
      [`${ROOT}/folder-name/meta.json`]: enc(JSON.stringify({other: 'x'})),
    });
    const sources = await discoverUserDicts(deps);
    expect(sources[0].name).toBe('folder-name');
  });

  test('json file named meta.json is not treated as a JSON dict', async () => {
    // A folder with ONLY meta.json is not a dict — no lookup format.
    const deps = baseDeps({
      [`${ROOT}/just-meta/meta.json`]: enc(JSON.stringify({name: 'X'})),
    });
    expect(await discoverUserDicts(deps)).toEqual([]);
  });

  test('returns sources sorted alphabetically by name (case-insensitive)', async () => {
    const deps = baseDeps({
      [`${ROOT}/zeta/words.csv`]: enc('a,b\n'),
      [`${ROOT}/Alpha/words.csv`]: enc('a,b\n'),
      [`${ROOT}/medical/words.csv`]: enc('a,b\n'),
    });
    const sources = await discoverUserDicts(deps);
    expect(sources.map(s => s.name)).toEqual(['Alpha', 'medical', 'zeta']);
  });

  test('isolates a per-folder failure and continues with the rest', async () => {
    const triple = stardictBytes({apple: 'fruit'});
    const fileUtils: FileUtilsLike = {
      exists: jest.fn(async () => true),
      listFiles: jest.fn(async (path: string) => {
        if (path === ROOT) {
          return [
            fileEntry(`${ROOT}/good`, 0),
            fileEntry(`${ROOT}/broken`, 0),
          ];
        }
        if (path === `${ROOT}/broken`) {
          throw new Error('IO error');
        }
        if (path === `${ROOT}/good`) {
          return [
            fileEntry(`${ROOT}/good/m.ifo`, 1),
            fileEntry(`${ROOT}/good/m.idx`, 1),
            fileEntry(`${ROOT}/good/m.dict.dz`, 1),
          ];
        }
        return [];
      }),
    };
    const fetchFn = jest.fn(async (url: string) => {
      const path = url.replace(/^file:\/\//, '');
      if (path.endsWith('.ifo')) {
        return {ok: true, status: 200, arrayBuffer: async () => triple.ifo} as Response;
      }
      if (path.endsWith('.idx')) {
        return {ok: true, status: 200, arrayBuffer: async () => triple.idx} as Response;
      }
      if (path.endsWith('.dict.dz')) {
        return {ok: true, status: 200, arrayBuffer: async () => triple.dict} as Response;
      }
      return {
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response;
    });
    const logger = buildLogger();
    const sources = await discoverUserDicts({
      fileUtils,
      fetchFn: fetchFn as unknown as typeof fetch,
      logger,
      rootPath: ROOT,
    });
    expect(sources.map(s => s.name)).toEqual(['good']);
    expect(
      (logger.warn as jest.Mock).mock.calls.flat().join(' '),
    ).toMatch(/folder "broken".*IO error/);
  });

  test('logs and returns [] when no fetch implementation is available', async () => {
    const built = makeVfs({
      [`${ROOT}/glossary/words.csv`]: enc('apple,fruit\n'),
    });
    const originalFetch = (globalThis as {fetch?: typeof fetch}).fetch;
    (globalThis as {fetch?: typeof fetch}).fetch = undefined;
    const logger = buildLogger();
    try {
      const sources = await discoverUserDicts({
        fileUtils: built.fileUtils,
        fetchFn: undefined,
        logger,
        rootPath: ROOT,
      });
      expect(sources).toEqual([]);
      expect(
        (logger.warn as jest.Mock).mock.calls.flat().join(' '),
      ).toMatch(/no fetch implementation/);
    } finally {
      (globalThis as {fetch?: typeof fetch}).fetch = originalFetch;
    }
  });

  test('discovers a mix of formats in one root', async () => {
    const triple = stardictBytes({apple: 'fruit (sd)'});
    const deps = baseDeps({
      [`${ROOT}/medical/m.ifo`]: triple.ifo,
      [`${ROOT}/medical/m.idx`]: triple.idx,
      [`${ROOT}/medical/m.dict.dz`]: triple.dict,
      [`${ROOT}/glossary/words.csv`]: enc('apple,fruit (csv)\n'),
      [`${ROOT}/japanese/data.json`]: enc(JSON.stringify({apple: 'fruit (json)'})),
    });
    const sources = await discoverUserDicts(deps);
    expect(sources.map(s => s.name)).toEqual(['glossary', 'japanese', 'medical']);
    expect((await sources[0].lookup('apple'))?.definition).toBe('fruit (csv)');
    expect((await sources[1].lookup('apple'))?.definition).toBe('fruit (json)');
    expect((await sources[2].lookup('apple'))?.definition).toBe('fruit (sd)');
  });

  test('uses the default root path when none is supplied', async () => {
    // Default root is /storage/emulated/0/MyStyle/SnDict.
    const built = makeVfs({
      ['/storage/emulated/0/MyStyle/SnDict/glossary/w.csv']: enc('apple,fruit\n'),
    });
    const sources = await discoverUserDicts({
      fileUtils: built.fileUtils,
      fetchFn: built.fetchFn,
      logger: buildLogger(),
    });
    expect(sources.map(s => s.name)).toEqual(['glossary']);
  });

  test('handles a sub-folder whose listFiles returns empty', async () => {
    const fileUtils: FileUtilsLike = {
      exists: jest.fn(async () => true),
      listFiles: jest.fn(async (path: string) => {
        if (path === ROOT) {
          return [fileEntry(`${ROOT}/empty`, 0)];
        }
        return [];
      }),
    };
    const logger = buildLogger();
    const sources = await discoverUserDicts({
      fileUtils,
      fetchFn: jest.fn() as unknown as typeof fetch,
      logger,
      rootPath: ROOT,
    });
    expect(sources).toEqual([]);
    expect(
      (logger.warn as jest.Mock).mock.calls.flat().join(' '),
    ).toMatch(/folder "empty" is empty/);
  });

  test('survives discovery without a logger', async () => {
    const deps = baseDeps(
      {[`${ROOT}/glossary/words.csv`]: enc('apple,fruit\n')},
      {logger: undefined},
    );
    const sources = await discoverUserDicts(deps);
    expect(sources.length).toBe(1);
  });

  test('source returns null when fetch responds with non-ok status', async () => {
    // Discovery succeeds (the file is listed) but reading its bytes
    // at lookup time gets a 403/404 — surface as a "no entry" rather
    // than crashing.
    const fileUtils: FileUtilsLike = {
      exists: jest.fn(async () => true),
      listFiles: jest.fn(async (path: string) => {
        if (path === ROOT) {
          return [fileEntry(`${ROOT}/glossary`, 0)];
        }
        return [fileEntry(`${ROOT}/glossary/words.csv`, 1)];
      }),
    };
    const fetchFn = jest.fn(async () => ({
      ok: false,
      status: 403,
      arrayBuffer: async () => new ArrayBuffer(0),
    }) as unknown as Response);
    const logger = buildLogger();
    const sources = await discoverUserDicts({
      fileUtils,
      fetchFn: fetchFn as unknown as typeof fetch,
      logger,
      rootPath: ROOT,
    });
    expect(sources.length).toBe(1);
    expect(await sources[0].lookup('apple')).toBeNull();
  });

  test('treats files without an extension as not-recognised', async () => {
    const deps = baseDeps({
      [`${ROOT}/no-ext/README`]: enc('not a dict'),
    });
    expect(await discoverUserDicts(deps)).toEqual([]);
    expect(
      (deps.logger?.warn as jest.Mock).mock.calls.flat().join(' '),
    ).toMatch(/no recognised dict files/);
  });
});
