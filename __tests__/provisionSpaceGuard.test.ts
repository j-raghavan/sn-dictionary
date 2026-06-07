// Storage-space pre-check (TF3-FR6). The guard runs ONLY before a copy
// branch and ONLY when BOTH a free-space probe and a byte requirement
// are supplied; on shortfall it rejects with a TAGGED error that the
// TF5 import path shares, so failures are distinguishable. These cases
// are framed from the FR's contract (sufficient / insufficient /
// skipped-when-absent) and pin the exact tagged message format.

import {
  EXPECTED_SCHEMA_VERSION,
  insufficientSpaceMessage,
  provisionBaseDb,
  type ProvisionPorts,
} from '../src/core/dict/sqlite/provision';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const okDb = (version = EXPECTED_SCHEMA_VERSION): SqliteDb => ({
  async query<T = Record<string, unknown>>(): Promise<T[]> {
    return [{schema_version: version}] as unknown as T[];
  },
  async run() {
    return {changes: 0};
  },
  async transaction() {
    return undefined;
  },
  async close() {
    return undefined;
  },
});

const freshInstallPorts = (
  over: Partial<ProvisionPorts>,
): {ports: ProvisionPorts; copy: jest.Mock} => {
  const copy = jest.fn(async () => okDb());
  const ports: ProvisionPorts = {
    exists: async () => false,
    open: async () => okDb(),
    copyFromAssetAndOpen: copy,
    ...over,
  };
  return {ports, copy};
};

describe('provision space guard (TF3-FR6)', () => {
  it('insufficientSpaceMessage is a shared, tagged format (TF5 reuses it)', () => {
    expect(insufficientSpaceMessage(2048, 1024)).toBe(
      '[provision] insufficient space: need 2048, have 1024',
    );
  });

  it('sufficient space -> copy proceeds', async () => {
    const {ports, copy} = freshInstallPorts({
      getAvailableSpace: async () => 5_000_000,
    });
    const res = await provisionBaseDb(ports, 1_000_000);
    expect(res.action).toBe('fresh-copy');
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('insufficient space -> rejects with the tagged error, NO copy', async () => {
    const {ports, copy} = freshInstallPorts({
      getAvailableSpace: async () => 100,
    });
    await expect(provisionBaseDb(ports, 1_000_000)).rejects.toThrow(
      insufficientSpaceMessage(1_000_000, 100),
    );
    expect(copy).not.toHaveBeenCalled();
  });

  it('guard is skipped when the probe is absent (requiredBytes alone)', async () => {
    const {ports, copy} = freshInstallPorts({}); // no getAvailableSpace
    const res = await provisionBaseDb(ports, 1_000_000);
    expect(res.action).toBe('fresh-copy');
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('guard is skipped when requiredBytes is absent (probe alone)', async () => {
    const probe = jest.fn(async () => 0);
    const {ports, copy} = freshInstallPorts({getAvailableSpace: probe});
    // No requiredBytes -> guard no-op, probe never consulted.
    const res = await provisionBaseDb(ports);
    expect(res.action).toBe('fresh-copy');
    expect(copy).toHaveBeenCalledTimes(1);
    expect(probe).not.toHaveBeenCalled();
  });

  it('runs the guard on the reprovision copy branch too (not just fresh)', async () => {
    const copy = jest.fn(async () => okDb());
    const ports: ProvisionPorts = {
      exists: async () => true,
      // stale version -> reprovision -> guard before copy.
      open: async () => okDb(EXPECTED_SCHEMA_VERSION - 1),
      copyFromAssetAndOpen: copy,
      getAvailableSpace: async () => 100,
    };
    await expect(provisionBaseDb(ports, 1_000_000)).rejects.toThrow(
      insufficientSpaceMessage(1_000_000, 100),
    );
    expect(copy).not.toHaveBeenCalled();
  });

  it('never runs the guard before the reused (no-copy) branch', async () => {
    const probe = jest.fn(async () => 0);
    const ports: ProvisionPorts = {
      exists: async () => true,
      open: async () => okDb(EXPECTED_SCHEMA_VERSION), // matches -> reused
      copyFromAssetAndOpen: async () => okDb(),
      getAvailableSpace: probe,
    };
    const res = await provisionBaseDb(ports, 1_000_000);
    expect(res.action).toBe('reused');
    // Reused path takes no copy, so the guard must not consult the probe.
    expect(probe).not.toHaveBeenCalled();
  });
});
