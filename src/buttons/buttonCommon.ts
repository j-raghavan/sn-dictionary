// Shared types and helpers for button registrations.
// Keeps register*Button.ts files focused on the parts that actually
// differ between buttons (type, appTypes, id, editDataTypes).

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
  // Toggles the enable state of a previously-registered button.
  // Used at startup to gate Lookup behind the base WordNet dict's
  // prime: the button is registered disabled, then flipped on once
  // the dict is parseable. Without this, a tap before priming
  // completes would queue OCR + lookup behind the prime parse and
  // exhibit the slow on-device latency.
  setButtonState: (id: number, state: boolean) => Promise<boolean>;
};

export const ICON_FILENAME = 'icon.png';

export const resolveIconUri = async (
  pluginManager: Pick<PluginManagerLike, 'getPluginDirPath'>,
  logger: {warn: (msg: string) => void},
  tag: string,
): Promise<string> => {
  let pluginDir: string | null | undefined;
  try {
    pluginDir = await pluginManager.getPluginDirPath();
  } catch (e) {
    logger.warn(
      `[${tag}:icon] getPluginDirPath threw: ${(e as Error).message} — registering without icon`,
    );
    pluginDir = null;
  }
  const iconUri = pluginDir ? `file://${pluginDir}/${ICON_FILENAME}` : '';
  if (!iconUri) {
    logger.warn(
      `[${tag}:icon] no plugin dir available — button will render without icon`,
    );
  }
  return iconUri;
};
