import {
  resolveIconUri,
  type ButtonListener,
  type PluginManagerLike,
} from './buttonCommon';
import type {ButtonEvent} from './buttonCommon';

// SDK button-type and editDataTypes constants.
// Per sn-plugin-lib: type 2 = lasso toolbar; editDataTypes 0=stroke, 3=text.
const BUTTON_TYPE_LASSO_TOOLBAR = 2;
const EDIT_DATA_TYPE_STROKE = 0;
const EDIT_DATA_TYPE_TEXT = 3;
const APP_TYPE_NOTE = 'NOTE';

// Two button ids: the firmware appears to apply AND semantics on
// `editDataTypes` (a button with [0, 3] only shows when the lasso
// contains BOTH strokes and text — empirically confirmed on-device,
// where a pure-text lasso of an "Anatomy" text box never surfaced
// the Lookup option). To cover the three input modes from the
// requirements doc — handwritten lasso, typed-text lasso, and the
// rare both-in-one — I register two buttons that share a single
// listener and dispatch into the same handler.
export const NOTE_LASSO_DEFINE_BUTTON_ID = 100;
export const NOTE_LASSO_DEFINE_TEXT_BUTTON_ID = 101;

// Re-exported so existing tests / callers don't have to know about
// the buttonCommon split.
export type {ButtonEvent, ButtonListener, PluginManagerLike};

export type RegisterDeps = {
  pluginManager: PluginManagerLike;
  onPress: (event: ButtonEvent) => void;
  logger: {warn: (msg: string) => void};
};

const buildButton = (
  id: number,
  iconUri: string,
  editDataTypes: number[],
): object => ({
  id,
  name: 'Lookup',
  icon: iconUri,
  enable: true,
  editDataTypes,
  // UI display: center-dialog region holding the DefinitionPopup.
  // Field name(s) here are unverified on SDK 0.1.34 — sn-shapes uses
  // `showType` (proven on-device), the SDK JSDoc references
  // `regionType`. Setting both is defensive; the native host reads
  // one and ignores the other.
  showType: 1,
  regionType: 1,
  regionWidth: 720,
  regionHeight: 540,
});

export const registerNoteLassoButton = async (
  deps: RegisterDeps,
): Promise<void> => {
  const iconUri = await resolveIconUri(
    deps.pluginManager,
    deps.logger,
    'define',
  );

  // Stroke lasso (handwritten content) — handler routes to OCR.
  await deps.pluginManager.registerButton(
    BUTTON_TYPE_LASSO_TOOLBAR,
    [APP_TYPE_NOTE],
    buildButton(NOTE_LASSO_DEFINE_BUTTON_ID, iconUri, [
      EDIT_DATA_TYPE_STROKE,
    ]),
  );

  // Text-box lasso (typed content) — handler reads textContentFull
  // directly, no OCR needed.
  await deps.pluginManager.registerButton(
    BUTTON_TYPE_LASSO_TOOLBAR,
    [APP_TYPE_NOTE],
    buildButton(NOTE_LASSO_DEFINE_TEXT_BUTTON_ID, iconUri, [
      EDIT_DATA_TYPE_TEXT,
    ]),
  );

  deps.pluginManager.registerButtonListener({
    onButtonPress: event => {
      if (
        event.id !== NOTE_LASSO_DEFINE_BUTTON_ID &&
        event.id !== NOTE_LASSO_DEFINE_TEXT_BUTTON_ID
      ) {
        return;
      }
      deps.onPress(event);
    },
  });
};
