// provisionBaseDb (redesigned: base.db is .snplg-bundled + host-
// extracted, opened in place — no copy). Covers: open-null -> reject,
// no-entries-table -> reject, empty-entries -> reject, populated -> ok,
// schema-version mismatch -> warn-not-reject, IV-2 (read-only: never
// writes base.db).

import {
  EXPECTED_SCHEMA_VERSION,
  provisionBaseDb,
  type ProvisionPorts,
} from '../src/core/dict/sqlite/provision';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const COUNT_SQL = 'SELECT count(*) AS n FROM entries';
const META_SQL = 'SELECT schema_version FROM meta LIMIT 1';

// A fake base.db: `count` rows in entries, optional meta version.
// `entriesThrows` models a missing entries table (query throws).
// runCalls records writes so we can assert provisioning never writes.
type FakeDb = SqliteDb & {runCalls: string[]; closed: boolean};

const fakeDb = (opts: {
  count?: number;
  metaVersion?: number | null;
  entriesThrows?: boolean;
  metaThrows?: boolean;
}): FakeDb => {
  const db: FakeDb = {
    runCalls: [],
    closed: false,
    async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
      if (sql === COUNT_SQL) {
        if (opts.entriesThrows) {
          throw new Error('no such table: entries');
        }
        return [{n: opts.count ?? 0}] as unknown as T[];
      }
      if (sql === META_SQL) {
        if (opts.metaThrows) {
          throw new Error('no such table: meta');
        }
        return (opts.metaVersion === null || opts.metaVersion === undefined
          ? []
          : [{schema_version: opts.metaVersion}]) as unknown as T[];
      }
      return [] as T[];
    },
    async run(sql: string) {
      db.runCalls.push(sql);
      return {changes: 0};
    },
    async transaction() {
      return undefined;
    },
    async close() {
      db.closed = true;
    },
  };
  return db;
};

const portsOpening = (db: SqliteDb | null): ProvisionPorts => ({
  open: async () => db,
});

describe('provisionBaseDb', () => {
  it('rejects when open() returns null (base.db missing — bundle/install bug)', async () => {
    await expect(provisionBaseDb(portsOpening(null))).rejects.toThrow(
      '[provision] base.db missing',
    );
  });

  it('rejects when the entries table is absent (query throws)', async () => {
    const db = fakeDb({entriesThrows: true});
    await expect(provisionBaseDb(portsOpening(db))).rejects.toThrow(
      '[provision] base.db present but empty/no entries table',
    );
  });

  it('rejects when entries is present but empty (count === 0)', async () => {
    const db = fakeDb({count: 0, metaVersion: EXPECTED_SCHEMA_VERSION});
    await expect(provisionBaseDb(portsOpening(db))).rejects.toThrow(
      '[provision] base.db present but empty/no entries table',
    );
  });

  it('treats an empty COUNT result set as zero (defensive)', async () => {
    // A COUNT query that returns no rows at all (rows.length === 0) is
    // coerced to count 0 -> reject (never a hang on an unreadable DB).
    const db: SqliteDb = {
      query: async () => [],
      run: async () => ({changes: 0}),
      transaction: async () => undefined,
      close: async () => undefined,
    };
    await expect(provisionBaseDb(portsOpening(db))).rejects.toThrow(
      '[provision] base.db present but empty/no entries table',
    );
  });

  it('opens a populated base.db -> {db, action:"opened"}', async () => {
    const db = fakeDb({count: 149535, metaVersion: EXPECTED_SCHEMA_VERSION});
    const res = await provisionBaseDb(db ? portsOpening(db) : portsOpening(null));
    expect(res.action).toBe('opened');
    expect(res.db).toBe(db);
  });

  it('NEVER writes base.db (IV-2 read-only)', async () => {
    const db = fakeDb({count: 10, metaVersion: EXPECTED_SCHEMA_VERSION});
    await provisionBaseDb(portsOpening(db));
    expect(db.runCalls).toEqual([]);
    // Provisioning opens in place; it does not close the handle (the
    // runtime keeps it for lookups).
    expect(db.closed).toBe(false);
  });

  describe('schema-version sanity check (warn, not reject)', () => {
    it('warns on a version mismatch but still returns ok', async () => {
      const db = fakeDb({count: 5, metaVersion: EXPECTED_SCHEMA_VERSION - 1});
      const warn = jest.fn();
      const res = await provisionBaseDb(portsOpening(db), {warn});
      expect(res.action).toBe('opened');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('schema v'),
      );
    });

    it('warns when meta row is absent but still returns ok', async () => {
      const db = fakeDb({count: 5, metaVersion: null});
      const warn = jest.fn();
      const res = await provisionBaseDb(portsOpening(db), {warn});
      expect(res.action).toBe('opened');
      expect(warn).toHaveBeenCalled();
    });

    it('warns when the meta table is missing (query throws) but returns ok', async () => {
      const db = fakeDb({count: 5, metaThrows: true});
      const warn = jest.fn();
      const res = await provisionBaseDb(portsOpening(db), {warn});
      expect(res.action).toBe('opened');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('no meta row'),
      );
    });

    it('does not warn when the version matches', async () => {
      const db = fakeDb({count: 5, metaVersion: EXPECTED_SCHEMA_VERSION});
      const warn = jest.fn();
      await provisionBaseDb(portsOpening(db), {warn});
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
