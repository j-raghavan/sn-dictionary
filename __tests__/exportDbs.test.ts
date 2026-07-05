import {
  BASE_DB_FILENAME,
  DEFAULT_EXPORT_DIR,
  EXPORT_SPACE_MARGIN_BYTES,
  buildExportableDbs,
  exportDbs,
  exportRootParent,
  isInsidePluginDir,
  joinPath,
  listFolders,
  toDbFiles,
  type ExportPorts,
  type ExportableDb,
} from '../src/core/dict/sqlite/exportDbs';
import type {FileUtilsLike, FileEntry} from '../src/core/dict/userDictDiscovery';
import type {ImportRow} from '../src/core/dict/sqlite/schema';

const PLUGIN_DIR = 'plugins/sndictdfltbasev1/';

// A baseline set: base.db, user.db, one imported slug — all under the
// plugin dir. The reasons object the orchestration throws on abort.
const reasons = {
  pluginDir: PLUGIN_DIR,
  pluginDirMessage: 'PLUGIN_DIR_GUARD',
  noSpace: 'NO_SPACE',
};

const dbSet = (): ExportableDb[] => [
  {label: 'WordNet', filename: 'base.db', srcPath: `${PLUGIN_DIR}base.db`},
  {label: 'User', filename: 'user.db', srcPath: `${PLUGIN_DIR}user.db`},
  {
    label: 'Dune',
    filename: 'dune-english.en.db',
    srcPath: `${PLUGIN_DIR}dune-english.en.db`,
  },
];

// A fully-stubbed, happy ExportPorts; tests override individual ports.
const happyPorts = (over: Partial<ExportPorts> = {}): ExportPorts => ({
  listDbs: async () => dbSet(),
  availableSpace: async () => EXPORT_SPACE_MARGIN_BYTES + 10_000,
  sizeOf: async () => 1000,
  copyFile: async () => true,
  ensureDir: async () => true,
  checkpointUserDb: async () => undefined,
  ...over,
});

describe('exportDbs — joinPath / isInsidePluginDir / toDbFiles', () => {
  test('joinPath inserts exactly one slash, tolerating a trailing one', () => {
    expect(joinPath('/a/b', 'c.db')).toBe('/a/b/c.db');
    expect(joinPath('/a/b/', 'c.db')).toBe('/a/b/c.db');
  });

  // P2-1: index.js routes BOTH the F7 delete slug path and the F5 export
  // slug path through joinPath(PLUGIN_LOCATION, filename) so they can't
  // diverge. PLUGIN_LOCATION ends in '/', so the result is exactly the
  // legacy `${PLUGIN_LOCATION}${filename}` string the import path builds.
  test('joinPath(PLUGIN_LOCATION, filename) === the slug-DB device path', () => {
    expect(joinPath(PLUGIN_DIR, 'dune-english.en.db')).toBe(
      `${PLUGIN_DIR}dune-english.en.db`,
    );
  });

  test('isInsidePluginDir: equal or nested is inside; a sibling prefix is NOT', () => {
    expect(isInsidePluginDir(PLUGIN_DIR, PLUGIN_DIR)).toBe(true);
    expect(isInsidePluginDir(`${PLUGIN_DIR}sub`, PLUGIN_DIR)).toBe(true);
    expect(isInsidePluginDir('plugins/sndictdfltbasev1', PLUGIN_DIR)).toBe(true);
    // A sibling whose name merely starts with the plugin-dir string.
    expect(
      isInsidePluginDir('plugins/sndictdfltbasev1-backup', PLUGIN_DIR),
    ).toBe(false);
    expect(isInsidePluginDir('/storage/MyStyle/SnDict', PLUGIN_DIR)).toBe(false);
  });

  test('toDbFiles drops the source path, keeping label + filename', () => {
    expect(toDbFiles(dbSet())).toEqual([
      {label: 'WordNet', filename: 'base.db'},
      {label: 'User', filename: 'user.db'},
      {label: 'Dune', filename: 'dune-english.en.db'},
    ]);
  });
});

describe('exportDbs — happy path (F5-AC1)', () => {
  test('copies every DB into the target; originals untouched (read-only)', async () => {
    const copies: {src: string; dest: string}[] = [];
    const target = '/storage/MyStyle/SnDict/backup';
    const summary = await exportDbs(
      target,
      happyPorts({
        copyFile: async (src, dest) => {
          copies.push({src, dest});
          return true;
        },
      }),
      reasons,
    );
    expect(summary.copied).toEqual([
      'base.db',
      'user.db',
      'dune-english.en.db',
    ]);
    expect(summary.failed).toEqual([]);
    expect(summary.targetDir).toBe(target);
    // copyFile read from the plugin dir, wrote into the target — never the
    // other way round (export is a copy, never a move).
    expect(copies).toEqual([
      {src: `${PLUGIN_DIR}base.db`, dest: `${target}/base.db`},
      {src: `${PLUGIN_DIR}user.db`, dest: `${target}/user.db`},
      {
        src: `${PLUGIN_DIR}dune-english.en.db`,
        dest: `${target}/dune-english.en.db`,
      },
    ]);
  });
});

describe('exportDbs — plugin-dir guard (F5-FR4 / F5-AC5)', () => {
  test('a target equal to the plugin dir is rejected; NOTHING is copied', async () => {
    const copyFile = jest.fn(async () => true);
    const listDbs = jest.fn(async () => dbSet());
    await expect(
      exportDbs(PLUGIN_DIR, happyPorts({copyFile, listDbs}), reasons),
    ).rejects.toThrow('PLUGIN_DIR_GUARD');
    // Guard fires BEFORE any I/O — not even listDbs ran.
    expect(listDbs).not.toHaveBeenCalled();
    expect(copyFile).not.toHaveBeenCalled();
  });

  test('a target NESTED inside the plugin dir is rejected', async () => {
    const copyFile = jest.fn(async () => true);
    await expect(
      exportDbs(`${PLUGIN_DIR}sub/backup`, happyPorts({copyFile}), reasons),
    ).rejects.toThrow('PLUGIN_DIR_GUARD');
    expect(copyFile).not.toHaveBeenCalled();
  });
});

describe('exportDbs — space pre-check (F5-FR3 / F5-AC2)', () => {
  test('insufficient free space aborts with the no-space reason; nothing copied', async () => {
    const copyFile = jest.fn(async () => true);
    const checkpointUserDb = jest.fn(async () => undefined);
    await expect(
      exportDbs(
        '/storage/MyStyle/SnDict',
        happyPorts({
          // 3 × 1000 + margin needed; only margin available -> shortfall.
          sizeOf: async () => 1000,
          availableSpace: async () => EXPORT_SPACE_MARGIN_BYTES,
          copyFile,
          checkpointUserDb,
        }),
        reasons,
      ),
    ).rejects.toThrow('NO_SPACE');
    expect(copyFile).not.toHaveBeenCalled();
    // Abort happens at the space gate, before the checkpoint.
    expect(checkpointUserDb).not.toHaveBeenCalled();
  });

  test('an unknowable size (sizeOf throws) does not block — counts 0, still exports', async () => {
    const summary = await exportDbs(
      '/storage/MyStyle/SnDict',
      happyPorts({
        sizeOf: async () => {
          throw new Error('stat failed');
        },
        availableSpace: async () => EXPORT_SPACE_MARGIN_BYTES + 1,
      }),
      reasons,
    );
    expect(summary.copied).toHaveLength(3);
  });
});

describe('exportDbs — checkpoint before copy (F5-FR8 / resolution #9)', () => {
  test('user.db is checkpointed BEFORE its file is copied', async () => {
    const order: string[] = [];
    await exportDbs(
      '/storage/MyStyle/SnDict',
      happyPorts({
        checkpointUserDb: async () => {
          order.push('checkpoint');
        },
        copyFile: async (_src, dest) => {
          order.push(`copy:${dest.split('/').pop()}`);
          return true;
        },
      }),
      reasons,
    );
    // The checkpoint runs once, before any copy (incl. user.db's).
    expect(order[0]).toBe('checkpoint');
    expect(order.filter(o => o === 'checkpoint')).toHaveLength(1);
    const userCopyIdx = order.indexOf('copy:user.db');
    expect(order.indexOf('checkpoint')).toBeLessThan(userCopyIdx);
  });

  test('no checkpoint when user.db is absent from the set (degraded user.db)', async () => {
    const checkpointUserDb = jest.fn(async () => undefined);
    await exportDbs(
      '/storage/MyStyle/SnDict',
      happyPorts({
        listDbs: async () => [
          {label: 'WordNet', filename: 'base.db', srcPath: `${PLUGIN_DIR}base.db`},
        ],
        checkpointUserDb,
      }),
      reasons,
    );
    expect(checkpointUserDb).not.toHaveBeenCalled();
  });

  test('a checkpoint failure is swallowed — the copy proceeds', async () => {
    const summary = await exportDbs(
      '/storage/MyStyle/SnDict',
      happyPorts({
        checkpointUserDb: async () => {
          throw new Error('wal locked');
        },
      }),
      reasons,
    );
    expect(summary.copied).toHaveLength(3);
  });
});

describe('exportDbs — partial failure reporting (F5-FR5 / F5-AC4)', () => {
  test('a single copyFile failure is reported; the others still copy', async () => {
    const summary = await exportDbs(
      '/storage/MyStyle/SnDict',
      happyPorts({
        copyFile: async (src) =>
          src.endsWith('user.db')
            ? Promise.reject(new Error('disk error'))
            : true,
      }),
      reasons,
    );
    expect(summary.copied).toEqual(['base.db', 'dune-english.en.db']);
    expect(summary.failed).toEqual([
      {file: 'user.db', reason: 'disk error'},
    ]);
  });

  test('a copyFile resolving false is a failure too (not silently dropped)', async () => {
    const summary = await exportDbs(
      '/storage/MyStyle/SnDict',
      happyPorts({
        copyFile: async (src) => !src.endsWith('base.db'),
      }),
      reasons,
    );
    expect(summary.copied).toEqual(['user.db', 'dune-english.en.db']);
    expect(summary.failed).toEqual([
      {file: 'base.db', reason: 'copy returned false'},
    ]);
  });
});

describe('exportDbs — target-dir creation (F5-FR2 / F5-AC3)', () => {
  test('ensureDir creates the target before copying', async () => {
    const ensureDir = jest.fn(async () => true);
    await exportDbs(
      '/storage/MyStyle/SnDict/backup',
      happyPorts({ensureDir}),
      reasons,
    );
    expect(ensureDir).toHaveBeenCalledWith('/storage/MyStyle/SnDict/backup');
  });

  test('an ensureDir failure aborts (as no-space); nothing copied', async () => {
    const copyFile = jest.fn(async () => true);
    await expect(
      exportDbs(
        '/storage/MyStyle/SnDict/backup',
        happyPorts({ensureDir: async () => false, copyFile}),
        reasons,
      ),
    ).rejects.toThrow('NO_SPACE');
    expect(copyFile).not.toHaveBeenCalled();
  });

  test('an ensureDir that throws is also a clean abort', async () => {
    await expect(
      exportDbs(
        '/storage/MyStyle/SnDict/backup',
        happyPorts({
          ensureDir: async () => {
            throw new Error('mkdir EACCES');
          },
        }),
        reasons,
      ),
    ).rejects.toThrow('NO_SPACE');
  });
});

describe('buildExportableDbs (F5-FR1)', () => {
  const imports: ImportRow[] = [
    {
      name: 'Dune',
      lang: 'en',
      entry_count: 10,
      imported_at: '2026-01-01',
      filename: 'dune-english.en.db',
      importer_version: 1,
    },
  ];
  const resolvePath = (filename: string): string => `${PLUGIN_DIR}${filename}`;

  test('base + user + each imported slug, with labels + resolved paths', () => {
    expect(
      buildExportableDbs({hasBase: true, hasUser: true, imports, resolvePath}),
    ).toEqual([
      {label: 'WordNet', filename: BASE_DB_FILENAME, srcPath: `${PLUGIN_DIR}base.db`},
      {label: 'User', filename: 'user.db', srcPath: `${PLUGIN_DIR}user.db`},
      {
        label: 'Dune',
        filename: 'dune-english.en.db',
        srcPath: `${PLUGIN_DIR}dune-english.en.db`,
      },
    ]);
  });

  test('omits user.db when the user DB is degraded (hasUser=false)', () => {
    const dbs = buildExportableDbs({
      hasBase: true,
      hasUser: false,
      imports: [],
      resolvePath,
    });
    expect(dbs.map(d => d.filename)).toEqual(['base.db']);
  });

  test('omits base.db when not provisioned (hasBase=false)', () => {
    const dbs = buildExportableDbs({
      hasBase: false,
      hasUser: true,
      imports: [],
      resolvePath,
    });
    expect(dbs.map(d => d.filename)).toEqual(['user.db']);
  });

  // P2-2 (F7 -> F5): a dict deleted via deleteImportedDict drops its audit
  // row, so the export set (driven off SELECT_IMPORT_ALL) sees the audit
  // MINUS that dict — base.db + user.db + the remaining imports only. Feed
  // the post-delete rows and assert the deleted dict is absent.
  test('a just-deleted dict (audit row gone) is absent from the export set', () => {
    const twoImports: ImportRow[] = [
      ...imports,
      {
        name: 'Atlas',
        lang: 'en',
        entry_count: 5,
        imported_at: '2026-02-02',
        filename: 'atlas-world.en.db',
        importer_version: 1,
      },
    ];
    // Dune was deleted: its audit row is gone, leaving only Atlas.
    const afterDelete = twoImports.filter(r => r.name !== 'Dune');
    const dbs = buildExportableDbs({
      hasBase: true,
      hasUser: true,
      imports: afterDelete,
      resolvePath,
    });
    expect(dbs.map(d => d.filename)).toEqual([
      'base.db',
      'user.db',
      'atlas-world.en.db',
    ]);
    expect(dbs.some(d => d.label === 'Dune')).toBe(false);
  });
});

describe('listFolders (F5-FR2 — reuses the type-tagged FileUtils)', () => {
  const entry = (path: string, type: number): FileEntry => ({path, type});
  const fileUtils = (entries: FileEntry[] | null): FileUtilsLike => ({
    exists: async () => true,
    listFiles: async () => entries,
  });

  test('keeps only directories (type===0), preserving order', async () => {
    const result = await listFolders(
      fileUtils([
        entry('/root/a', 0),
        entry('/root/file.txt', 1),
        entry('/root/b', 0),
      ]),
      '/root',
    );
    expect(result).toEqual(['/root/a', '/root/b']);
  });

  test('a null listing yields an empty chooser (no crash)', async () => {
    expect(await listFolders(fileUtils(null), '/root')).toEqual([]);
  });

  test('a throwing listFiles yields an empty chooser', async () => {
    const fu: FileUtilsLike = {
      exists: async () => true,
      listFiles: async () => {
        throw new Error('unreadable');
      },
    };
    expect(await listFolders(fu, '/root')).toEqual([]);
  });
});

describe('exportRootParent / DEFAULT_EXPORT_DIR', () => {
  test('rootParent is the parent of the SnDict default root (MyStyle)', () => {
    expect(exportRootParent()).toBe('/storage/emulated/0/MyStyle');
    expect(DEFAULT_EXPORT_DIR).toBe('/storage/emulated/0/MyStyle/SnDict');
  });
});
