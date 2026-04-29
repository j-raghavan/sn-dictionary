import {
  resolveIconUri,
  type ButtonListener,
  type PluginManagerLike,
} from './buttonCommon';
import type {ButtonEvent} from './buttonCommon';
import {localizedButtonName} from '../i18n/i18n';

// SDK button-type and app-type constants.
// type 3 = DOC text-selection toolbar (per sn-plugin-lib JSDoc on
// NativePluginManager.registerButtonRes).
const BUTTON_TYPE_DOC_SELECTION_TOOLBAR = 3;
const APP_TYPE_DOC = 'DOC';

// Distinct from NOTE_LASSO_DEFINE_BUTTON_ID (=100). Plugin-local
// uniqueness is what the SDK requires; we keep the gap large enough
// to allow future button additions without re-numbering.
export const DOC_SELECT_DEFINE_BUTTON_ID = 200;

// Re-exported so existing tests / callers don't have to know about
// the buttonCommon split.
export type {ButtonEvent, ButtonListener, PluginManagerLike};

export type RegisterDocDeps = {
  pluginManager: PluginManagerLike;
  onPress: (event: ButtonEvent) => void;
  logger: {warn: (msg: string) => void};
};

export const registerDocSelectButton = async (
  deps: RegisterDocDeps,
): Promise<void> => {
  const iconUri = await resolveIconUri(
    deps.pluginManager,
    deps.logger,
    'doc-define',
  );

  // type:3 buttons appear in the PDF text-selection toolbar after a
  // user selects text. They have no `editDataTypes` (that's a type:2
  // concept). The popup-region UI hints mirror the NOTE lasso button
  // so the same DefinitionPopup renders inside.
  await deps.pluginManager.registerButton(
    BUTTON_TYPE_DOC_SELECTION_TOOLBAR,
    [APP_TYPE_DOC],
    {
      id: DOC_SELECT_DEFINE_BUTTON_ID,
      // JSON-encoded {locale: name} map — same shape as the NOTE
      // lasso button. Firmware picks the row matching device locale.
      name: localizedButtonName(),
      icon: iconUri,
      enable: true,
      // Defensive double-set across SDK versions; see
      // src/buttons/registerNoteLassoButton.ts for rationale.
      showType: 1,
      regionType: 1,
      regionWidth: 720,
      regionHeight: 540,
    },
  );

  deps.pluginManager.registerButtonListener({
    onButtonPress: event => {
      if (event.id !== DOC_SELECT_DEFINE_BUTTON_ID) {
        return;
      }
      deps.onPress(event);
    },
  });
};
