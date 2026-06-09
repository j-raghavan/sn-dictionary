import type {LookupResult} from '../core/lookup';
import type {ThesaurusResult} from '../core/dict/sqlite/thesaurusLookup';
import type {DeleteResult, DictPref} from '../core/dict/sqlite/settings';

// Bridge between async handlers (which don't render React) and the
// popup component (which does). A handler calls one of the show*()
// functions; the popup subscribes via `subscribe(...)` and re-renders
// on each event.
//
// Keeping this as a tiny module-level event bus instead of React
// Context lets handlers stay pure async functions, importable and
// testable without a renderer.
//
// Two visible kinds:
//   - 'recognizing'  Open during the OCR window of the lasso flow,
//                    before any lookup result is available. The
//                    popup shows a localised "Recognizing…" message
//                    so the user gets immediate feedback that the
//                    tap landed, instead of staring at the page for
//                    5–8 s while the SDK marshals strokes and runs
//                    handwriting recognition.
//   - 'result'       The familiar lookup-result popup. Rendered as
//                    soon as the first lookup snapshot lands (which,
//                    with streaming, fires synchronously inside
//                    multiDictLookup before any source resolves).

// The closeable-and-restorable payload of a result-kind popup. Factored
// out so the Settings panel can stash the exact result it opened over and
// the Back button restores it verbatim (F1). It is NOT a LookupResult
// field — editability + the active tab are popup chrome (IV-1).
export type ResultSnapshot = {
  ocrLabel?: string;
  result: LookupResult;
  // OPTIONAL: when true the popup shows the OCR-correction editable
  // field (lasso flow). Absent/false -> read-only view (doc-select).
  // The component guards on `=== true`, never on ocrLabel presence
  // (Designer ruling 4 / flag 5). The LookupResult shape itself is
  // unchanged (IV-1) — editability is popup chrome, not a result field.
  editable?: boolean;
  // The tab the user was on when they opened Settings, so Back restores
  // it instead of resetting to Definition (F1-AC2). Absent on a normal
  // lookup -> the component defaults to 'definition'.
  activeTab?: 'definition' | 'thesaurus';
};

export type PopupState =
  | {visible: false}
  | {visible: true; kind: 'recognizing'; ocrLabel?: string}
  | ({visible: true; kind: 'result'} & ResultSnapshot)
  | {visible: true; kind: 'settings'; resume?: ResultSnapshot};

type Listener = (state: PopupState) => void;

// Registry seam (Designer ruling 1): the popup needs to call back into
// the runtime (fetch thesaurus, persist a user word, re-run a lookup)
// without the controller importing the engine. Handlers are registered
// at startup via setPopupActions; the component reads them via
// getPopupActions(), which can be NULL before registration (async) —
// every call site guards for that (Designer flag 1).
//
// Source -> language resolution lives INSIDE lookupThesaurus (it returns
// {lang, omw}); the 'und' short-circuit is in the action too, so the
// component stays language-policy-free and IV-1 holds (the thesaurus is
// a separate lazy query, never a LookupResult field).
export type PopupActions = {
  lookupThesaurus(
    headword: string,
    sourceName: string,
  ): Promise<{lang: string; omw: ThesaurusResult}>;
  addUserEntry(word: string, definition: string): Promise<void>;
  relookup(text: string): Promise<void>;
  // F3 — the dictionary manager reads the current order+enablement and
  // writes a whole reordered/toggled set. The engine (index.js) wires
  // these to the RuntimeHandle's listDictPrefs/setDictPrefs, keeping the
  // panel engine-agnostic (Designer ruling 1).
  listDictPrefs(): Promise<DictPref[]>;
  setDictPrefs(prefs: DictPref[]): Promise<void>;
  // F4 — the opt-in source-deletion toggle. Reads/writes the
  // keepSourcesAfterImport app setting (default keep=true). Applies to
  // FUTURE imports only (F4-FR7). Wired by index.js to the user.db
  // getKeepSources/setKeepSources helpers.
  getKeepSources(): Promise<boolean>;
  setKeepSources(keep: boolean): Promise<void>;
  // F7 — delete an already-imported dict. `confirmDeleteDict` shows the
  // device confirm dialog (showRattaDialog) and resolves true ONLY when the
  // user taps Delete; it is a host-mockable PORT (like F4's promptKeepDelete)
  // so the panel stays renderer-testable off-device. `deleteImportedDict`
  // wires to the RuntimeHandle and reports what was removed. Both are
  // OPTIONAL so the F3/F4 fakeActions (and a not-yet-wired engine) still
  // satisfy PopupActions; the panel guards on their presence.
  confirmDeleteDict?(name: string): Promise<boolean>;
  deleteImportedDict?(prefKey: string): Promise<DeleteResult>;
};

let popupActions: PopupActions | null = null;

export const setPopupActions = (actions: PopupActions): void => {
  popupActions = actions;
};

export const getPopupActions = (): PopupActions | null => popupActions;

let currentState: PopupState = {visible: false};
const listeners = new Set<Listener>();

const emit = (next: PopupState): void => {
  currentState = next;
  listeners.forEach(l => l(next));
};

export const showRecognizing = (ocrLabel?: string): void => {
  emit({visible: true, kind: 'recognizing', ocrLabel});
};

export const showDefinition = (
  result: LookupResult,
  ocrLabel?: string,
  editable?: boolean,
): void => {
  emit({visible: true, kind: 'result', ocrLabel, result, editable});
};

export const hideDefinition = (): void => {
  emit({visible: false});
};

// Open the Settings panel, stashing the result the user was viewing so
// Back can restore it verbatim (F1). `snapshot` is undefined when opened
// from a non-result state (e.g. nothing to return to).
export const showSettings = (snapshot?: ResultSnapshot): void => {
  emit({visible: true, kind: 'settings', resume: snapshot});
};

// Leave the Settings panel: re-emit the stashed result (restoring its
// OCR label, editability, and active tab) when there is one, else close.
export const closeSettings = (): void => {
  const s = currentState;
  if (s.visible && s.kind === 'settings' && s.resume) {
    emit({visible: true, kind: 'result', ...s.resume});
  } else {
    emit({visible: false});
  }
};

export const getCurrentState = (): PopupState => currentState;

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const __testing__ = {
  reset: () => {
    listeners.clear();
    currentState = {visible: false};
    // Null the registry so suites don't leak actions across tests
    // (Designer flag 6).
    popupActions = null;
  },
};
