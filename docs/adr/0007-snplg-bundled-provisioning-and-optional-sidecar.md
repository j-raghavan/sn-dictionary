# ADR-0007: .snplg-bundled provisioning, optional sidecar, native streamed import (the on-device pivot)

- Status: accepted
- Date: 2026-06-07
- Deciders: J-Raghavan
- Supersedes: parts of [ADR-0002](0002-bundled-english-db.md) (provisioning mechanism) and [ADR-0003](0003-sideload-stardict-import-and-delete.md) (required `meta.json`)
- Related: [ADR-0001](0001-native-sqlite-engine.md) (native SQLite), [ADR-0006](0006-import-execution-model.md) (native import)

## Context and Problem Statement

ADR-0001/0002/0003 were written before the on-device spike. Three of their assumptions proved wrong (or too rigid) once the plugin actually ran on a Supernote host. This ADR records the decisions we *shipped* and why, so the older ADRs aren't read as current.

1. **`createFromLocation` from app.npk assets does not work in a dynamically-loaded plugin.** ADR-0002 assumed `react-native-sqlite-storage`'s `createFromLocation` would copy `assets/base.db` out of the APK on first run. On-device, the plugin host loads our code inside *its own* process; our `app.npk` assets are not on the classpath the SQLite plugin reads, so the copy silently produced an empty DB (which then wedged Lookup). We need a provisioning path that doesn't depend on reading our own APK assets.
2. **Requiring `meta.json` gated the core feature on enhancement metadata.** ADR-0003 required a `meta.json` sidecar per sideloaded dict. On-device, real dicts (e.g. jp-en, fr-en) often ship *without* one, so they silently failed to load — even though their definitions are perfectly usable. The lookup is the product; the language tag only enables the thesaurus.
3. **The JS import OOM'd / froze Hermes.** Parsing + inserting a 779,859-entry dict on the JS thread blew the host's ~192 MB heap (ADR-0006 addresses the execution model; this ADR records its on-device outcome).

## Decision Outcome

**(a) base.db is BUNDLED in the `.snplg`, opened via `{name, location}` — not `createFromLocation`.** The build stages `base.db` at the `.snplg` root (`buildPlugin.sh` copies `build/base.db → build/generated/base.db`); the plugin host extracts the `.snplg` into `getFilesDir()/plugins/<pluginID>/`, landing `base.db` at `plugins/<id>/base.db`. The runtime opens it with `openDatabase({name: 'base.db', location: 'plugins/<id>/'})` — the proven sticker-demo pattern (the native side resolves `getFilesDir()+location+name`, SQLitePlugin.java:392-395). No `createFromLocation`, no app.npk asset read, no hardcoded absolute paths. Provisioning (`provision.ts`) opens the DB and **verifies** it (`SELECT count(*) FROM entries`) before use, so an empty/missing DB rejects loudly instead of wedging Lookup. **Supersedes ADR-0002's provisioning mechanism** (the "bundle EN as a prebuilt all-text SQLite DB, retire the blob" decision stands).

**(b) The StarDict sidecar (`meta.json`) is OPTIONAL.** A complete StarDict triple is the only hard requirement to load a dict. With no `meta.json`, discovery loads it with a default sidecar `{name: <folderName>, language: 'und'}` — definitions work immediately; the Thesaurus tab is empty (it needs a resolved language). A present-but-invalid `meta.json` *degrades* to the default (warn, don't skip). Rationale: **don't gate the core feature (definition lookup) on enhancement metadata** — the design-gate lesson from the on-device misses. `parseSidecar` stays strict (only used when a `meta.json` is present) but accepts the `und` tag. **Supersedes ADR-0003's "required `meta.json`".**

**(c) The import runs in NATIVE Kotlin, off the JS thread, streamed.** `SnDictImportModule` (a React Native module) parses the triple + `.syn` and bulk-inserts into a per-dict SQLite DB on a private executor — never Hermes (ADR-0006). To stay under the ~192 MB host heap regardless of dict size, the body is inflated to a temp file and read via an off-heap `MappedByteBuffer`, with definitions streamed one-at-a-time into the transaction (no all-definitions map, no full body in heap). JS keeps the host-tested verify-then-delete + audit orchestration; the Kotlin path produces a byte-identical DB (same `normalizeKey` fold, `.idx`/`.syn` merge, schema DDL, `SCHEMA_VERSION`, meta-LAST). `base.db` additionally ships the EN Open English WordNet OMW thesaurus (`thesaurus` table; CC BY 4.0).

**(d) On-device validation status.**

- **VERIFIED:** cold-start ~250 ms on a note re-open post-provision; the native SQLite module loads (no "Native module is null"); the native streamed import of a **779,859-entry** dict completes with **no OOM**; verify-then-delete (count match → delete sources + audit) works; the `.snplg`-bundled `base.db` is found at `plugins/<id>/` and opened by `{name, location}`.
- **STILL OPEN:** the Kotlin `NormalizeKey` parity vs the TS `normalizeKey` (an explicit folded-key word check against `base.db` keys — the cross-language parity fixture `__tests__/_fixtures/normalizeKeyVectors.json` pins the TS side; the Kotlin side needs an on-device folded-key spot-check); IME-over-overlay for the OCR-correction / add-word `TextInput`; five-language lookup latency (only EN content ships today).

### Consequences

- Good: provisioning works on the real host; meta-less dicts load (definitions never gated on metadata); imports don't OOM/freeze; one DDL/parser path build-time + import-time.
- Cost: native code (Gradle/NDK, larger `app.npk`); the Kotlin parser must be kept byte-identical to the TS build-time path (the parity fixture + a planned on-device folded-key check guard this).
- The old in-memory StarDict engine + the 16 MB base64 blob are removed (post-spike cleanup) — `base.db` + the native engine are the only path.

## Release gates

The release gate is **(d)'s VERIFIED set**: native load + `.snplg`-bundled provision + cold-start < ~1 s + a native import with no OOM + verify-then-delete. The old `sqliteParity.test.ts` (in-memory-engine-vs-SQLite) is **no longer a gate** — that engine is removed; the SQLite path is host-tested (the `sqlite/*` suites) and device-proven. The STILL-OPEN items in (d) are follow-ups, not release blockers for the EN-only ship.

## More Information

This repo: `index.js` ({name, location} wiring + live `sourceLang`), `src/core/dict/sqlite/{provision,bootstrap,importStardict,nativeImport,rnSqliteDb}.ts`, `android/app/src/main/java/com/sndict/imports/*` (the native importer), `buildPlugin.sh` (`.snplg` staging). Related: ADR-0001 (the runbook, updated to this reality), ADR-0006 (import execution model).
