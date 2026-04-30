# Dictionary Plugin for Supernote

![Tests](https://img.shields.io/badge/tests-175%20passed-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-100%25%20lines%20%2F%2098%25%20branches-brightgreen)
![Lint](https://img.shields.io/badge/lint-passing-brightgreen)
![Platform](https://img.shields.io/badge/platform-Supernote-blue)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.0.1-blue)

A Supernote plugin that adds offline English-word lookup to handwritten notes and PDFs. Lasso a word in your notes (handwritten or recognised) or select text in the PDF reader, tap **Lookup**, and the plugin shows the WordNet definition — multiple senses, part-of-speech, synonyms, and example sentences — in a centred popup. Everything runs on-device; no companion app, no cloud, no network calls at lookup time.

## Features

- **Two entry gestures, one popup.** Lasso handwritten or already-recognised text on a note page → tap **Lookup** in the lasso toolbar; or select text in the PDF reader → tap **Lookup** in the selection toolbar. Both flows feed the same on-device dictionary and render in the same structured popup.
- **Real WordNet content.** 149,535 entries from Princeton WordNet 2.x (BSD-style license), shipped as a base64-embedded StarDict triple (`.ifo` + `.idx` + `.dict.dz`) inside the plugin bundle. No network at runtime.
- **OCR-aware.** When you lasso handwriting, the plugin runs the firmware's stroke recogniser (`recognizeElements`) before the lookup, so the popup shows what was *recognised* alongside the matching definition. Saved-and-reloaded handwriting (`trailLink`) and recognised titles (`title`) are covered by the same path — not just freshly-drawn strokes.
- **Structured popup.** Each WordNet sense renders as its own block: a part-of-speech badge (*noun* / *verb* / *adjective* / *adverb*), a numbered sense, the definition, italicised example sentences in curly quotes, and a `Synonyms:` line. Senses are visually separated so multi-sense entries (e.g. "AI" — Army Intelligence vs. artificial intelligence vs. three-toed sloth vs. artificial insemination) are scannable at a glance.
- **Bilingual UI chrome.** The plugin name on the plugin manager card, the **Lookup** toolbar label, and every popup label (`Synonyms:`, `OCR:`, `No definition found for…`, `Close`) localise into Simplified Chinese, Traditional Chinese, Japanese, Thai, and Dutch based on the device's system locale. The dictionary content stays English; the surrounding chrome doesn't.
- **Case- and whitespace-insensitive.** "Anatomy", "anatomy", and "  ANATOMY  " all hit the same entry.
- **Bring-your-own dictionary** *(future)* — the architecture splits cleanly into a base `.snplg` and a user-bundled `SnDict_Custom.snplg` produced by an in-browser converter (Prong B). Same plugin code, different content, same popup. Custom dict precedes base on lookup so user terms shadow generic ones.

## Demo 

### v1.0.1

https://github.com/user-attachments/assets/5539c6bf-0c5c-4fb8-89ee-464f9f34a0aa



## How it works

The plugin owns **the OCR-to-lookup pipeline and the rendering**. On lasso tap or PDF text selection:

1. **Reentrancy guard** acquired (single in-flight pipeline at a time, regardless of context). Released synchronously *before* awaiting `closePluginView` — the host's `state:stop` transition can suspend the JS context, and clearing the flag after the await would leave it stuck.
2. **NOTE lasso path:** `getLassoElementTypeCounts` → branches if any of `trailNum`, `trailLinkNum`, or `titleNum` is non-zero → `getLassoElements` + page-info → `recognizeElements` (no `deleteLassoElements`; lookup is non-destructive) → `setLassoBoxState(2)` clears the lasso UI.
3. **DOC selection path:** `getLastSelectedText` returns the user's selected text directly.
4. **Lookup core** (`createStardictLookup`) — case-insensitive, lazy-initialised on first lookup. The base WordNet bytes are decoded from a base64 string in the bundle, the `.dict.dz` is gunzipped via `pako` at startup, and a `Map<lowercased-word, IdxEntry>` is built once.
5. **Popup** — the raw WordNet entry is parsed into `{senses: [{pos, index, definition, examples, synonyms}]}` by `wordnetFormatter.ts`, then rendered as discrete sense blocks.
6. **Close** — the popup's Close button calls `PluginManager.closePluginView()` directly (fire-and-forget, sn-mindmap's pattern). The handler does *not* close the view on the success path — closing while the popup is still on-screen leaves the host's input channel in a bad state and the device hangs on subsequent pen taps.

By design, **the plugin is pure read** — it never modifies the page, never deletes strokes, never inserts text. Lookup is a side-effect-free overlay.

## Usage

### NOTE mode (handwritten notes)

1. Open a note on your Supernote.
2. Lasso a handwritten or already-recognised word.
3. Tap **Lookup** in the lasso toolbar.
4. Read the definition in the popup. Tap **Close** when done.

### DOC mode (PDFs)

1. Open a PDF in the Supernote document reader.
2. Switch to the **text-selection tool** (not the pen tool — it's a separate icon in the document toolbar; selecting with the pen draws strokes instead of selecting).
3. Drag-select a word.
4. Tap **Lookup** in the selection toolbar that appears.
5. Read the definition. Tap **Close** when done.

The first lookup after the plugin process spins up takes ~30–60 seconds (Hermes/JSC parses the bundle, decodes the base64, gunzips the StarDict, builds the index). After that, every subsequent lookup is instant for the rest of the session — the index lives in JS heap memory until the plugin host is killed.

## Adding your own dictionary

The plugin scans `/storage/emulated/0/MyStyle/SnDict/` on every launch and registers any dictionaries it finds there. User dicts appear as separate sections in the popup, ahead of the bundled WordNet base — so a domain glossary like "medical" supplements the general definition rather than replacing it.

### Layout

Two layouts are accepted, mix freely:

```
MyStyle/
└── SnDict/
    ├── medical.csv                  ← flat: a single CSV at the root IS a complete dict
    ├── japanese.json                ← flat: a single JSON at the root IS a complete dict
    ├── medical-en/                  ← organised: subfolder per dict (REQUIRED for StarDict)
    │   ├── meta.json                  (optional)
    │   ├── medical.ifo
    │   ├── medical.idx
    │   └── medical.dict.dz
    └── my-glossary/                 ← organised: subfolder works for any format
        └── words.csv
```

**Flat layout** is the path of least resistance for a single CSV or JSON file — the filename (without extension) becomes the popup section label. Drop `medical.csv` directly into `MyStyle/SnDict/`, done.

**Organised layout** (one subfolder per dict) is required for StarDict (it's three files that need to live together) and lets you supply a friendlier display name via an optional `meta.json` inside the folder:

```json
{ "name": "Medical en→en" }
```

Without `meta.json`, the display name falls back to the folder name.

### Supported formats

| Format | Files | Notes |
|---|---|---|
| **StarDict** | `*.ifo` + `*.idx` + (`*.dict.dz` or `*.dict`) | The native format. Free dictionaries available at [FreeDict](https://freedict.org) and [dict.org](http://dict.org). |
| **CSV** | one `*.csv` | Headword in column 0, definition in column 1, by default. Quoted fields with embedded commas / newlines / escaped quotes are handled per RFC 4180. UTF-8 BOM is tolerated. |
| **JSON** | one `*.json` | Two shapes accepted: `{"word": "definition", ...}` or `[{"word": "...", "definition": "..."}, ...]`. Field aliases recognised: `headword`/`term`/`key` and `def`/`meaning`/`value`. |
| MDX | *(deferred)* | Not yet supported. Folder is logged and skipped — convert to StarDict via [`mdict-utils`](https://pypi.org/project/mdict-utils/) or [`pyglossary`](https://github.com/ilius/pyglossary) until then. |

A folder with no recognised files, a partial StarDict triple, or multiple format markers is logged and skipped — discovery is fault-isolated, so one bad folder doesn't break the rest.

#### What CSV and JSON should look like

The simplest CSV — headword in column 0, definition in column 1, no header row:

```csv
braise,a slow cooking method that combines searing with simmering in a covered pot
deglaze,"to add liquid to a hot pan to dissolve and lift caramelised browned bits stuck to the bottom"
emulsify,"to combine two liquids that don't normally mix, such as oil and vinegar, into a stable suspension"
julienne,to cut food into long thin strips of roughly equal size
```

Quote a field if its content contains commas, newlines, or `"` (double quotes inside a quoted field are escaped as `""`). UTF-8 BOM at the file start is tolerated. The lookup is case-insensitive — `Braise`, `BRAISE`, and `braise` all hit the same entry.

JSON, "object-map" shape — the simplest case:

```json
{
  "EPD": "Electrophoretic Paper Display — the e-ink panel technology used in Supernote devices.",
  "lasso": "A freeform selection tool: enclose strokes or elements with a hand-drawn loop to act on them as a group.",
  "trail": "A freshly-drawn ink stroke that has not yet been linked to any recognition result."
}
```

JSON, "array of entries" shape — useful when you want to keep extra fields per entry without breaking lookup:

```json
[
  { "word": "EPD",   "definition": "Electrophoretic Paper Display — the e-ink panel technology used in Supernote devices." },
  { "word": "lasso", "definition": "A freeform selection tool: enclose strokes or elements with a hand-drawn loop." }
]
```

Recognised aliases for the array shape: the headword side accepts `word` / `headword` / `term` / `key`; the definition side accepts `definition` / `def` / `meaning` / `value`. Entries that don't match any shape (missing fields, wrong types, scalar rows) are skipped silently — your other entries still load.

Concrete copy-pasteable starting points live at [`assets/sample-dicts/`](assets/sample-dicts/) — one CSV, one JSON, and one StarDict folder.

### File-size caps

CSV and JSON dictionaries are capped at 10 MB each; bigger files are refused with a logged warning. StarDict has no explicit cap (the format streams via index + on-demand block decompression). The `fetch(file://...)` bridge throughput is around 0.85 MB/s — a 10 MB CSV loads in ~12 s on first lookup, then stays in memory for the session.

### Verifying it works (with the bundled sample)

A small, hand-curated tech-jargon dictionary lives at [`assets/sample-dicts/sn-tech-jargon/`](assets/sample-dicts/sn-tech-jargon/). Use it to verify your device picks up sideloaded dicts before you commit to producing your own.

**1. Build and install the plugin** as described in [Building](#building) and [Installing on the device](#installing-on-the-device). User-dict discovery is part of v1.x — confirm you're running a build from this branch (or any commit including this section's history), not the published v1.0.1.

**2. Transfer the sample folder to your Supernote.** Pick whichever of these you already use:

- **USB:** plug the device in, it mounts as a USB drive. Navigate to `MyStyle/`, create a folder named `SnDict` if it doesn't exist, and copy `assets/sample-dicts/sn-tech-jargon/` into it. Eject the device.
- **WebDAV:** in the Supernote settings, enable WebDAV and note the IP/port. From a desktop, connect (Finder on macOS via "Connect to Server", Windows via "Map Network Drive", Linux via `davfs2`), navigate to `MyStyle/SnDict/` (create `SnDict` if absent), and drop the folder in.
- **Supernote Cloud / sync:** put the folder under `MyStyle/SnDict/` in your synced workspace and let the device pull it down.

The end-state on the device should be:
```
MyStyle/SnDict/sn-tech-jargon/
├── meta.json
├── sn-tech-jargon.ifo
├── sn-tech-jargon.idx
└── sn-tech-jargon.dict.dz
```

**3. Re-trigger plugin discovery.** Discovery runs once per plugin process at startup. The simplest way to force a fresh run is to leave-and-reenter a note: navigate out of the note app entirely (back to the launcher), then open a note again. If you've just installed the plugin in the same session, it'll already be a fresh process.

**4. Test a lookup against an entry only the sample dict has.** The sample contains ~30 tech-jargon terms that WordNet does *not* — pick any of these, write or print it on a note page, lasso it, and tap **Lookup**:

- `API`, `REST`, `CRUD`, `GraphQL`, `WebSocket`, `idempotent`, `monorepo`, `microservice`
- `embedding`, `tokenizer`, `inference`, `finetune`, `RAG`
- `observability`, `CDN`, `TTL`, `digitizer`, `EPD`, `ghosting`
- `middleware`, `shim`, `polyfill`, `webhook`, `pagination`, `postmortem`
- `YAGNI`, `bikeshedding`, `yakshave`

The popup should show a single **Tech Jargon** section with the entry's definition. Because the bundled WordNet doesn't have these, only one section appears (no source-badge clutter).

**5. Test multi-source rendering.** Look up a word that exists in *both* dicts — for example, `embedding` (sample) and a common English word like `language` (WordNet). Lasso a word that hits both: try the headword `inference` (in the sample) — WordNet also defines "inference". You should see two sections in the popup, each with a bordered source badge: `Tech Jargon` first, then `WordNet` below.

**6. Verify via logcat (optional).** Capture a logcat from your device after plugin start. Look for lines like:

```
ReactNativeJS: [discovery] discovered 1 user dict(s): [Tech Jargon]
ReactNativeJS: [startup] registry now has 2 source(s): [Tech Jargon, WordNet]
```

If you see `[discovery] root "/storage/emulated/0/MyStyle/SnDict" not listable …` the folder isn't on the device yet — re-check step 2. If you see `folder "sn-tech-jargon" has no recognised dict files — skipped` the file names didn't transfer cleanly (some sync tools rename or strip extensions); re-copy the originals from this repo.

To regenerate the sample after editing entries in `scripts/buildSampleDicts.mjs`: `npm run build:sample-dicts`.

## Limits

- **English only** for the bundled dictionary content. Other languages are out of scope for the base; see *Adding your own dictionary* above for sideloading user dicts in StarDict / CSV / JSON formats.
- **Tap-on-existing-word** (no lasso, just tap a written word) is **not currently supported by the SDK** — there is no spatial-query API to ask "what stroke is under this point?". A pen/touch event API is on Dunn-sn's roadmap; tap-to-define is tracked for v1.x.
- **`PEN_UP` auto-define** — explicitly *not* a feature. The "OCR every stroke as you write" UX is intrusive without a clean word-boundary signal; lookups are user-initiated only.
- **Bundle size:** ~17MB (~16MB of base64-encoded WordNet plus the JS bundle). The Supernote firmware confirmed no `.snplg` size limit, but the bundle parse on first plugin-host spin-up is the main rough edge today (~30–60s on a Nomad). Once parsed, lookups are instant.

## Building

Make sure you have Node.js 18+ installed, then:

```sh
npm install
./buildPlugin.sh
```

This produces `build/outputs/SnDict.snplg`. The build script automatically runs `npm run prepare:dict` first, which:

1. Fetches the WordNet StarDict bundle (~10MB tar.bz2) from the dict.org community mirror to `dict/wordnet/` if not already present.
2. Base64-encodes the three files (`.ifo`, `.idx`, `.dict.dz`) and emits `src/core/dict/data/baseDictData.ts`.

Both `dict/wordnet/*` and `src/core/dict/data/baseDictData.ts` are git-ignored — they are regenerable from the build pipeline and would otherwise add ~16MB of base64 to every commit.

## Installing on the device

1. Build the plugin (`./buildPlugin.sh`) or download `SnDict.snplg` from the [latest release](https://github.com/j-raghavan/sn-dictionary/releases).
2. Use the Supernote Partner App to copy `build/outputs/SnDict.snplg` to the `MyStyles` folder on your device.
3. On the Supernote, navigate to **Settings → Apps → Plugins → Add Plugin** and select the file.
4. Plugin appears as **Dictionary** (or 词典 / 詞典 / 辞書 / พจนานุกรม / Woordenboek depending on your device locale).

## Running tests

```sh
npm test
```

Covers 175 unit tests across 20 suites: the StarDict reader (`.ifo` parser, `.idx` parser, dictzip decompression, orchestrator, lazy-init lookup), the synthetic StarDict writer used by tests and the placeholder dict, the WordNet entry formatter (3 sense-line shapes, multi-POS entries, synonyms wrapping across lines, examples, defensive paths), the on-device pipeline handlers (NOTE lasso branching on `trailNum` / `trailLinkNum` / `titleNum`, DOC selection, reentrancy guard, busy/empty/crash paths), the bilingual UI chrome (locale resolution, hyphen/region fallbacks, missing/throwing `Intl`, defensive string-id fallback), the popup component (visible/hidden states, found/not-found rendering, parsed-WordNet vs raw-text fallback, Close button → `PluginManager.closePluginView`), and the small SDK utility modules (UTF-8 codec with platform fast-path + manual fallback, base64 decoder with the same shape, reentrancy guard, `safeClosePluginView`, `unwrap`).

Coverage thresholds are enforced in `jest.config.js` at **97%** statements / branches / functions / lines globally. Current measured coverage is **100% statements / 97.76% branches / 100% functions / 100% lines** across `src/`.

To regenerate the coverage report:

```sh
npm run coverage
```

## Linting

```sh
npm run lint
```

## Project structure

```
src/
  buttons/
    registerNoteLassoButton.ts   type:2 lasso button (NOTE, editDataTypes:[0])
    registerDocSelectButton.ts   type:3 selection button (DOC)
    buttonCommon.ts              shared types + resolveIconUri helper
  core/
    reentrancyGuard.ts           module-level guard, sync-release-before-await
    lookup.ts                    type-only DictLookup contract
    dict/
      stardictLookup.ts          DictLookup impl: lazy-init + custom-shadows-base
      stardict/
        parseIfo.ts              .ifo header parser
        parseIdx.ts              .idx (32 / 64-bit offsets, UTF-8 words) parser
        decompressDict.ts        pako wrapper: gzip magic detection, full inflate
        stardictDict.ts          orchestrator: case-insensitive Map index + lookup
        writeStardict.ts         StarDict writer used by tests + build pipeline
      data/
        baseDictData.ts          AUTO-GENERATED: base64-encoded WordNet
                                 (gitignored; regenerated by `npm run build:dict`)
  handlers/
    onNoteLassoDefine.ts         NOTE pipeline (counts → recognize → lookup → setLassoBoxState)
    onDocSelectDefine.ts         DOC pipeline (getLastSelectedText → lookup)
  i18n/
    i18n.ts                      t(id), detectLocale, localizedButtonName / Plugin
                                 name; en / zh_CN / zh_TW / ja / th / nl
  sdk/
    types.ts                     APIResponse<T>, Logger
    unwrap.ts                    APIResponse<T> → T or throw
    closeView.ts                 safeClosePluginView wrapper
    utf8.ts                      Platform Intl + manual UTF-8 codec fallback
    base64.ts                    Platform atob + manual base64 decoder fallback
  ui/
    DefinitionPopup.tsx          popup: structured senses or raw fallback + Close
    popupController.ts           module-level state + subscribe; getCurrentState
                                 for initial value (avoids React commit-phase warn)
    wordnetFormatter.ts          parses raw WordNet entry → senses[]; labelForPos
scripts/
  fetchBaseDict.sh               idempotent download from dict.org mirror
  buildBaseDict.mjs              base64-encode → emit baseDictData.ts
.github/workflows/
  ci.yml                         lint + test + build .snplg artifact per push
  release.yml                    manual workflow_dispatch; lint+test, version
                                 bump, build, tag, GitHub Release with notes
__tests__/                       Jest suites (one per src module + helpers)
index.js                         plugin entry: PluginManager.init, button + handler
                                 wiring, eager-load probe for diagnostics
App.tsx                          React Native root: renders DefinitionPopup
PluginConfig.json                plugin metadata (id, version, locale-aware name)
buildPlugin.sh                   build: prepare:dict + Metro bundle + .snplg zip
```

## Architecture notes

**The reader is vendored, not a third-party dependency.** The MIT-compatible `mdict-js` package on npm is named confusingly close to the AGPL-3.0 `js-mdict` (different maintainers, different licenses) — bundling the AGPL one into the `.snplg` would force the entire plugin to AGPL on distribution, which I explicitly didn't want. No maintained MIT-licensed StarDict reader exists on npm, so I wrote one (~250 LoC across `parseIfo`, `parseIdx`, `decompressDict`, `stardictDict`). The only third-party runtime dependency is `pako` (MIT) for gzip / dictzip inflate.

**Hermes / JSC defensive polyfills.** Early on-device runs revealed that `console.warn` output is not reliably visible in `adb logcat` on the Supernote firmware — every `ReactNativeJS:` line lands at info level. This forced two defensive layers: (1) the logger in `index.js` routes every level through `console.log` with `[WARN]` / `[ERROR]` prefixes; (2) `src/sdk/utf8.ts` and `src/sdk/base64.ts` try platform globals (`TextEncoder` / `TextDecoder` / `atob`) but fall back to portable inline implementations when the host throws on construction or returns malformed values. These fallbacks are tested via `jest.isolateModules`-based simulations of missing or broken globals.

**The popup never closes the firmware overlay from the handler.** Initial implementation called `closePluginView()` in the handler's `finally` block (matching the sn-formula pipeline pattern, where there is no popup). On a popup-bearing flow this orphans the firmware overlay window — pen taps land nowhere afterwards and the device hangs. Fixed to track a `popupShown` flag in the handler; `closePluginView` only fires on early-exit paths (empty lasso, recognize-empty, busy guard, pipeline crash). On the success path the popup's Close button calls `PluginManager.closePluginView()` directly, fire-and-forget — sn-shapes and sn-mindmap use the same pattern.

**Single lasso button with stroke-family `editDataTypes`.** The firmware applies stricter semantics on `editDataTypes` than the SDK doc suggests: a button with `[0, 3]` (stroke + text-box) is hidden on every lasso, not just shown for the union. Splitting into two buttons (`[0]` and `[3]`) surfaces both as duplicates in the toolbar. Settled on a single `[0]` registration; the handler's branch covers `trailNum + trailLinkNum + titleNum` so freshly-written, saved-and-reloaded, and title-recognised handwriting all flow through the same OCR path. Typed text-box lookup is intentionally out of scope for v1.

## Acknowledgements

- **Dunn-sn** (Supernote SDK engineer) — direct DM responses on plugin SDK questions: confirmed the DOC text-selection model (`getLastSelectedText`), the `EventType.PEN_UP` listener's behaviour, the deprecation of `NativePluginManager.showPluginView()`, and that `.snplg` packaging auto-includes everything in `build/generated/`. The reader and handler design are downstream of those answers.
- **`OkReward5192`** (r/Supernote_dev) — community thread on dictionary plugins, including the empirical observation that the SDK only supports lasso / text-selection entry gestures (no tap-on-word).
- **Princeton WordNet** (BSD-style license) — the bundled English content. Distribution via the dict.org community mirror.
- **`pako`** (MIT) — the only third-party runtime dependency.
- Sibling Supernote plugins **`sn-shapes`** and **`sn-mindmap`** — patterns for the lasso pipeline (delete-before-recognize, `setLassoBoxState(2)`, reentrancy guard with sync-release), popup close semantics (`PluginManager.closePluginView` from the close button), and the localized `nameMap` shape on `PluginButton.name`.

## License

MIT — see [LICENSE](./LICENSE).

The bundled WordNet content is distributed under its own [WordNet license](https://wordnet.princeton.edu/license-and-commercial-use) (BSD-style; free for any use including redistribution).

---

Hope you find this plugin useful. If you hit a bug or have a feature request, please open an [issue](https://github.com/j-raghavan/sn-dictionary/issues).
