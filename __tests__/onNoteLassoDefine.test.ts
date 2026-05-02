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
    queriedFor: 'hello',
    hits: [{source: 'WordNet', entry: {word: 'hello', definition: 'a greeting'}}],
    loading: [],
  };
  const showResult = jest.fn();

  const view = {
    closePluginView: jest.fn(async () => {
      calls.push('closePluginView');
      return true;
    }),
  };
  const showRecognizing = jest.fn();
  const hidePopup = jest.fn();
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
    },
    view,
    file: {
      getPageSize: jest.fn(async () => {
        calls.push('getPageSize');
        return ok({width: 1404, height: 1872});
      }),
    },
    lookup: {
      lookup: jest.fn(async () => lookupResult),
    },
    showRecognizing,
    showResult,
    hidePopup,
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
    expect(deps.comm.setLassoBoxState).toHaveBeenCalledWith(2);
    expect(deps.view.closePluginView).not.toHaveBeenCalled();
    expect(deps.lookup.lookup).toHaveBeenCalledWith('hello', expect.any(Function));
    // Tests run with the en locale, so the OCR-prefix label
    // resolves to "OCR: hello"; in other locales the prefix is
    // localised (e.g. zh_CN -> "识别: hello").
    expect(deps.showResult).toHaveBeenCalledWith(
      expect.objectContaining({hits: expect.arrayContaining([expect.anything()])}),
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
    expect(deps.lookup.lookup).toHaveBeenCalledWith('hello', expect.any(Function));
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

  test('empty lasso (all stroke-family counts = 0): returns empty-lasso, releases lasso box, and closes plugin view', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElementTypeCounts: jest.fn(async () => ok(counts())),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('empty-lasso');
    expect(deps.comm.setLassoBoxState).toHaveBeenCalledWith(2);
    expect(deps.view.closePluginView).toHaveBeenCalled();
    expect(deps.lookup.lookup).not.toHaveBeenCalled();
  });

  test('reentrancy: when guard is busy, returns busy and closes view without running pipeline or touching lasso state', async () => {
    expect(tryAcquire()).toBe(true);
    const deps = buildDeps();
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('busy');
    expect(deps.view.closePluginView).toHaveBeenCalled();
    // The first (in-flight) invocation owns the lasso state and will
    // release it in its own finally. The reentrant tap must not
    // race-release on top of that.
    expect(deps.comm.setLassoBoxState).not.toHaveBeenCalled();
    expect(deps.comm.getLassoElementTypeCounts).not.toHaveBeenCalled();
    expect(deps.lookup.lookup).not.toHaveBeenCalled();
  });

  test('returns recognize-empty when OCR yields an empty string and releases lasso box', async () => {
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
    expect(deps.comm.setLassoBoxState).toHaveBeenCalledWith(2);
    expect(deps.view.closePluginView).toHaveBeenCalled();
  });

  test('returns recognize-empty when OCR yields whitespace only ("  \\n  ") and releases lasso box', async () => {
    // Regression: previously `.length === 0` only caught the literal
    // empty string and let " \n " through to lookup, which trimmed
    // it internally and surfaced a misleading "not found" popup.
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        recognizeElements: jest.fn(async () => ok('  \n\t ')),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('recognize-empty');
    expect(deps.lookup.lookup).not.toHaveBeenCalled();
    expect(deps.showResult).not.toHaveBeenCalled();
    expect(deps.comm.setLassoBoxState).toHaveBeenCalledWith(2);
    expect(deps.view.closePluginView).toHaveBeenCalled();
  });

  test('trims surrounding whitespace from OCR output before lookup and OCR label', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        recognizeElements: jest.fn(async () => ok('  hello\n')),
      } as DefineDeps['comm'],
    });
    await onNoteLassoDefine(deps);
    expect(deps.lookup.lookup).toHaveBeenCalledWith('hello', expect.any(Function));
    // OCR label uses the trimmed text too — popup doesn't show
    // "OCR:   hello\n".
    expect(deps.showResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^.+: hello$/),
    );
  });

  test('reentrancy flag is released even on pipeline crash, and lasso box is released', async () => {
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
    expect(deps.comm.setLassoBoxState).toHaveBeenCalledWith(2);
    expect(deps.view.closePluginView).toHaveBeenCalled();

    const next = buildDeps();
    expect(await onNoteLassoDefine(next)).toBe('ok');
  });

  test('lasso box release tolerates setLassoBoxState throwing — outcome is preserved and view still closes', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        recognizeElements: jest.fn(async () => ok('')),
        setLassoBoxState: jest.fn(async () => {
          throw new Error('host bridge gone');
        }),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('recognize-empty');
    expect(deps.comm.setLassoBoxState).toHaveBeenCalledWith(2);
    expect(deps.view.closePluginView).toHaveBeenCalled();
  });

  test('lasso box release tolerates setLassoBoxState returning success=false', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        setLassoBoxState: jest.fn(async () => fail('already cleared')),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('ok');
    expect(deps.comm.setLassoBoxState).toHaveBeenCalledWith(2);
  });

  test('streaming progress: showResult fires per snapshot emission and once for the final result', async () => {
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
    const deps = buildDeps({
      lookup: {
        lookup: jest.fn(
          async (
            _t: string,
            onUpdate?: (snap: LookupResult) => void,
          ): Promise<LookupResult> => {
            onUpdate?.(initialSnapshot);
            onUpdate?.(finalSnapshot);
            return finalSnapshot;
          },
        ),
      },
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('ok');
    expect(deps.showResult).toHaveBeenCalledTimes(3);
    expect((deps.showResult as jest.Mock).mock.calls[0][0]).toEqual(initialSnapshot);
    expect((deps.showResult as jest.Mock).mock.calls[1][0]).toEqual(finalSnapshot);
    expect((deps.showResult as jest.Mock).mock.calls[2][0]).toEqual(finalSnapshot);
    expect(deps.view.closePluginView).not.toHaveBeenCalled();
  });

  test('opens the "Recognizing…" popup BEFORE OCR runs, ahead of any showResult call', async () => {
    // Tap-to-popup speedup: the user must see feedback within
    // hundreds of ms, not the 5–8 s the firmware needs to marshal
    // strokes + run OCR. Verifies showRecognizing fires before the
    // SDK round-trips kick off.
    const callSequence: string[] = [];
    const baseComm = buildDeps().comm;
    const deps = buildDeps({
      comm: {
        ...baseComm,
        getLassoElements: jest.fn(async () => {
          callSequence.push('getLassoElements');
          return ok([{}]);
        }),
        recognizeElements: jest.fn(async () => {
          callSequence.push('recognizeElements');
          return ok('hello');
        }),
      } as DefineDeps['comm'],
      showRecognizing: jest.fn(() => callSequence.push('showRecognizing')),
      showResult: jest.fn(() => callSequence.push('showResult')),
    });
    await onNoteLassoDefine(deps);
    expect(callSequence[0]).toBe('showRecognizing');
    expect(callSequence.indexOf('showRecognizing')).toBeLessThan(
      callSequence.indexOf('getLassoElements'),
    );
    expect(callSequence.indexOf('showRecognizing')).toBeLessThan(
      callSequence.indexOf('recognizeElements'),
    );
  });

  test('parallelises getLassoElements + getCurrentFilePath + getCurrentPageNum (concurrent SDK calls)', async () => {
    // Without parallelisation the three independent SDK calls cost
    // ~1 s each and stack ~3 s onto tap-to-popup. Promise.all over
    // them shaves that down. The test verifies they're started
    // concurrently — each call records its start, and we assert the
    // start times overlap rather than serialising.
    let lassoStarted = -1;
    let pathStarted = -1;
    let pageNumStarted = -1;
    let lassoResolve!: () => void;
    let pathResolve!: () => void;
    let pageNumResolve!: () => void;
    const lassoP = new Promise<{success: true; result: Object[]}>(r => {
      lassoResolve = () => r({success: true, result: [{}]});
    });
    const pathP = new Promise<{success: true; result: string}>(r => {
      pathResolve = () => r({success: true, result: '/notes/x.note'});
    });
    const pageNumP = new Promise<{success: true; result: number}>(r => {
      pageNumResolve = () => r({success: true, result: 0});
    });
    let counter = 0;
    const baseComm = buildDeps().comm;
    const deps = buildDeps({
      comm: {
        ...baseComm,
        getLassoElements: jest.fn(() => {
          lassoStarted = counter++;
          return lassoP;
        }),
        getCurrentFilePath: jest.fn(() => {
          pathStarted = counter++;
          return pathP;
        }),
        getCurrentPageNum: jest.fn(() => {
          pageNumStarted = counter++;
          return pageNumP;
        }),
      } as DefineDeps['comm'],
    });
    const outcome = onNoteLassoDefine(deps);
    // All three should have been started before any has resolved.
    await Promise.resolve(); // microtask flush
    expect(lassoStarted).toBeGreaterThanOrEqual(0);
    expect(pathStarted).toBeGreaterThanOrEqual(0);
    expect(pageNumStarted).toBeGreaterThanOrEqual(0);
    // Now resolve them and let the handler complete.
    lassoResolve();
    pathResolve();
    pageNumResolve();
    expect(await outcome).toBe('ok');
  });

  test('hides the Recognizing popup on recognize-empty so the host overlay can close', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        recognizeElements: jest.fn(async () => ok('')),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('recognize-empty');
    expect(deps.showRecognizing).toHaveBeenCalled();
    expect(deps.hidePopup).toHaveBeenCalled();
    expect(deps.view.closePluginView).toHaveBeenCalled();
  });

  test('hides the Recognizing popup on a pipeline crash', async () => {
    const deps = buildDeps({
      comm: {
        ...buildDeps().comm,
        getLassoElements: jest.fn(async () => {
          throw new Error('lasso fetch boom');
        }),
      } as DefineDeps['comm'],
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('failed');
    expect(deps.showRecognizing).toHaveBeenCalled();
    expect(deps.hidePopup).toHaveBeenCalled();
    expect(deps.view.closePluginView).toHaveBeenCalled();
  });

  test('lookup throws WITHOUT emitting any snapshot: outcome is failed and view is closed', async () => {
    const deps = buildDeps({
      lookup: {
        lookup: jest.fn(async (): Promise<LookupResult> => {
          throw new Error('lookup boom');
        }),
      },
    });
    const outcome = await onNoteLassoDefine(deps);
    expect(outcome).toBe('failed');
    expect(deps.showResult).not.toHaveBeenCalled();
    expect(deps.view.closePluginView).toHaveBeenCalled();
  });
});
