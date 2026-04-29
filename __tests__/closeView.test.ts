import {safeClosePluginView} from '../src/sdk/closeView';

describe('safeClosePluginView', () => {
  test('awaits closePluginView on the happy path', async () => {
    const close = jest.fn(async () => true);
    const warn = jest.fn();
    await safeClosePluginView({closePluginView: close}, {warn});
    expect(close).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('catches a thrown error and warns instead of propagating', async () => {
    const close = jest.fn(async () => {
      throw new Error('boom');
    });
    const warn = jest.fn();
    await expect(
      safeClosePluginView({closePluginView: close}, {warn}),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/closePluginView threw: boom/);
  });
});
