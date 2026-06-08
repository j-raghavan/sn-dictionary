# ADR-0001: Adopt a native SQLite engine (pure-JS → native pivot)

- Status: accepted
- Date: 2026-06-07
- Deciders: J-Raghavan
- Spec: `spec/SPEC-THESAURUS-NEW-FEATURES.md` (TF1, TF2)

## Context and Problem Statement

On-device, Lookup is unusable for a **minutes-class delay** after every note open. The base WordNet dictionary (149,535 entries) is parsed from a 16 MB bundled base64 blob — `parseIdx` + 149k× `normalizeKey` + `Map` build — on **every** JS-context reload, and the Supernote firmware reloads the JS context on every note open. The persistent `indexCache` meant to skip this **degrades to in-memory on-device** (it logs a one-shot `[indexCache]` warn, then falls back): AsyncStorage's native module is unbound because the plugin ships **no native code at all** (no `android/` project, no `nativeCodePackage`). So the expensive parse re-runs every reload.

How do we make Lookup ready in ~1 s on a (post-provision) note re-open, with real cross-reload persistence?

## Decision Drivers

- Kill the minutes-class cold start; lookup must survive JS reloads with no re-parse.
- Real persistence (also unblocks user-added words and future history/favourites).
- Reuse the existing `DictSource` / `multiDictLookup` seams; avoid a core rewrite.
- A proven precedent on Supernote firmware (de-risk before committing).

## Considered Options

1. **Native SQLite** (`react-native-sqlite-storage`) bundled into a custom `app.npk`; indexed `SELECT` replaces parse.
2. **Stay pure-JS, fix persistence via the filesystem** — write the parsed index to a file under the plugin dir using `PluginFileAPI`, hydrate on reload (no AsyncStorage native dep).
3. **Build-time-bake the index as a bundled asset** (pre-normalized key→offset table shipped as JSON/binary, loaded into a `Map` at startup) — no parse, but still an in-memory `Map` rebuild per reload and no query engine for thesaurus/precedence/user-add.

## Decision Outcome

**Chosen: Option 1 — native SQLite.** It is the only option that removes both the parse **and** the per-reload in-memory rebuild, gives durable native persistence, and provides a real query engine that the thesaurus (ADR-0004), precedence (ADR-0005), sideload import (ADR-0003), and user-add features build on. The precedent exists: `~/Workspace/sn-plugin-demo-sticker` vendors `react-native-sqlite-storage` under `node_change/`, ships an `android/` Gradle project, and bundles a custom APK via `gradlew buildCustomApkDebug`; `buildPlugin.sh` **already** contains the custom-APK machinery (`get_react_packages_from_autolinking_source`, `copy_apk_and_update_config`) — it is simply unused today.

**Native SQLite becomes a hard dependency.** This is de-risked by a **mandatory TF1 spike** (open a trivial bundled DB read-only via `createFromLocation`, `SELECT 1`, log on-device) **before** any feature work and **before** the 16 MB blob is retired (ADR-0002). If the spike fails, we do **not** proceed on this path — we reassess Option 2 (filesystem cache) rather than ship a broken native build. We deliberately keep **no permanent JS fallback** for EN once cut over: retaining a 16 MB fallback blob would defeat the bundle-size/memory win, and the spike removes the uncertainty that a fallback would hedge.

### Consequences

- Good: on a **post-provision note re-open**, Lookup is ready in ~1 s and lookup latency is constant across reloads; durable persistence; one query engine for all new features. (The one-time first-install `createFromLocation` copy is separate and may take longer — ADR-0002, spec TF3-AC2/TF8-FR3.)
- Good: reuses `DictSource`/`multiDictLookup`; the StarDict parsers move to build/import time, off the runtime hot path.
- Bad/Cost: the plugin gains native code — a Gradle/NDK build dependency, a larger `app.npk`, and native surface to test on-device; heavier CI/contributor setup.
- Risk: native module behaviour under the firmware is unverified here → the TF1 spike is the gate (RO-1).
- Edge: if the spike fails, the cold-start problem is re-opened against Option 2.

## TF1 On-Device Spike Runbook (updated to the shipped reality)

> **Updated post-spike.** The spike RAN and changed two assumptions (see [ADR-0007](0007-snplg-bundled-provisioning-and-optional-sidecar.md)): `createFromLocation` from app.npk assets does **not** work in a dynamically-loaded plugin, so base.db now ships INSIDE the `.snplg` and is opened by `{name, location}`. The runbook below reflects that. The GATE items are now **VERIFIED**.

**Build + install.** On macOS/Linux (or WSL) with the Android toolchain:
`npm install` → `./buildPlugin.sh` (runs `prepare:dict` (fetch only) + `prepare:omw`, `build:base-db`, stages `build/base.db → build/generated/base.db` so it ships at the **`.snplg` root**, Metro bundle, then `gradlew buildCustomApkDebug` → `app.npk`). Sideload the resulting `.snplg` onto a Manta; the host extracts it into `getFilesDir()/plugins/sndictdfltbasev1/`. `buildPlugin.ps1` is unsupported for native builds.

Then verify, capturing `adb logcat` for each:

1. **(GATE — VERIFIED) Native load + provision.** The host-extracted `base.db` lands at `plugins/sndictdfltbasev1/base.db`; the runtime opens it via `openDatabase({name:'base.db', location:'plugins/sndictdfltbasev1/'})` (NO `createFromLocation`). Confirm: the native SQLite module loads (no "Native module is null"), the open succeeds, and `provision` verifies `SELECT count(*) FROM entries` > 0 (an empty DB rejects loudly). *Verified on-device.*
2. **(GATE — VERIFIED) Cold-start < ~1 s.** On a note re-open post-provision, time-to-Lookup-ready (first `index.js` log → `setButtonState(true)` log). *Verified: ~250 ms.*
3. **Five-language lookup latency.** Look up a word in EN + four languages; < ~20 ms each (TF2-AC1). *Open — only EN content ships today.*
4. **(VERIFIED) Sideload import → delete → persist.** Drop a StarDict (meta.json OPTIONAL, ADR-0007) under `MyStyle/SnDict/<dict>/`; the **native** importer parses+inserts off the JS thread; verify-then-delete removes the sources + writes the audit row; the dict survives a reload. *Verified: a 779,859-entry dict imported with no OOM.*
5. **IME-over-overlay (TextInput).** OCR-correction field + add-word form: confirm the soft keyboard appears over the overlay and edits commit (`windowSoftInputMode="adjustResize"`). *Still open.*
6. **(VERIFIED) Provision location + setButtonState.** `plugins/sndictdfltbasev1/` extraction and `PluginManager.setButtonState(BUTTON_ID, true)` behave as expected. **Still open:** the Kotlin `NormalizeKey` parity vs TS `normalizeKey` — an explicit folded-key word check against `base.db` keys (the parity fixture pins the TS side).

**Gate = (1) + (2) — both PASSED.** The 16 MB base64 blob + the in-memory engine are removed (post-spike cleanup, done). `sqliteParity.test.ts` is no longer a release gate (that engine is gone; the SQLite path is host-tested + device-proven — see ADR-0007's release-gates note).

## More Information

Spec TF1/TF2, RO-1. Sticker demo: `node_change/react-native-sqlite-storage`, `android/`, `buildPlugin.sh`. This repo: `index.js` ({name, location} wiring), `src/core/dict/sqlite/{provision,rnSqliteDb}.ts`, `buildPlugin.sh` (`.snplg` base.db staging + custom-APK). Related: **ADR-0007 (the on-device pivot — supersedes the createFromLocation + required-meta assumptions)**, ADR-0002 (bundled EN DB), ADR-0003 (sideload import), ADR-0006 (native import), ADR-0004 (thesaurus), ADR-0005 (precedence).
