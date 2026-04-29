import {
  onNoteLassoDefine,
  type DefineDeps,
} from '../src/handlers/onNoteLassoDefine';
import {release, tryAcquire} from '../src/core/reentrancyGuard';
import type {LookupResult} from '../src/core/lookup';

const ok = <T>(result: T) => ({success: true, result});
const fail = (message: string) => ({
  success: false,
  error: {code: 1, message},
});

const counts = (overrides: Partial<Record<string, number>> = {}) => ({
  trailNum: 0,
  trailLinkNum: 0,
  titleNum: 0,
  ...overrides,
});

const buildDeps = (overrides: Partial<DefineDeps> = {}): DefineDeps => {
  const calls: string[] = [];
  const lookupResult: LookupResult = {
    found: true,
    entry: {word: 'hello', definition: 'a greeting'},
  };
  const showResult = jest.fn();

  const deps: DefineDeps = {
    comm: {
      getLassoElementTypeCounts: jest.fn(async () => {
        calls.push('getLassoElementTypeCounts');
        return ok(counts({trailNum: 1}));
      }),
      getLassoElements: jest.fn(async () => {
        calls.push('getLassoElements');
        return ok([{}]);
      }),
      getCurrentFilePath: jest.fn(async () => {
        calls.push('getCurrentFilePath');
        return ok('/notes/x.note');
      }),
      getCurrentPageNum: jest.fn(async () => {
        calls.push('getCurrentPageNum');
        return ok(0);
      }),
      recognizeElements: jest.fn(async () => {
        calls.push('recognizeElements');
        return ok('hello');
      }),
      setLassoBoxState: jest.fn(async () => {
        calls.push('setLassoBoxState');
        return ok(true);
      }),
      closePluginView: jest.fn(async () => {
        calls.push('closePluginView');
        return true;
      }),
    },
    file: {
      getPageSize: jest.fn(async () => {
        calls.push('getPageSize');
        return ok({width: 1404, height: 1872});
      }),
    },
    lookup: {
      lookup: jest.fn(async () => lookupResult),
    },
    showResult,
    logger: {log: jest.fn(), warn: jest.fn(), error: jest.fn()},
    ...overrides,
  };

  (deps as DefineDeps & {__calls: string[]}).__calls = calls;
  return deps;
};

beforeEach(() => {
  release();
  jest.clearAllMocks();
});

describe('onNoteLassoDefine', () => {
  test('fresh-stroke path: counts → elements → page-info → recognize → lookup → setLassoBoxState (no closePluginView — popup owns close)', async () => {
    const deps = buildDeps();
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('ok');
    const calls = (deps as DefineDeps & {__calls: string[]}).__calls;
    expect(calls).toEqual([
      'getLassoElementTypeCounts',
      'getLassoElements',
      'getCurrentFilePath',
      'getCurrentPageNum',
      'getPageSize',
      'recognizeElements',
      'setLassoBoxState',
    ]);
    expect(deps.comm.closePluginView).not.toHaveBeenCalled();
    expect(deps.lookup.lookup).toHaveBeenCalledWith('hello');
    // Tests run with the en locale, so the OCR-prefix label
    // resolves to "OCR: hello"; in other locales the prefix is
    // localised (e.g. zh_CN -> "识别: hello").
    expect(deps.showResult).toHaveBeenCalledWith(
      expect.objectContaining({found: true}),
      expect.stringMatching(/^.+: hello$/),
    );
  });

  test('does not call deleteLassoElements (dictionary lookup is non-destructive)', async () => {
    const deps = buildDeps();
    expect((deps.comm as Record<string, unknown>).deleteLassoElements).toBeUndefined();
    await onNoteLassoDefine(deps);
  });

  test('previously-recognized strokes (trailLinkNum > 0): same OCR path fires', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () =>
          ok(counts({trailLinkNum: 3})),
        ),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('ok');
    expect(deps.comm.recognizeElements).toHaveBeenCalled();
    expect(deps.lookup.lookup).toHaveBeenCalledWith('hello');
  });

  test('lassoed title (titleNum > 0): same OCR path fires', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () =>
          ok(counts({titleNum: 1})),
        ),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('ok');
    expect(deps.comm.recognizeElements).toHaveBeenCalled();
  });

  test('mixed counts (trailNum + trailLinkNum): single OCR path, no double-fire', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () =>
          ok(counts({trailNum: 2, trailLinkNum: 4})),
        ),
      } as DefineDeps['comm'],
    });
    await onNoteLassoDefine(deps);
    expect(deps.comm.recognizeElements).toHaveBeenCalledTimes(1);
  });

  test('empty lasso (all stroke-family counts = 0): returns empty-lasso and still closes plugin view', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () => ok(counts())),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('empty-lasso');
    expect(deps.comm.closePluginView).toHaveBeenCalled();
    expect(deps.lookup.lookup).not.toHaveBeenCalled();
  });

  test('reentrancy: when guard is busy, returns busy and closes view without running pipeline', async () => {
    expect(tryAcquire()).toBe(true);
    const deps = buildDeps();
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('busy');
    expect(deps.comm.closePluginView).toHaveBeenCalled();
    expect(deps.comm.getLassoElementTypeCounts).not.toHaveBeenCalled();
    expect(deps.lookup.lookup).not.toHaveBeenCalled();
  });

  test('returns recognize-empty when OCR yields an empty string', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        recognizeElements: jest.fn(async () => ok('')),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('recognize-empty');
    expect(deps.lookup.lookup).not.toHaveBeenCalled();
    expect(deps.showResult).not.toHaveBeenCalled();
    expect(deps.comm.closePluginView).toHaveBeenCalled();
  });

  test('reentrancy flag is released even on pipeline crash', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () =>
          fail('forced failure'),
        ),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('failed');
    expect(deps.comm.closePluginView).toHaveBeenCalled();

    const next = buildDeps();
    expect(await onNoteLassoDefine(next)).toBe('ok');
  });
});
