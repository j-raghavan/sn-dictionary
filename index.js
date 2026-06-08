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
import {lookupThesaurus} from './src/core/dict/sqlite/thesaurusLookup';
import {addUserEntry} from './src/core/dict/sqlite/userEntries';
import {SELECT_IMPORT_ALL} from './src/core/dict/sqlite/schema';
import {setPopupActions} from './src/ui/popupController';
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
      // Reopen the ACTUAL slug DB at absPath (the same path openSlugDb
      // was given for this filename) so verify reads committed rows from
      // the file just written — not a fixed placeholder.
      reopenSlugDb: absPath => openRnSqliteDb({name: absPath})(),
      audit,
    }),
  enableButtons,
};

// Captured by the handlers; populated when bootstrap resolves. Until
// then the buttons are disabled, so no lookup can fire against a null.
const runtime = {lookup: null};

// Resolve a source name -> language. Base WordNet is English; user
// entries are language-undetermined ('und' -> thesaurus short-circuits);
// imported dicts carry their sidecar language in the imports audit.
const buildSourceLangMap = async userDb => {
  const map = {WordNet: 'en', User: 'und'};
  if (userDb !== null) {
    try {
      const rows = await userDb.query(SELECT_IMPORT_ALL);
      for (const row of rows) {
        map[row.name] = row.lang;
      }
    } catch (e) {
      logger.warn(`[startup] could not read import langs: ${e.message}`);
    }
  }
  return map;
};

bootstrap(bootstrapPorts, logger)
  .then(async handle => {
    runtime.lookup = handle.lookup;
    const sourceLang = await buildSourceLangMap(handle.userDb);

    // Register the popup actions (Designer ruling 1/2): the popup calls
    // these without importing the engine. Source->lang resolution + the
    // 'und' short-circuit live INSIDE lookupThesaurus (IV-1 preserved).
    setPopupActions({
      lookupThesaurus: async (headword, sourceName) => {
        const lang = sourceLang[sourceName] ?? 'und';
        // OMW relations live ONLY in base.db (shared across all
        // same-language sources); the thesaurus query always targets
        // handle.baseDb by design, scoped by the source's resolved lang.
        const omw = await lookupThesaurus(handle.baseDb, headword, lang, logger);
        return {lang, omw};
      },
      addUserEntry: async (word, definition) => {
        const result = await addUserEntry(handle.userDb, word, definition);
        if (!result.ok) {
          // Surface a failure to the popup (it shows an inline error);
          // validation rejections become a thrown error here so the
          // component's .catch path fires uniformly.
          throw new Error(`addUserEntry: ${result.reason}`);
        }
      },
      relookup: async text => {
        const res = await runtime.lookup.lookup(text);
        showDefinition(res, undefined, true);
      },
    });

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
  // Lasso flow is editable: the popup shows the OCR-correction field so
  // the user can fix a mis-recognised word (editable === true).
  showResult: (result, ocrLabel) => showDefinition(result, ocrLabel, true),
  hidePopup: hideDefinition,
  logger,
};

const docHandlerDeps = {
  doc: PluginDocAPI,
  view: PluginManager,
  lookup: {lookup: (...args) => runtime.lookup.lookup(...args)},
  // Doc-select text is already exact — no OCR field (editable omitted).
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
