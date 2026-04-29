import type {LookupResult} from '../core/lookup';

// Bridge between async handlers (which don't render React) and the
// popup component (which does). A handler calls `show(result)`; the
// popup subscribes via `subscribe(...)` and re-renders on each event.
//
// Keeping this as a tiny module-level event bus instead of React
// Context lets handlers stay pure async functions, importable and
// testable without a renderer.

export type PopupState =
  | {visible: false}
  | {visible: true; ocrLabel?: string; result: LookupResult};

type Listener = (state: PopupState) => void;

let currentState: PopupState = {visible: false};
const listeners = new Set<Listener>();

const emit = (next: PopupState): void => {
  currentState = next;
  listeners.forEach(l => l(next));
};

export const showDefinition = (
  result: LookupResult,
  ocrLabel?: string,
): void => {
  emit({visible: true, ocrLabel, result});
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
  getState: (): PopupState => currentState,
};
