import {tryAcquire, release} from '../core/reentrancyGuard';
import type {DictLookup, LookupResult} from '../core/lookup';
import type {APIResponse, Logger} from '../sdk/types';
import {unwrap} from '../sdk/unwrap';
import {safeClosePluginView} from '../sdk/closeView';
import {t} from '../i18n/i18n';

// Narrow dependency interfaces (modeled after sn-formula/src/spike.ts).
// Letting the handler take SDK calls as deps keeps the module pure
// JS — testable without RN, without booting any turbomodule.

type Size = {width: number; height: number};

// Subset of LassoElementTypeNum we depend on. The button registers
// editDataTypes:[0] (stroke-family only), so we only see lassos
// containing strokes / titles / trail-links — the firmware filters
// out pure text-box lassos before our handler ever fires.
type LassoCounts = {
  // Freshly-drawn strokes that have not yet been linked to a
  // recognition result.
  trailNum: number;
  // Strokes that the firmware's background recognition has already
  // promoted to a "trail link" (typical for handwritten content
  // that has been on the page across saves / reloads).
  trailLinkNum: number;
  // Titles — strokes that the firmware recognised as a heading.
  titleNum: number;
};

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

export type FileAPILike = {
  getPageSize: (notePath: string, page: number) => Promise<APIResponse<Size>>;
};

export type DefineDeps = {
  comm: CommAPILike;
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

    const strokeLikeCount =
      counts.trailNum + counts.trailLinkNum + counts.titleNum;
    if (strokeLikeCount === 0) {
      deps.logger.warn(
        `[define] empty lasso — nothing to define (counts: trail=${counts.trailNum}, trailLink=${counts.trailLinkNum}, title=${counts.titleNum})`,
      );
      return 'empty-lasso';
    }

    const recognized = await ocrLassoedStrokes(deps);
    if (recognized.length === 0) {
      deps.logger.warn('[define:recognize] empty result');
      return 'recognize-empty';
    }
    const result = await deps.lookup.lookup(recognized);
    deps.showResult(result, `${t('popup.ocr')}: ${recognized}`);
    popupShown = true;

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
