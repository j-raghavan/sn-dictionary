import {tryAcquire, release} from '../core/reentrancyGuard';
import type {DictLookup, LookupResult} from '../core/lookup';
import type {APIResponse, Logger} from '../sdk/types';
import {unwrap} from '../sdk/unwrap';
import {safeClosePluginView} from '../sdk/closeView';

// Narrow dependency interfaces (modeled after sn-formula/src/spike.ts).
// Letting the handler take SDK calls as deps keeps the module pure
// JS — testable without RN, without booting any turbomodule.

type Size = {width: number; height: number};

type LassoCounts = {
  trailNum: number;
  normalTextBoxNum: number;
  digestTextBoxNum: number;
  digestTextBoxEditableNum: number;
};

type TextBox = {textContentFull: string | null};

export type CommAPILike = {
  getLassoElementTypeCounts: () => Promise<APIResponse<LassoCounts>>;
  getLassoElements: () => Promise<APIResponse<Object[]>>;
  getCurrentFilePath: () => Promise<APIResponse<string>>;
  getCurrentPageNum: () => Promise<APIResponse<number>>;
  recognizeElements: (
    elements: Object[],
    size: Size,
  ) => Promise<APIResponse<string>>;
  setLassoBoxState: (state: number) => Promise<APIResponse<boolean>>;
  closePluginView: () => Promise<boolean>;
};

export type NoteAPILike = {
  getLassoText: () => Promise<APIResponse<TextBox[]>>;
};

export type FileAPILike = {
  getPageSize: (notePath: string, page: number) => Promise<APIResponse<Size>>;
};

export type DefineDeps = {
  comm: CommAPILike;
  note: NoteAPILike;
  file: FileAPILike;
  lookup: DictLookup;
  showResult: (result: LookupResult, ocrLabel?: string) => void;
  logger: Logger;
};

export type DefineOutcome =
  | 'ok'
  | 'busy'
  | 'empty-lasso'
  | 'recognize-empty'
  | 'failed';

const ocrLassoedStrokes = async (deps: DefineDeps): Promise<string> => {
  const elements = unwrap(
    await deps.comm.getLassoElements(),
    'getLassoElements',
  );
  // recognizeElements expects the *page* size, not the lasso rect — see
  // sn-formula/src/spike.ts:243-251 (logcat: IllegalArgumentException
  // getRealMaxX, unknown pageSize).
  const notePath = unwrap(
    await deps.comm.getCurrentFilePath(),
    'getCurrentFilePath',
  );
  const pageNum = unwrap(
    await deps.comm.getCurrentPageNum(),
    'getCurrentPageNum',
  );
  const pageSize = unwrap(
    await deps.file.getPageSize(notePath, pageNum),
    'getPageSize',
  );
  // No deleteLassoElements: dictionary lookup is non-destructive — we
  // want the user's strokes to remain on the page after lookup.
  const recognized = unwrap(
    await deps.comm.recognizeElements(elements, pageSize),
    'recognizeElements',
  );
  return recognized;
};

const readLassoedText = async (deps: DefineDeps): Promise<string> => {
  const boxes = unwrap(await deps.note.getLassoText(), 'getLassoText');
  return boxes
    .map(b => b.textContentFull ?? '')
    .join(' ')
    .trim();
};

export const onNoteLassoDefine = async (
  deps: DefineDeps,
): Promise<DefineOutcome> => {
  // The host has already added its overlay window for this tap. Even on
  // the early-exit path we must release that window or the device hangs
  // (sn-formula/src/spike.ts:419-426).
  if (!tryAcquire()) {
    deps.logger.warn('[define] pipeline already running — ignoring re-entry');
    await safeClosePluginView(deps.comm, deps.logger);
    return 'busy';
  }

  // When we successfully render the popup, the firmware overlay must
  // STAY OPEN until the user dismisses the popup. Closing the view
  // here while the popup is still on-screen leaves the host's input
  // channel in a bad state — pen taps land nowhere afterwards. The
  // popup's Close button calls PluginManager.closePluginView() itself
  // (matching the sn-shapes / sn-mindmap pattern). On every other
  // exit path we close in the finally block.
  let popupShown = false;

  try {
    const counts = unwrap(
      await deps.comm.getLassoElementTypeCounts(),
      'getLassoElementTypeCounts',
    );

    // Strokes win over text boxes when both are lassoed: the user
    // clearly wants OCR, otherwise they would have lassoed only text.
    if (counts.trailNum > 0) {
      const recognized = await ocrLassoedStrokes(deps);
      if (recognized.length === 0) {
        deps.logger.warn('[define:recognize] empty result');
        return 'recognize-empty';
      }
      const result = await deps.lookup.lookup(recognized);
      deps.showResult(result, `OCR: ${recognized}`);
      popupShown = true;
    } else if (
      counts.normalTextBoxNum > 0 ||
      counts.digestTextBoxNum > 0 ||
      counts.digestTextBoxEditableNum > 0
    ) {
      const text = await readLassoedText(deps);
      if (text.length === 0) {
        deps.logger.warn('[define:text] empty result');
        return 'recognize-empty';
      }
      const result = await deps.lookup.lookup(text);
      deps.showResult(result);
      popupShown = true;
    } else {
      deps.logger.warn('[define] empty lasso — nothing to define');
      return 'empty-lasso';
    }

    // Release the lasso state inline on the success path. Skipping
    // this leaves the gesture chain dangling and the device hangs
    // (sn-formula/src/spike.ts:329-335).
    await deps.comm.setLassoBoxState(2);
    return 'ok';
  } catch (e) {
    deps.logger.error(`[define] pipeline crashed: ${(e as Error).message}`);
    return 'failed';
  } finally {
    // Clear the reentrancy flag SYNCHRONOUSLY before awaiting
    // anything. If we cleared it after the await, the host's
    // state:stop transition can suspend the JS context and the
    // assignment may never run — see sn-formula/src/spike.ts:438-446.
    release();
    if (!popupShown) {
      await safeClosePluginView(deps.comm, deps.logger);
    }
  }
};
