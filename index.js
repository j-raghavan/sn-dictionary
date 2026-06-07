// DEVICE-UNVERIFIED thin device shell. Builds the real RN/SDK-backed
// ports and hands them to the host-tested composition root (bootstrap).
// No dictionary logic lives here — index.js only translates the device
// (react-native-sqlite-storage, sn-plugin-lib FileUtils/PluginManager,
// fetch(file://...)) into the BootstrapPorts shape and wires the
// returned lookup into the (unchanged) handlers + popup.
//
// ADR-0001: the SQLite engine is the only path — there is NO base64
// blob fallback. The bundled base.db is provisioned via
// createFromLocation on first run; subsequent note re-opens just open
// the file (the cold-start fix this whole milestone exists for).

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {
  FileUtils,
  PluginCommAPI,
  PluginDocAPI,
  PluginFileAPI,
  PluginManager,
} from 'sn-plugin-lib';
import {
  registerNoteLassoButton,
  NOTE_LASSO_DEFINE_BUTTON_ID,
} from './src/buttons/registerNoteLassoButton';
import {
  registerDocSelectButton,
  DOC_SELECT_DEFINE_BUTTON_ID,
} from './src/buttons/registerDocSelectButton';
import {onNoteLassoDefine} from './src/handlers/onNoteLassoDefine';
import {onDocSelectDefine} from './src/handlers/onDocSelectDefine';
import {bootstrap} from './src/core/dict/sqlite/bootstrap';
import {createRnProvisionPorts} from './src/core/dict/sqlite/provisionRnPorts';
import {createRnImportPorts} from './src/core/dict/sqlite/importRnPorts';
import {openRnSqliteDb} from './src/core/dict/sqlite/rnSqliteDb';
import {discoverUserDicts} from './src/core/dict/userDictDiscovery';
import {decodeUtf8} from './src/sdk/utf8';
import {
  hideDefinition,
  showDefinition,
  showRecognizing,
} from './src/ui/popupController';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// Supernote's RN host filters console.warn / console.error out of
// logcat, so route every level through console.log with a prefix.
const logger = {
  log: msg => console.log(msg),
  warn: msg => console.log(`[WARN] ${msg}`),
  error: msg => console.log(`[ERROR] ${msg}`),
};

// Plugin sandbox layout (DB location is plugins/<pluginID>/).
const PLUGIN_DIR = '/storage/emulated/0/Android/data/com.ratta.supernote/files/plugins/sndictdfltbasev1';
const BASE_DB_PATH = `${PLUGIN_DIR}/base.db`;
const USER_DB_PATH = `${PLUGIN_DIR}/user.db`;
const IMPORT_DIR = `${PLUGIN_DIR}/imported`;
// The bundled base.db asset name react-native-sqlite-storage copies
// from (createFromLocation reads from the app's www/ assets).
const BASE_DB_ASSET = 'base.db';

// fetch(file://...) byte/text readers for the import pipeline.
const readBytes = async path => {
  const res = await fetch(`file://${path}`);
  if (!res.ok) {
    throw new Error(`read ${path} -> ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};
const readText = async path => {
  const bytes = await readBytes(path);
  return decodeUtf8(bytes);
};

const buttonsEnabled = {done: false};
const enableButtons = async () => {
  if (buttonsEnabled.done) {
    return;
  }
  buttonsEnabled.done = true;
  await Promise.all([
    PluginManager.setButtonState(NOTE_LASSO_DEFINE_BUTTON_ID, true),
    PluginManager.setButtonState(DOC_SELECT_DEFINE_BUTTON_ID, true),
  ]);
  logger.log('[startup] Lookup buttons enabled');
};

const provision = createRnProvisionPorts({
  dbPath: BASE_DB_PATH,
  fileUtils: FileUtils,
  openExisting: openRnSqliteDb({name: BASE_DB_PATH}),
  openFromAsset: async () => {
    const open = openRnSqliteDb({
      name: 'base.db',
      createFromAsset: `~${BASE_DB_ASSET}`,
    });
    const db = await open();
    if (db === null) {
      throw new Error('[provision] base.db createFromLocation returned null');
    }
    return db;
  },
});

const bootstrapPorts = {
  provision,
  db: {
    openUserDb: async () => {
      const open = openRnSqliteDb({name: USER_DB_PATH});
      const db = await open();
      if (db === null) {
        throw new Error('user.db open returned null');
      }
      return db;
    },
    openImportedDb: filename => openRnSqliteDb({name: `${IMPORT_DIR}/${filename}`}),
  },
  discover: () => discoverUserDicts({fileUtils: FileUtils, logger}),
  importPortsFor: (descriptor, audit) =>
    createRnImportPorts({
      ifoPath: descriptor.ifoPath,
      idxPath: descriptor.idxPath,
      dictPath: descriptor.dictPath,
      synPath: descriptor.synPath,
      sidecarPath: descriptor.sidecarPath,
      slugDbDir: IMPORT_DIR,
      fileUtils: FileUtils,
      readers: {readBytes, readText},
      openSlugDb: absPath =>
        openRnSqliteDb({name: absPath})().then(db => {
          if (db === null) {
            throw new Error(`open slug db returned null: ${absPath}`);
          }
          return db;
        }),
      reopenSlugDb: openRnSqliteDb({name: `${IMPORT_DIR}/__verify__`}),
      audit,
    }),
  enableButtons,
};

// Captured by the handlers; populated when bootstrap resolves. Until
// then the buttons are disabled, so no lookup can fire against a null.
const runtime = {lookup: null};

bootstrap(bootstrapPorts, logger)
  .then(handle => {
    runtime.lookup = handle.lookup;
    logger.log(
      `[startup] engine ready: ${handle.sources.length} source(s) [${handle.sources
        .map(s => s.name)
        .join(', ')}]`,
    );
  })
  .catch(e => logger.error(`[startup] bootstrap failed: ${e.message}`));

// closePluginView lives on PluginManager, not PluginCommAPI, so the
// handlers take a separate `view` dep.
const noteHandlerDeps = {
  comm: PluginCommAPI,
  view: PluginManager,
  file: PluginFileAPI,
  lookup: {lookup: (...args) => runtime.lookup.lookup(...args)},
  showRecognizing,
  showResult: showDefinition,
  hidePopup: hideDefinition,
  logger,
};

const docHandlerDeps = {
  doc: PluginDocAPI,
  view: PluginManager,
  lookup: {lookup: (...args) => runtime.lookup.lookup(...args)},
  showResult: showDefinition,
  logger,
};

registerNoteLassoButton({
  pluginManager: PluginManager,
  // Disabled until bootstrap provisions base.db and calls enableButtons.
  initiallyEnabled: false,
  onPress: () => {
    onNoteLassoDefine(noteHandlerDeps).catch(e => {
      logger.error(`[define] dispatch crashed: ${e.message}`);
    });
  },
  logger,
}).catch(e => {
  logger.error(`[define] NOTE button registration failed: ${e.message}`);
});

registerDocSelectButton({
  pluginManager: PluginManager,
  initiallyEnabled: false,
  onPress: () => {
    onDocSelectDefine(docHandlerDeps).catch(e => {
      logger.error(`[doc-define] dispatch crashed: ${e.message}`);
    });
  },
  logger,
}).catch(e => {
  logger.error(`[doc-define] DOC button registration failed: ${e.message}`);
});
