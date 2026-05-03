// Cooperative-yield helper for long synchronous loops. Used by every
// dict format (StarDict `.idx` / `.syn` / index-build, CSV row parse,
// JSON array-of-entries iteration) — anywhere a multi-MB user file
// would otherwise spin the JS thread for several seconds. Hermes runs
// every loop on the JS thread, so without yielding the visible
// symptom is "freezing/locking input" the moment the user taps to
// look up a word and triggers first-load of a large dictionary.
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
