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

// F5 — one DB in the export set: a human `label` (source name) + the
// on-disk `filename` it keeps in the target folder. The UI summary lists
// these; the orchestration (exportDbs.ts) carries the absolute path too.
export type DbFile = {label: string; filename: string};

// F5 — the outcome of an export run: which DB filenames copied, which
// failed (with a reason), and the resolved target directory. Partial
// failures are reported, never dropped (F5-FR5).
export type ExportSummary = {
  copied: string[];
  failed: {file: string; reason: string}[];
  targetDir: string;
};

// F7 — the outcome of deleteImportedDict. `ok` is false ONLY when the
// prefKey doesn't resolve to a removable imported dict (base/User — INV5,
// F7-FR6) with a `reason`; a partial/idempotent delete (some artifact
// already gone) still resolves ok:true (F7-FR5). `removed.*` reports which
// sub-steps actually changed disk/db state: slugDb (handle closed + file
// deleted), audit (imports row), pref (dict_prefs row), sources (the
// leftover on-disk source set — false when it couldn't be removed, so the
// caller warns the dict may reappear on reload, F7-AC3).
export type DeleteResult = {
  ok: boolean;
  removed: {slugDb: boolean; audit: boolean; pref: boolean; sources: boolean};
  reason?: string;
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

// Persist a WHOLE pref set atomically (F3): every row is DELETE+INSERTed
// inside ONE transaction, so a write that reorders/toggles the entire
// list can never leave dict_prefs in a partially-updated state. null db
// -> warn + no-op (degraded). Mirrors upsertDictPref's DELETE-then-INSERT
// per key, batched.
export const setDictPrefs = async (
  db: SqliteDb | null,
  prefs: DictPref[],
  logger?: Logger,
): Promise<void> => {
  if (db === null) {
    logger?.warn('[settings] user.db unavailable — dict prefs not persisted');
    return;
  }
  await db.transaction(async tx => {
    for (const pref of prefs) {
      await tx.run(DELETE_DICT_PREF, [pref.prefKey]);
      await tx.run(INSERT_DICT_PREF, [
        pref.prefKey,
        pref.name,
        pref.enabled ? 1 : 0,
        pref.sortOrder,
      ]);
    }
  });
};

// F7 — delete one source's dict_prefs row by prefKey. Idempotent (an
// absent key is a no-op, changes:0) so deleting a dict whose pref was
// never persisted still succeeds (F7-FR5). null db -> warn + no-op
// (degraded). Resolves the rows-changed count for the delete summary.
export const removeDictPref = async (
  db: SqliteDb | null,
  prefKey: string,
  logger?: Logger,
): Promise<{changes: number}> => {
  if (db === null) {
    logger?.warn('[settings] user.db unavailable — dict pref not removed');
    return {changes: 0};
  }
  return db.run(DELETE_DICT_PREF, [prefKey]);
};

// --- F3: merge persisted prefs with the live registry ---------------
//
// The identity of one opened source for the merge. `prefKey` is the
// dict_prefs primary key (bare name for base/User, identityKey(name,lang)
// for imports — derived by the caller, who knows base/user/imported);
// `removable` is popup chrome (true only for imported dicts — F7 owns
// the Remove action; F3 just surfaces the flag).
export type DictSourceIdentity = {
  name: string;
  prefKey: string;
  removable: boolean;
};

// PURE (F3-FR1). Produce one DictPref per source in the LIVE registry
// (`sources`, in natural [user?,…imported,base] order), merged with the
// persisted rows by prefKey: a persisted row's enabled/sortOrder WIN;
// a source with no persisted row defaults to enabled at its natural
// registry position. The result is sorted by sortOrder so the panel and
// the live-array recompute agree on precedence. Sources are the source
// of truth for existence — a persisted row with no matching source
// (a since-removed dict) is dropped, never surfaced.
//
// Tie-break: when two sources resolve to the same sortOrder (a persisted
// row colliding with a default-positioned new source) the natural
// registry index breaks the tie, so a freshly-imported dict slots in
// deterministically rather than reordering the persisted set.
export const mergeDictPrefs = (
  sources: DictSourceIdentity[],
  persisted: DictPref[],
): DictPref[] => {
  const byKey = new Map<string, DictPref>();
  for (const row of persisted) {
    byKey.set(row.prefKey, row);
  }
  return sources
    .map((source, index) => {
      const row = byKey.get(source.prefKey);
      return {
        pref: {
          prefKey: source.prefKey,
          name: source.name,
          enabled: row ? row.enabled : true,
          sortOrder: row ? row.sortOrder : index,
          removable: source.removable,
        },
        index,
      };
    })
    .sort((a, b) =>
      a.pref.sortOrder !== b.pref.sortOrder
        ? a.pref.sortOrder - b.pref.sortOrder
        : a.index - b.index,
    )
    .map(entry => entry.pref);
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

// --- F4: opt-in post-import source deletion -------------------------
//
// `app_settings('keepSourcesAfterImport')` is '1' (keep) / '0' (delete).
// The DEFAULT is KEEP (opt-IN to delete): an absent row, a degraded
// (null) user.db, or any value other than '0' reads as keep=true. The
// flag gates runImport's delete step (F4-FR2) and reconcile's keep rule
// (F4-FR3); a first-run bootstrap dialog seeds it (F4-FR5).
export const KEEP_SOURCES_KEY = 'keepSourcesAfterImport';

// True unless explicitly persisted as '0'. Total + null-db-safe (a
// degraded user.db keeps sources — the safe default; nothing is deleted).
export const getKeepSources = async (db: SqliteDb | null): Promise<boolean> =>
  (await getAppSetting(db, KEEP_SOURCES_KEY)) !== '0';

// Persist the keep/delete choice as '1'/'0' (round-trips through
// getKeepSources). null db -> warn + no-op (degraded).
export const setKeepSources = async (
  db: SqliteDb | null,
  keep: boolean,
  logger?: Logger,
): Promise<void> =>
  setAppSetting(db, KEEP_SOURCES_KEY, keep ? '1' : '0', logger);

// Whether the keep/delete flag has been chosen yet (drives the first-run
// prompt — F4-FR5). null db / absent row -> not set.
export const hasKeepSourcesSetting = async (
  db: SqliteDb | null,
): Promise<boolean> => (await getAppSetting(db, KEEP_SOURCES_KEY)) !== null;
