// base.db provisioning (TF3 — redesigned for the .snplg-bundled model).
// Pure, host-testable: the one environment effect (open the DB handle)
// is behind ProvisionPorts so the algorithm is exercised with fakes.
//
// The spike proved createFromLocation cannot read app.npk assets in a
// dynamically-loaded plugin. So base.db is shipped INSIDE the .snplg and
// the plugin host extracts it to plugins/<pluginID>/base.db; the runtime
// opens it by {name, location} (rnSqliteDb). base.db is therefore ALWAYS
// pre-placed — there is no copy/reprovision step here anymore.
//
// IV-2 still holds: provisioning is READ-ONLY against base.db — it opens
// and runs a COUNT/meta read, never writes.
//
// Algorithm:
//   open() === null            -> reject "base.db missing" (bundle/install bug)
//   SELECT count(*) entries throws (no table) OR count === 0
//                              -> reject "present but empty/no entries"
//   meta schema_version != EXPECTED
//                              -> WARN (a reinstall replaces base.db; not
//                                 fatal — the DB still has entries), continue
//   otherwise                  -> {db, action:'opened'}
//
// The entries COUNT verify is the guard that would have caught the
// empty-DB hang the spike hit (an unreadable asset opened as an empty DB
// and silently "succeeded").

import type {SqliteDb} from './db';
import {SCHEMA_VERSION} from './buildBaseDb';
import {SELECT_META_VERSION, type MetaRow} from './schema';

// The schema version provisioning expects base.db to carry. Single
// source of truth is buildBaseDb.SCHEMA_VERSION (the generator is the
// writer); re-exported here under the name provisioning reasons about.
export const EXPECTED_SCHEMA_VERSION: number = SCHEMA_VERSION;

export interface ProvisionPorts {
  // Open the host-extracted base.db. Resolves null when the file is
  // missing (a bundle/install problem); throws on a native open error.
  open(): Promise<SqliteDb | null>;
}

// Single outcome now — base.db is always opened in place (no copy).
export type ProvisionAction = 'opened';

export interface ProvisionResult {
  db: SqliteDb;
  action: ProvisionAction;
}

type Logger = {warn: (msg: string) => void; log?: (msg: string) => void};

export const provisionBaseDb = async (
  ports: ProvisionPorts,
  logger?: Logger,
): Promise<ProvisionResult> => {
  const db = await ports.open();
  if (db === null) {
    throw new Error(
      '[provision] base.db missing (bundle/install problem) — the .snplg should ship base.db at plugins/<id>/',
    );
  }

  // Verify the DB actually has dictionary content. An asset that failed
  // to extract/open as a real DB surfaces here as a missing entries
  // table (query throws) or zero rows — reject rather than hand back an
  // empty DB that wedges Lookup (the spike's failure mode).
  let count: number;
  try {
    const rows = await db.query<{n: number}>('SELECT count(*) AS n FROM entries');
    count = rows.length > 0 ? rows[0].n : 0;
  } catch (e) {
    throw new Error(
      `[provision] base.db present but empty/no entries table (${(e as Error).message})`,
    );
  }
  if (count === 0) {
    throw new Error('[provision] base.db present but empty/no entries table');
  }

  // Schema-version sanity check: log only. A mismatch is not fatal — a
  // reinstall ships a fresh base.db, and the DB demonstrably has entries
  // (the COUNT above passed), so Lookup works either way.
  try {
    const meta = await db.query<MetaRow>(SELECT_META_VERSION);
    const version = meta.length > 0 ? meta[0].schema_version : null;
    if (version !== EXPECTED_SCHEMA_VERSION) {
      logger?.warn(
        `[provision] base.db schema v${version} != expected v${EXPECTED_SCHEMA_VERSION} (reinstall to refresh) — continuing`,
      );
    }
  } catch {
    logger?.warn('[provision] base.db has no meta row — continuing');
  }

  logger?.log?.(`[provision] opened (${count} entries)`);
  return {db, action: 'opened'};
};
