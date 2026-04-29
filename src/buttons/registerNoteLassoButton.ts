// SDK button-type and editDataTypes constants.
// Per sn-plugin-lib: type 2 = lasso toolbar; editDataTypes 0=stroke, 3=text.
const BUTTON_TYPE_LASSO_TOOLBAR = 2;
const EDIT_DATA_TYPE_STROKE = 0;
const EDIT_DATA_TYPE_TEXT = 3;
const APP_TYPE_NOTE = 'NOTE';

// Stable id for the Define lasso button. Sticking to a fixed integer
// matches the convention in sn-shapes/sn-formula and lets logcat /
// listener filtering identify our events without ambiguity.
export const NOTE_LASSO_DEFINE_BUTTON_ID = 100;

export type ButtonEvent = {id: number};

export type ButtonListener = {
  onButtonPress: (event: ButtonEvent) => void;
};

export type PluginManagerLike = {
  registerButton: (
    type: number,
    appTypes: string[],
    button: object,
  ) => Promise<boolean>;
  registerButtonListener: (listener: ButtonListener) => unknown;
  getPluginDirPath: () => Promise<string | null | undefined>;
};

export type RegisterDeps = {
  pluginManager: PluginManagerLike;
  onPress: (event: ButtonEvent) => void;
  logger: {warn: (msg: string) => void};
};

const ICON_FILENAME = 'icon.png';

const buildIconUri = (pluginDir: string | null | undefined): string =>
  pluginDir ? `file://${pluginDir}/${ICON_FILENAME}` : '';

export const registerNoteLassoButton = async (
  deps: RegisterDeps,
): Promise<void> => {
  let pluginDir: string | null | undefined;
  try {
    pluginDir = await deps.pluginManager.getPluginDirPath();
  } catch (e) {
    deps.logger.warn(
      `[define:icon] getPluginDirPath threw: ${(e as Error).message} — registering without icon`,
    );
    pluginDir = null;
  }
  const iconUri = buildIconUri(pluginDir);
  if (!iconUri) {
    deps.logger.warn(
      '[define:icon] no plugin dir available — button will render without icon',
    );
  }

  await deps.pluginManager.registerButton(
    BUTTON_TYPE_LASSO_TOOLBAR,
    [APP_TYPE_NOTE],
    {
      id: NOTE_LASSO_DEFINE_BUTTON_ID,
      name: 'Define',
      icon: iconUri,
      enable: true,
      // Strokes (handwritten) and text boxes (typed). The handler
      // branches on getLassoElementTypeCounts to decide between OCR
      // and direct text read.
      editDataTypes: [EDIT_DATA_TYPE_STROKE, EDIT_DATA_TYPE_TEXT],
      // UI display: center-dialog region holding the DefinitionPopup.
      // Field name(s) here are unverified on SDK 0.1.34 — sn-shapes uses
      // `showType` (proven on-device), the SDK JSDoc references
      // `regionType`. Setting both is defensive; the native host reads
      // one and ignores the other. Empirical confirmation lands in
      // spike 1's on-device run.
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
