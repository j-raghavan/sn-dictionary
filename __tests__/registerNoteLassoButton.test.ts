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
    },
    onPress: jest.fn(),
    logger: {warn: jest.fn()},
    ...overrides,
  };
  return Object.assign(deps, {capturedListener: () => captured});
};

describe('registerNoteLassoButton', () => {
  test('registers a lasso-toolbar button for NOTE with stroke and text editDataTypes', async () => {
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
      name: 'Lookup',
      enable: true,
      editDataTypes: [0, 3],
    });
  });

  test('button declares the popup-region UI hints (defensive double-set across SDK versions)', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    const button = (deps.pluginManager.registerButton as jest.Mock).mock
      .calls[0][2];
    // sn-shapes' proven older-SDK field
    expect(button.showType).toBe(1);
    // sn-plugin-lib 0.1.34 JSDoc field
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

  test('listener forwards events for the Define button only', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    const listener = deps.capturedListener();
    expect(listener).toBeDefined();
    listener!.onButtonPress({id: NOTE_LASSO_DEFINE_BUTTON_ID});
    listener!.onButtonPress({id: 999});
    expect(deps.onPress).toHaveBeenCalledTimes(1);
    expect(deps.onPress).toHaveBeenCalledWith({
      id: NOTE_LASSO_DEFINE_BUTTON_ID,
    });
  });
});
