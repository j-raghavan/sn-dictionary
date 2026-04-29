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
    found: true,
    entry: {word: 'hello', definition: 'a greeting'},
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
  test('happy path: getLastSelectedText → lookup → showResult → closePluginView', async () => {
    const deps = buildDeps();
    const outcome = await onDocSelectDefine(deps);
    expect(outcome).toBe('ok');
    expect(deps.doc.getLastSelectedText).toHaveBeenCalledTimes(1);
    expect(deps.lookup.lookup).toHaveBeenCalledWith('hello');
    expect(deps.showResult).toHaveBeenCalledTimes(1);
    expect(deps.showResult).toHaveBeenCalledWith(
      expect.objectContaining({found: true}),
    );
    expect(deps.comm.closePluginView).toHaveBeenCalledTimes(1);
  });

  test('trims whitespace before passing to lookup', async () => {
    const deps = buildDeps({
      doc: {
        getLastSelectedText: jest.fn(async () => ok('  hello   ')),
      },
    });
    await onDocSelectDefine(deps);
    expect(deps.lookup.lookup).toHaveBeenCalledWith('hello');
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
});
