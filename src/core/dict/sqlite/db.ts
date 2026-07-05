// The SQLite port. A minimal, promise-wrapped seam over whatever
// SQLite engine a given environment provides:
//
//   - On-device: `react-native-sqlite-storage` (see rnSqliteDb.ts —
//     DEVICE-UNVERIFIED, isolated from the jest import graph because
//     it pulls a native module).
//   - Host (tests / build-time generation): `better-sqlite3`
//     (see __tests__/_helpers/betterSqliteDb.ts).
//
// Both adapters sit behind this one interface so the dictionary
// engine (sqliteDictSource) is written once and never names a
// concrete driver. Modelled on the sticker demo's promise-wrapped
// `src/db/index.js` (`openDatabase` / `transaction` / `executeSql` /
// `rows.raw()`), reduced to the two operations the engine needs:
// a parameterized read (`query`) and a parameterized write (`run`),
// plus a `transaction` for batched writes (the import pipeline, TF5)
// and `close`.
//
// Parameterized only — there is deliberately no raw-exec method on
// the port. Every value reaches SQLite through a bound `?` placeholder
// so a headword carrying `'` or `; DROP TABLE` is data, never SQL
// (TF2-FR4 / boundary validation).

// The value types SQLite can bind through a `?` placeholder. The
// dictionary schema stores only TEXT columns; `number` and `null`
// round out the set for the write paths (row counts, optional cols).
export type SqlParam = string | number | null;

export interface SqliteDb {
  // Parameterized read. Returns every matching row as a plain object
  // keyed by column name. T defaults to an open record; callers that
  // know their projection pass a concrete row type (e.g. EntryRow).
  query<T = Record<string, unknown>>(
    sql: string,
    params?: SqlParam[],
  ): Promise<T[]>;
  // Parameterized write. Resolves with the number of rows changed so
  // the import/verify pipeline (TF5) can assert affected-row counts.
  run(sql: string, params?: SqlParam[]): Promise<{changes: number}>;
  // Run `fn` with a `tx` handle for a sequence of writes. NOTE the real
  // on-device contract (react-native-sqlite-storage): every statement
  // AUTOCOMMITS independently — there is NO multi-statement rollback. If `fn`
  // rejects, statements that already ran STAY committed and the rejection
  // propagates. So this is a convenience grouping, NOT an atomic unit: code that
  // needs atomicity across writes must achieve it in a SINGLE statement (e.g.
  // INSERT OR REPLACE over a PRIMARY KEY — see upsertImport / upsertDictPref).
  transaction(fn: (tx: SqliteDb) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

// Factory for opening a DB. MUST be nullable: a missing file/asset
// resolves `null`, which the lazy harness maps to the sticky
// 'absent' status (TF2-FR7) — distinct from a thrown error, which is
// a transient failure that retries. Open success resolves a handle;
// open failure (corrupt/locked) throws.
export type OpenSqliteDb = () => Promise<SqliteDb | null>;

// Additive column migration for an EXISTING table: run an
// `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT ...` and SWALLOW the
// idempotent "duplicate column name" error SQLite raises when the column is
// already present (CREATE ... IF NOT EXISTS never alters an existing table, so
// this is how a new column reaches an older on-device DB). Any OTHER failure
// (e.g. disk I/O) is a real error and rethrows so the caller can degrade.
// Shared by the user.db phonetic migration and the imports importer_version
// migration (both proved on-device with the same rn-sqlite adapter).
export const runAdditiveColumnMigration = async (
  db: SqliteDb,
  alterSql: string,
): Promise<void> => {
  try {
    await db.run(alterSql);
  } catch (e) {
    if (!/duplicate column name/i.test((e as Error).message)) {
      throw e;
    }
  }
};
