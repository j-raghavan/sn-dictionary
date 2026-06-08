// DEVICE-UNVERIFIED. Wires ProvisionPorts to the on-device runtime.
// base.db is bundled in the .snplg and extracted by the host into
// plugins/<pluginID>/; provisioning just OPENS it by {name, location}
// (rnSqliteDb) — no createFromLocation, no asset copy (the spike proved
// createFromLocation can't read app.npk assets in a dynamically-loaded
// plugin). The pure verify logic it feeds (provision.ts) is host-tested
// with fakes. Coverage-excluded (jest.config.js); keep this THIN.

import type {OpenSqliteDb} from './db';
import type {ProvisionPorts} from './provision';

export type RnProvisionConfig = {
  // Opens the host-extracted base.db by {name, location} (resolves null
  // when missing, throws on a native open error).
  open: OpenSqliteDb;
};

export const createRnProvisionPorts = (
  config: RnProvisionConfig,
): ProvisionPorts => ({
  open(): ReturnType<OpenSqliteDb> {
    return config.open();
  },
});
