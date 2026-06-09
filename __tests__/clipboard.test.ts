// Contract test for the device-only clipboard wrapper. The module itself
// is coverage-EXCLUDED (it touches NativeModules, unbound off-device), but
// its "always resolves, never rejects" contract is exactly what
// DefinitionPopup's runCopy relies on to never crash — so pin it here
// against the REAL wrapper by mocking only react-native's NativeModules,
// rather than leaving the contract asserted solely by the popup's mock.

describe('native clipboard wrapper contract', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('resolves MODULE_MISSING when the native module is absent', async () => {
    jest.doMock('react-native', () => ({NativeModules: {}}));
    const {copyToClipboard} = require('../src/native/clipboard');
    await expect(copyToClipboard('hi')).resolves.toEqual({
      success: false,
      code: 'MODULE_MISSING',
      message: expect.any(String),
    });
  });

  test('resolves MODULE_MISSING when the module lacks copyToClipboard', async () => {
    jest.doMock('react-native', () => ({NativeModules: {SnDictClipboard: {}}}));
    const {copyToClipboard} = require('../src/native/clipboard');
    const result = await copyToClipboard('hi');
    expect(result.success).toBe(false);
    expect(result.code).toBe('MODULE_MISSING');
  });

  test('delegates to the native module and passes its result through', async () => {
    const native = jest.fn(async () => ({success: true, code: 'OK', message: 'ok'}));
    jest.doMock('react-native', () => ({
      NativeModules: {SnDictClipboard: {copyToClipboard: native}},
    }));
    const {copyToClipboard} = require('../src/native/clipboard');
    const result = await copyToClipboard('hello', 'MyLabel');
    expect(native).toHaveBeenCalledWith('hello', 'MyLabel');
    expect(result).toEqual({success: true, code: 'OK', message: 'ok'});
  });

  test('defaults the label to null when omitted', async () => {
    const native = jest.fn(async () => ({success: true, code: 'OK', message: ''}));
    jest.doMock('react-native', () => ({
      NativeModules: {SnDictClipboard: {copyToClipboard: native}},
    }));
    const {copyToClipboard} = require('../src/native/clipboard');
    await copyToClipboard('x');
    expect(native).toHaveBeenCalledWith('x', null);
  });
});
