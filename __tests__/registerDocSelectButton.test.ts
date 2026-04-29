import {
  registerDocSelectButton,
  DOC_SELECT_DEFINE_BUTTON_ID,
  type RegisterDocDeps,
  type ButtonListener,
} from '../src/buttons/registerDocSelectButton';

const buildDeps = (
  overrides: Partial<RegisterDocDeps> = {},
): RegisterDocDeps & {capturedListener: () => ButtonListener | undefined} => {
  let captured: ButtonListener | undefined;
  const deps: RegisterDocDeps = {
    pluginManager: {
      registerButton: jest.fn(async () => true),
      registerButtonListener: jest.fn((l: ButtonListener) => {
        captured = l;
        return {id: 1};
      }),
      getPluginDirPath: jest.fn(async () => '/data/plugins/sn-dict'),
    },
    onPress: jest.fn(),
    logger: {warn: jest.fn()},
    ...overrides,
  };
  return Object.assign(deps, {capturedListener: () => captured});
};

describe('registerDocSelectButton', () => {
  test('registers a type:3 selection-toolbar button for DOC', async () => {
    const deps = buildDeps();
    await registerDocSelectButton(deps);
    expect(deps.pluginManager.registerButton).toHaveBeenCalledTimes(1);
    const [type, appTypes, button] = (
      deps.pluginManager.registerButton as jest.Mock
    ).mock.calls[0];
    expect(type).toBe(3);
    expect(appTypes).toEqual(['DOC']);
    expect(button).toMatchObject({
      id: DOC_SELECT_DEFINE_BUTTON_ID,
      name: 'Define',
      enable: true,
    });
  });

  test('does not include editDataTypes (those are a type:2/lasso concept only)', async () => {
    const deps = buildDeps();
    await registerDocSelectButton(deps);
    const button = (deps.pluginManager.registerButton as jest.Mock).mock
      .calls[0][2];
    expect(button.editDataTypes).toBeUndefined();
  });

  test('button declares the popup-region UI hints (defensive double-set)', async () => {
    const deps = buildDeps();
    await registerDocSelectButton(deps);
    const button = (deps.pluginManager.registerButton as jest.Mock).mock
      .calls[0][2];
    expect(button.showType).toBe(1);
    expect(button.regionType).toBe(1);
    expect(button.regionWidth).toBeGreaterThan(0);
    expect(button.regionHeight).toBeGreaterThan(0);
  });

  test('icon URI is built from getPluginDirPath()', async () => {
    const deps = buildDeps();
    await registerDocSelectButton(deps);
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
    await registerDocSelectButton(deps);
    const button = (deps.pluginManager.registerButton as jest.Mock).mock
      .calls[0][2];
    expect(button.icon).toBe('');
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  test('listener forwards events for the DOC Define button only', async () => {
    const deps = buildDeps();
    await registerDocSelectButton(deps);
    const listener = deps.capturedListener();
    expect(listener).toBeDefined();
    listener!.onButtonPress({id: DOC_SELECT_DEFINE_BUTTON_ID});
    listener!.onButtonPress({id: 999});
    listener!.onButtonPress({id: 100}); // NOTE lasso button id — must be ignored
    expect(deps.onPress).toHaveBeenCalledTimes(1);
    expect(deps.onPress).toHaveBeenCalledWith({
      id: DOC_SELECT_DEFINE_BUTTON_ID,
    });
  });
});
