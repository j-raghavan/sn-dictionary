import {
  buildRestorableDbs,
  restoreDbs,
  type RestorePorts,
} from '../src/core/dict/sqlite/restoreDbs';

// The live plugin dir (relative PLUGIN_LOCATION) the restore copies INTO,
// and a backup folder under MyStyle the restore copies FROM.
const PLUGIN_DIR = 'plugins/sndictdfltbasev1/';
const BACKUP_DIR = '/storage/emulated/0/MyStyle/SnDict/backup';

const reasons = {noBackup: 'NO_BACKUP'};

// A fully-stubbed, happy RestorePorts; tests override individual ports.
const happyPorts = (over: Partial<RestorePorts> = {}): RestorePorts => ({
  listBackup: async () => ['user.db', 'dune-english.en.db'],
  copyInto: async () => true,
  resolveLivePath: (filename: string) => `${PLUGIN_DIR}${filename}`,
  closeWritable: async () => undefined,
  ...over,
});

describe('buildRestorableDbs (F8 — pure)', () => {
  test('includes user.db + every slug, EXCLUDES base.db', () => {
    const dbs = buildRestorableDbs([
      'base.db',
      'user.db',
      'dune-english.en.db',
      'atlas-world.en.db',
    ]);
    // base.db is NEVER restorable; user.db sorts first, then the slugs.
    expect(dbs.map(d => d.filename)).toEqual([
      'user.db',
      'dune-english.en.db',
      'atlas-world.en.db',
    ]);
  });

  test('base.db is excluded even when it is the ONLY file (schema-mismatch rail)', () => {
    expect(buildRestorableDbs(['base.db'])).toEqual([]);
  });

  test('a backup of only slugs (no user.db) restores just the slugs', () => {
    const dbs = buildRestorableDbs(['dune-english.en.db', 'base.db']);
    expect(dbs.map(d => d.filename)).toEqual(['dune-english.en.db']);
  });

  test('user.db is restorable even with no slugs present', () => {
    expect(buildRestorableDbs(['user.db', 'base.db']).map(d => d.filename)).toEqual([
      'user.db',
    ]);
  });

  test('non-.db names are ignored (defensive)', () => {
    expect(
      buildRestorableDbs(['user.db', 'notes.txt', 'meta.json']).map(d => d.filename),
    ).toEqual(['user.db']);
  });

  test('an empty backup folder yields nothing to restore', () => {
    expect(buildRestorableDbs([])).toEqual([]);
  });
});

describe('restoreDbs — happy path (close BEFORE copy, base.db never copied)', () => {
  test('closeWritable runs BEFORE any copy; each restorable copied src->dest', async () => {
    const order: string[] = [];
    const copies: {src: string; dest: string}[] = [];
    const summary = await restoreDbs(
      BACKUP_DIR,
      happyPorts({
        // base.db is in the backup folder but MUST NOT be copied.
        listBackup: async () => ['base.db', 'user.db', 'dune-english.en.db'],
        closeWritable: async () => {
          order.push('close');
        },
        copyInto: async (src, dest) => {
          order.push(`copy:${dest.split('/').pop()}`);
          copies.push({src, dest});
          return true;
        },
      }),
      reasons,
    );
    // Close ran exactly once, BEFORE every copy.
    expect(order[0]).toBe('close');
    expect(order.filter(o => o === 'close')).toHaveLength(1);
    expect(order.slice(1)).toEqual([
      'copy:user.db',
      'copy:dune-english.en.db',
    ]);
    // base.db was NEVER copied (the build helper excludes it).
    expect(copies.some(c => c.src.endsWith('base.db'))).toBe(false);
    expect(copies.some(c => c.dest.endsWith('base.db'))).toBe(false);
    // Each restorable copied from the backup folder INTO the live plugin dir.
    expect(copies).toEqual([
      {src: `${BACKUP_DIR}/user.db`, dest: `${PLUGIN_DIR}user.db`},
      {
        src: `${BACKUP_DIR}/dune-english.en.db`,
        dest: `${PLUGIN_DIR}dune-english.en.db`,
      },
    ]);
    expect(summary).toEqual({
      restored: ['user.db', 'dune-english.en.db'],
      failed: [],
      backupDir: BACKUP_DIR,
    });
  });
});

describe('restoreDbs — empty backup (no-op, nothing closed or copied)', () => {
  test('an empty folder returns the noBackup reason; closeWritable NOT called', async () => {
    const closeWritable = jest.fn(async () => undefined);
    const copyInto = jest.fn(async () => true);
    const summary = await restoreDbs(
      BACKUP_DIR,
      happyPorts({listBackup: async () => [], closeWritable, copyInto}),
      reasons,
    );
    expect(summary).toEqual({
      restored: [],
      failed: [{file: BACKUP_DIR, reason: 'NO_BACKUP'}],
      backupDir: BACKUP_DIR,
    });
    // Nothing was closed or copied — there was nothing to restore.
    expect(closeWritable).not.toHaveBeenCalled();
    expect(copyInto).not.toHaveBeenCalled();
  });

  test('a backup of ONLY base.db is treated as empty (base.db never restored)', async () => {
    const closeWritable = jest.fn(async () => undefined);
    const summary = await restoreDbs(
      BACKUP_DIR,
      happyPorts({listBackup: async () => ['base.db'], closeWritable}),
      reasons,
    );
    expect(summary.restored).toEqual([]);
    expect(summary.failed).toEqual([{file: BACKUP_DIR, reason: 'NO_BACKUP'}]);
    expect(closeWritable).not.toHaveBeenCalled();
  });

  test('a throwing listBackup is treated as an empty folder (no-op)', async () => {
    const closeWritable = jest.fn(async () => undefined);
    const warn = jest.fn();
    const summary = await restoreDbs(
      BACKUP_DIR,
      happyPorts({
        listBackup: async () => {
          throw new Error('unreadable');
        },
        closeWritable,
      }),
      reasons,
      {warn},
    );
    expect(summary.restored).toEqual([]);
    expect(closeWritable).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('listBackup'));
  });
});

describe('restoreDbs — partial failure reporting', () => {
  test('a single copy failure is reported per-file; the others still restore', async () => {
    const summary = await restoreDbs(
      BACKUP_DIR,
      happyPorts({
        listBackup: async () => ['user.db', 'dune-english.en.db'],
        copyInto: async (src) =>
          src.endsWith('user.db')
            ? Promise.reject(new Error('disk error'))
            : true,
      }),
      reasons,
    );
    expect(summary.restored).toEqual(['dune-english.en.db']);
    expect(summary.failed).toEqual([{file: 'user.db', reason: 'disk error'}]);
  });

  test('a copyInto resolving false is a failure too (not silently dropped)', async () => {
    const summary = await restoreDbs(
      BACKUP_DIR,
      happyPorts({
        listBackup: async () => ['user.db', 'dune-english.en.db'],
        copyInto: async (src) => !src.endsWith('user.db'),
      }),
      reasons,
    );
    expect(summary.restored).toEqual(['dune-english.en.db']);
    expect(summary.failed).toEqual([
      {file: 'user.db', reason: 'copy returned false'},
    ]);
  });
});

describe('restoreDbs — closeWritable best-effort', () => {
  test('a throwing closeWritable is swallowed; the copies still proceed', async () => {
    const warn = jest.fn();
    const summary = await restoreDbs(
      BACKUP_DIR,
      happyPorts({
        listBackup: async () => ['user.db'],
        closeWritable: async () => {
          throw new Error('handle stuck');
        },
      }),
      reasons,
      {warn},
    );
    expect(summary.restored).toEqual(['user.db']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('closeWritable'));
  });
});
