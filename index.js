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
import {registerNoteLassoButton} from './src/buttons/registerNoteLassoButton';
import {registerDocSelectButton} from './src/buttons/registerDocSelectButton';
import {onNoteLassoDefine} from './src/handlers/onNoteLassoDefine';
import {onDocSelectDefine} from './src/handlers/onDocSelectDefine';
import {createStardictLookup} from './src/core/dict/stardictLookup';
import {createMultiDictLookup} from './src/core/dict/multiDictLookup';
import {discoverUserDicts} from './src/core/dict/userDictDiscovery';
import {primeAllConcurrently} from './src/core/dict/primeAllConcurrently';
import {loadBaseDictFromGenerated} from './src/core/dict/data/baseDictData';
import {
  hideDefinition,
  showDefinition,
  showRecognizing,
} from './src/ui/popupController';

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
// loadBase contract used by runtime-discovered user dicts. Explicit
// format='wordnet' so the popup uses the structured-sense renderer
// for entries from this source.
const baseSource = createStardictLookup({
  name: 'WordNet',
  loadBase: async () => loadBaseDictFromGenerated(),
  format: 'wordnet',
  logger,
});

// Mutable source list, captured by closure inside createMultiDictLookup
// so user dicts discovered at runtime are picked up by lookups without
// rebuilding the registry. Order: discovered user dicts first (they're
// shown above the base in the popup section list), base dict last.
const sources = [baseSource];

const lookup = createMultiDictLookup(sources, logger);

// Eager-load the base dict at plugin start so any build error is
// visible immediately in logcat rather than at first lookup. The
// dict is memoised inside the loader, so this doesn't add per-lookup
// cost.
lookup
  .lookup('__sndict_init__')
  .then(() =>
    logger.log('[stardict] base dict loaded ok (init probe complete)'),
  )
  .catch(e => logger.error(`[stardict] init probe threw: ${e.message}`));

// Discover sideloaded user dicts under /storage/emulated/0/MyStyle/SnDict.
// Fire-and-forget at startup: the Lookup button is always enabled
// (users can hit the base dict immediately) and discovery prepends
// any found dicts into the registry as they become available.
//
// Priming is delegated to primeAllConcurrently — see that module
// for the rationale on concurrent vs. serial. The contract is
// covered by __tests__/primeAllConcurrently.test.ts so we can't
// regress this without breaking the suite.
discoverUserDicts({fileUtils: FileUtils, logger})
  .then(async userDicts => {
    if (userDicts.length === 0) {
      return;
    }
    sources.unshift(...userDicts);
    logger.log(
      `[startup] registry now has ${sources.length} source(s): [${sources
        .map(s => s.name)
        .join(', ')}]`,
    );
    await primeAllConcurrently(userDicts, logger);
  })
  .catch(e => logger.error(`[discovery] dispatch crashed: ${e.message}`));

// closePluginView lives on PluginManager, not PluginCommAPI, so the
// handlers take a separate `view` dep. PluginManager satisfies the
// ClosablePluginView interface structurally — no wrapper needed.
// Wiring it via PluginCommAPI would silently resolve to undefined at
// runtime — exactly the bug the on-device "[WARN] closePluginView
// threw: undefined is not a function" reentrancy log surfaced.
const noteHandlerDeps = {
  comm: PluginCommAPI,
  view: PluginManager,
  file: PluginFileAPI,
  lookup,
  showRecognizing,
  showResult: showDefinition,
  hidePopup: hideDefinition,
  logger,
};

const docHandlerDeps = {
  doc: PluginDocAPI,
  view: PluginManager,
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
