// Settings-Panel persistence (F1, ADR-0009). Drives the real SQL through
// the host better-sqlite3 adapter (the same adapter bootstrap.test.ts
// uses) and pins the null-db graceful-degrade path for every helper.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  ensureSettingsTables,
  readDictPrefs,
  upsertDictPref,
  getAppSetting,
  setAppSetting,
  type DictPref,
} from '../src/core/dict/sqlite/settings';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const pref = (over: Partial<DictPref> = {}): DictPref => ({
  prefKey: 'WordNet',
  name: 'WordNet',
  enabled: true,
  sortOrder: 0,
  removable: false,
  ...over,
});

const tableNames = async (db: SqliteDb): Promise<string[]> => {
  const rows = await db.query<{name: string}>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  return rows.map(r => r.name);
};

const freshDb = (): Promise<SqliteDb> =>
  createSeededDb(async db => {
    await ensureSettingsTables(db);
  });

describe('settings — ensureSettingsTables', () => {
  test('creates dict_prefs, app_settings, and user_meta', async () => {
    const db = await freshDb();
    const names = await tableNames(db);
    expect(names).toEqual(
      expect.arrayContaining(['dict_prefs', 'app_settings', 'user_meta']),
    );
  });

  test('is idempotent (re-running does not throw)', async () => {
    const db = await freshDb();
    await expect(ensureSettingsTables(db)).resolves.toBeUndefined();
  });
});

describe('settings — dict_prefs CRUD', () => {
  test('upsert then read round-trips a pref (enabled 1 -> true)', async () => {
    const db = await freshDb();
    await upsertDictPref(db, pref({prefKey: 'k1', name: 'WordNet', sortOrder: 0}));
    const prefs = await readDictPrefs(db);
    expect(prefs).toEqual([
      {
        prefKey: 'k1',
        name: 'WordNet',
        enabled: true,
        sortOrder: 0,
        removable: false,
      },
    ]);
  });

  test('maps enabled 0 -> false', async () => {
    const db = await freshDb();
    await upsertDictPref(db, pref({prefKey: 'k1', enabled: false}));
    const prefs = await readDictPrefs(db);
    expect(prefs[0].enabled).toBe(false);
  });

  test('replaces the row on a same-key upsert (no duplicate)', async () => {
    const db = await freshDb();
    await upsertDictPref(db, pref({prefKey: 'k1', name: 'Old', sortOrder: 5}));
    await upsertDictPref(
      db,
      pref({prefKey: 'k1', name: 'New', enabled: false, sortOrder: 2}),
    );
    const prefs = await readDictPrefs(db);
    expect(prefs).toHaveLength(1);
    expect(prefs[0]).toMatchObject({name: 'New', enabled: false, sortOrder: 2});
  });

  test('reads rows in sort_order', async () => {
    const db = await freshDb();
    await upsertDictPref(db, pref({prefKey: 'b', name: 'B', sortOrder: 2}));
    await upsertDictPref(db, pref({prefKey: 'a', name: 'A', sortOrder: 0}));
    await upsertDictPref(db, pref({prefKey: 'c', name: 'C', sortOrder: 1}));
    const names = (await readDictPrefs(db)).map(p => p.name);
    expect(names).toEqual(['A', 'C', 'B']);
  });
});

describe('settings — app_settings CRUD', () => {
  test('getAppSetting returns null for an absent key', async () => {
    const db = await freshDb();
    expect(await getAppSetting(db, 'missing')).toBeNull();
  });

  test('set then get round-trips a value', async () => {
    const db = await freshDb();
    await setAppSetting(db, 'keepSourcesAfterImport', 'true');
    expect(await getAppSetting(db, 'keepSourcesAfterImport')).toBe('true');
  });

  test('overwrites an existing value (no duplicate row)', async () => {
    const db = await freshDb();
    await setAppSetting(db, 'exportDir', '/a');
    await setAppSetting(db, 'exportDir', '/b');
    expect(await getAppSetting(db, 'exportDir')).toBe('/b');
    const rows = await db.query<{n: number}>(
      'SELECT COUNT(*) AS n FROM app_settings WHERE key = ?',
      ['exportDir'],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('settings — null-db graceful degrade', () => {
  test('readDictPrefs(null) -> []', async () => {
    expect(await readDictPrefs(null)).toEqual([]);
  });

  test('getAppSetting(null) -> null', async () => {
    expect(await getAppSetting(null, 'anything')).toBeNull();
  });

  test('upsertDictPref(null) warns and no-ops (no throw)', async () => {
    const warn = jest.fn();
    await expect(upsertDictPref(null, pref(), {warn})).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[settings]'));
  });

  test('upsertDictPref(null) without a logger still no-ops', async () => {
    await expect(upsertDictPref(null, pref())).resolves.toBeUndefined();
  });

  test('setAppSetting(null) warns and no-ops (no throw)', async () => {
    const warn = jest.fn();
    await expect(
      setAppSetting(null, 'k', 'v', {warn}),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[settings]'));
  });

  test('setAppSetting(null) without a logger still no-ops', async () => {
    await expect(setAppSetting(null, 'k', 'v')).resolves.toBeUndefined();
  });
});
