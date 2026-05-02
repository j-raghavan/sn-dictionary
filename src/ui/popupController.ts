import type {LookupResult} from '../core/lookup';

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

export type PopupState =
  | {visible: false}
  | {visible: true; kind: 'recognizing'; ocrLabel?: string}
  | {
      visible: true;
      kind: 'result';
      ocrLabel?: string;
      result: LookupResult;
    };

type Listener = (state: PopupState) => void;

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
): void => {
  emit({visible: true, kind: 'result', ocrLabel, result});
};

export const hideDefinition = (): void => {
  emit({visible: false});
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
  },
};
