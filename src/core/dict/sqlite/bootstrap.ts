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
import {ensureSettingsTables} from './settings';
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

const identityKey = (name: string, lang: string): string => `${name}\u0000${lang}`;

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
  sources: DictSource[];
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
  const alreadyImported: DictSource[] = [];
  for (const item of reconciled) {
    if (item.bucket === 'open') {
      alreadyImported.push(
        createSqliteDictSource({
          name: item.row.name,
          openDb: ports.db.openImportedDb(item.row.filename),
        }),
      );
    }
  }

  // 6. Registry in precedence order [user?, ...imported, base] (IV-3).
  const sources: DictSource[] = [];
  if (userSource !== null) {
    sources.push(userSource);
  }
  sources.push(...alreadyImported);
  sources.push(baseSource);
  const lookup = createMultiDictLookup(sources, logger);

  // LIVE source -> language map (see RuntimeHandle.sourceLang). Seed the
  // base (WordNet = 'en'), the user source ('und' — user entries are
  // language-undetermined), and every already-imported source (its audit
  // row's lang). Detached imports (step 7) add their entry on splice.
  const sourceLang: Record<string, string> = {[baseSource.name]: 'en'};
  if (userSource !== null) {
    sourceLang[userSource.name] = 'und';
  }
  for (const item of reconciled) {
    if (item.bucket === 'open') {
      sourceLang[item.row.name] = item.row.lang;
    }
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
            const src = createSqliteDictSource({
              name: result.name,
              openDb: ports.db.openImportedDb(result.filename),
            });
            // Splice just-before base: base is always last, so length-1
            // keeps [user, ...imported, base] even as concurrent results
            // land into the live array.
            sources.splice(sources.length - 1, 0, src);
            // Register the new source's language LIVE so its thesaurus
            // resolves this session (no reload). Same object index.js reads.
            sourceLang[result.name] = item.descriptor.sidecar.language;
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

  return {lookup, sources, baseDb, userDb, importsSettled, sourceLang};
};
