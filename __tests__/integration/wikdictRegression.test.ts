// End-to-end regression suite against real downloaded StarDicts.
// Run via `npm run test:integration` — the runner script downloads
// each manifest entry into .cache/integration-dicts/, SHA-verifies,
// then invokes jest with SNDICT_INTEGRATION=1. Without that env var
// the suite no-ops (so default `npm test` stays fast and offline).
//
// What this catches that synthetic-fixture unit tests don't:
//   - Real upstream HTML shapes (Wikdict's `<div>` translation
//     wrapping, `<font color="...">` for IPA + POS, nested
//     `<ol>/<li><div>...</div></li>` for multi-sense translations).
//   - Issue-#15-class glue regressions: a future change to the
//     <div> handling in htmlToPlainText that re-introduces
//     `istastre` immediately fails this suite against the actual
//     Gestirn entry, not a hand-typed fixture.
//   - Full pipeline integrity: dictzip random-access read, .idx
//     parsing of a 50k+ entry dict, normalizeKey roundtrip across
//     non-ASCII headwords (Gestirn, chien, …).
//
// CI integration: .github/workflows/release.yml runs this as a hard
// gate before any release artifact is produced. If wikdict.com is
// unreachable, the runner script fails the release deliberately —
// we'd rather block a release than ship one without verifying real
// upstream content still renders correctly.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildDict, lookupDict} from '../../src/core/dict/stardict/stardictDict';
import {htmlToPlainText} from '../../src/ui/htmlToPlainText';
import {MANIFEST} from './manifest';

const RUN_INTEGRATION = process.env.SNDICT_INTEGRATION === '1';
const CACHE_DIR = join(__dirname, '..', '..', '.cache', 'integration-dicts');

const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

describeIntegration('Real-StarDict regression (run via `npm run test:integration`)', () => {
  for (const dict of MANIFEST) {
    describe(`${dict.name} — ${dict.description}`, () => {
      const dir = join(CACHE_DIR, dict.name);
      const cacheReady = existsSync(join(dir, 'stardict.ifo'));

      if (!cacheReady) {
        // Intentional placeholder: when the runner downloaded the
        // manifest but this specific entry's extract is missing
        // (e.g. partial cleanup, hand-edited cache), surface a
        // visibly-skipped test rather than silently dropping the
        // dict's coverage. eslint-disable: no-disabled-tests warns
        // on test.skip in general, but here it's deliberate
        // defensive code, not forgotten WIP.
        // eslint-disable-next-line jest/no-disabled-tests
        test.skip(`${dict.name} not in cache — runner did not extract this dict`, () => {});
        return;
      }

      // Resolved once per dict. The buildDict promise is awaited
      // inside each test (jest-friendly) rather than in beforeAll,
      // so a build failure in one dict doesn't mask other dicts'
      // tests under a missing-fixture symptom.
      let parsedPromise: ReturnType<typeof buildDict> | null = null;
      const getParsed = (): ReturnType<typeof buildDict> => {
        if (parsedPromise === null) {
          // Locate the dict-data directory inside the extracted
          // archive. WikDict zips contain a single top-level
          // folder whose stardict.* files we read here. The
          // runner script normalises this layout so we can rely
          // on a stable shape.
          const ifo = readFileSync(join(dir, 'stardict.ifo'));
          const idx = readFileSync(join(dir, 'stardict.idx'));
          const dictBytes = readFileSync(join(dir, 'stardict.dict.dz'));
          parsedPromise = buildDict(
            new Uint8Array(ifo),
            new Uint8Array(idx),
            new Uint8Array(dictBytes),
          );
        }
        return parsedPromise;
      };

      for (const expectation of dict.entries) {
        test(`lookup "${expectation.word}" renders without glue`, async () => {
          const parsed = await getParsed();
          const hit = lookupDict(parsed, expectation.word);
          // Failure here means the dict's headword set changed.
          // That's the signal to update the manifest, not to ship.
          expect(hit).not.toBeNull();
          if (!hit) {
            return;
          }
          const rendered = htmlToPlainText(hit.definition);

          for (const sub of expectation.contains) {
            expect(rendered).toContain(sub);
          }
          for (const sub of expectation.notContains ?? []) {
            // notContains is the bug-shape pin. A regression that
            // re-glues translation onto definition text fires
            // here with a clear "<dict> <word> contains
            // <bad-string>" trace.
            expect(rendered).not.toContain(sub);
          }
          for (const re of expectation.matches ?? []) {
            expect(rendered).toMatch(re);
          }
          // Universal invariant: stripping should leave no HTML
          // tag residue regardless of upstream shape.
          expect(rendered).not.toMatch(/<\/?[a-z]/i);
        });
      }
    });
  }
});
