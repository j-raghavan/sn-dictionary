// Production-startup contract: every discovered DictSource MUST have
// its prime() called concurrently, not serially.
//
// Background: multiDictLookup gates 'loading' sources at fan-out time
// (skips them so a user tap during prime returns instantly). Serial
// priming defeats that gate — only the currently-running source is
// 'loading'; everything else queued behind it is still 'idle'. An
// 'idle' source's lookup() falls through to the lazy harness, which
// triggers its load right then and blocks the user-initiated query
// until the parse finishes. On a Wiktionary-class dict that meant
// ~70 s of dead air after the user's tap, plus the host firmware's
// reentrancy guard rejecting any retap.
//
// Concurrent priming flips every source's status to 'loading'
// essentially simultaneously, so the gate kicks in for all of them
// and the user's tap returns immediately with whatever's already
// resolved. Cooperative yields inside parseIdx / parseSyn /
// buildDict hand the JS thread back at every yield boundary, so
// concurrent parses interleave on a single thread instead of
// monopolising it — total CPU work is unchanged; individual
// wall-clock prime times stretch a little; the UI stays responsive.
//
// Extracted from index.js so the test suite can lock the contract:
// __tests__/primeAllConcurrently.test.ts asserts the loading-state
// transition + the fast-return shape that production depends on.

import type {DictSource} from '../lookup';

export type PrimeAllLogger = {log: (msg: string) => void};

export const primeAllConcurrently = async (
  sources: readonly DictSource[],
  logger: PrimeAllLogger,
): Promise<void> => {
  await Promise.all(
    sources.map(async source => {
      if (typeof source.prime !== 'function') {
        return;
      }
      await source.prime();
      logger.log(`[startup] primed user dict "${source.name}"`);
    }),
  );
};
