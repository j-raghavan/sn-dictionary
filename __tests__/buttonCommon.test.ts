import {resolveIconUri} from '../src/buttons/buttonCommon';

describe('resolveIconUri', () => {
  test('builds a file:// URI from getPluginDirPath', async () => {
    const mgr = {
      getPluginDirPath: jest.fn(async () => '/data/plugins/sn-dict'),
    };
    const warn = jest.fn();
    const uri = await resolveIconUri(mgr, {warn}, 'tag');
    expect(uri).toBe('file:///data/plugins/sn-dict/icon.png');
    expect(warn).not.toHaveBeenCalled();
  });

  test('returns empty string and warns when plugin dir is null', async () => {
    const mgr = {getPluginDirPath: jest.fn(async () => null)};
    const warn = jest.fn();
    const uri = await resolveIconUri(mgr, {warn}, 'tag');
    expect(uri).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/\[tag:icon\]/);
  });

  test('returns empty string and warns twice when getPluginDirPath throws', async () => {
    // First warn on the catch, second warn on the empty-uri fallback.
    const mgr = {
      getPluginDirPath: jest.fn(async () => {
        throw new Error('boom');
      }),
    };
    const warn = jest.fn();
    const uri = await resolveIconUri(mgr, {warn}, 'tag');
    expect(uri).toBe('');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatch(/getPluginDirPath threw: boom/);
    expect(warn.mock.calls[1][0]).toMatch(/no plugin dir available/);
  });
});
