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

import type {DictLookup, DictSource} from '../lookup';
import {createMultiDictLookup} from '../multiDictLookup';
import {createSqliteDictSource} from './sqliteDictSource';
import type {OpenSqliteDb, SqliteDb} from './db';
import type {ProvisionPorts} from './provision';
import {provisionBaseDb} from './provision';
import {
  CREATE_USER_ENTRIES_TABLE,
  CREATE_USER_ENTRIES_INDEX,
  ALTER_USER_ENTRIES_ADD_PHONETIC,
  SELECT_IMPORT_ALL,
  type ImportRow,
} from './schema';
import {ensureImportsTable} from './importAudit';
import {
  ensureSettingsTables,
  mergeDictPrefs,
  readDictPrefs,
  setDictPrefs,
  type DictPref,
  type DictSourceIdentity,
} from './settings';
import {runImport, type RunImportPorts} from './runImport';
import type {ImportJobDescriptor} from '../userDictDiscovery';

type Logger = {warn: (msg: string) => void; log?: (msg: string) => void};

// --- reconcileImports (PURE) ----------------------------------------
// Decide, from the descriptors found on disk and the audit rows in
// user.db, what to do with each. Pure — NO file-existence probe (a
// missing/corrupt slug DB is not a bucket here; the lazy source handles
// it as 'absent'/'failed', Designer ruling 1).
//
//   'import' — a descriptor to (re)import. NEW (no audit hit) or
//              RE-ADD (audit hit -> replacesFilename = prior slug).
//   'open'   — an audit row with no matching descriptor on disk
//              (already imported; just open its slug DB).
//   'skip'   — a duplicate (name, lang) descriptor (first wins as
//              'import', the rest skip — Designer flag 1).

export type ReconcileItem =
  | {bucket: 'import'; descriptor: ImportJobDescriptor; replacesFilename?: string}
  | {bucket: 'open'; row: ImportRow}
  | {bucket: 'skip'; reason: string; descriptor?: ImportJobDescriptor};

export const identityKey = (name: string, lang: string): string =>
  `${name}\u0000${lang}`;

// dict_prefs primary key for a source (resolution #6 / F3): an IMPORTED
// dict keys on its audit identity (identityKey(name,lang)) so two dicts
// sharing a display name in different languages get distinct prefs; the
// built-in base (WordNet) and User sources have no language ambiguity, so
// their bare name is the key (matching how sourceLang special-cases them).
export const dictPrefKey = (
  name: string,
  lang: string,
  removable: boolean,
): string => (removable ? identityKey(name, lang) : name);

export const reconcileImports = (
  descriptors: ImportJobDescriptor[],
  auditRows: ImportRow[],
): ReconcileItem[] => {
  const auditByKey = new Map<string, ImportRow>();
  for (const row of auditRows) {
    auditByKey.set(identityKey(row.name, row.lang), row);
  }

  const items: ReconcileItem[] = [];
  const seen = new Set<string>();
  const importedKeys = new Set<string>();

  // Descriptors first: NEW + RE-ADD become 'import'; duplicates skip.
  for (const descriptor of descriptors) {
    const {name, language: lang} = descriptor.sidecar;
    const key = identityKey(name, lang);
    if (seen.has(key)) {
      items.push({
        bucket: 'skip',
        reason: 'duplicate name+lang on disk',
        descriptor,
      });
      continue;
    }
    seen.add(key);
    importedKeys.add(key);
    const prior = auditByKey.get(key);
    items.push(
      prior
        ? {bucket: 'import', descriptor, replacesFilename: prior.filename}
        : {bucket: 'import', descriptor},
    );
  }

  // Audit rows with no descriptor on disk -> 'open' the existing slug.
  for (const row of auditRows) {
    const key = identityKey(row.name, row.lang);
    if (!importedKeys.has(key)) {
      items.push({bucket: 'open', row});
    }
  }

  return items;
};

// --- live `sources` derivation (F3) ---------------------------------
//
// The live `sources` array (the one multiDictLookup snapshots per
// lookup) is DERIVED from `allSources` (the full opened registry) by
// applying dict_prefs: keep only enabled sources, ordered by sort_order.
// `identities` resolves each source's prefKey/removable (base/User vs
// imported). Recomputed IN PLACE (clear + push) so the array reference
// the lookup closed over stays valid — a disabled source leaves
// `sources` but stays in `allSources`, so re-enabling needs no reopen.
//
// PURE save for the in-place mutation of `live`: given the same inputs it
// always produces the same ordered enabled set. Sources absent from
// `identities` (defensive) are treated as enabled at their natural index.
export const deriveLiveSources = (
  live: DictSource[],
  allSources: DictSource[],
  identities: Map<DictSource, DictSourceIdentity>,
  persisted: DictPref[],
): void => {
  const identityList: DictSourceIdentity[] = allSources.map(
    source =>
      identities.get(source) ?? {
        name: source.name,
        prefKey: source.name,
        removable: false,
      },
  );
  const merged = mergeDictPrefs(identityList, persisted);
  const sourceByKey = new Map<string, DictSource>();
  allSources.forEach((source, index) => {
    sourceByKey.set(identityList[index].prefKey, source);
  });
  const next: DictSource[] = [];
  for (const pref of merged) {
    const source = sourceByKey.get(pref.prefKey);
    if (source && pref.enabled) {
      next.push(source);
    }
  }
  live.length = 0;
  live.push(...next);
};

// --- bootstrap ------------------------------------------------------

export interface BootstrapDbPorts {
  openUserDb(): Promise<SqliteDb>;
  openImportedDb(filename: string): OpenSqliteDb;
}

export interface BootstrapPorts {
  provision: ProvisionPorts;
  db: BootstrapDbPorts;
  discover(): Promise<ImportJobDescriptor[]>;
  // Build the format-agnostic import ports for a descriptor. The host
  // adapter (index.js) branches on descriptor.kind to wire the right
  // produceSlugDb (native StarDict vs JS CSV) + source/sidecar paths.
  importPortsFor(d: ImportJobDescriptor, audit: SqliteDb): RunImportPorts;
  enableButtons(): Promise<void>;
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
}

const readAuditRows = async (userDb: SqliteDb): Promise<ImportRow[]> =>
  userDb.query<ImportRow>(SELECT_IMPORT_ALL);

export const bootstrap = async (
  ports: BootstrapPorts,
  logger?: Logger,
): Promise<RuntimeHandle> => {
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
    // alter an EXISTING (pre-v3) user.db, so an old 6-col table would
    // still lack `phonetic` and the v3 SELECT would throw "no such
    // column" on every lookup. ALTER it in; on a fresh 7-col table SQLite
    // raises "duplicate column name" which we swallow (idempotent).
    try {
      await userDb.run(ALTER_USER_ENTRIES_ADD_PHONETIC);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/duplicate column name/i.test(msg)) {
        throw e;
      }
    }
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
  let reconciled: ReconcileItem[] = [];
  if (userDb !== null) {
    let descriptors: ImportJobDescriptor[] = [];
    try {
      descriptors = await ports.discover();
    } catch (e) {
      logger?.warn(`[bootstrap] discover threw: ${(e as Error).message} — no imports`);
    }
    const auditRows = await readAuditRows(userDb);
    reconciled = reconcileImports(descriptors, auditRows);
    for (const item of reconciled) {
      if (item.bucket === 'skip') {
        logger?.warn(`[bootstrap] skip import: ${item.reason}`);
      }
    }
  }

  // 5. Open already-imported sources ('open' bucket).
  const alreadyImported: {source: DictSource; lang: string}[] = [];
  for (const item of reconciled) {
    if (item.bucket === 'open') {
      alreadyImported.push({
        source: createSqliteDictSource({
          name: item.row.name,
          openDb: ports.db.openImportedDb(item.row.filename),
        }),
        lang: item.row.lang,
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
  for (const {source, lang} of alreadyImported) {
    register(source, lang, true);
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
    importsSettled = Promise.all(
      toImport.map(async item => {
        try {
          // Format-agnostic: importPortsFor wires the kind-appropriate
          // produceSlugDb; runImport drives the shared spine for both.
          const result = await runImport(
            ports.importPortsFor(item.descriptor, audit),
            logger,
          );
          if (result.ok) {
            const lang = item.descriptor.sidecar.language;
            const src = createSqliteDictSource({
              name: result.name,
              openDb: ports.db.openImportedDb(result.filename),
            });
            // Push the new source into the FULL registry just-before base
            // (base is always last, so splice at length-1 keeps
            // [user, ...imported, base] even as concurrent results land),
            // then register its identity (imported -> removable).
            allSources.splice(allSources.length - 1, 0, src);
            identities.set(src, {
              name: src.name,
              prefKey: dictPrefKey(src.name, lang, true),
              removable: true,
            });
            // Recompute the LIVE `sources` in place honoring prefs: a new
            // (unknown-key) source defaults enabled + default-ordered just-
            // before base (its natural allSources position). multiDictLookup
            // snapshots per lookup, so an in-flight lookup is unaffected.
            deriveLiveSources(sources, allSources, identities, persistedPrefs);
            // Register the new source's language LIVE so its thesaurus
            // resolves this session (no reload). Same object index.js reads.
            sourceLang[result.name] = lang;
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
  };
};
