import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
} from 'sn-plugin-lib';
import {registerNoteLassoButton} from './src/buttons/registerNoteLassoButton';
import {onNoteLassoDefine} from './src/handlers/onNoteLassoDefine';
import {mockLookup} from './src/core/lookup';
import {showDefinition} from './src/ui/popupController';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

const logger = {
  log: msg => console.log(msg),
  warn: msg => console.warn(msg),
  error: msg => console.error(msg),
};

// Spike 1: real SDK calls + mock lookup. Spike 3 swaps `mockLookup`
// for the js-mdict-backed reader; nothing else here changes.
const handlerDeps = {
  comm: PluginCommAPI,
  note: PluginNoteAPI,
  file: PluginFileAPI,
  lookup: mockLookup,
  showResult: showDefinition,
  logger,
};

registerNoteLassoButton({
  pluginManager: PluginManager,
  onPress: () => {
    onNoteLassoDefine(handlerDeps).catch(e => {
      logger.error(`[define] dispatch crashed: ${e.message}`);
    });
  },
  logger,
}).catch(e => {
  logger.error(`[define] button registration failed: ${e.message}`);
});
