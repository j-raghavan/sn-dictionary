import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {
  PluginCommAPI,
  PluginDocAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
} from 'sn-plugin-lib';
import {registerNoteLassoButton} from './src/buttons/registerNoteLassoButton';
import {registerDocSelectButton} from './src/buttons/registerDocSelectButton';
import {onNoteLassoDefine} from './src/handlers/onNoteLassoDefine';
import {onDocSelectDefine} from './src/handlers/onDocSelectDefine';
import {createStardictLookup} from './src/core/dict/stardictLookup';
import {loadPlaceholderBaseDict} from './src/core/dict/data/placeholderBaseDict';
import {showDefinition} from './src/ui/popupController';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

const logger = {
  log: msg => console.log(msg),
  warn: msg => console.warn(msg),
  error: msg => console.error(msg),
};

// Spike 3: vendored StarDict reader backed by an in-memory placeholder
// dict so the runtime path is exercised end-to-end on-device. The
// follow-up commit replaces `loadPlaceholderBaseDict` with a
// build-time-emitted base64 module loading a real WordNet StarDict;
// nothing else here changes.
const lookup = createStardictLookup({
  loadBase: loadPlaceholderBaseDict,
  logger,
});

const noteHandlerDeps = {
  comm: PluginCommAPI,
  note: PluginNoteAPI,
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
