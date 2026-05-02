import {
  registerNoteLassoButton,
  NOTE_LASSO_DEFINE_BUTTON_ID,
  type RegisterDeps,
  type ButtonListener,
} from '../src/buttons/registerNoteLassoButton';

const buildDeps = (
  overrides: Partial<RegisterDeps> = {},
): RegisterDeps & {capturedListener: () => ButtonListener | undefined} => {
  let captured: ButtonListener | undefined;
  const deps: RegisterDeps = {
    pluginManager: {
      registerButton: jest.fn(async () => true),
      registerButtonListener: jest.fn((l: ButtonListener) => {
        captured = l;
        return {id: 1};
      }),
      getPluginDirPath: jest.fn(async () => '/data/plugins/sn-dict'),
      setButtonState: jest.fn(async () => true),
    },
    onPress: jest.fn(),
    logger: {warn: jest.fn()},
    ...overrides,
  };
  return Object.assign(deps, {capturedListener: () => captured});
};

describe('registerNoteLassoButton', () => {
  test('registers a single lasso-toolbar button for NOTE with stroke-only editDataTypes', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    expect(deps.pluginManager.registerButton).toHaveBeenCalledTimes(1);
    const [type, appTypes, button] = (
      deps.pluginManager.registerButton as jest.Mock
    ).mock.calls[0];
    expect(type).toBe(2);
    expect(appTypes).toEqual(['NOTE']);
    expect(button).toMatchObject({
      id: NOTE_LASSO_DEFINE_BUTTON_ID,
      enable: true,
      // Stroke-family only; mixing 0 and 3 in editDataTypes hides
      // the button on every lasso (firmware filter quirk).
      editDataTypes: [0],
    });
    // Button name is a JSON-encoded {locale: label} map so the
    // firmware can pick the right localised label for the device.
    const parsedName = JSON.parse(button.name);
    expect(parsedName.en).toBe('Lookup');
    expect(parsedName.zh_CN).toBe('查询');
  });

  test('button declares the popup-region UI hints', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    const button = (deps.pluginManager.registerButton as jest.Mock).mock
      .calls[0][2];
    expect(button.showType).toBe(1);
    expect(button.regionType).toBe(1);
    expect(button.regionWidth).toBeGreaterThan(0);
    expect(button.regionHeight).toBeGreaterThan(0);
  });

  test('icon URI is built from getPluginDirPath()', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    const button = (deps.pluginManager.registerButton as jest.Mock).mock
      .calls[0][2];
    expect(button.icon).toBe('file:///data/plugins/sn-dict/icon.png');
  });

  test('falls back to empty icon when plugin dir is unavailable', async () => {
    const deps = buildDeps({
      pluginManager: {
        ...buildDeps().pluginManager,
        getPluginDirPath: jest.fn(async () => null),
      },
    });
    await registerNoteLassoButton(deps);
    const button = (deps.pluginManager.registerButton as jest.Mock).mock
      .calls[0][2];
    expect(button.icon).toBe('');
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  test('initiallyEnabled defaults to true (backwards-compat)', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    const button = (deps.pluginManager.registerButton as jest.Mock).mock
      .calls[0][2];
    expect(button.enable).toBe(true);
  });

  test('initiallyEnabled=false registers the button disabled', async () => {
    const deps = buildDeps({initiallyEnabled: false});
    await registerNoteLassoButton(deps);
    const button = (deps.pluginManager.registerButton as jest.Mock).mock
      .calls[0][2];
    expect(button.enable).toBe(false);
  });

  test('listener forwards events for the Lookup button only', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    const listener = deps.capturedListener();
    expect(listener).toBeDefined();
    listener!.onButtonPress({id: NOTE_LASSO_DEFINE_BUTTON_ID});
    listener!.onButtonPress({id: 999});
    listener!.onButtonPress({id: 200}); // DOC button id — must be ignored
    expect(deps.onPress).toHaveBeenCalledTimes(1);
    expect(deps.onPress).toHaveBeenCalledWith({
      id: NOTE_LASSO_DEFINE_BUTTON_ID,
    });
  });
});
