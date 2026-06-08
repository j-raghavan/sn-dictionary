// DEVICE-UNVERIFIED thin device shell. Builds the real RN/SDK-backed
// ports and hands them to the host-tested composition root (bootstrap).
// No dictionary logic lives here — index.js only translates the device
// (react-native-sqlite-storage, sn-plugin-lib FileUtils/PluginManager,
// fetch(file://...)) into the BootstrapPorts shape and wires the
// returned lookup into the (unchanged) handlers + popup.
//
// ADR-0001: the SQLite engine is the only path — there is NO base64
// blob fallback. base.db ships INSIDE the .snplg and the plugin host
// extracts it to plugins/<pluginID>/; every DB is opened by
// {name, location} (no createFromLocation — the spike proved it can't
// read app.npk assets in a dynamically-loaded plugin).

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
import {createRnCsvImportPorts} from './src/core/dict/sqlite/importCsvRnPorts';
import {stardictRunPorts} from './src/core/dict/sqlite/importStardict';
import {runNativeImport, getFileSize} from './src/core/dict/sqlite/nativeImport';
import {openRnSqliteDb} from './src/core/dict/sqlite/rnSqliteDb';
import {discoverUserDicts} from './src/core/dict/userDictDiscovery';
import {lookupThesaurus} from './src/core/dict/sqlite/thesaurusLookup';
import {addUserEntry} from './src/core/dict/sqlite/userEntries';
import {setPopupActions} from './src/ui/popupController';
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

// All DBs live in the plugin host's extracted dir, addressed by
// {name, location} — NOT a hardcoded absolute path. The native side
// resolves getFilesDir() + location + name (SQLitePlugin.java:392-395),
// where getFilesDir() is the host's own files dir (the spike proved it
// is .../com.ratta.supernote.pluginhost/files, NOT a guessable absolute
// path — the old hardcoded com.ratta.supernote path was wrong). base.db
// ships in the .snplg and the host extracts it here; user.db + imported
// slug DBs are created in place by the native layer.
const PLUGIN_LOCATION = 'plugins/sndictdfltbasev1/';

const openDbByName = name => openRnSqliteDb({name, location: PLUGIN_LOCATION});

// Captured by the handlers; set when bootstrap resolves — which is NOW
// fast: bootstrap returns as soon as base + user + already-imported are
// ready (sideload imports run DETACHED and splice into handle.sources
// live, rather than blocking the resolve). So runtime.lookup is set
// quickly after enableButtons, instead of only after every import
// finishes — closing the long null-lookup window.
const runtime = {lookup: null};

// --- buttons: register FIRST, then enable after registration ---------
// The "Plugin button is not exists!" race was setButtonState firing
// before the button finished registering. enableButtons now AWAITS the
// registration promises (buttonsReady) before flipping state.
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

const buttonsReady = Promise.all([
  registerNoteLassoButton({
    pluginManager: PluginManager,
    initiallyEnabled: false,
    onPress: () => {
      onNoteLassoDefine(noteHandlerDeps).catch(e => {
        logger.error(`[define] dispatch crashed: ${e.message}`);
      });
    },
    logger,
  }).catch(e => {
    logger.error(`[define] NOTE button registration failed: ${e.message}`);
  }),
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
  }),
]);

const buttonsEnabled = {done: false};
const enableButtons = async () => {
  if (buttonsEnabled.done) {
    return;
  }
  buttonsEnabled.done = true;
  // Wait for the buttons to exist before setting their state (fixes the
  // "Plugin button is not exists!" race).
  await buttonsReady;
  await Promise.all([
    PluginManager.setButtonState(NOTE_LASSO_DEFINE_BUTTON_ID, true),
    PluginManager.setButtonState(DOC_SELECT_DEFINE_BUTTON_ID, true),
  ]);
  logger.log('[startup] Lookup buttons enabled');
};

const provision = createRnProvisionPorts({
  // base.db is host-extracted into plugins/<id>/; open it in place.
  open: openDbByName('base.db'),
});

const bootstrapPorts = {
  provision,
  db: {
    openUserDb: async () => {
      const db = await openDbByName('user.db')();
      if (db === null) {
        throw new Error('user.db open returned null');
      }
      return db;
    },
    openImportedDb: filename => openDbByName(filename),
  },
  discover: () => discoverUserDicts({fileUtils: FileUtils, logger}),
  // Build the format-agnostic RunImportPorts for a descriptor, branching
  // on descriptor.kind. StarDict -> native produce-step (via
  // stardictRunPorts); CSV -> JS produce-step (createRnCsvImportPorts).
  importPortsFor: (descriptor, audit) =>
    descriptor.kind === 'csv'
      ? createRnCsvImportPorts({
          csvPath: descriptor.csvPath,
          // sidecarPath may be undefined (no per-file meta.json) — then no
          // sidecar file is deleted.
          sidecarPath: descriptor.sidecarPath,
          sidecarText: JSON.stringify(descriptor.sidecar),
          csvConfig: descriptor.csvConfig,
          fileUtils: FileUtils,
          // Fetch the CSV bytes (file://) for the JS parse.
          loadBytes: async () => {
            const res = await fetch(`file://${descriptor.csvPath}`);
            if (!res.ok) {
              throw new Error(
                `fetch ${descriptor.csvPath} returned status ${res.status}`,
              );
            }
            return res.arrayBuffer();
          },
          resolveSlugDbPath: filename => `${PLUGIN_LOCATION}${filename}`,
          // The CSV produce-step parses in JS and writes via a WRITABLE
          // rn-sqlite handle (openDbByName opens read/write).
          openWritableSlug: filename => openDbByName(filename)(),
          reopenSlugByName: filename => openDbByName(filename)(),
          discardSlugByName: filename =>
            FileUtils.deleteFile(`${PLUGIN_LOCATION}${filename}`).catch(() => {}),
          audit,
        })
      : stardictRunPorts(
          createRnImportPorts({
            ifoPath: descriptor.ifoPath,
            idxPath: descriptor.idxPath,
            dictPath: descriptor.dictPath,
            synPath: descriptor.synPath,
            // The containing subfolder — removed (best-effort) after the
            // files are deleted so an empty dir isn't left behind (FR3).
            setPath: descriptor.setPath,
            // sidecarPath may be undefined (no meta.json) — then no sidecar
            // file is deleted. The sidecarText is the discovery-resolved
            // sidecar serialized (discovery already read+validated meta.json,
            // or built the default), so no meta.json re-read is needed.
            sidecarPath: descriptor.sidecarPath,
            sidecarText: JSON.stringify(descriptor.sidecar),
            // Real .dict size from a native stat (SnDictImport.fileSize) —
            // not a hardcoded 0 that would silently disable the space guard.
            statDictSize: () => getFileSize(descriptor.dictPath),
            fileUtils: FileUtils,
            // Native parse+insert into plugins/<id>/<filename> (the module
            // resolves a relative dbPath under the host files dir).
            runNativeImport,
            resolveSlugDbPath: filename => `${PLUGIN_LOCATION}${filename}`,
            // Verify reopens the committed slug DB; discard deletes the
            // half-built file (best-effort).
            reopenSlugByName: filename => openDbByName(filename)(),
            discardSlugByName: filename =>
              FileUtils.deleteFile(`${PLUGIN_LOCATION}${filename}`).catch(() => {}),
            audit,
          }),
        ),
  enableButtons,
};

bootstrap(bootstrapPorts, logger)
  .then(handle => {
    runtime.lookup = handle.lookup;

    // Register the popup actions (Designer ruling 1/2): the popup calls
    // these without importing the engine. Source->lang resolution + the
    // 'und' short-circuit live INSIDE lookupThesaurus (IV-1 preserved).
    setPopupActions({
      lookupThesaurus: async (headword, sourceName) => {
        // handle.sourceLang is the LIVE map bootstrap owns — a dict
        // imported this session is already in it (no reload needed).
        const lang = handle.sourceLang[sourceName] ?? 'und';
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
