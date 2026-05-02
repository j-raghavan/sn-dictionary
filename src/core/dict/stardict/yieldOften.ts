// Cooperative-yield helper for long synchronous loops (StarDict
// `.idx` parsing, `.syn` parsing, the index-build pass over hundreds
// of thousands of entries). Hermes runs every loop on the JS thread,
// so a multi-second loop blocks UI input — the visible "5-minute
// freeze on first lookup" symptom users hit with large user-supplied
// dictionaries.
//
// Yielding via a macrotask (setTimeout 0) — not a microtask — gives
// the JS thread room to drain pending UI events and spinners between
// chunks. A microtask (queueMicrotask / Promise.resolve) would still
// starve rendering on Hermes.

const DEFAULT_PERIOD = 16384;

// Returns a new period if you want to override the default, otherwise
// `shouldYield(i)` answers `true` once every PERIOD iterations
// (excluding i=0).
export const shouldYield = (i: number, period = DEFAULT_PERIOD): boolean =>
  i > 0 && i % period === 0;

export const yieldToEventLoop = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 0));

export const YIELD_PERIOD = DEFAULT_PERIOD;
