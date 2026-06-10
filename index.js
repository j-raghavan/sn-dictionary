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
  NativeUIUtils,
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
import {
  runNativeImport,
  getFileSize,
  copyPluginFile,
  deletePluginFile,
} from './src/core/dict/sqlite/nativeImport';
import {openRnSqliteDb} from './src/core/dict/sqlite/rnSqliteDb';
import {discoverUserDicts} from './src/core/dict/userDictDiscovery';
import {lookupThesaurus} from './src/core/dict/sqlite/thesaurusLookup';
import {addUserEntry} from './src/core/dict/sqlite/userEntries';
import {
  getKeepSources,
  setKeepSources,
} from './src/core/dict/sqlite/settings';
import {
  exportDbs as orchestrateExportDbs,
  buildExportableDbs,
  joinPath,
  exportRootParent,
  listFolders as listExportFolders,
  toDbFiles,
} from './src/core/dict/sqlite/exportDbs';
import {restoreDbs as orchestrateRestoreDbs} from './src/core/dict/sqlite/restoreDbs';
import {SELECT_IMPORT_ALL} from './src/core/dict/sqlite/schema';
import {t} from './src/i18n/i18n';
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

// SINGLE source of truth for the slug-DB on-device path (P2-1). Both the
// F7 delete port (resolveSlugPath) and the F5 export set (resolvePath)
// address a slug DB at PLUGIN_LOCATION/<filename>; routing both through one
// helper means they can never diverge. PLUGIN_LOCATION ends in '/', so
// joinPath collapses to the same string the import path's resolveSlugDbPath
// builds. joinPath is the shared, host-tested join from exportDbs.
const resolveSlugDbPath = filename => joinPath(PLUGIN_LOCATION, filename);

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
    // F4-FR3: slug-DB health probe (existence is enough for v1). The slug
    // lives at PLUGIN_LOCATION/<filename> (relative); RTNFileUtils.exists
    // can't resolve that, so probe via the resolving native stat — a
    // healthy slug DB is non-empty. A probe failure / 0 bytes -> treated as
    // unhealthy upstream (RE-ADD).
    slugDbExists: filename =>
      getFileSize(resolveSlugDbPath(filename)).then(size => size > 0),
  },
  discover: () => discoverUserDicts({fileUtils: FileUtils, logger}),
  // F7: the file-deletion seam deleteImportedDict drives — unlink the slug
  // DB at PLUGIN_LOCATION/<filename> (same mapping resolveSlugDbPath uses on
  // the import path) and the leftover on-disk source set. All best-effort;
  // bootstrap reflects per-step success in the DeleteResult it returns.
  delete: {
    resolveSlugPath: resolveSlugDbPath,
    // deletePluginFile resolves a RELATIVE plugin path (the slug DB) under
    // filesDir AND passes an ABSOLUTE path (a kept source file) through —
    // RTNFileUtils.deleteFile can't reach the relative slug path.
    deleteFile: path => deletePluginFile(path).then(() => undefined),
    deleteFolder: path => FileUtils.deleteDir(path),
  },
  // F4-FR5: the one-time first-run keep/delete dialog. Device-only (the
  // RattaDialog is a native overlay); bootstrap calls it once before the
  // first import dispatch when the flag is unset. true=keep, false=delete.
  promptKeepDelete: () =>
    NativeUIUtils.showRattaDialog(
      t('settings.keepPrompt'),
      t('common.delete'),
      t('common.keep'),
      true,
    ),
  // Build the format-agnostic RunImportPorts for a descriptor, branching
  // on descriptor.kind. StarDict -> native produce-step (via
  // stardictRunPorts); CSV -> JS produce-step (createRnCsvImportPorts).
  // F4: the kind-specific factories build the produce/delete seam; this
  // shell layers on the keepSources gate + the `.refresh` sentinel cleanup
  // (both format-agnostic) so runImport skips the delete when keeping and
  // removes a refresh marker after a verified refresh import.
  importPortsFor: (descriptor, audit, keepSources) => {
    const base =
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
            deletePluginFile(`${PLUGIN_LOCATION}${filename}`).catch(() => {}),
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
              deletePluginFile(`${PLUGIN_LOCATION}${filename}`).catch(() => {}),
            audit,
          }),
        );
    base.keepSources = keepSources;
    // F4-FR9: when a `.refresh` sentinel forced this re-import, delete it
    // after a verified commit so the same set doesn't loop next boot.
    if (descriptor.refreshPath !== undefined) {
      base.refreshPath = descriptor.refreshPath;
      base.deleteRefreshSentinel = path =>
        FileUtils.deleteFile(path).then(
          () => undefined,
          () => undefined,
        );
    }
    return base;
  },
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
      // F3 dictionary manager: the heavy logic (merge with the live
      // allSources + recompute the live `sources`) lives in the host-
      // tested handle; index.js just forwards.
      // [settings] diagnostics. Logs the actual prefKEYS (not just names) so a
      // write/read key mismatch is visible, and an IMMEDIATE read-back on the
      // SAME connection right after the save — if that read-back doesn't show
      // the just-saved state, the write isn't being applied at all (a broken
      // transaction), as opposed to a reload-durability issue.
      listDictPrefs: () =>
        handle.listDictPrefs().then(p => {
          logger.log(
            `[settings] load <- ${p.length}: ` +
              p
                .map(x => `${x.prefKey}=${x.enabled ? 'on' : 'off'}#${x.sortOrder}`)
                .join(' | '),
          );
          return p;
        }),
      setDictPrefs: prefs => {
        logger.log(
          `[settings] save -> ${prefs.length}: ` +
            prefs
              .map(x => `${x.prefKey}=${x.enabled ? 'on' : 'off'}#${x.sortOrder}`)
              .join(' | '),
        );
        return handle.setDictPrefs(prefs).then(
          () =>
            handle.listDictPrefs().then(rb =>
              logger.log(
                `[settings] readback <- ` +
                  rb
                    .map(x => `${x.prefKey}=${x.enabled ? 'on' : 'off'}`)
                    .join(' | '),
              ),
            ),
          e => {
            logger.log(`[settings] save FAILED: ${e?.message ?? e}`);
            throw e;
          },
        );
      },
      // F4 opt-in delete toggle: read/write the keepSourcesAfterImport
      // app setting on the live user.db (default keep; null-db-safe).
      getKeepSources: () => getKeepSources(handle.userDb),
      setKeepSources: keep => setKeepSources(handle.userDb, keep, logger),
      // F7 delete an imported dict: the confirm dialog is a native overlay
      // (device-only), so it lives here as the host-mockable port the panel
      // calls; only the Delete button (showRattaDialog -> true) proceeds.
      // The delete itself runs through the host-tested RuntimeHandle. The dict
      // `name` (a proper noun — not re-translated) heads the localized prompt
      // so the user sees WHICH dictionary they're about to remove.
      confirmDeleteDict: name =>
        NativeUIUtils.showRattaDialog(
          `${name}\n\n${t('settings.deleteDictPrompt')}`,
          t('common.cancel'),
          t('common.delete'),
          false,
        ),
      deleteImportedDict: prefKey => handle.deleteImportedDict(prefKey),
      // F5 DB export. The orchestration (space pre-check, plugin-dir
      // guard, user.db checkpoint, per-file copy) is host-tested in
      // exportDbs.ts; index.js only supplies the device ports
      // (NativeFileUtils) and the live audit/handle state.
      //
      // The export set is base.db + user.db + every imported slug (from
      // the imports audit table), each addressed at PLUGIN_LOCATION/<fn>.
      listExportableDbs: async () => {
        const imports =
          handle.userDb !== null
            ? await handle.userDb.query(SELECT_IMPORT_ALL)
            : [];
        return toDbFiles(
          buildExportableDbs({
            hasBase: true,
            hasUser: handle.userDb !== null,
            imports,
            resolvePath: resolveSlugDbPath,
          }),
        );
      },
      // Folder chooser: reuse the type-tagged FileUtils.listFiles (dirs
      // only) — the SAME FileUtils discovery injects (resolution #4).
      listFolders: parent => listExportFolders(FileUtils, parent),
      createFolder: path => FileUtils.makeDir(path),
      exportDbs: targetDir =>
        orchestrateExportDbs(
          targetDir,
          {
            listDbs: async () => {
              const imports =
                handle.userDb !== null
                  ? await handle.userDb.query(SELECT_IMPORT_ALL)
                  : [];
              return buildExportableDbs({
                hasBase: true,
                hasUser: handle.userDb !== null,
                imports,
                resolvePath: resolveSlugDbPath,
              });
            },
            availableSpace: () => FileUtils.getStorageAvailableSpace(),
            sizeOf: srcPath => getFileSize(srcPath),
            copyFile: (srcPath, destPath) =>
              copyPluginFile(srcPath, destPath),
            ensureDir: dir => FileUtils.makeDir(dir),
            // Checkpoint the OPEN user.db so its on-disk file is
            // WAL-consistent before the raw copy (resolution #9).
            checkpointUserDb: async () => {
              if (handle.userDb !== null) {
                await handle.userDb.run('PRAGMA wal_checkpoint(TRUNCATE)');
              }
            },
          },
          {
            pluginDir: PLUGIN_LOCATION,
            pluginDirMessage: t('settings.exportPluginDir'),
            noSpace: t('settings.exportNoSpace'),
          },
          logger,
        ),
      // F8 DB restore (the inverse of export). The orchestration (the
      // base.db exclusion, close-writable-before-copy, per-file copy) is
      // host-tested in restoreDbs.ts; index.js only supplies the device
      // ports. DEVICE-UNVERIFIED.
      //
      // The confirm dialog is a native overlay (device-only), so it lives
      // here as the host-mockable port the panel calls; only the Restore
      // button (showRattaDialog -> true) proceeds. The restore itself runs
      // through the host-tested orchestration over the live handle.
      confirmRestore: () =>
        NativeUIUtils.showRattaDialog(
          t('settings.restorePrompt'),
          t('common.cancel'),
          t('settings.restore'),
          false,
        ),
      restoreDbs: backupDir =>
        orchestrateRestoreDbs(
          backupDir,
          {
            // The backup folder is external (MyStyle/...), so FileUtils
            // reaches it; keep only the .db files (type===1), by basename.
            listBackup: async dir => {
              const entries = await FileUtils.listFiles(dir);
              if (!entries) {
                return [];
              }
              return entries
                .filter(e => e.type === 1 && e.path.endsWith('.db'))
                .map(e => {
                  const slash = e.path.lastIndexOf('/');
                  return slash >= 0 ? e.path.slice(slash + 1) : e.path;
                });
            },
            // copyPluginFile resolves BOTH ends (absolute backup src,
            // relative live dest) via the native copyResolved — a real
            // byte copy across the external->filesDir boundary.
            copyInto: (absSrc, relDest) => copyPluginFile(absSrc, relDest),
            resolveLivePath: resolveSlugDbPath,
            // Close the WRITABLE handles (user.db + imported slugs) BEFORE
            // the copy overwrites their files; base.db stays open (read-only,
            // never restored). The user reopens the plugin to finish.
            closeWritable: () => handle.closeWritable(),
            // Pre-restore safety snapshot: checkpoint user.db, then copy the
            // live user.db + every imported slug DB out to MyStyle/
            // SnDict-pre-restore/ so a bad restore is undoable (restore FROM
            // that folder to revert). base.db is the .snplg copy — not
            // snapshotted. A throw ABORTS the restore (orchestration) so the
            // live DBs are never overwritten without a safety net.
            snapshot: async () => {
              const snapDir = joinPath(exportRootParent(), 'SnDict-pre-restore');
              await FileUtils.makeDir(snapDir);
              if (handle.userDb !== null) {
                await handle.userDb.run('PRAGMA wal_checkpoint(TRUNCATE)');
              }
              const imports =
                handle.userDb !== null
                  ? await handle.userDb.query(SELECT_IMPORT_ALL)
                  : [];
              const files = ['user.db', ...imports.map(r => r.filename)];
              for (const f of files) {
                await copyPluginFile(resolveSlugDbPath(f), joinPath(snapDir, f));
              }
            },
          },
          {
            noBackup: t('settings.restoreNoBackup'),
            snapshotFailed: t('settings.restoreSnapshotFailed'),
          },
          logger,
        ),
      // Surface export/restore outcomes as a modal dialog (RattaDialog) — a
      // result the user can't miss, unlike the inline summary that's easy to
      // scroll past. Both buttons just dismiss it.
      notify: msg =>
        NativeUIUtils.showRattaDialog(
          msg,
          t('popup.close'),
          t('popup.close'),
          true,
        ).then(() => undefined),
    });

    logger.log(
      `[startup] engine ready: ${handle.sources.length} source(s) [${handle.sources
        .map(s => s.name)
        .join(', ')}]`,
    );
  })
  .catch(e => logger.error(`[startup] bootstrap failed: ${e.message}`));
