// Runtime composition root (TF7-FR1/FR2/FR4). Wires the SQLite engine
// together off any concrete device: provision base.db, open user.db,
// reconcile + open already-imported dicts, build the multiDict registry
// in precedence order [user, ...imported, base] (IV-3), then dispatch
// pending sideload imports in the background, splicing each new source
// in just-before base as it lands.
//
// Everything environmental is behind BootstrapPorts so this is fully
// host-tested with fakes. The thin device shell (index.js) supplies the
// real RN/SDK-backed ports.

import type {DictLookup, DictSource} from '../../lookup';
import {createMultiDictLookup} from '../multiDictLookup';
import {createSqliteDictSource} from './sqliteDictSource';
import type {OpenSqliteDb, SqliteDb} from './db';
import {runAdditiveColumnMigration} from './db';
import type {ProvisionPorts} from './provision';
import {provisionBaseDb} from './provision';
import {
  CREATE_USER_ENTRIES_TABLE,
  CREATE_USER_ENTRIES_INDEX,
  ALTER_USER_ENTRIES_ADD_PHONETIC,
  isStaleImport,
  SELECT_IMPORT_ALL,
  type ImportRow,
} from './schema';
import {refreshTargetFilename, slugForName} from './importSidecar';
import {ensureImportsTable} from './importAudit';
import {
  ensureSettingsTables,
  getKeepSources,
  hasKeepSourcesSetting,
  mergeDictPrefs,
  readDictPrefs,
  removeDictPref,
  setDictPrefs,
  setKeepSources,
  type DeleteResult,
  type DictPref,
  type DictSourceIdentity,
} from './settings';
import {removeImport} from './importAudit';
import {runImport, type RunImportPorts} from './runImport';
import type {ImportJobDescriptor} from '../userDictDiscovery';
// C5 — the PURE reconcile layer now lives in reconcile.ts. Imported here for
// bootstrap's own use AND re-exported below so existing importers/tests that
// reference these off bootstrap.ts keep working unchanged (zero behaviour change).
import {
  deriveLiveSources,
  dictPrefKey,
  identityKey,
  reconcileImports,
  sourcePathsOf,
  type ReconcileItem,
  type ReconcileOpts,
} from './reconcile';

export {
  deriveLiveSources,
  dictPrefKey,
  identityKey,
  reconcileImports,
  sourcePathsOf,
};
export type {ReconcileItem, ReconcileOpts};

type Logger = {warn: (msg: string) => void; log?: (msg: string) => void};

// F7 — per imported (removable) source, the bookkeeping deleteImportedDict
// needs beyond the dict_prefs identity: the OPEN slug `SqliteDb` handle (so
// it can be close()d before the file is unlinked, F7-FR3 step 2) and the
// slug `filename` + audit `(name, lang)` (so it can unlink the slug file,
// match the leftover on-disk source set, and drop the audit row). Built in
// bootstrap for the 'open' bucket AND each detached import as it lands;
// base/User have no entry here (they are non-removable — INV5). `handle` is
// null when the slug DB opened absent/failed (nothing to close).
export type ImportedSourceRecord = {
  prefKey: string;
  name: string;
  lang: string;
  filename: string;
  handle: SqliteDb | null;
};

// --- bootstrap ------------------------------------------------------

export interface BootstrapDbPorts {
  openUserDb(): Promise<SqliteDb>;
  openImportedDb(filename: string): OpenSqliteDb;
  // F4-FR3: probe whether a recorded slug DB still exists on disk
  // (existence is enough for v1 — OQ6). Used to build the `slugHealthy`
  // Set passed to the PURE reconcileImports, keeping the I/O out of it.
  // Optional: a host that omits it makes every audited slug "unhealthy",
  // so a kept set falls back to today's RE-ADD (safe).
  slugDbExists?(filename: string): Promise<boolean>;
}

// F7 — the file-system seam deleteImportedDict drives. All best-effort:
// a throw / false is logged and reflected in DeleteResult.removed, never
// rethrown (the audit + pref rows are still cleaned so the dict can't
// re-open). `resolveSlugPath(filename)` -> the absolute slug-DB path;
// `deleteFile` unlinks a file; `deleteFolder` rmdirs a (now-empty) folder.
export interface DeletePorts {
  resolveSlugPath(filename: string): string;
  deleteFile(path: string): Promise<void>;
  deleteFolder(path: string): Promise<boolean>;
}

// C3 — best-effort unlink of ONE slug slot (resolve path + delete + swallow).
// ONE definition, two callers: deleteImportedDict awaits it for BOTH A/B slots
// (base + sibling), and the step-5 sweep fires it un-awaited. Returns true iff
// the file was actually deleted (deleteImportedDict uses that for removed.slugDb;
// the sweep ignores it).
const unlinkSlugSlot = async (
  del: DeletePorts,
  filename: string,
): Promise<boolean> => {
  try {
    await del.deleteFile(del.resolveSlugPath(filename));
    return true;
  } catch {
    return false;
  }
};

export interface BootstrapPorts {
  provision: ProvisionPorts;
  db: BootstrapDbPorts;
  discover(): Promise<ImportJobDescriptor[]>;
  // Build the format-agnostic import ports for a descriptor. The host
  // adapter (index.js) branches on descriptor.kind to wire the right
  // produceSlugDb (native StarDict vs JS CSV) + source/sidecar paths.
  // `keepSources` (F4) is resolved once at bootstrap and threaded in so
  // the delete step is gated; the host passes it onto RunImportPorts.
  importPortsFor(
    d: ImportJobDescriptor,
    audit: SqliteDb,
    keepSources: boolean,
  ): RunImportPorts;
  // F7 — file-deletion seam for deleteImportedDict (drop the slug DB file
  // + any leftover on-disk source set). Optional: a host that omits it can
  // still delete the audit + pref rows and splice the live source out, but
  // the slug file / source set are left on disk (removed.slugDb/sources
  // report false). `resolveSlugPath` maps an audit filename to the absolute
  // slug-DB path (same mapping the import path's resolveSlugDbPath uses).
  delete?: DeletePorts;
  enableButtons(): Promise<void>;
  // F4-FR5: the one-time first-run keep/delete dialog. Called at bootstrap
  // ONLY when the keepSourcesAfterImport flag is unset AND there is ≥1
  // import to dispatch — never mid-import on the detached path. Returns
  // true=keep, false=delete. Optional: absent / throwing -> default KEEP.
  promptKeepDelete?(): Promise<boolean>;
}

export interface RuntimeHandle {
  lookup: DictLookup;
  // The DERIVED enabled+ordered view handed to multiDictLookup. Mutated
  // IN PLACE (never reassigned) by detached imports + setDictPrefs, and
  // snapshotted per lookup — so a reorder/toggle takes effect on the next
  // lookup with no reload (F3).
  sources: DictSource[];
  // The COMPLETE opened registry (base + User + every imported source),
  // UNFILTERED (F3 blocker 3). `sources` is derived from this by applying
  // dict_prefs; a disabled dict stays here so it can be re-enabled with no
  // DB reopen / re-bootstrap.
  allSources: DictSource[];
  baseDb: SqliteDb;
  userDb: SqliteDb | null;
  // Resolves when the DETACHED sideload imports finish (the un-awaited
  // Promise.all of step 7). bootstrap returns before this settles —
  // the lookup is usable for base/user/already-imported immediately;
  // imported dicts splice into `sources` as each resolves. Tests and
  // diagnostics await this to observe the final source set.
  importsSettled: Promise<void>;
  // LIVE source-name -> language map for the thesaurus query (which is
  // language-scoped). Seeded with the base ('en'), User ('und'), and
  // every already-imported source (audit lang); a detached import adds
  // its entry on splice. The runtime (index.js) holds this SAME object
  // reference, so a dict imported THIS session resolves its language
  // with NO reload (the bug: index.js's old one-off snapshot missed
  // detached imports -> they fell back to 'und' until reload).
  sourceLang: Record<string, string>;
  // F3 — the dictionary-manager seam (wired to the popup via index.js's
  // PopupActions). `listDictPrefs` merges `allSources` with the persisted
  // dict_prefs into one ordered row per source (incl. disabled ones, since
  // they live in `allSources`). `setDictPrefs` persists the whole set
  // atomically AND recomputes the live `sources` in place from
  // `allSources` — so a toggle/reorder takes effect on the next lookup
  // with no reload. Both degrade with a null user.db (read -> natural
  // defaults; write -> no persist, but the live array still recomputes).
  listDictPrefs(): Promise<DictPref[]>;
  setDictPrefs(prefs: DictPref[]): Promise<void>;
  // F7 — fully delete ONE imported dict by its dict_prefs key: splice it
  // out of the LIVE `allSources`/`sources` (+ `sourceLang` + the imported
  // registry) BEFORE closing its slug handle (so no in-flight lookup races
  // a closing handle — F7-AC6), close() + deleteFile the slug DB, remove
  // any leftover on-disk source set (so discovery can't re-import it next
  // reload — F7-FR4), then drop the audit + dict_prefs rows. Rejects
  // (ok:false) a key resolving to base/User (INV5, F7-FR6); idempotent /
  // partial-safe (a missing artifact is a no-op success — F7-FR5).
  deleteImportedDict(prefKey: string): Promise<DeleteResult>;
  // F8 — close the WRITABLE live DB handles so a restore can overwrite their
  // on-disk files: user.db (saved words + settings + the imports audit) AND
  // every eager-opened imported slug handle (the F7 imported registry retains
  // them). base.db is read-only and NEVER restored, so it stays open. Each
  // handle is closed best-effort (a throw on one doesn't block the rest);
  // after this the live lookup references closed handles — that is fine, the
  // restore prompts the user to reopen the plugin, which re-bootstraps over
  // the restored DBs on the next note-open.
  closeWritable(): Promise<void>;
}

const readAuditRows = async (userDb: SqliteDb): Promise<ImportRow[]> =>
  userDb.query<ImportRow>(SELECT_IMPORT_ALL);

// F4-FR3: build the `slugHealthy` Set (audit filenames whose slug DB
// exists) that the PURE reconcileImports consumes — the ONLY I/O probe in
// the keep-vs-reimport decision, kept here in bootstrap. Existence is
// enough for v1 (OQ6). A probe that throws / is absent treats that slug as
// unhealthy (-> fall back to RE-ADD, the safe legacy path).
const probeSlugHealth = async (
  db: BootstrapDbPorts,
  auditRows: ImportRow[],
): Promise<Set<string>> => {
  const healthy = new Set<string>();
  if (db.slugDbExists === undefined) {
    return healthy;
  }
  for (const row of auditRows) {
    try {
      if (await db.slugDbExists(row.filename)) {
        healthy.add(row.filename);
      }
    } catch {
      // Treat a probe failure as unhealthy — RE-ADD is the safe fallback.
    }
  }
  return healthy;
};

export const bootstrap = async (
  ports: BootstrapPorts,
  logger?: Logger,
): Promise<RuntimeHandle> => {
  // NEW-3 (Remove-vs-refresh race): identity keys the user Removed THIS session.
  // deleteImportedDict adds a key as its FIRST action (before any splice); each
  // dispatched import's isCancelled port reads this set immediately before its
  // audit upsert, so a Remove concurrent with a refresh cancels the upsert and
  // the removed dict never resurrects.
  const removedKeys = new Set<string>();

  // 1. Provision base.db. A provision failure REJECTS bootstrap and the
  //    buttons are NEVER enabled (Designer ruling 4 / flag 4). base.db is
  //    bundled in the .snplg + host-extracted; provision opens + verifies
  //    it (no copy).
  const {db: baseDb} = await provisionBaseDb(ports.provision, logger);
  const baseSource = createSqliteDictSource({
    name: 'WordNet',
    openDb: async () => baseDb,
    format: 'wordnet',
  });

  // 2. Buttons on — base works. Fire-once, BEFORE imports, after a
  //    successful base provision only.
  try {
    await ports.enableButtons();
  } catch (e) {
    logger?.warn(
      `[bootstrap] enableButtons threw: ${(e as Error).message} — buttons may stay disabled`,
    );
  }

  // 3. user.db — failure DEGRADES (buttons already on, base works); we
  //    continue without a user source / imports.
  let userDb: SqliteDb | null = null;
  try {
    userDb = await ports.db.openUserDb();
    // Additive migration: user.db carries the entries table (for
    // user-added words, TF7) + the imports audit table. user.db uses
    // the 7-col superset 'entries' (lang + created_at + phonetic);
    // base.db/imports use the v3 5-col CREATE_ENTRIES_TABLE (+ nullable
    // phonetic; their INSERTs stay 4-value, so phonetic defaults NULL).
    await userDb.run(CREATE_USER_ENTRIES_TABLE);
    await userDb.run(CREATE_USER_ENTRIES_INDEX);
    // v3 additive migration (M17-FR2): CREATE ... IF NOT EXISTS does NOT
    // alter an EXISTING (pre-v3) user.db, so an old 6-col table would still
    // lack `phonetic` and the v3 SELECT would throw "no such column" on
    // every lookup. runAdditiveColumnMigration ALTERs it in, swallowing the
    // idempotent "duplicate column name" on a fresh 7-col table and rethrowing
    // any real failure (shared with ensureImportsTable's own migration).
    await runAdditiveColumnMigration(userDb, ALTER_USER_ENTRIES_ADD_PHONETIC);
    await ensureImportsTable(userDb);
    // Settings-Panel preference tables (F1, ADR-0009). Additive +
    // idempotent like the imports table; a throw here degrades user.db
    // to null below (F1-AC4) — base.db still works.
    await ensureSettingsTables(userDb);
  } catch (e) {
    logger?.warn(
      `[bootstrap] user.db unavailable (${(e as Error).message}) — degrading: imports + user words disabled, base works`,
    );
    userDb = null;
  }

  const userSource =
    userDb !== null
      ? createSqliteDictSource({name: 'User', openDb: async () => userDb as SqliteDb})
      : null;

  // 4. Reconcile descriptors against audit rows (only if user.db is up).
  //    F4: resolve keepSources + probe slug-DB health FIRST so the PURE
  //    reconcileImports decides with no I/O (review fix 6). The first-run
  //    keep/delete prompt (F4-FR5) runs here — once, before any import
  //    dispatch, only when the flag is unset AND there is ≥1 import to
  //    dispatch — and persists the choice; thereafter the toggle owns it.
  let reconciled: ReconcileItem[] = [];
  let keepSources = true;
  if (userDb !== null) {
    let descriptors: ImportJobDescriptor[] = [];
    try {
      descriptors = await ports.discover();
    } catch (e) {
      logger?.warn(`[bootstrap] discover threw: ${(e as Error).message} — no imports`);
    }
    const auditRows = await readAuditRows(userDb);

    // F4-FR5: first-run prompt. Only when the flag is unset AND a
    // descriptor would actually import (there's a pending re-/import). With
    // keep=true a kept+healthy set reconciles to 'open', so we probe health
    // FIRST and ask only if at least one descriptor still wants importing
    // under keep=true. Default KEEP if the port is absent / throws.
    keepSources = await getKeepSources(userDb);
    const slugHealthy = await probeSlugHealth(ports.db, auditRows);
    const flagSet = await hasKeepSourcesSetting(userDb);
    if (!flagSet && ports.promptKeepDelete !== undefined) {
      // Would any descriptor import under the current (default keep) rule?
      // EXCLUDE refresh-in-place rebuilds: a pure version-bump upgrade of an
      // already-imported dict must not trigger the keep/delete prompt (the
      // sources are staying either way). A genuinely NEW / re-dropped /
      // unhealthy import still counts.
      const wouldImport = reconcileImports(descriptors, auditRows, {
        keepSources,
        slugHealthy,
      }).some(i => i.bucket === 'import' && i.refreshInPlace !== true);
      if (wouldImport) {
        try {
          keepSources = await ports.promptKeepDelete();
        } catch (e) {
          logger?.warn(
            `[bootstrap] keep/delete prompt threw: ${(e as Error).message} — defaulting to keep`,
          );
          keepSources = true;
        }
        await setKeepSources(userDb, keepSources, logger);
      }
    }

    reconciled = reconcileImports(descriptors, auditRows, {
      keepSources,
      slugHealthy,
    });
    for (const item of reconciled) {
      if (item.bucket === 'skip') {
        logger?.warn(`[bootstrap] skip import: ${item.reason}`);
      }
    }
  }

  // 5. Open already-imported sources ('open' bucket). EAGER-open the slug
  //    DB handle here (rather than lazily on first lookup) so F7's
  //    deleteImportedDict can close() it before unlinking the file (a lazy,
  //    never-opened source has no handle to close, but a since-opened one
  //    would lock the file). The opened handle is passed to the source AND
  //    retained in the F7 imported registry. An open that resolves null
  //    (absent) / throws keeps the source lazy (handle null) — there is
  //    then nothing to close and the file is already gone/unreadable.
  const alreadyImported: {
    source: DictSource;
    lang: string;
    filename: string;
    handle: SqliteDb | null;
  }[] = [];
  // Identities that have a refresh-in-place rebuild dispatched this boot (step
  // 7). A stale 'open' row for one of these is AUTO-healing, so it must NOT
  // draw the "re-drop / Remove + re-add" warning — only a stale AUDIT-ONLY row
  // (no descriptor, nothing rebuilding it) does.
  const refreshingKeys = new Set(
    reconciled
      .filter(
        (i): i is Extract<ReconcileItem, {bucket: 'import'}> =>
          i.bucket === 'import' && i.refreshInPlace === true,
      )
      .map(i => identityKey(i.descriptor.sidecar.name, i.descriptor.sidecar.language)),
  );
  for (const item of reconciled) {
    if (item.bucket === 'open') {
      // A stale AUDIT-ONLY row (sources gone, nothing rebuilding it) is served
      // as-is — its content is behind the current pipeline (e.g. raw HTML
      // tags). Warn so the user knows to re-drop the sources or Remove +
      // re-add the dict to refresh it. (A stale row that IS being refreshed
      // this boot heals on its own next launch, so it stays silent.)
      if (
        isStaleImport(item.row) &&
        !refreshingKeys.has(identityKey(item.row.name, item.row.lang))
      ) {
        logger?.warn(
          `[bootstrap] serving old DB for "${item.row.name}" (${item.row.lang}): built by an older importer — re-drop its sources or Remove + re-add to refresh`,
        );
      }
      let handle: SqliteDb | null = null;
      try {
        handle = await ports.db.openImportedDb(item.row.filename)();
      } catch (e) {
        logger?.warn(
          `[bootstrap] open imported "${item.row.name}" (${item.row.filename}) threw: ${(e as Error).message} — source stays lazy`,
        );
      }
      // A/B slot sweep (C2): the audit points at this filename, so its sibling
      // slot is dead by definition — FIRE-AND-FORGET unlink it (an old
      // generation or a prior refresh left it behind). SKIPPED for an identity
      // being refreshed this boot: the ONLY other writer of that sibling is that
      // refresh's build for the SAME identity, which owns the slot via the spine
      // pre-clean — so excluding refreshing keys makes the un-awaited unlink
      // race-free. With no delete port, at most one dead sibling per dict
      // lingers until the next refresh overwrites it — acceptable.
      //
      // PLAUSIBLE-5 (reload mid-refresh cannot serve a corrupt DB): (1) serving
      // follows the audit filename, which repoints only AFTER a fresh verify of
      // the build target; (2) this unlink/start-clean isolates any orphaned old
      // writer onto an unlinked inode — invisible at the path, and its JS
      // continuation died with the old context so it can never upsert; (3) worst
      // case is a half-built target that fails the next verify or is
      // start-cleaned before the next build, i.e. a retry next boot.
      if (
        handle !== null &&
        ports.delete !== undefined &&
        !refreshingKeys.has(identityKey(item.row.name, item.row.lang))
      ) {
        // Fire-and-forget: unlinkSlugSlot never rejects (swallows internally),
        // so the un-awaited promise is safe to drop.
        unlinkSlugSlot(ports.delete, refreshTargetFilename(item.row.filename));
      }
      const openDb =
        handle !== null
          ? async () => handle
          : ports.db.openImportedDb(item.row.filename);
      alreadyImported.push({
        source: createSqliteDictSource({name: item.row.name, openDb}),
        lang: item.row.lang,
        filename: item.row.filename,
        handle,
      });
    }
  }

  // 6. FULL registry `allSources` in natural precedence order
  //    [user?, ...imported, base] (IV-3) — the COMPLETE opened set, never
  //    filtered (F3 blocker 3). The live `sources` array (what the lookup
  //    snapshots) is DERIVED from it by applying dict_prefs below; a
  //    disabled dict stays in `allSources` so re-enabling needs no reopen.
  //    `identities` maps each source to its dict_prefs key (bare name for
  //    base/User, identityKey(name,lang) for imports — resolution #6) and
  //    its removable flag (imported only — F7 chrome).
  const allSources: DictSource[] = [];
  const identities = new Map<DictSource, DictSourceIdentity>();
  // F7 — removable imported sources only: their open slug handle + filename
  // + audit identity, so deleteImportedDict can resolve a prefKey to the
  // live source object (and close/unlink its slug). base/User are never
  // added (non-removable — INV5).
  const imported = new Map<DictSource, ImportedSourceRecord>();
  const register = (
    source: DictSource,
    lang: string,
    removable: boolean,
  ): void => {
    allSources.push(source);
    identities.set(source, {
      name: source.name,
      prefKey: dictPrefKey(source.name, lang, removable),
      removable,
    });
  };
  if (userSource !== null) {
    register(userSource, 'und', false);
  }
  for (const {source, lang, filename, handle} of alreadyImported) {
    register(source, lang, true);
    imported.set(source, {
      prefKey: dictPrefKey(source.name, lang, true),
      name: source.name,
      lang,
      filename,
      handle,
    });
  }
  register(baseSource, 'en', false);

  // Read persisted prefs (degraded user.db -> []) and DERIVE the live
  // `sources` from `allSources` before the lookup is built (F3-FR4):
  // keep enabled, order by sort_order. `sources` is the SAME array
  // reference the lookup closes over and detached imports / setDictPrefs
  // recompute in place.
  let persistedPrefs: DictPref[] = await readDictPrefs(userDb);
  const sources: DictSource[] = [];
  deriveLiveSources(sources, allSources, identities, persistedPrefs);
  const lookup = createMultiDictLookup(sources, logger);

  // LIVE source -> language map (see RuntimeHandle.sourceLang). Seed the
  // base (WordNet = 'en'), the user source ('und' — user entries are
  // language-undetermined), and every already-imported source (its audit
  // row's lang). Detached imports (step 7) add their entry on splice.
  const sourceLang: Record<string, string> = {[baseSource.name]: 'en'};
  if (userSource !== null) {
    sourceLang[userSource.name] = 'und';
  }
  for (const {source, lang} of alreadyImported) {
    sourceLang[source.name] = lang;
  }

  // 7. Dispatch pending sideload imports — DETACHED (fire-and-forget).
  //    bootstrap returns NOW with a usable lookup over the READY sources
  //    (base + user + already-imported), so index.js sets runtime.lookup
  //    immediately and the just-enabled buttons never tap a null lookup.
  //    Each import splices its source into the LIVE sources array as it
  //    completes (the splice is the point — multiDictLookup snapshots
  //    per lookup, so a mid-flight splice is safe, IV-3). Concurrency is
  //    safe ONLY because reconcile deduped (name, lang) -> distinct slug
  //    files (Designer flag 2). `importsSettled` exposes the (un-awaited)
  //    completion for tests/diagnostics.
  let importsSettled: Promise<void> = Promise.resolve();
  if (userDb !== null) {
    const toImport = reconciled.filter(
      (i): i is Extract<ReconcileItem, {bucket: 'import'}> =>
        i.bucket === 'import',
    );
    const audit = userDb;
    // R3-0: the per-item dispatch body, extracted so same-stem imports can be
    // serialized (below) instead of racing resolveSlugCollision.
    const dispatchOne = async (
      item: Extract<ReconcileItem, {bucket: 'import'}>,
    ): Promise<void> => {
      try {
        // Format-agnostic: importPortsFor wires the kind-appropriate
        // produceSlugDb; runImport drives the shared spine for both.
        // keepSources (F4) gates the delete step inside runImport — BUT a
        // refresh-in-place rebuild ALWAYS keeps its sources: deleting the
        // sources of a version-bump refresh would permanently foreclose all
        // future healing (belt-and-braces beside the wouldImport exclusion).
        const keep = item.refreshInPlace === true ? true : keepSources;
        const runPorts = ports.importPortsFor(item.descriptor, audit, keep);
        // A re-import with a prior audit row builds into the A/B sibling slot
        // (never the still-serving audited file); a fresh import leaves this
        // unset and resolves its own collision-free name.
        if (item.prior !== undefined) {
          runPorts.targetFilename = refreshTargetFilename(item.prior.filename);
        }
        // NEW-3: cancel the audit upsert if the user Removes this dict while
        // the import is in flight — so a Remove during a refresh doesn't get
        // resurrected by a late upsert.
        runPorts.isCancelled = () =>
          removedKeys.has(
            identityKey(item.descriptor.sidecar.name, item.descriptor.sidecar.language),
          );
        const result = await runImport(runPorts, logger);
        if (result.ok) {
          const lang = item.descriptor.sidecar.language;
          if (item.refreshInPlace === true) {
            // The dict is ALREADY registered (paired 'open' at boot) and
            // served from the OLD slug all session. runImport has repointed +
            // restamped the audit row to the sibling; the NEW content serves
            // from the NEXT bootstrap (bounded 2-boot convergence). Do NOT
            // splice a second source — that would double-register the dict
            // and double the lookup fan-out. Just repoint the live F7 record
            // to the sibling so a same-session Remove unlinks the file the
            // audit now names.
            const prefKey = dictPrefKey(result.name, lang, true);
            for (const record of imported.values()) {
              if (record.prefKey === prefKey) {
                record.filename = result.filename;
                break;
              }
            }
            logger?.log?.(
              `[bootstrap] refreshed "${result.name}" (${lang}) into ${result.filename} — new content serves next launch`,
            );
          } else {
            // EAGER-open the slug handle (as the 'open' bucket does) so F7
            // can close() it before unlinking; an absent/failed open keeps
            // the source lazy (handle null — nothing to close).
            let handle: SqliteDb | null = null;
            try {
              handle = await ports.db.openImportedDb(result.filename)();
            } catch (e) {
              logger?.warn(
                `[bootstrap] open imported "${result.name}" (${result.filename}) threw: ${(e as Error).message} — source stays lazy`,
              );
            }
            const openDb =
              handle !== null
                ? async () => handle
                : ports.db.openImportedDb(result.filename);
            const src = createSqliteDictSource({name: result.name, openDb});
            // Push the new source into the FULL registry just-before base
            // (base is always last, so splice at length-1 keeps
            // [user, ...imported, base] even as concurrent results land),
            // then register its identity (imported -> removable).
            allSources.splice(allSources.length - 1, 0, src);
            const prefKey = dictPrefKey(src.name, lang, true);
            identities.set(src, {
              name: src.name,
              prefKey,
              removable: true,
            });
            // F7: retain the open handle + slug filename so a delete this
            // session can close + unlink it.
            imported.set(src, {
              prefKey,
              name: src.name,
              lang,
              filename: result.filename,
              handle,
            });
            // Recompute the LIVE `sources` in place honoring prefs: a new
            // (unknown-key) source defaults enabled + default-ordered just-
            // before base (its natural allSources position). multiDictLookup
            // snapshots per lookup, so an in-flight lookup is unaffected.
            deriveLiveSources(sources, allSources, identities, persistedPrefs);
            // Register the new source's language LIVE so its thesaurus
            // resolves this session (no reload). Same object index.js reads.
            sourceLang[result.name] = lang;
          }
        } else {
          logger?.warn(
            `[bootstrap] import "${item.descriptor.sidecar.name}" failed: ${result.reason}`,
          );
        }
      } catch (e) {
        logger?.warn(
          `[bootstrap] import "${item.descriptor.sidecar.name}" threw: ${(e as Error).message}`,
        );
      }
    };

    // R3-0: group items whose descriptors would resolve to the SAME prospective
    // slug stem AND lang, and run each group SEQUENTIALLY. The stem key mirrors
    // slugDbFilename's empty-slug fallback (`dict-<lang>`) so two all-symbol
    // names ("Foo!"/"Foo?" -> "foo", or two unslugables) also serialize. Without
    // this, two concurrent FRESH same-stem imports both resolveSlugCollision to
    // the base filename before either writes its audit row -> collision. Distinct
    // stems still run fully concurrently. Items carrying `prior` group by stem
    // too (harmless extra serialization — their build target is already the
    // sibling, but grouping is keyed only on the prospective stem).
    const groups = new Map<
      string,
      Array<Extract<ReconcileItem, {bucket: 'import'}>>
    >();
    for (const item of toImport) {
      const {name, language: lang} = item.descriptor.sidecar;
      const groupKey = `${slugForName(name) || `dict-${lang}`}|${lang}`;
      const existing = groups.get(groupKey);
      if (existing === undefined) {
        groups.set(groupKey, [item]);
      } else {
        existing.push(item);
      }
    }
    importsSettled = Promise.all(
      [...groups.values()].map(async group => {
        for (const item of group) {
          await dispatchOne(item);
        }
      }),
    ).then(() => undefined);
  }

  // F3 dictionary-manager seam. Closes over the live `allSources` +
  // `identities` + `sources`, so `listDictPrefs` reflects detached imports
  // that landed since bootstrap, and `setDictPrefs` recomputes the SAME
  // live `sources` array reference the lookup snapshots.
  const listDictPrefs = async (): Promise<DictPref[]> => {
    const persisted = await readDictPrefs(userDb);
    const identityList = allSources.map(
      source =>
        identities.get(source) ?? {
          name: source.name,
          prefKey: source.name,
          removable: false,
        },
    );
    return mergeDictPrefs(identityList, persisted);
  };
  const applyDictPrefs = async (prefs: DictPref[]): Promise<void> => {
    await setDictPrefs(userDb, prefs, logger);
    // Keep the bootstrap-captured snapshot in sync so a LATER detached
    // import recomputes against the user's current ordering, not the
    // stale start-of-session set.
    persistedPrefs = prefs;
    deriveLiveSources(sources, allSources, identities, persistedPrefs);
  };

  // F7 — delete ONE imported dict by its dict_prefs key. The order is the
  // whole correctness story (F7-FR3 / EC9):
  //   (1) splice the source out of the LIVE allSources + sources + sourceLang
  //       + the imported registry FIRST — a multiDictLookup snapshotted at
  //       lookup start (sources.slice()) before this point still resolves
  //       against the open handle; one snapshotted AFTER never sees it. So
  //       the splice MUST precede close() (F7-AC6).
  //   (2) close() the open slug handle (so the file isn't locked).
  //   (3) deleteFile the slug DB.
  //   (4) remove the leftover on-disk source set (else discovery RE-IMPORTS
  //       it next reload with keep=true — F7-FR4 / EC8).
  //   (5) drop the imports audit row; (6) drop the dict_prefs row.
  // Each FS step is best-effort; removed.* reflects what actually happened.
  // Rejects (ok:false) base/User (INV5, F7-FR6). Idempotent: a missing
  // source / slug / audit row still cleans the rest (ok:true — F7-FR5).
  const deleteImportedDict = async (
    prefKey: string,
  ): Promise<DeleteResult> => {
    // NEW-3: FIRST action — flag this identity as removed so any in-flight
    // refresh import for it cancels its audit upsert (isCancelled) rather than
    // resurrecting the row we are about to drop. Set before the splice and
    // before the base/User reject (harmless for a non-importing key).
    removedKeys.add(prefKey);
    const removed = {slugDb: false, audit: false, pref: false, sources: false};
    // F7-AC3: set true ONLY when a source descriptor matched on disk but a file
    // couldn't be deleted (resurrection risk → warn). Stays false when there
    // was nothing on disk to delete (keep=false / already gone) — benign.
    let sourcesAtRisk = false;

    // Resolve the prefKey to a LIVE source (if still present) + its imported
    // record. A key that matches a registered source whose identity is NOT
    // removable is base/User -> reject (never droppable).
    let targetSource: DictSource | null = null;
    let record: ImportedSourceRecord | null = null;
    for (const source of allSources) {
      const identity = identities.get(source);
      if (identity !== undefined && identity.prefKey === prefKey) {
        if (!identity.removable) {
          return {
            ok: false,
            removed,
            sourcesAtRisk,
            reason: `"${source.name}" is the base or user dictionary and cannot be removed`,
          };
        }
        targetSource = source;
        record = imported.get(source) ?? null;
        break;
      }
    }

    // Resolve the audit identity (name, lang, filename). From the live
    // record when present; else from the audit rows by prefKey (a
    // half-deleted dict whose source is already gone — F7-FR5). identityKey
    // round-trips: prefKey === identityKey(name, lang) for an import.
    let name: string | null = record?.name ?? null;
    let lang: string | null = record?.lang ?? null;
    let filename: string | null = record?.filename ?? null;
    if (name === null && userDb !== null) {
      const rows = await readAuditRows(userDb);
      const hit = rows.find(
        row => identityKey(row.name, row.lang) === prefKey,
      );
      if (hit !== undefined) {
        name = hit.name;
        lang = hit.lang;
        filename = hit.filename;
      }
    }

    // No live source AND no audit row AND no dict_prefs row would resolve a
    // target — nothing to delete. Still attempt the pref delete by raw key
    // (a stranded pref with no source/audit), then return idempotent success.
    if (name === null) {
      const prefDel = await removeDictPref(userDb, prefKey, logger);
      removed.pref = prefDel.changes > 0;
      return {ok: true, removed, sourcesAtRisk};
    }

    // (1) SPLICE OUT of the live runtime BEFORE any close/delete (EC9).
    if (targetSource !== null) {
      const idx = allSources.indexOf(targetSource);
      if (idx >= 0) {
        allSources.splice(idx, 1);
      }
      identities.delete(targetSource);
      imported.delete(targetSource);
      // sourceLang is keyed by display NAME (M1): only drop the entry when
      // NO surviving source in the post-splice `allSources` still carries
      // that name, so deleting one dict never strips the language resolution
      // of a same-named sibling. Pre-existing limitation, NOT fixed here:
      // two LIVE dicts that share a display name in different languages
      // collapse to ONE sourceLang entry (last-writer-wins) — a real fix
      // would re-key sourceLang by source identity and touch the
      // popup->thesaurus contract, so it is tracked, not done in this pass.
      const removedName = targetSource.name;
      if (!allSources.some(s => s.name === removedName)) {
        delete sourceLang[removedName];
      }
      // Recompute the live `sources` in place (the lookup's next snapshot
      // excludes the removed source; an in-flight snapshot is unaffected).
      deriveLiveSources(sources, allSources, identities, persistedPrefs);
    }

    // (2) close() the open slug handle (best-effort), then (3) unlink the
    //     slug file. A null handle (never eager-opened / opened absent) just
    //     skips the close. deleteFile is gated on the delete port.
    if (record?.handle != null) {
      try {
        await record.handle.close();
      } catch (e) {
        logger?.warn(
          `[bootstrap] close slug "${filename}" threw: ${(e as Error).message} — proceeding to delete`,
        );
      }
    }
    if (ports.delete !== undefined && filename !== null) {
      // (3) Unlink BOTH A/B slots (C3, awaited): the audited file AND its
      //     sibling — a refresh this session may have left the old slot on disk
      //     (audit points at the new one), so neither must survive a Remove.
      //     removed.slugDb reflects the AUDITED slot's unlink.
      removed.slugDb = await unlinkSlugSlot(ports.delete, filename);
      if (!removed.slugDb) {
        logger?.warn(
          `[bootstrap] delete slug file "${filename}" failed — left on disk`,
        );
      }
      await unlinkSlugSlot(ports.delete, refreshTargetFilename(filename));
    }

    // (4) Remove the leftover on-disk source set so discovery can't
    //     re-import the dict next reload (F7-FR4 / EC8). The imports table
    //     holds no source paths, so re-run discovery and match the
    //     descriptor whose sidecar (name, lang) equals the audit identity,
    //     then delete its paths exactly as runImport would. With NO delete
    //     port, or no matching descriptor on disk (sources already gone /
    //     kept=false), there is nothing to remove -> removed.sources stays
    //     false but that is not a failure (no descriptor == no resurrection).
    if (ports.delete !== undefined) {
      let descriptors: ImportJobDescriptor[] = [];
      try {
        descriptors = await ports.discover();
      } catch (e) {
        logger?.warn(
          `[bootstrap] re-discover for source-set delete threw: ${(e as Error).message}`,
        );
      }
      const match = descriptors.find(
        d => d.sidecar.name === name && d.sidecar.language === lang,
      );
      if (match !== undefined) {
        const {files, folder} = sourcePathsOf(match);
        let allOk = true;
        for (const path of files) {
          try {
            await ports.delete.deleteFile(path);
          } catch (e) {
            allOk = false;
            logger?.warn(
              `[bootstrap] delete source file "${path}" threw: ${(e as Error).message} — left on disk (dict may reappear on reload)`,
            );
          }
        }
        if (folder !== undefined) {
          try {
            await ports.delete.deleteFolder(folder);
          } catch (e) {
            // A non-empty / failed rmdir is tolerated (matches runImport):
            // an empty leftover folder doesn't resurrect the dict.
            logger?.warn(
              `[bootstrap] rmdir source folder "${folder}" threw: ${(e as Error).message} — left in place`,
            );
          }
        }
        // sources removed only if every data/sidecar file went (a leftover
        // data file would let discovery re-import — F7-AC3 warns the user).
        // A descriptor WAS found, so a partial failure here is a real
        // resurrection risk (unlike the no-descriptor branch below).
        removed.sources = allOk;
        sourcesAtRisk = !allOk;
      }
    }

    // (5) Drop the audit row; (6) drop the dict_prefs row. Both idempotent.
    if (userDb !== null) {
      try {
        const auditDel = await removeImport(userDb, name, lang as string);
        removed.audit = auditDel.changes > 0;
      } catch (e) {
        logger?.warn(
          `[bootstrap] delete audit row for "${name}" threw: ${(e as Error).message}`,
        );
      }
    }
    const prefDel = await removeDictPref(userDb, prefKey, logger);
    removed.pref = prefDel.changes > 0;

    return {ok: true, removed, sourcesAtRisk};
  };

  // F8 — close the WRITABLE handles (user.db + every eager-opened imported
  // slug) so a restore can overwrite their files; base.db (read-only, never
  // restored) is left open. Best-effort PER HANDLE: a throw on one is logged
  // and the rest still close (a half-closed set is fine — the user reopens
  // the plugin and bootstrap reopens everything over the restored DBs). The
  // imported handles come from the F7 `imported` registry, which retains the
  // eager-opened slug handle (null when a slug opened absent/failed — nothing
  // to close). Idempotent enough for one restore: closing an already-closed
  // handle just throws and is swallowed.
  const closeWritable = async (): Promise<void> => {
    if (userDb !== null) {
      try {
        await userDb.close();
      } catch (e) {
        logger?.warn(
          `[restore] close user.db threw: ${(e as Error).message} — continuing`,
        );
      }
    }
    for (const record of imported.values()) {
      if (record.handle === null) {
        continue;
      }
      try {
        await record.handle.close();
      } catch (e) {
        logger?.warn(
          `[restore] close slug "${record.filename}" threw: ${(e as Error).message} — continuing`,
        );
      }
    }
  };

  return {
    lookup,
    sources,
    allSources,
    baseDb,
    userDb,
    importsSettled,
    sourceLang,
    listDictPrefs,
    setDictPrefs: applyDictPrefs,
    deleteImportedDict,
    closeWritable,
  };
};
