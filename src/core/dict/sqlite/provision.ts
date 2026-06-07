// base.db provisioning decision logic (TF3-FR3 + the space-guard part
// of TF3-FR6). Pure, host-testable: all environment effects (does the
// DB exist? copy the bundled asset, open a handle, query free space)
// are behind ProvisionPorts so the algorithm is exercised with fakes.
//
// IV-2: provisioning is READ-ONLY against base.db — it runs
// SELECT_META_VERSION and NEVER inserts. Only the generator writes the
// meta row. A version mismatch / absent meta triggers a re-copy of the
// bundled asset, not an in-place write.
//
// Algorithm:
//   exists() === false  -> [space guard] -> copyFromAssetAndOpen
//                          -> 'fresh-copy'
//   exists() === true    -> open() -> SELECT_META_VERSION
//        row.schema_version === EXPECTED        -> 'reused' (no copy)
//        rows.length === 0 OR version < EXPECTED -> close, [space guard],
//                                                  copyFromAssetAndOpen
//                                                  -> 'reprovisioned'
//   any port throw / insufficient space -> log + reject.

import type {SqliteDb} from './db';
import {SCHEMA_VERSION} from './buildBaseDb';
import {SELECT_META_VERSION, type MetaRow} from './schema';

// The schema version provisioning expects the bundled DB to carry.
// Single source of truth is buildBaseDb.SCHEMA_VERSION (the generator
// is the writer); re-exported here under the name provisioning reasons
// about.
export const EXPECTED_SCHEMA_VERSION: number = SCHEMA_VERSION;

export interface ProvisionPorts {
  // Does a provisioned DB already exist on disk? Kept separate from
  // open() so the "fresh install" branch never opens a missing file.
  exists(): Promise<boolean>;
  // Copy the bundled asset into place (createFromLocation) and open it.
  copyFromAssetAndOpen(): Promise<SqliteDb>;
  // Open the already-present DB.
  open(): Promise<SqliteDb>;
  // Optional free-space probe (bytes). When present alongside
  // requiredBytes, the space guard runs before a copy.
  getAvailableSpace?(): Promise<number>;
}

export type ProvisionAction = 'fresh-copy' | 'reused' | 'reprovisioned';

export interface ProvisionResult {
  db: SqliteDb;
  action: ProvisionAction;
}

type Logger = {warn: (msg: string) => void; log?: (msg: string) => void};

// Tagged so the TF5 import path (which shares this guard) can be told
// apart from other failures. Distinguishable by the '[provision]'
// prefix and the structured need/have figures.
export const insufficientSpaceMessage = (
  requiredBytes: number,
  available: number,
): string =>
  `[provision] insufficient space: need ${requiredBytes}, have ${available}`;

// Space guard: only enforced when BOTH a probe and a requirement are
// supplied (Designer flag 1). Throws the tagged error on shortfall
// (Designer flag 2). A no-op when either input is absent.
const assertSpace = async (
  ports: ProvisionPorts,
  requiredBytes: number | undefined,
  logger?: Logger,
): Promise<void> => {
  if (ports.getAvailableSpace === undefined || requiredBytes === undefined) {
    return;
  }
  const available = await ports.getAvailableSpace();
  if (available < requiredBytes) {
    const msg = insufficientSpaceMessage(requiredBytes, available);
    logger?.warn(msg);
    throw new Error(msg);
  }
};

const copy = async (
  ports: ProvisionPorts,
  requiredBytes: number | undefined,
  action: ProvisionAction,
  logger?: Logger,
): Promise<ProvisionResult> => {
  await assertSpace(ports, requiredBytes, logger);
  const db = await ports.copyFromAssetAndOpen();
  logger?.log?.(`[provision] ${action} (schema v${EXPECTED_SCHEMA_VERSION})`);
  return {db, action};
};

export const provisionBaseDb = async (
  ports: ProvisionPorts,
  requiredBytes?: number,
  logger?: Logger,
): Promise<ProvisionResult> => {
  const present = await ports.exists();
  if (!present) {
    // Fresh install: nothing on disk, copy the bundled asset.
    return copy(ports, requiredBytes, 'fresh-copy', logger);
  }

  // Already provisioned — open and check the stamped schema version.
  const db = await ports.open();
  const rows = await db.query<MetaRow>(SELECT_META_VERSION);

  // Compare === EXPECTED (Designer flag 5): version 0 is falsy but a
  // valid stamped value, so never `if (version)`.
  if (rows.length > 0 && rows[0].schema_version === EXPECTED_SCHEMA_VERSION) {
    logger?.log?.('[provision] reused');
    return {db, action: 'reused'};
  }

  // Meta absent (rows.length === 0 — mid-build crash / pre-meta DB) or
  // a stale/newer version: re-copy the bundled asset. Close the stale
  // handle first so the copy can replace the file.
  await db.close();
  return copy(ports, requiredBytes, 'reprovisioned', logger);
};
