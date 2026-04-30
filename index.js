import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {
  PluginCommAPI,
  PluginDocAPI,
  PluginFileAPI,
  PluginManager,
} from 'sn-plugin-lib';
import {registerNoteLassoButton} from './src/buttons/registerNoteLassoButton';
import {registerDocSelectButton} from './src/buttons/registerDocSelectButton';
import {onNoteLassoDefine} from './src/handlers/onNoteLassoDefine';
import {onDocSelectDefine} from './src/handlers/onDocSelectDefine';
import {createStardictLookup} from './src/core/dict/stardictLookup';
import {createMultiDictLookup} from './src/core/dict/multiDictLookup';
import {loadBaseDictFromGenerated} from './src/core/dict/data/baseDictData';
import {showDefinition} from './src/ui/popupController';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// Supernote's RN host filters console.warn / console.error out of
// logcat (every ReactNativeJS line in observed traces is at info
// level), so we route every level through console.log with an
// explicit prefix. Keeps diagnostics visible during on-device runs.
const logger = {
  log: msg => console.log(msg),
  warn: msg => console.log(`[WARN] ${msg}`),
  error: msg => console.log(`[ERROR] ${msg}`),
};

// The base dict source. Bundled into the JS at build time, so the
// loader is sync underneath; we wrap it in async to fit the shared
// loadBase contract used by runtime-discovered user dicts.
const baseSource = createStardictLookup({
  name: 'WordNet',
  loadBase: async () => loadBaseDictFromGenerated(),
  logger,
});

const lookup = createMultiDictLookup([baseSource], logger);

// Eager-load the dict at plugin start so any build error is visible
// immediately in logcat rather than at first lookup. The dict is
// memoised inside the loader, so this doesn't add per-lookup cost.
lookup
  .lookup('__sndict_init__')
  .then(() =>
    logger.log('[stardict] base dict loaded ok (init probe complete)'),
  )
  .catch(e => logger.error(`[stardict] init probe threw: ${e.message}`));

const noteHandlerDeps = {
  comm: PluginCommAPI,
  file: PluginFileAPI,
  lookup,
  showResult: showDefinition,
  logger,
};

const docHandlerDeps = {
  doc: PluginDocAPI,
  comm: PluginCommAPI,
  lookup,
  showResult: showDefinition,
  logger,
};

registerNoteLassoButton({
  pluginManager: PluginManager,
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
  onPress: () => {
    onDocSelectDefine(docHandlerDeps).catch(e => {
      logger.error(`[doc-define] dispatch crashed: ${e.message}`);
    });
  },
  logger,
}).catch(e => {
  logger.error(`[doc-define] DOC button registration failed: ${e.message}`);
});
