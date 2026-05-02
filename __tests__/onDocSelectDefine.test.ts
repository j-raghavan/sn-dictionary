import {
  onDocSelectDefine,
  type DocDefineDeps,
} from '../src/handlers/onDocSelectDefine';
import {release, tryAcquire} from '../src/core/reentrancyGuard';
import type {LookupResult} from '../src/core/lookup';

const ok = <T>(result: T) => ({success: true, result});
const fail = (message: string) => ({
  success: false,
  error: {code: 1, message},
});

const buildDeps = (
  overrides: Partial<DocDefineDeps> = {},
): DocDefineDeps => {
  const lookupResult: LookupResult = {
    queriedFor: 'hello',
    hits: [{source: 'WordNet', entry: {word: 'hello', definition: 'a greeting'}}],
    loading: [],
  };
  return {
    doc: {
      getLastSelectedText: jest.fn(async () => ok('hello')),
    },
    comm: {
      closePluginView: jest.fn(async () => true),
    },
    lookup: {
      lookup: jest.fn(async () => lookupResult),
    },
    showResult: jest.fn(),
    logger: {log: jest.fn(), warn: jest.fn(), error: jest.fn()},
    ...overrides,
  };
};

beforeEach(() => {
  release();
  jest.clearAllMocks();
});

describe('onDocSelectDefine', () => {
  test('happy path: getLastSelectedText → lookup → showResult (no closePluginView — popup owns close)', async () => {
    const deps = buildDeps();
    const outcome = await onDocSelectDefine(deps);
    expect(outcome).toBe('ok');
    expect(deps.doc.getLastSelectedText).toHaveBeenCalledTimes(1);
    expect(deps.lookup.lookup).toHaveBeenCalledWith('hello', expect.any(Function));
    expect(deps.showResult).toHaveBeenCalledTimes(1);
    expect(deps.showResult).toHaveBeenCalledWith(
      expect.objectContaining({hits: expect.arrayContaining([expect.anything()])}),
    );
    expect(deps.comm.closePluginView).not.toHaveBeenCalled();
  });

  test('trims whitespace before passing to lookup', async () => {
    const deps = buildDeps({
      doc: {
        getLastSelectedText: jest.fn(async () => ok('  hello   ')),
      },
    });
    await onDocSelectDefine(deps);
    expect(deps.lookup.lookup).toHaveBeenCalledWith('hello', expect.any(Function));
  });

  test('empty selection: returns no-selection and still closes plugin view', async () => {
    const deps = buildDeps({
      doc: {
        getLastSelectedText: jest.fn(async () => ok('   ')),
      },
    });
    const outcome = await onDocSelectDefine(deps);
    expect(outcome).toBe('no-selection');
    expect(deps.lookup.lookup).not.toHaveBeenCalled();
    expect(deps.comm.closePluginView).toHaveBeenCalled();
  });

  test('reentrancy: when guard is busy, returns busy and closes view without calling SDK', async () => {
    expect(tryAcquire()).toBe(true);
    const deps = buildDeps();
    const outcome = await onDocSelectDefine(deps);
    expect(outcome).toBe('busy');
    expect(deps.doc.getLastSelectedText).not.toHaveBeenCalled();
    expect(deps.lookup.lookup).not.toHaveBeenCalled();
    expect(deps.comm.closePluginView).toHaveBeenCalled();
  });

  test('SDK failure: returns failed, releases guard, closes view', async () => {
    const deps = buildDeps({
      doc: {
        getLastSelectedText: jest.fn(async () => fail('boom')),
      },
    });
    const outcome = await onDocSelectDefine(deps);
    expect(outcome).toBe('failed');
    expect(deps.comm.closePluginView).toHaveBeenCalled();

    // Subsequent call must succeed (guard was released).
    const next = buildDeps();
    expect(await onDocSelectDefine(next)).toBe('ok');
  });

  test('streaming progress: showResult fires per snapshot emission and once for the final result', async () => {
    // The streaming variant of lookup() invokes the onUpdate callback
    // for the initial empty snapshot and after each source resolves.
    // The handler must forward every snapshot to showResult so the
    // popup renders incrementally instead of waiting for the slowest
    // source.
    const initialSnapshot: LookupResult = {
      queriedFor: 'hello',
      hits: [],
      loading: ['UserA', 'WordNet'],
    };
    const finalSnapshot: LookupResult = {
      queriedFor: 'hello',
      hits: [{source: 'WordNet', entry: {word: 'hello', definition: 'a greeting'}}],
      loading: [],
    };
    const lookup = jest.fn(
      async (
        _t: string,
        onUpdate?: (snap: LookupResult) => void,
      ): Promise<LookupResult> => {
        onUpdate?.(initialSnapshot);
        onUpdate?.(finalSnapshot);
        return finalSnapshot;
      },
    );
    const deps = buildDeps({lookup: {lookup}});
    const outcome = await onDocSelectDefine(deps);
    expect(outcome).toBe('ok');
    expect(deps.showResult).toHaveBeenCalledTimes(3);
    expect((deps.showResult as jest.Mock).mock.calls[0][0]).toEqual(initialSnapshot);
    expect((deps.showResult as jest.Mock).mock.calls[1][0]).toEqual(finalSnapshot);
    expect((deps.showResult as jest.Mock).mock.calls[2][0]).toEqual(finalSnapshot);
    expect(deps.comm.closePluginView).not.toHaveBeenCalled();
  });

  test('lookup throws WITHOUT emitting any snapshot: outcome is failed and view is closed', async () => {
    // Defensive path: a custom DictLookup impl that throws before
    // calling onUpdate must not leave popupShown=true (which would
    // skip closePluginView in the finally and leak the host overlay).
    const lookup = jest.fn(async (): Promise<LookupResult> => {
      throw new Error('lookup boom');
    });
    const deps = buildDeps({lookup: {lookup}});
    const outcome = await onDocSelectDefine(deps);
    expect(outcome).toBe('failed');
    expect(deps.showResult).not.toHaveBeenCalled();
    expect(deps.comm.closePluginView).toHaveBeenCalled();
  });
});
