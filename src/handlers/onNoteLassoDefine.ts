import {tryAcquire, release} from '../core/reentrancyGuard';
import type {DictLookup, LookupResult} from '../core/lookup';
import type {APIResponse, Logger} from '../sdk/types';
import {unwrap} from '../sdk/unwrap';
import {safeClosePluginView, type ClosablePluginView} from '../sdk/closeView';
import {t} from '../i18n/i18n';

const LASSO_BOX_STATE_RELEASED = 2;

const safeReleaseLassoBox = async (
  comm: {setLassoBoxState: (state: number) => Promise<APIResponse<boolean>>},
  logger: Logger,
): Promise<void> => {
  try {
    const res = await comm.setLassoBoxState(LASSO_BOX_STATE_RELEASED);
    if (!res || !res.success) {
      const msg = res?.error?.message ?? 'no error message';
      logger.warn(`[define:lasso-box] setLassoBoxState(2) success=false: ${msg}`);
    }
  } catch (e) {
    logger.warn(
      `[define:lasso-box] setLassoBoxState(2) threw: ${(e as Error).message}`,
    );
  }
};

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

// Note: closePluginView is intentionally NOT on this interface.
// PluginCommAPI from sn-plugin-lib does not expose it — closePluginView
// lives on PluginManager. The handler takes a separate `view` dep so
// the runtime wiring matches the SDK's actual surface and we never
// hit "undefined is not a function" at the reentrancy / finally
// close path again.
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
};

export type FileAPILike = {
  getPageSize: (notePath: string, page: number) => Promise<APIResponse<Size>>;
};

export type DefineDeps = {
  comm: CommAPILike;
  // PluginManager surface for closing the firmware overlay. Distinct
  // from `comm` because closePluginView is on PluginManager, not
  // PluginCommAPI — see CommAPILike comment above.
  view: ClosablePluginView;
  file: FileAPILike;
  lookup: DictLookup;
  // Open the popup with a "Recognizing…" placeholder before OCR
  // begins. Decouples user-perceived popup latency from the firmware
  // OCR latency: the popup appears in <300 ms after tap, then the
  // OCR'd word + lookup hits stream in.
  showRecognizing: (ocrLabel?: string) => void;
  showResult: (result: LookupResult, ocrLabel?: string) => void;
  // Dismisses the popup; called on the recognize-empty path so we
  // don't leave a stale "Recognizing…" panel up after OCR returns
  // nothing useful. The host overlay is then closed by the finally
  // block via safeClosePluginView.
  hidePopup: () => void;
  logger: Logger;
};

export type DefineOutcome =
  | 'ok'
  | 'busy'
  | 'empty-lasso'
  | 'recognize-empty'
  | 'failed';

const ocrLassoedStrokes = async (deps: DefineDeps): Promise<string> => {
  // Three independent SDK calls — fire concurrently. On-device each
  // round-trip to the firmware costs ~0.3–1 s; running them in
  // sequence stacks ~1–1.5 s onto the tap-to-popup latency for no
  // good reason. getLassoElements + getCurrentFilePath +
  // getCurrentPageNum have no inter-dependencies; only getPageSize
  // and recognizeElements need the prior results.
  const [elements, notePath, pageNum] = await Promise.all([
    deps.comm
      .getLassoElements()
      .then(r => unwrap(r, 'getLassoElements')),
    deps.comm
      .getCurrentFilePath()
      .then(r => unwrap(r, 'getCurrentFilePath')),
    deps.comm
      .getCurrentPageNum()
      .then(r => unwrap(r, 'getCurrentPageNum')),
  ]);
  // recognizeElements expects the *page* size, not the lasso rect — see
  // sn-formula/src/spike.ts:243-251 (logcat: IllegalArgumentException
  // getRealMaxX, unknown pageSize).
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
    await safeClosePluginView(deps.view, deps.logger);
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

    // Open the popup with "Recognizing…" BEFORE OCR runs. The user
    // sees feedback within a few hundred ms instead of staring at
    // the page for 5–8 s while the SDK marshals strokes and runs
    // handwriting recognition. popupShown flips here too: even on
    // an OCR failure we want the popup's Close button to be the
    // dismissal path, not the host's auto-close.
    deps.showRecognizing();
    popupShown = true;

    const recognized = (await ocrLassoedStrokes(deps)).trim();
    if (recognized.length === 0) {
      deps.logger.warn(
        '[define:recognize] empty / whitespace-only result',
      );
      // Pull the "Recognizing…" popup down so the finally block can
      // close the host overlay cleanly (popupShown=false → finally
      // calls safeClosePluginView).
      deps.hidePopup();
      popupShown = false;
      return 'recognize-empty';
    }
    // Streaming progress: each source resolution re-renders with
    // the freshly-arrived hit. The first onUpdate snapshot
    // transitions the popup from 'recognizing' to 'result' kind.
    const ocrLabel = `${t('popup.ocr')}: ${recognized}`;
    const result = await deps.lookup.lookup(recognized, snapshot => {
      deps.showResult(snapshot, ocrLabel);
    });
    deps.showResult(result, ocrLabel);
    return 'ok';
  } catch (e) {
    deps.logger.error(`[define] pipeline crashed: ${(e as Error).message}`);
    // Showed "Recognizing…" early so the user got immediate
    // feedback. On a crash that follows, dismiss it and let the
    // finally block close the host overlay — leaving a stale
    // "Recognizing…" up forever would be worse than nothing.
    deps.hidePopup();
    popupShown = false;
    return 'failed';
  } finally {
    // Clear the reentrancy flag SYNCHRONOUSLY before awaiting
    // anything. If we cleared it after the await, the host's
    // state:stop transition can suspend the JS context and the
    // assignment may never run — see sn-formula/src/spike.ts:438-446.
    release();
    // Release the lasso state on EVERY path that owns it. Skipping
    // it leaves the lasso toolbar stuck on-screen and the host's
    // gesture chain dangling — pen taps stop landing until the user
    // exits the note (sn-formula/src/spike.ts:329-335). This must
    // run for empty-lasso, recognize-empty, failed, AND ok.
    await safeReleaseLassoBox(deps.comm, deps.logger);
    if (!popupShown) {
      await safeClosePluginView(deps.view, deps.logger);
    }
  }
};
