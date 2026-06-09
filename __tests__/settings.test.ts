// Settings-Panel persistence (F1, ADR-0009). Drives the real SQL through
// the host better-sqlite3 adapter (the same adapter bootstrap.test.ts
// uses) and pins the null-db graceful-degrade path for every helper.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  ensureSettingsTables,
  readDictPrefs,
  upsertDictPref,
  setDictPrefs,
  mergeDictPrefs,
  getAppSetting,
  setAppSetting,
  getKeepSources,
  setKeepSources,
  hasKeepSourcesSetting,
  KEEP_SOURCES_KEY,
  type DictPref,
  type DictSourceIdentity,
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

describe('settings — setDictPrefs (whole-set atomic write)', () => {
  test('persists every row; readback round-trips in sort order', async () => {
    const db = await freshDb();
    await setDictPrefs(db, [
      pref({prefKey: 'User', name: 'User', sortOrder: 0}),
      pref({prefKey: 'Dune', name: 'Dune', enabled: false, sortOrder: 1}),
      pref({prefKey: 'WordNet', name: 'WordNet', sortOrder: 2}),
    ]);
    const out = await readDictPrefs(db);
    expect(out.map(p => [p.name, p.enabled, p.sortOrder])).toEqual([
      ['User', true, 0],
      ['Dune', false, 1],
      ['WordNet', true, 2],
    ]);
  });

  test('re-writing the same keys replaces (no duplicate rows)', async () => {
    const db = await freshDb();
    await setDictPrefs(db, [pref({prefKey: 'A', name: 'A', sortOrder: 0})]);
    await setDictPrefs(db, [
      pref({prefKey: 'A', name: 'A', enabled: false, sortOrder: 1}),
    ]);
    const out = await readDictPrefs(db);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({enabled: false, sortOrder: 1});
  });

  test('null db warns and no-ops (no throw)', async () => {
    const warn = jest.fn();
    await expect(setDictPrefs(null, [pref()], {warn})).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[settings]'));
  });

  test('null db without a logger still no-ops', async () => {
    await expect(setDictPrefs(null, [pref()])).resolves.toBeUndefined();
  });
});

describe('settings — mergeDictPrefs (pure)', () => {
  const id = (
    name: string,
    over: Partial<DictSourceIdentity> = {},
  ): DictSourceIdentity => ({
    name,
    prefKey: name,
    removable: false,
    ...over,
  });

  test('no persisted rows -> all enabled in natural registry order', () => {
    const merged = mergeDictPrefs(
      [id('User'), id('Dune', {removable: true}), id('WordNet')],
      [],
    );
    expect(merged.map(p => [p.name, p.enabled, p.sortOrder])).toEqual([
      ['User', true, 0],
      ['Dune', true, 1],
      ['WordNet', true, 2],
    ]);
  });

  test('removable flag comes from the source identity (imported=true)', () => {
    const merged = mergeDictPrefs(
      [id('User'), id('Dune', {removable: true}), id('WordNet')],
      [],
    );
    expect(merged.find(p => p.name === 'Dune')?.removable).toBe(true);
    expect(merged.find(p => p.name === 'WordNet')?.removable).toBe(false);
    expect(merged.find(p => p.name === 'User')?.removable).toBe(false);
  });

  test('persisted enabled/sortOrder WIN over the natural position', () => {
    // WordNet moved to the top + Dune disabled.
    const merged = mergeDictPrefs(
      [id('User'), id('Dune', {removable: true}), id('WordNet')],
      [
        pref({prefKey: 'WordNet', name: 'WordNet', sortOrder: 0}),
        pref({prefKey: 'User', name: 'User', sortOrder: 1}),
        pref({prefKey: 'Dune', name: 'Dune', enabled: false, sortOrder: 2}),
      ],
    );
    expect(merged.map(p => p.name)).toEqual(['WordNet', 'User', 'Dune']);
    expect(merged.find(p => p.name === 'Dune')?.enabled).toBe(false);
  });

  test('an unknown source (no pref row) defaults enabled at its natural slot', () => {
    // Persisted: [WordNet(0), User(1)]; a freshly-imported Dune (natural
    // index 1, between them) has no row -> enabled, slots in by tie-break.
    const merged = mergeDictPrefs(
      [id('WordNet'), id('Dune', {removable: true}), id('User')],
      [
        pref({prefKey: 'WordNet', name: 'WordNet', sortOrder: 0}),
        pref({prefKey: 'User', name: 'User', sortOrder: 1}),
      ],
    );
    const dune = merged.find(p => p.name === 'Dune');
    expect(dune?.enabled).toBe(true);
    // sortOrder defaults to the natural registry index (1).
    expect(dune?.sortOrder).toBe(1);
  });

  test('a persisted row with no matching source is dropped (since-removed dict)', () => {
    const merged = mergeDictPrefs(
      [id('WordNet')],
      [
        pref({prefKey: 'WordNet', name: 'WordNet', sortOrder: 0}),
        pref({prefKey: 'Gone', name: 'Gone', sortOrder: 1}),
      ],
    );
    expect(merged.map(p => p.name)).toEqual(['WordNet']);
  });

  test('equal sortOrder ties break on natural registry index (deterministic)', () => {
    // Both persisted to sortOrder 0; natural order [A, B] must win the tie.
    const merged = mergeDictPrefs(
      [id('A'), id('B')],
      [
        pref({prefKey: 'A', name: 'A', sortOrder: 0}),
        pref({prefKey: 'B', name: 'B', sortOrder: 0}),
      ],
    );
    expect(merged.map(p => p.name)).toEqual(['A', 'B']);
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

describe('settings — keepSources (F4)', () => {
  test('default is KEEP (true) when no row is set', async () => {
    const db = await freshDb();
    expect(await getKeepSources(db)).toBe(true);
    expect(await hasKeepSourcesSetting(db)).toBe(false);
  });

  test('setKeepSources(false) persists 0 and round-trips to false', async () => {
    const db = await freshDb();
    await setKeepSources(db, false);
    expect(await getAppSetting(db, KEEP_SOURCES_KEY)).toBe('0');
    expect(await getKeepSources(db)).toBe(false);
    expect(await hasKeepSourcesSetting(db)).toBe(true);
  });

  test('setKeepSources(true) persists 1 and round-trips to true', async () => {
    const db = await freshDb();
    await setKeepSources(db, true);
    expect(await getAppSetting(db, KEEP_SOURCES_KEY)).toBe('1');
    expect(await getKeepSources(db)).toBe(true);
    expect(await hasKeepSourcesSetting(db)).toBe(true);
  });

  test('only an explicit 0 reads as delete; any other value is keep', async () => {
    const db = await freshDb();
    await setAppSetting(db, KEEP_SOURCES_KEY, 'true');
    expect(await getKeepSources(db)).toBe(true);
  });

  test('null db -> keep (the safe default; nothing is deleted)', async () => {
    expect(await getKeepSources(null)).toBe(true);
    expect(await hasKeepSourcesSetting(null)).toBe(false);
  });

  test('setKeepSources(null) warns and no-ops (no throw)', async () => {
    const warn = jest.fn();
    await expect(setKeepSources(null, false, {warn})).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[settings]'));
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
