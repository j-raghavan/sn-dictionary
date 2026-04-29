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
  normalTextBoxNum: 0,
  digestTextBoxNum: 0,
  digestTextBoxEditableNum: 0,
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
    note: {
      getLassoText: jest.fn(async () => {
        calls.push('getLassoText');
        return ok([{textContentFull: 'world'}]);
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
  test('stroke path: counts → elements → page-info → recognize → lookup → setLassoBoxState → closePluginView', async () => {
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
      'closePluginView',
    ]);
    expect(deps.lookup.lookup).toHaveBeenCalledWith('hello');
    expect(deps.showResult).toHaveBeenCalledWith(
      expect.objectContaining({found: true}),
      'OCR: hello',
    );
  });

  test('does not call deleteLassoElements (dictionary lookup is non-destructive)', async () => {
    const deps = buildDeps();
    expect((deps.comm as Record<string, unknown>).deleteLassoElements).toBeUndefined();
    await onNoteLassoDefine(deps);
  });

  test('text path: counts → getLassoText → lookup → setLassoBoxState → closePluginView, no recognize', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () =>
          ok(counts({normalTextBoxNum: 1})),
        ),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('ok');
    expect(deps.note.getLassoText).toHaveBeenCalled();
    expect(deps.comm.recognizeElements).not.toHaveBeenCalled();
    expect(deps.lookup.lookup).toHaveBeenCalledWith('world');
    expect(deps.showResult).toHaveBeenCalledTimes(1);
    expect(deps.showResult).toHaveBeenCalledWith(
      expect.objectContaining({found: true}),
    );
  });

  test('strokes win when both strokes and text are lassoed', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () =>
          ok(counts({trailNum: 1, normalTextBoxNum: 1})),
        ),
      } as DefineDeps['comm'],
    });
    await onNoteLassoDefine(deps);
    expect(deps.comm.recognizeElements).toHaveBeenCalled();
    expect(deps.note.getLassoText).not.toHaveBeenCalled();
  });

  test('empty lasso: returns empty-lasso outcome and still closes plugin view', async () => {
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
    // Simulate an in-flight pipeline by holding the module-level guard
    // directly. This avoids simulating real concurrent awaits and the
    // microtask-ordering pitfalls that come with it.
    expect(tryAcquire()).toBe(true);

    const deps = buildDeps();
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('busy');
    expect(deps.comm.closePluginView).toHaveBeenCalled();
    expect(deps.comm.getLassoElementTypeCounts).not.toHaveBeenCalled();
    expect(deps.lookup.lookup).not.toHaveBeenCalled();
  });

  test('stroke path: returns recognize-empty when OCR yields an empty string', async () => {
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

  test('text path: returns recognize-empty when textBox content is blank', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () =>
          ok(counts({normalTextBoxNum: 1})),
        ),
      } as DefineDeps['comm'],
      note: {
        getLassoText: jest.fn(async () => ok([{textContentFull: '   '}])),
      },
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('recognize-empty');
    expect(deps.lookup.lookup).not.toHaveBeenCalled();
    expect(deps.showResult).not.toHaveBeenCalled();
    expect(deps.comm.closePluginView).toHaveBeenCalled();
  });

  test('text path: textContentFull=null is treated as empty', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () =>
          ok(counts({normalTextBoxNum: 1})),
        ),
      } as DefineDeps['comm'],
      note: {
        getLassoText: jest.fn(async () => ok([{textContentFull: null}])),
      },
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('recognize-empty');
  });

  test('text path: digestTextBoxNum > 0 also routes to text branch', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () =>
          ok(counts({digestTextBoxNum: 1})),
        ),
      } as DefineDeps['comm'],
    });
    await onNoteLassoDefine(deps);
    expect(deps.note.getLassoText).toHaveBeenCalled();
  });

  test('text path: digestTextBoxEditableNum > 0 also routes to text branch', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () =>
          ok(counts({digestTextBoxEditableNum: 1})),
        ),
      } as DefineDeps['comm'],
    });
    await onNoteLassoDefine(deps);
    expect(deps.note.getLassoText).toHaveBeenCalled();
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

    // Subsequent call must succeed (flag was released).
    const next = buildDeps();
    expect(await onNoteLassoDefine(next)).toBe('ok');
  });
});
