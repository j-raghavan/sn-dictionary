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
import {mockLookup} from './src/core/lookup';
import {showDefinition} from './src/ui/popupController';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

const logger = {
  log: msg => console.log(msg),
  warn: msg => console.warn(msg),
  error: msg => console.error(msg),
};

// Spike 1+2: real SDK calls + mock lookup. Spike 3 swaps `mockLookup`
// for the js-mdict-backed reader; nothing else here changes.
const noteHandlerDeps = {
  comm: PluginCommAPI,
  note: PluginNoteAPI,
  file: PluginFileAPI,
  lookup: mockLookup,
  showResult: showDefinition,
  logger,
};

const docHandlerDeps = {
  doc: PluginDocAPI,
  comm: PluginCommAPI,
  lookup: mockLookup,
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
