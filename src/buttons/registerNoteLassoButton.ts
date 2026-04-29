import {
  resolveIconUri,
  type ButtonListener,
  type PluginManagerLike,
} from './buttonCommon';
import type {ButtonEvent} from './buttonCommon';
import {localizedButtonName} from '../i18n/i18n';

// SDK button-type and editDataTypes constants.
// Per sn-plugin-lib: type 2 = lasso toolbar; editDataTypes 0=stroke,
// 1=title, 2=image, 3=text-box, 4=link.
//
// Empirically (logcat 04-29 12:15:24, PluginButtonAdapter), the
// firmware filters lasso buttons such that:
//   - the Sticker plugin's [0, 5] button shows for a stroke lasso
//   - our previous [0, 3] button hid for both stroke-only AND
//     text-only lassos
// The likely rule is "all of editDataTypes must be 'stroke-family'
// or all must be 'text-family'; mixing the two hides the button on
// every lasso." Sticking with type 0 (stroke) only — the dominant
// note-taking case. If a future user need surfaces typed text-box
// lookup, register a separate button with [3] then.
const BUTTON_TYPE_LASSO_TOOLBAR = 2;
const EDIT_DATA_TYPE_STROKE = 0;
const APP_TYPE_NOTE = 'NOTE';

export const NOTE_LASSO_DEFINE_BUTTON_ID = 100;

export type {ButtonEvent, ButtonListener, PluginManagerLike};

export type RegisterDeps = {
  pluginManager: PluginManagerLike;
  onPress: (event: ButtonEvent) => void;
  logger: {warn: (msg: string) => void};
};

export const registerNoteLassoButton = async (
  deps: RegisterDeps,
): Promise<void> => {
  const iconUri = await resolveIconUri(
    deps.pluginManager,
    deps.logger,
    'define',
  );

  await deps.pluginManager.registerButton(
    BUTTON_TYPE_LASSO_TOOLBAR,
    [APP_TYPE_NOTE],
    {
      id: NOTE_LASSO_DEFINE_BUTTON_ID,
      // JSON-encoded {locale: name} map; the firmware picks the row
      // matching the device locale (sticker plugin's nameMap shape).
      name: localizedButtonName(),
      icon: iconUri,
      enable: true,
      // Single stroke-family entry — covers both freshly-written
      // strokes (trailNum) and previously-recognised strokes
      // (trailLinkNum / titleNum), which the handler funnels into
      // the same recognizeElements OCR path.
      editDataTypes: [EDIT_DATA_TYPE_STROKE],
      // UI display: center-dialog region holding the DefinitionPopup.
      // Field name(s) here are unverified on SDK 0.1.34 — sn-shapes
      // uses `showType` (proven on-device), the SDK JSDoc references
      // `regionType`. Setting both is defensive.
      showType: 1,
      regionType: 1,
      regionWidth: 720,
      regionHeight: 540,
    },
  );

  deps.pluginManager.registerButtonListener({
    onButtonPress: event => {
      if (event.id !== NOTE_LASSO_DEFINE_BUTTON_ID) {
        return;
      }
      deps.onPress(event);
    },
  });
};
