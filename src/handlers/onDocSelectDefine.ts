import {tryAcquire, release} from '../core/reentrancyGuard';
import type {DictLookup, LookupResult} from '../core/lookup';
import type {APIResponse, Logger} from '../sdk/types';
import {unwrap} from '../sdk/unwrap';
import {safeClosePluginView} from '../sdk/closeView';

// Narrow DI surface — same shape style as onNoteLassoDefine.

export type DocAPILike = {
  getLastSelectedText: () => Promise<APIResponse<string>>;
};

export type CommAPILike = {
  closePluginView: () => Promise<boolean>;
};

export type DocDefineDeps = {
  doc: DocAPILike;
  comm: CommAPILike;
  lookup: DictLookup;
  showResult: (result: LookupResult) => void;
  logger: Logger;
};

export type DocDefineOutcome = 'ok' | 'busy' | 'no-selection' | 'failed';

export const onDocSelectDefine = async (
  deps: DocDefineDeps,
): Promise<DocDefineOutcome> => {
  // Reuse the same module-level guard as the NOTE handler so tapping
  // Define mid-pipeline (across either context) is rejected cleanly.
  if (!tryAcquire()) {
    deps.logger.warn('[doc-define] pipeline already running — ignoring re-entry');
    await safeClosePluginView(deps.comm, deps.logger);
    return 'busy';
  }

  // When the popup is rendered, leave the firmware overlay open and
  // let the popup's own Close button release it. See onNoteLassoDefine
  // for the full rationale.
  let popupShown = false;

  try {
    const selected = unwrap(
      await deps.doc.getLastSelectedText(),
      'getLastSelectedText',
    );
    const text = selected.trim();
    if (text.length === 0) {
      deps.logger.warn('[doc-define] no selection — nothing to define');
      return 'no-selection';
    }
    const result = await deps.lookup.lookup(text);
    deps.showResult(result);
    popupShown = true;
    return 'ok';
  } catch (e) {
    deps.logger.error(`[doc-define] pipeline crashed: ${(e as Error).message}`);
    return 'failed';
  } finally {
    // Release the reentrancy flag synchronously before any await; same
    // rationale as the NOTE handler — see src/handlers/onNoteLassoDefine.ts.
    release();
    if (!popupShown) {
      await safeClosePluginView(deps.comm, deps.logger);
    }
  }
};
