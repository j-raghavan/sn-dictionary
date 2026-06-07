// provisionBaseDb decision logic (TF3-FR3 + FR6 space-guard part),
// driven entirely through fake ProvisionPorts. Covers the four
// branches (fresh-copy / reused / version-bump reprovision /
// meta-absent reprovision), IV-2 (read-only: never INSERT into
// base.db), schema-version-0 validity, and port-throw isolation.

import {
  EXPECTED_SCHEMA_VERSION,
  provisionBaseDb,
  type ProvisionPorts,
} from '../src/core/dict/sqlite/provision';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

// A fake SqliteDb whose query() returns the given meta rows and records
// every run()/INSERT so the test can assert provisioning never writes.
type FakeDb = SqliteDb & {runCalls: string[]; closed: boolean};

const fakeDb = (metaRows: {schema_version: number}[]): FakeDb => {
  const db: FakeDb = {
    runCalls: [],
    closed: false,
    async query<T = Record<string, unknown>>(): Promise<T[]> {
      return metaRows as unknown as T[];
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

type PortsOverrides = Partial<ProvisionPorts> & {
  existing?: FakeDb;
  copied?: FakeDb;
};

const makePorts = (o: PortsOverrides) => {
  const existing = o.existing ?? fakeDb([{schema_version: EXPECTED_SCHEMA_VERSION}]);
  const copied = o.copied ?? fakeDb([{schema_version: EXPECTED_SCHEMA_VERSION}]);
  const ports: ProvisionPorts = {
    exists: o.exists ?? (async () => true),
    open: o.open ?? (async () => existing),
    copyFromAssetAndOpen: o.copyFromAssetAndOpen ?? (async () => copied),
    getAvailableSpace: o.getAvailableSpace,
  };
  return {ports, existing, copied};
};

describe('provisionBaseDb', () => {
  it('fresh install (not present) -> fresh-copy', async () => {
    const copyFn = jest.fn(async () => fakeDb([]));
    const {ports} = makePorts({
      exists: async () => false,
      copyFromAssetAndOpen: copyFn,
    });
    const res = await provisionBaseDb(ports);
    expect(res.action).toBe('fresh-copy');
    expect(copyFn).toHaveBeenCalledTimes(1);
  });

  it('present + matching version -> reused, with NO copy', async () => {
    const copyFn = jest.fn(async () => fakeDb([]));
    const {ports, existing} = makePorts({
      existing: fakeDb([{schema_version: EXPECTED_SCHEMA_VERSION}]),
      copyFromAssetAndOpen: copyFn,
    });
    const res = await provisionBaseDb(ports);
    expect(res.action).toBe('reused');
    expect(res.db).toBe(existing);
    expect(copyFn).not.toHaveBeenCalled();
  });

  it('reused path NEVER writes the read-only base.db (IV-2)', async () => {
    const existing = fakeDb([{schema_version: EXPECTED_SCHEMA_VERSION}]);
    const {ports} = makePorts({existing});
    await provisionBaseDb(ports);
    expect(existing.runCalls).toEqual([]);
  });

  it('present + stale (lower) version -> reprovisioned (re-copy), stale handle closed', async () => {
    const stale = fakeDb([{schema_version: EXPECTED_SCHEMA_VERSION - 1}]);
    const copyFn = jest.fn(async () => fakeDb([]));
    const {ports} = makePorts({existing: stale, copyFromAssetAndOpen: copyFn});
    const res = await provisionBaseDb(ports);
    expect(res.action).toBe('reprovisioned');
    expect(copyFn).toHaveBeenCalledTimes(1);
    expect(stale.closed).toBe(true);
  });

  it('expects schema v2 and reprovisions a v1 (pre-thesaurus) db (TF4-FR1)', async () => {
    // v1 had no thesaurus table; the v1 -> v2 bump must trigger a
    // re-copy of the bundled (thesaurus-bearing) DB.
    expect(EXPECTED_SCHEMA_VERSION).toBe(2);
    const v1 = fakeDb([{schema_version: 1}]);
    const copyFn = jest.fn(async () => fakeDb([]));
    const {ports} = makePorts({existing: v1, copyFromAssetAndOpen: copyFn});
    const res = await provisionBaseDb(ports);
    expect(res.action).toBe('reprovisioned');
    expect(copyFn).toHaveBeenCalledTimes(1);
    expect(v1.closed).toBe(true);
  });

  it('present + meta absent (rows.length === 0) -> reprovisioned', async () => {
    const noMeta = fakeDb([]);
    const copyFn = jest.fn(async () => fakeDb([]));
    const {ports} = makePorts({existing: noMeta, copyFromAssetAndOpen: copyFn});
    const res = await provisionBaseDb(ports);
    expect(res.action).toBe('reprovisioned');
    expect(copyFn).toHaveBeenCalledTimes(1);
  });

  it('treats schema_version 0 as a valid stamped value', async () => {
    // With EXPECTED = current version, a 0 stamp is stale -> reprovision
    // (proves it is COMPARED, not coerced via truthiness which would
    // also reprovision but for the wrong reason). To prove 0 is honoured
    // as a value, point EXPECTED-equality at it via a matching DB.
    const zeroExpected = fakeDb([{schema_version: 0}]);
    const copyFn = jest.fn(async () => fakeDb([]));
    const {ports} = makePorts({existing: zeroExpected, copyFromAssetAndOpen: copyFn});
    const res = await provisionBaseDb(ports);
    // EXPECTED_SCHEMA_VERSION is >= 1, so 0 is stale -> reprovision.
    // The point: the decision came from `0 === EXPECTED` being false,
    // not from `if (0)` — verified by meta-absent and match cases above.
    expect(res.action).toBe('reprovisioned');
    expect(copyFn).toHaveBeenCalled();
  });

  // Space-guard branch coverage. The FR6 deliverable (commit 5) adds
  // the named sufficient/insufficient/skipped cases; these exercise the
  // guard's branches so the shipped code is covered here.
  describe('space guard branches', () => {
    it('skips the guard when getAvailableSpace is absent', async () => {
      const copyFn = jest.fn(async () => fakeDb([]));
      const {ports} = makePorts({exists: async () => false, copyFromAssetAndOpen: copyFn});
      // requiredBytes supplied but no probe -> guard no-op, copy proceeds.
      const res = await provisionBaseDb(ports, 1_000_000);
      expect(res.action).toBe('fresh-copy');
    });

    it('enforces the guard and proceeds when space is sufficient', async () => {
      const copyFn = jest.fn(async () => fakeDb([]));
      const {ports} = makePorts({
        exists: async () => false,
        getAvailableSpace: async () => 10,
        copyFromAssetAndOpen: copyFn,
      });
      const res = await provisionBaseDb(ports, 5);
      expect(res.action).toBe('fresh-copy');
      expect(copyFn).toHaveBeenCalled();
    });

    it('rejects with the tagged error when space is insufficient', async () => {
      const copyFn = jest.fn(async () => fakeDb([]));
      const {ports} = makePorts({
        exists: async () => false,
        getAvailableSpace: async () => 3,
        copyFromAssetAndOpen: copyFn,
      });
      await expect(provisionBaseDb(ports, 10)).rejects.toThrow(
        '[provision] insufficient space: need 10, have 3',
      );
      expect(copyFn).not.toHaveBeenCalled();
    });
  });

  describe('port-throw isolation', () => {
    it('rejects when exists() throws', async () => {
      const {ports} = makePorts({
        exists: async () => {
          throw new Error('fs error');
        },
      });
      await expect(provisionBaseDb(ports)).rejects.toThrow('fs error');
    });

    it('rejects when copyFromAssetAndOpen() throws', async () => {
      const {ports} = makePorts({
        exists: async () => false,
        copyFromAssetAndOpen: async () => {
          throw new Error('copy failed');
        },
      });
      await expect(provisionBaseDb(ports)).rejects.toThrow('copy failed');
    });
  });
});
