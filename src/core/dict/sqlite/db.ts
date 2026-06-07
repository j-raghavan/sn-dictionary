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
  // Run `fn` inside a single transaction. The adapter commits when
  // `fn` resolves and rolls back if it rejects. The `tx` handle is a
  // SqliteDb scoped to the transaction.
  transaction(fn: (tx: SqliteDb) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

// Factory for opening a DB. MUST be nullable: a missing file/asset
// resolves `null`, which the lazy harness maps to the sticky
// 'absent' status (TF2-FR7) — distinct from a thrown error, which is
// a transient failure that retries. Open success resolves a handle;
// open failure (corrupt/locked) throws.
export type OpenSqliteDb = () => Promise<SqliteDb | null>;
