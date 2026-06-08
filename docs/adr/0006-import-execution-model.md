# ADR-0006: Move StarDict sideload import parse+insert to native Kotlin

- Status: accepted
- Date: 2026-06-07
- Deciders: J-Raghavan
- Spec: `spec/SPEC-THESAURUS-NEW-FEATURES.md` (TF5). Refines the import *execution model* of ADR-0001/TF5-FR3 (the SQLite engine decision stands; only how the sideload import runs changes).

## Context and Problem Statement

TF5 sideload import ran entirely in JS: `importStardict.ts` called `buildDict` (parse `.ifo`/`.idx`/`.syn` + decode every body via the dictzip reader) then `populateBaseDb`, which INSERTed every entry **one row at a time across the React Native bridge** (`SqliteDb.run` per row). On a Wiktionary-class dict (100k–2M entries) this floods the single Hermes JS thread and the bridge — each INSERT is a JS→native round-trip, and the parse + per-row marshalling starve the thread that also serves OCR/lookup/render. On-device this produced a **sluggish first lookup** while sideload imports were running (logcat: three concurrent imports for ~30 s; `getPageSize` took 2.8 s mid-import vs its usual ms). The cooperative `yieldOften` helps responsiveness but multiplies wall-clock time.

The build-time `base.db` generator has the same parse/insert logic but runs in **Node off-device**, so it is unaffected — this is purely a runtime (on-device import) problem.

## Decision Drivers

- Import speed + a responsive JS thread during sideload (the explicit goal: "fully native for speed and accuracy").
- Accuracy: imported keys MUST match `base.db`/build-time keys exactly (IV-4) or lookups diverge across sources.
- Keep the data-safety guarantees already host-tested (verify-then-delete IV-6, audit, retryability).
- No dead code: remove the JS device-import path it replaces.

## Considered Options

1. **Optimize the JS insert** (batch rows per `executeSql`, bigger transactions). Fewer round-trips, but the parse + body decode + key-fold for 100k–2M entries still runs on Hermes; the thread still stalls. Marginal.
2. **Native Kotlin parse+insert behind a JS port; JS keeps orchestration.** A new RN native module runs the whole parse + single-transaction prepared-statement INSERT on a background thread; JS keeps reconcile/verify/delete/audit. Fast, frees the JS thread, safety stays host-tested.
3. **Native module that ALSO owns verify/delete/audit.** Maximal native, but moves the destructive-delete safety logic (host-tested at 97%) into device-only Kotlin that can't be host-tested. Rejected.

## Decision Outcome

**Chosen: Option 2.** A new `SnDictImportModule` (`ReactContextBaseJavaModule`, registered via its own `ReactPackage` in `MainApplication.kt` alongside the vendored `org.pgsqlite` `SQLitePluginPackage` — the vendored module is NOT modified) exposes one Promise-based `@ReactMethod importStardict(ifoPath, idxPath, dictPath, synPath?, dbPath, format?)` that runs on a background `Executor` (never the JS/main thread). It parses the triple, builds the entries set with the **same dedup/first-key-wins and `normalizeKey` folding as `buildDict`**, and bulk-INSERTs in ONE transaction with a prepared statement using the **same `entries` DDL as `schema.ts`**, writing the `meta` row last; it resolves the inserted entry count.

The JS `importStardict.ts` is rewritten to call this native method via a `runNativeImport` **port**, then keep its existing, host-tested **verify-then-delete + audit** logic (reopen the slug DB, `SELECT COUNT(*)`, match the native-returned count, audit-then-delete). The `SqliteDb`/`ImportPorts` safety seam is preserved; only parse+insert is native.

**`normalizeKey` is ported to Kotlin with EXACT parity** (the accuracy gate): `Normalizer.normalize(NFC)` → the same `PUNCT_FOLD` codepoint map + the `U+2026`→`"..."` rule, iterating by codepoint → `trim().lowercase(Locale.ROOT)`. Parity is verified by a shared fixture vector and an on-device key/def match against `base.db`.

The JS per-row device-insert path it replaces is **removed** (no dead code): the JS `buildDict`+`populateBaseDb` calls inside `importStardict`, and the byte-reading / writable-slug-open parts of `importRnPorts`. The parsers + `populateBaseDb` + the TS `normalizeKey` are **RETAINED** — still consumed by the Node build-time `base.db` generator and the runtime lookup path. The Kotlin `normalizeKey` is a parallel copy for the device-import only; the TS source stays canonical.

### Consequences

- Good: import runs off the JS thread → responsive lookups during sideload; a single-transaction prepared INSERT in Kotlin is far faster than per-row bridge calls; full dictzip inflate in one pass.
- Good: data-safety (verify/delete/audit) stays in host-tested JS.
- Bad/Cost: a second native module to maintain + a `normalizeKey` Kotlin port that MUST stay in lockstep with the TS source (parity vectors mitigate); the parse+insert is **device-verified only** — Gradle-compile-checked, runtime-verified on-device.
- Risk: `normalizeKey` parity (NFC + fold + ellipsis + `lowercase(ROOT)`), dictzip full-inflate, and `.idx` big-endian/`idxoffsetbits` — all spelled out in the design and covered by an on-device parity check against build-time keys.

## More Information

Spec TF5; ADR-0001 (native engine), ADR-0002 (base.db). Shared source-of-truth literals: `schema.ts` `CREATE_ENTRIES_TABLE`/`CREATE_ENTRIES_INDEX`/`SCHEMA_VERSION`; `normalizeKey.ts` `PUNCT_FOLD`. Verification reality: Kotlin = Gradle-compile + device; JS orchestration = host-tested ≥97%.
