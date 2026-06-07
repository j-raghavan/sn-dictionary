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

## More Information

Spec TF1/TF2, RO-1. Sticker demo: `node_change/react-native-sqlite-storage`, `android/`, `buildPlugin.sh`. This repo: `index.js` (init-probe gate), `indexCacheStorage.ts` (the in-memory degrade), `buildPlugin.sh` (`copy_apk_and_update_config`). Related: ADR-0002 (bundled EN DB), ADR-0003 (sideload import), ADR-0004 (thesaurus), ADR-0005 (precedence).
