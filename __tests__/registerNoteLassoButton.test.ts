import {
  registerNoteLassoButton,
  NOTE_LASSO_DEFINE_BUTTON_ID,
  NOTE_LASSO_DEFINE_TEXT_BUTTON_ID,
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

const callsOf = (deps: RegisterDeps) =>
  (deps.pluginManager.registerButton as jest.Mock).mock.calls;

describe('registerNoteLassoButton', () => {
  test('registers two lasso-toolbar buttons for NOTE: one stroke-only, one text-only', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    expect(deps.pluginManager.registerButton).toHaveBeenCalledTimes(2);
    const [strokeCall, textCall] = callsOf(deps);
    expect(strokeCall[0]).toBe(2);
    expect(strokeCall[1]).toEqual(['NOTE']);
    expect(strokeCall[2]).toMatchObject({
      id: NOTE_LASSO_DEFINE_BUTTON_ID,
      name: 'Lookup',
      enable: true,
      editDataTypes: [0],
    });
    expect(textCall[0]).toBe(2);
    expect(textCall[1]).toEqual(['NOTE']);
    expect(textCall[2]).toMatchObject({
      id: NOTE_LASSO_DEFINE_TEXT_BUTTON_ID,
      name: 'Lookup',
      enable: true,
      editDataTypes: [3],
    });
  });

  test('the two button ids are distinct (firmware requires plugin-local uniqueness)', () => {
    expect(NOTE_LASSO_DEFINE_BUTTON_ID).not.toBe(NOTE_LASSO_DEFINE_TEXT_BUTTON_ID);
  });

  test('both buttons declare the popup-region UI hints', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    for (const call of callsOf(deps)) {
      const button = call[2];
      expect(button.showType).toBe(1);
      expect(button.regionType).toBe(1);
      expect(button.regionWidth).toBeGreaterThan(0);
      expect(button.regionHeight).toBeGreaterThan(0);
    }
  });

  test('both buttons share the same icon URI from getPluginDirPath()', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    const calls = callsOf(deps);
    expect(calls[0][2].icon).toBe('file:///data/plugins/sn-dict/icon.png');
    expect(calls[1][2].icon).toBe(calls[0][2].icon);
  });

  test('falls back to empty icon when plugin dir is unavailable', async () => {
    const deps = buildDeps({
      pluginManager: {
        ...buildDeps().pluginManager,
        getPluginDirPath: jest.fn(async () => null),
      },
    });
    await registerNoteLassoButton(deps);
    for (const call of callsOf(deps)) {
      expect(call[2].icon).toBe('');
    }
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  test('listener forwards events for either Lookup button id, ignores anything else', async () => {
    const deps = buildDeps();
    await registerNoteLassoButton(deps);
    const listener = deps.capturedListener();
    expect(listener).toBeDefined();
    listener!.onButtonPress({id: NOTE_LASSO_DEFINE_BUTTON_ID});
    listener!.onButtonPress({id: NOTE_LASSO_DEFINE_TEXT_BUTTON_ID});
    listener!.onButtonPress({id: 999});
    listener!.onButtonPress({id: 200}); // DOC button id — must be ignored
    expect(deps.onPress).toHaveBeenCalledTimes(2);
    expect(deps.onPress).toHaveBeenNthCalledWith(1, {
      id: NOTE_LASSO_DEFINE_BUTTON_ID,
    });
    expect(deps.onPress).toHaveBeenNthCalledWith(2, {
      id: NOTE_LASSO_DEFINE_TEXT_BUTTON_ID,
    });
  });
});
