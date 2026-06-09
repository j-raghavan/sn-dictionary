// Settings-Panel persistence (F1, ADR-0009). Reads/writes the
// preference tables in the WRITABLE user.db — never base.db, never a
// native key-value store (AsyncStorage's binding is unbound off-device,
// the ADR-0001 failure; a MyStyle JSON file would be user-visible and
// race discovery). dict_prefs holds per-source enablement + ordering;
// app_settings is a generic string key/value store. user_meta is a
// forward-migration anchor created here (no read/write helper yet).
//
// Every helper is TOTAL and DEGRADES gracefully: a null user.db (the
// degraded-bootstrap case) yields defaults on reads ([] / null) and a
// logged no-op on writes — the caller keeps working against base.db
// without persistence, mirroring userEntries.ts / importAudit.ts. The
// upsert path reuses the DELETE+INSERT-in-a-transaction pattern so a
// re-write of the same key never leaves either zero or two rows.

import type {SqliteDb} from './db';
import {
  CREATE_APP_SETTINGS_TABLE,
  CREATE_DICT_PREFS_TABLE,
  CREATE_USER_META_TABLE,
  DELETE_APP_SETTING,
  DELETE_DICT_PREF,
  INSERT_APP_SETTING,
  INSERT_DICT_PREF,
  SELECT_APP_SETTING,
  SELECT_DICT_PREFS_ALL,
  type AppSettingRow,
  type DictPrefRow,
} from './schema';

type Logger = {warn: (msg: string) => void};

// A single dictionary source's enablement + ordering preference. prefKey
// is the source identity (see schema.ts). `removable` is popup chrome
// (whether the user may delete the source) — F1 never sets it true; F3/F4
// own removal, so reads always surface `false`.
export type DictPref = {
  prefKey: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  removable: boolean;
};

// Idempotent create of the three settings tables on the user.db handle
// (mirrors ensureImportsTable). Runs inside bootstrap's degradable
// user.db try, so a throw degrades userDb to null (F1-AC4).
export const ensureSettingsTables = async (db: SqliteDb): Promise<void> => {
  await db.run(CREATE_DICT_PREFS_TABLE);
  await db.run(CREATE_APP_SETTINGS_TABLE);
  await db.run(CREATE_USER_META_TABLE);
};

// All persisted dict preferences in sort order. null db -> [] (degraded:
// the caller falls back to its default source set).
export const readDictPrefs = async (
  db: SqliteDb | null,
): Promise<DictPref[]> => {
  if (db === null) {
    return [];
  }
  const rows = await db.query<DictPrefRow>(SELECT_DICT_PREFS_ALL);
  return rows.map(row => ({
    prefKey: row.pref_key,
    name: row.name,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    removable: false,
  }));
};

// Replace any existing row for pref.prefKey with the new one in a SINGLE
// transaction (mirror upsertImport). null db -> warn + no-op (degraded).
export const upsertDictPref = async (
  db: SqliteDb | null,
  pref: DictPref,
  logger?: Logger,
): Promise<void> => {
  if (db === null) {
    logger?.warn('[settings] user.db unavailable — dict pref not persisted');
    return;
  }
  await db.transaction(async tx => {
    await tx.run(DELETE_DICT_PREF, [pref.prefKey]);
    await tx.run(INSERT_DICT_PREF, [
      pref.prefKey,
      pref.name,
      pref.enabled ? 1 : 0,
      pref.sortOrder,
    ]);
  });
};

// A single app setting value, or null when absent. null db -> null.
export const getAppSetting = async (
  db: SqliteDb | null,
  key: string,
): Promise<string | null> => {
  if (db === null) {
    return null;
  }
  const rows = await db.query<AppSettingRow>(SELECT_APP_SETTING, [key]);
  return rows.length > 0 ? rows[0].value : null;
};

// Replace any existing value for `key` in a SINGLE transaction. null db ->
// warn + no-op (degraded).
export const setAppSetting = async (
  db: SqliteDb | null,
  key: string,
  value: string,
  logger?: Logger,
): Promise<void> => {
  if (db === null) {
    logger?.warn('[settings] user.db unavailable — app setting not persisted');
    return;
  }
  await db.transaction(async tx => {
    await tx.run(DELETE_APP_SETTING, [key]);
    await tx.run(INSERT_APP_SETTING, [key, value]);
  });
};
