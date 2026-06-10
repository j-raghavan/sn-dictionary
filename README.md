# Dictionary Plugin for Supernote

![Tests](https://img.shields.io/badge/tests-1118%20passed-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-99%25%20lines%20%2F%2098%25%20branches-brightgreen)
![Lint](https://img.shields.io/badge/lint-passing-brightgreen)
![Platform](https://img.shields.io/badge/platform-Supernote-blue)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.1.0-blue)

A Supernote plugin that adds offline English-word lookup to handwritten notes and PDFs. Lasso a word in your notes (handwritten or recognised) or select text in the PDF reader, tap **Lookup**, and the plugin shows the WordNet definition — multiple senses, part-of-speech, synonyms, and example sentences — in a centred popup. Everything runs on-device; no companion app, no cloud, no network calls at lookup time.

## Features

- **Two entry gestures, one popup.** Lasso handwritten or already-recognised text on a note page → tap **Lookup** in the lasso toolbar; or select text in the PDF reader → tap **Lookup** in the selection toolbar. Both flows feed the same on-device dictionary and render in the same structured popup.
- **Real WordNet content + thesaurus.** 149,535 Princeton WordNet 2.x definitions (BSD-style license) plus an English synonym/antonym thesaurus from Open English WordNet 2023 (CC BY 4.0) and the Moby Thesaurus (public domain), built into a single prebuilt SQLite `base.db` that ships inside the `.snplg` and is opened on-device by the native SQLite engine. No network at runtime; lookup is one indexed `SELECT` (no per-reload parse).
- **OCR-aware.** When you lasso handwriting, the plugin runs the firmware's stroke recogniser (`recognizeElements`) before the lookup, so the popup shows what was *recognised* alongside the matching definition. Saved-and-reloaded handwriting (`trailLink`) and recognised titles (`title`) are covered by the same path — not just freshly-drawn strokes.
- **Structured popup.** Each WordNet sense renders as its own block: a part-of-speech badge (*noun* / *verb* / *adjective* / *adverb*), a numbered sense, the definition, italicised example sentences in curly quotes, and a `Synonyms:` line. Senses are visually separated so multi-sense entries (e.g. "AI" — Army Intelligence vs. artificial intelligence vs. three-toed sloth vs. artificial insemination) are scannable at a glance.
- **Bilingual UI chrome.** The plugin name on the plugin manager card, the **Lookup** toolbar label, and every popup label (`Synonyms:`, `OCR:`, `No definition found for…`, `Close`) localise into Simplified Chinese, Traditional Chinese, Japanese, Thai, Dutch, and German based on the device's system locale. The dictionary content stays English; the surrounding chrome doesn't.
- **Case- and whitespace-insensitive.** "Anatomy", "anatomy", and "  ANATOMY  " all hit the same entry.
- **Bring-your-own dictionary** *(shipped)* — drop a **StarDict** folder or a **CSV** file into `MyStyle/SnDict/` and the plugin imports it into its own SQLite DB at startup (native, off-thread; **source files are kept by default** — a Settings toggle / first-run prompt lets you opt in to deleting them after a verified import). User dictionaries precede the base on lookup, so your terms shadow generic ones, and a `meta.json` sidecar can name the dict, set its language, and (for CSV) map columns including an optional phonetic field. A separate prebuilt custom `.snplg` via an in-browser converter (Prong B) may still come later.

## Demo

### v1.0.1

https://github.com/user-attachments/assets/5539c6bf-0c5c-4fb8-89ee-464f9f34a0aa

### v1.0.2 

https://github.com/user-attachments/assets/ddeda359-761e-40c9-895b-e7eb6db71b0d

### v1.0.6

https://github.com/user-attachments/assets/ea5f54cb-7b18-4d64-a591-c3cc13b558f6


## How it works

The plugin owns **the OCR-to-lookup pipeline and the rendering**. On lasso tap or PDF text selection:

1. **Reentrancy guard** acquired (single in-flight pipeline at a time, regardless of context). Released synchronously *before* awaiting `closePluginView` — the host's `state:stop` transition can suspend the JS context, and clearing the flag after the await would leave it stuck.
2. **NOTE lasso path:** `getLassoElementTypeCounts` → branches if any of `trailNum`, `trailLinkNum`, or `titleNum` is non-zero → `getLassoElements` + page-info → `recognizeElements` (no `deleteLassoElements`; lookup is non-destructive) → `setLassoBoxState(2)` clears the lasso UI.
3. **DOC selection path:** `getLastSelectedText` returns the user's selected text directly.
4. **Lookup core** — a native SQLite engine over the bundled `base.db` (host-extracted to `plugins/<id>/`, opened by `{name, location}`). A lookup is one indexed `SELECT word, definition, format FROM entries WHERE key = ?` with a normalized key — no parse, no in-memory index, constant cold-start. Multiple sources (`[user.db, …imported, base.db]`) fan out and return the union.
5. **Popup** — a WordNet-format entry is parsed into `{senses: [{pos, index, definition, examples, synonyms}]}` by `wordnetFormatter.ts` and rendered as discrete sense blocks; a Definition/Thesaurus toggle shows synonyms/antonyms (lazy `lookupThesaurus`).
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

Lookup is ready in well under a second after the plugin process spins up — the native SQLite engine just opens the prebuilt `base.db` (no parse, no in-memory index build), and every lookup is a single indexed `SELECT`. (Measured ~250 ms to Lookup-ready on a note re-open; ADR-0007.)

## Settings

Tap the **gear (⚙)** in the top-right of any lookup popup to open Settings. Edits are staged locally and only written when you tap **Save** (a "Settings saved" line confirms); **Back** returns to the definition.

- **Dictionaries** — every active source (the bundled WordNet, your saved words, and each imported dict) shows with a checkbox. Tap a row to enable/disable it; disabled sources are skipped on lookup (turning them all off warns you). With two or more dictionaries the **↑ / ↓** arrows reorder precedence — results appear in this order, so move the dictionary you want first to the top. An imported dictionary also has a **Remove** button: it confirms (naming the dictionary), then deletes its database and any leftover source files. If a source file can't be deleted, you're warned the dict may reappear on the next reload.
- **Import sources** — the **Keep source files after import** toggle decides whether the files you dropped in `MyStyle/SnDict/` are kept after the dictionary is built, or deleted once the import is verified (default: keep). The same choice is offered once, the first time you import.
- **Backup** — **Export** copies the bundled `base.db`, your `user.db` (saved words + settings), and every imported dictionary to a folder you choose under `MyStyle/`. **Restore** copies those DBs back over the live ones — reopen the plugin afterwards to finish. `base.db` is included in an export but is never overwritten on restore (it ships with the plugin).
- **Copy** — in the definition popup, the **Copy** button puts the headword plus the current tab's text (definition or thesaurus) on the device's system clipboard for pasting into other apps. Pasting into handwritten notes isn't supported — the firmware's note-element clipboard isn't exposed to plugins.

## Adding your own dictionary

The plugin scans `MyStyle/SnDict/` on every launch. A discovered dict is **imported** — parsed (natively, off the JS thread) and inserted into a self-contained SQLite DB under the plugin dir. **By default the source files are kept** (a Settings toggle / one-time first-run prompt lets you opt in to deleting them after a verified commit). Imported dicts appear as separate sections in the popup, ahead of the bundled WordNet base — so a domain glossary like "medical" supplements the general definition rather than replacing it. Because sources are kept, a re-dropped dict that's already imported is just re-opened (idempotent), **not** re-imported — to refresh it, drop a `.refresh` marker in its folder (`<name>.refresh` beside a CSV) or toggle delete on and re-drop; multiple dicts per language coexist.

### Layout

Two layouts are supported — **StarDict** (one subfolder per dict; the triple is multiple files that must live together) and **CSV** (a single loose file dropped at the root):

```
MyStyle/
└── SnDict/
    ├── Dune.csv                      (CSV — a loose file IS a dict, named "Dune")
    ├── Dune.meta.json                (OPTIONAL per-file sidecar for Dune.csv)
    ├── meta.json                     (OPTIONAL shared sidecar — its csv.* config
    │                                  applies to every CSV; its name is NOT used)
    ├── medical-en/                   (StarDict — one subfolder per dict)
    │   ├── meta.json                  (OPTIONAL — name + language)
    │   ├── medical.ifo
    │   ├── medical.idx
    │   ├── medical.dict.dz
    │   └── medical.syn               (optional — synonym/transliteration index)
    └── wikdict-de/
        ├── de.ifo
        ├── de.idx
        └── de.dict.dz                (no meta.json — loads with defaults)
```

Both formats are imported the same way (parsed → inserted into a SQLite DB → **source files kept by default**, or deleted after a verified commit if you opt in via the Settings toggle / first-run prompt); when deleting, StarDict's now-empty subfolder is removed too.

`meta.json` is **optional** for both. For StarDict:

```json
{ "name": "Medical en→en", "language": "en" }
```

- **With `meta.json`** — `name` is the popup section label; `language` (ISO-639-1) enables the Thesaurus tab for that dict.
- **Without `meta.json`** (or an invalid one) — the dict still loads with the **folder name** as the label and language `und` (undetermined). Definitions work fully; the Thesaurus tab is simply empty (it needs a known language). *Definition lookup is never gated on the sidecar* (ADR-0007).

For a CSV the name is **always the filename** (`Dune.csv` → "Dune"); a sidecar only adds `language` and the column layout:

```json
{ "language": "en", "csv": { "headwordCol": 0, "definitionCol": 1, "phoneticCol": 2, "hasHeader": false } }
```

- **Defaults** (no sidecar / no `csv` block): column 0 = headword, column 1 = definition, no phonetic, no header row, language `und`.
- A per-file `Dune.meta.json` overrides the shared root `meta.json` (key by key); the shared `meta.json`'s `csv` block is the base config for **every** CSV, but its `name` is never broadcast.
- CSV parsing is **RFC-4180** (quoted fields, embedded commas/newlines, `CRLF`/`LF`/lone-`CR`), with **CP1252** and **UTF-16** (BOM-sniffed) decoding. The headword is trimmed; the **definition is preserved verbatim** (leading/trailing whitespace kept); an optional `phoneticCol` surfaces a pronunciation. First occurrence wins on duplicate (folded) keys.

### Supported formats

| Format | Files | Notes |
|---|---|---|
| **StarDict** | `*.ifo` + `*.idx` + (`*.dict.dz` or `*.dict`) [+ optional `*.syn`] | One subfolder per dict. Free dictionaries at [FreeDict](https://freedict.org) and [dict.org](http://dict.org). |
| **CSV** | a loose `*.csv` at the `SnDict/` root [+ optional `*.meta.json`] | RFC-4180; CP1252/UTF-16 aware; ≤ 10 MB. Drop a glossary `Name.csv` directly in `SnDict/`. |

A subfolder without a complete StarDict triple — or a CSV over the size cap — is logged and skipped; discovery is fault-isolated, so one bad item doesn't break the rest. For **other** formats (MDX, EPUB, Babylon, …) convert to StarDict via [`pyglossary`](https://github.com/ilius/pyglossary) (`pip install pyglossary`; reads ~50 formats, writes StarDict).

### Where to find dictionaries

Most users won't author a StarDict from scratch — there are huge corpora of pre-built dicts in the wild. Five sources cover the long tail:

- **[FreeDict](https://freedict.org/)** — open-source bilingual dictionaries, native StarDict format, MIT/CC-licensed. Direct downloads at [freedict.org/freedict-database.json](https://freedict.org/freedict-database.json) (machine-readable) or browse the per-language pages. Covers German, French, Italian, Spanish, Portuguese, Dutch, Russian, Japanese, Czech, Polish, Hungarian, Swedish, Turkish, Arabic, Hebrew, and more.
- **[WikDict](https://download.wikdict.com/dictionaries/stardict/)** — translation dictionaries between non-English language pairs (de↔fr, fr↔de, it↔es, la↔fr, …) plus FreeDict cross-language pairs, derived from Wiktionary via DBnary. CC-BY-SA. Particularly useful for language learners who want a non-English source/target without going through English. Native StarDict format.
- **[xxyzz/wiktionary_stardict](https://xxyzz.github.io/wiktionary_stardict/)** — Wiktionary-derived StarDict bundles for 100+ language pairs, including monolingual heavyweight dicts (~100 MB+ for full-language Wiktionaries). Actively maintained. Native StarDict format, CC-BY-SA. *(Thanks to [@alioth9](https://github.com/alioth9) for the pointer.)*
- **[Wiktionary-Dictionaries (Vuizur)](https://github.com/Vuizur/Wiktionary-Dictionaries)** — actively-maintained Wiktionary dumps converted to StarDict, ~100+ language pairs including monolingual entries. CC-BY-SA. Comparable to xxyzz's collection — try whichever has better coverage for your specific pair.
- **[huzheng.org](http://download.huzheng.org/)** — the historical StarDict archive. Heavy on Chinese and Japanese options; mixed licensing (check each entry). Site is occasionally slow or down — Wiktionary-Dictionaries / xxyzz are the modern alternatives for most languages.

#### Quick pointers per language

| Language | Reasonable starting points |
|---|---|
| **Chinese (zh)** | CC-CEDICT (Chinese ↔ English) via [Vuizur](https://github.com/Vuizur/Wiktionary-Dictionaries) or huzheng. For monolingual zh, Wiktionary zh on Vuizur. |
| **Japanese (ja)** | JMdict / EDICT (Japanese ↔ English) on huzheng or Vuizur. KANJIDIC for kanji-specific lookups. |
| **Italian (it)** | FreeDict `eng-ita` and `ita-eng` for bilingual; Wiktionary it on Vuizur for monolingual definitions. |
| **Dutch (nl)** | FreeDict `eng-nld` and `nld-eng`; Wiktionary nl on Vuizur. |
| **German (de)** | FreeDict `eng-deu` and `deu-eng` for bilingual via English; **WikDict `de-fr`/`fr-de`** or `de-es`/`es-de` for direct non-English pairs; Wiktionary de on Vuizur or xxyzz for monolingual. |
| **French (fr)** | FreeDict `eng-fra` and `fra-eng`; WikDict has `fr-de`, `fr-it`, `fr-es`, `la-fr`; Wiktionary fr on Vuizur or xxyzz. |
| **Spanish (es)** | FreeDict `eng-spa` and `spa-eng`; WikDict has `es-de`, `es-it`, `es-fr`; Wiktionary es on Vuizur or xxyzz. |
| **Russian (ru)** | FreeDict `eng-rus` and `rus-eng`; Wiktionary ru on Vuizur. |
| **Korean (ko)** | Wiktionary ko on Vuizur. |
| **Polish, Czech, Hungarian, Swedish, Portuguese, Turkish, Arabic, Hebrew, …** | FreeDict has bilingual pairs against English; Wiktionary-Dictionaries has monolingual + many cross-language pairs. |

#### A few notes worth knowing before you grab one

- **Most downloads ship as `.tar.bz2` or `.zip`.** Extract first, then drop the resulting folder (or its files) into `MyStyle/SnDict/`. A typical extracted layout matches the organised layout described above — `.ifo` + `.idx` + `.dict.dz` together.
- **Wikdict / Wiktionary-derived dicts use HTML formatting** (`sametypesequence=h` in the `.ifo`). The popup strips the tags and lays out the resulting blocks — IPA on its own line, part-of-speech on its own line, definition body, then translations on separate lines. v1.0.6 and earlier had a bug where translation blocks (`<div>...</div>`) glued to the definition text above (e.g. `…sichtbar istastre`); v1.0.7+ renders them on their own lines correctly.
- **Licensing.** For personal use on your own device, every source above is fine. If you plan to redistribute (e.g., bundle into a custom `.snplg`), check the per-dict license — FreeDict is permissive, Wiktionary-derived dicts are CC-BY-SA, huzheng entries vary.
- **Morphology / inflected forms.** Highly inflected languages (German declensions, Italian conjugations) are only as good as the dict's headword coverage. Wiktionary-derived dicts generally include inflected forms; FreeDict's coverage varies. If lassoing `Häuser` returns "no entry," try lassoing the lemma `Haus` to confirm the dict simply lacks form folding rather than your sideloading being broken.
- **If you have a dict in a different format** (MDX, EPUB-based, SDictionary, Babylon, …), [`pyglossary`](https://github.com/ilius/pyglossary) is the gold-standard CLI converter — it reads ~50 formats and writes StarDict. One-line install via `pip install pyglossary`, then `pyglossary --read-format=mdx --write-format=stardict input.mdx`.

### File-size limits

| Format | Hard cap | Notes |
|---|---|---|
| **CSV** | **10 MB** | A file over the cap is refused with a `[WARN]` log and skipped (the import returns `{ok:false}`; the registry is untouched). Under the cap it imports normally. |
| **StarDict** | **no explicit cap** | Bound by device RAM. The bundled WordNet at ~16 MB works fine; 50 MB+ dicts (e.g. JMdict, Wiktionary-derived) should also work but are untested on-device — file an issue if you hit a hang. |

The cap is per file, so you can have many dictionaries side by side without their sizes adding up against any combined limit.

### How long before a new dictionary is ready?

Two different things, and both are fast — there is **no per-session parse**. Every dictionary is a prebuilt/indexed SQLite DB, and every lookup is a single indexed `SELECT` (~70 ms on a Manta).

**The bundled English dictionary is ready in ~0.25 s.** `base.db` (149k entries + thesaurus) ships *prebuilt* inside the `.snplg` and is *opened*, not parsed — the **Lookup** button is live within ~250–450 ms of the plugin starting (measured on a Manta).

**A sideloaded dictionary is imported once, in the background.** When you drop a dict into `MyStyle/SnDict/`, it's indexed into its own SQLite DB at plugin start by a native (Kotlin) importer running **off the JS thread** — so it never blocks lookups, and the base dictionary is usable immediately. The new dict splices into the registry the moment its import finishes; after that it's permanent (the DB persists, so the next launch just *opens* it in milliseconds, like the base dictionary). **Source files are kept by default** — on the next launch the kept-and-already-imported set is recognized and re-opened, not re-imported (no duplicate work, no loop); opt in to deleting sources after import via the Settings toggle / one-time first-run prompt.

Import time scales with **entry count** at a steady **~18,000 entries/sec** (measured on a Manta), i.e. roughly `entries ÷ 18,000`:

| Dictionary | Entries | One-time import |
|---|---|---|
| Small CSV (e.g. `Dune.csv`) | ~300 | <1 s |
| Mid StarDict (`fr-en`) | ~417,000 | ~23 s |
| Large StarDict (`jp-en`) | ~780,000 | ~44 s |
| Wiktionary-class | 2–5 M | a few minutes |

Notes:

- **One-time only.** After the first import the dict lives in its own DB; every later launch just *opens* it (milliseconds) — there is no re-parse, ever.
- **Non-blocking.** The **Lookup** button is live immediately after plugin start. A lookup taken *during* an import answers from whatever is already loaded (base + any finished imports); the importing dict appears as soon as it completes.
- **Native imports run one at a time** — queue several large dicts and they import sequentially (off-thread), so the last one lands later. CSV imports run in JS (small files, ≤10 MB cap).

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

- **English only** for the bundled dictionary content. Other languages are out of scope for the base; see *Adding your own dictionary* above for sideloading user dicts in StarDict or CSV format.
- **Tap-on-existing-word** (no lasso, just tap a written word) is **not currently supported by the SDK** — there is no spatial-query API to ask "what stroke is under this point?". A pen/touch event API is on Dunn-sn's roadmap; tap-to-define is tracked for v1.x.
- **`PEN_UP` auto-define** — explicitly *not* a feature. The "OCR every stroke as you write" UX is intrusive without a clean word-boundary signal; lookups are user-initiated only.
- **Bundle size:** the `.snplg` ships the prebuilt `base.db` (WordNet + EN OMW + Moby thesaurus) plus the native `app.npk` and the JS bundle. There is no base64 blob and no first-run parse — the native SQLite engine opens `base.db` directly, so Lookup is ready in well under a second (no per-reload cost).

## Building

The plugin ships **native code** (a vendored SQLite module + a Kotlin StarDict importer), so a build needs Node.js 18+ **and** the Android toolchain (Gradle/NDK). Build on macOS/Linux (or WSL):

```sh
npm install
./buildPlugin.sh         # macOS / Linux (the native build path)
```

`buildPlugin.sh` produces `build/outputs/SnDict.snplg` and runs the full pipeline:

1. `npm run prepare:dict` — fetches the WordNet StarDict source to `dict/wordnet/` (read directly by the generator; no base64 blob).
2. `npm run prepare:omw` — fetches Open English WordNet 2023 and builds the EN thesaurus TSV.
3. `npm run prepare:moby` — stages the public-domain Moby Thesaurus StarDict to `dict/moby/` (optional; the build warn-skips it if absent).
4. `npm run build:base-db` — folds the WordNet entries + OMW + Moby thesaurus into a prebuilt `build/base.db`, staged at the **`.snplg` root** (the host extracts it to `plugins/<id>/base.db`).
5. Metro bundle → `gradlew buildCustomApkDebug` → `app.npk` → zips everything into `SnDict.snplg`.

`dict/wordnet/`, `dict/omw/`, and `build/` are git-ignored (regenerable). **`buildPlugin.ps1` does NOT support native builds** — it errors and points you to `buildPlugin.sh`.

> **Note on `nativeCodePackage`.** `PluginConfig.json`'s `nativeCodePackage` field (pointing at the built `app.npk`) is **injected by `./buildPlugin.sh` at build time** — it is not committed. Local native development therefore requires running `./buildPlugin.sh` (a Metro-only `npm start` won't produce the native module or wire it up).

## Installing on the device

1. Build the plugin (`./buildPlugin.sh` on macOS/Linux, `.\buildPlugin.ps1` on Windows) or download `SnDict.snplg` from the [latest release](https://github.com/j-raghavan/sn-dictionary/releases).
2. Use the Supernote Partner App to copy `build/outputs/SnDict.snplg` to the `MyStyles` folder on your device.
3. On the Supernote, navigate to **Settings → Apps → Plugins → Add Plugin** and select the file.
4. Plugin appears as **Dictionary** (or 词典 / 詞典 / 辞書 / พจนานุกรม / Woordenboek depending on your device locale).

## Running tests

```sh
npm test
```

Covers 1,118 unit tests across 58 suites (gate: 97 %+ coverage), run against an in-memory `better-sqlite3` adapter that stands in for the on-device SQLite engine. Broadly: the **SQLite engine** (parameterized lookup, schema/migrations, multi-dict fan-out, the dictionary source), **import** (StarDict `.ifo`/`.idx`/`.syn` reader + dictzip, CSV/RFC-4180 parsing, the shared `runImport` verify→commit→audit spine), the **bootstrap composition root** (provisioning, reconcile, detached imports, the F3 dictionary manager, F7 delete with `sourcesAtRisk`), **settings persistence** (dict prefs, keep-sources, app settings), **export/restore** (the plugin-dir guard, space pre-check, per-file copy, the snapshot/close-writable restore flow), the **thesaurus** (lazy fetch + assembly), the **popup component** (lookup/settings/thesaurus tabs, found/not-found, add-word, copy), **HTML rendering** (`htmlParser` → spans / plain text), the **multilingual UI chrome** across all seven locales, the on-device adapter contracts (`rnSqliteDb` transaction/checkpoint semantics, `identityKey` never embedding a NUL), and the small SDK utility modules. The device-only native modules (coverage-excluded) are mirrored by these host adapters against the same ports.

Coverage thresholds are enforced in `jest.config.js` at **97%** statements / branches / functions / lines globally. Current measured coverage is **100% statements / 97.76% branches / 100% functions / 100% lines** across `src/`.

To regenerate the coverage report:

```sh
npm run coverage
```

## Real-StarDict regression suite

```sh
npm run test:integration
```

End-to-end tests that download real Wikdict StarDicts (German↔French, French↔German, German↔English), SHA-verify each archive against the pins in `__tests__/integration/manifest.ts`, run the full StarDict→`htmlToPlainText` pipeline against real entries (`Gestirn`, `Hund`, `chien`, `maison`, `Buch`, …), then auto-clean the cache. Pass `--keep` (`npm run test:integration -- --keep`) to retain the downloads in `.cache/integration-dicts/` while iterating on assertions.

Why a separate command: the default `npm test` runs only the synthetic-fixture unit suite — fast, offline, deterministic. The integration suite needs network and ~12 MB of downloads, so it's opt-in for local development. **It is mandatory for releases**: `release.yml` runs it as a hard gate before producing any artifact, and a non-zero exit (test failure, SHA mismatch, or wikdict.com unreachable) blocks the release.

To add a new dict to the suite, capture its SHA-256 (`shasum -a 256 file.zip`), add it to `MANIFEST` in `manifest.ts` with a few headword expectations, mirror the entry in `scripts/runIntegrationTests.mjs`'s `MANIFEST_MIRROR` (the runner checks for drift between the two and fails loudly on mismatch), and re-run.

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
      normalizeKey.ts            shared lookup-key fold (TS; Kotlin port mirrors it)
      multiDictLookup.ts         registry: fan out over sources, return the union
      userDictDiscovery.ts       scan MyStyle/SnDict → StarDict import-job descriptors
      sqlite/                    the LIVE engine: db port, sqliteDictSource, provision,
                                 bootstrap, buildBaseDb, thesaurus, import orchestration
      stardict/                  BUILD-TIME parsers (used by build:base-db + tests)
        parseIfo.ts / parseIdx.ts / parseSyn.ts / dictReader.ts / stardictDict.ts
        writeStardict.ts         StarDict writer used by tests
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
  ui/
    DefinitionPopup.tsx          popup: structured senses or raw fallback + Close
    popupController.ts           module-level state + subscribe; getCurrentState
                                 for initial value (avoids React commit-phase warn)
    wordnetFormatter.ts          parses raw WordNet entry → senses[]; labelForPos
  android/                       Gradle project: vendored SQLite module +
                                 com/sndict/imports/* (the native Kotlin StarDict importer)
scripts/
  fetchBaseDict.mjs              idempotent WordNet download from dict.org mirror
  fetchOmw.mjs / buildOmw.mjs    fetch + build the EN OMW thesaurus TSV
  fetchMoby.mjs                  stage the public-domain Moby thesaurus StarDict
  buildBaseDb.mjs                fold WordNet + OMW + Moby into the prebuilt base.db
.github/workflows/
  ci.yml                         lint + test + build .snplg artifact per push
  release.yml                    manual workflow_dispatch; lint+test, version
                                 bump, build, tag, GitHub Release with notes
__tests__/                       Jest suites (one per src module + helpers)
index.js                         plugin entry: PluginManager.init, button + handler
                                 wiring, eager-load probe for diagnostics
App.tsx                          React Native root: renders DefinitionPopup
PluginConfig.json                plugin metadata (id, version, locale-aware name)
buildPlugin.sh                   build (macOS/Linux): prepare:dict + bundle + .snplg
buildPlugin.ps1                  build (Windows): same pipeline as buildPlugin.sh
```

## Architecture notes

**The reader is vendored, not a third-party dependency.** The MIT-compatible `mdict-js` package on npm is named confusingly close to the AGPL-3.0 `js-mdict` (different maintainers, different licenses) — bundling the AGPL one into the `.snplg` would force the entire plugin to AGPL on distribution, which I explicitly didn't want. No maintained MIT-licensed StarDict reader exists on npm, so I wrote one (~250 LoC across `parseIfo`, `parseIdx`, `decompressDict`, `stardictDict`). The only third-party runtime dependency is `pako` (MIT) for gzip / dictzip inflate.

**Hermes / JSC defensive polyfills.** Early on-device runs revealed that `console.warn` output is not reliably visible in `adb logcat` on the Supernote firmware — every `ReactNativeJS:` line lands at info level. This forced two defensive layers: (1) the logger in `index.js` routes every level through `console.log` with `[WARN]` / `[ERROR]` prefixes; (2) `src/sdk/utf8.ts` tries the platform `TextEncoder`/`TextDecoder` but falls back to a portable inline UTF-8 codec when the host throws on construction or returns malformed values. The fallback is tested via `jest.isolateModules`-based simulations of missing or broken globals. (The old `sdk/base64.ts` was removed with the base64 blob — M14.)

**The popup never closes the firmware overlay from the handler.** Initial implementation called `closePluginView()` in the handler's `finally` block (matching the sn-formula pipeline pattern, where there is no popup). On a popup-bearing flow this orphans the firmware overlay window — pen taps land nowhere afterwards and the device hangs. Fixed to track a `popupShown` flag in the handler; `closePluginView` only fires on early-exit paths (empty lasso, recognize-empty, busy guard, pipeline crash). On the success path the popup's Close button calls `PluginManager.closePluginView()` directly, fire-and-forget — sn-shapes and sn-mindmap use the same pattern.

**Single lasso button with stroke-family `editDataTypes`.** The firmware applies stricter semantics on `editDataTypes` than the SDK doc suggests: a button with `[0, 3]` (stroke + text-box) is hidden on every lasso, not just shown for the union. Splitting into two buttons (`[0]` and `[3]`) surfaces both as duplicates in the toolbar. Settled on a single `[0]` registration; the handler's branch covers `trailNum + trailLinkNum + titleNum` so freshly-written, saved-and-reloaded, and title-recognised handwriting all flow through the same OCR path. Typed text-box lookup is intentionally out of scope for v1.

## Acknowledgements

- **Dunn-sn** (Supernote SDK engineer) — direct DM responses on plugin SDK questions: confirmed the DOC text-selection model (`getLastSelectedText`), the `EventType.PEN_UP` listener's behaviour, the deprecation of `NativePluginManager.showPluginView()`, and that `.snplg` packaging auto-includes everything in `build/generated/`. The reader and handler design are downstream of those answers.
- **`OkReward5192`** (r/Supernote_dev) — community thread on dictionary plugins, including the empirical observation that the SDK only supports lasso / text-selection entry gestures (no tap-on-word).
- **Princeton WordNet** (BSD-style license) — the bundled English definitions. Distribution via the dict.org community mirror.
- **Open English WordNet 2023** ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), <https://en-word.net/>) — the bundled English thesaurus (synonyms / antonyms in `base.db`).
- **`pako`** (MIT) — the only third-party runtime dependency.
- Sibling Supernote plugins **`sn-shapes`** and **`sn-mindmap`** — patterns for the lasso pipeline (delete-before-recognize, `setLassoBoxState(2)`, reentrancy guard with sync-release), popup close semantics (`PluginManager.closePluginView` from the close button), and the localized `nameMap` shape on `PluginButton.name`.

## License

MIT — see [LICENSE](./LICENSE).

### Bundled dictionary content (WordNet)

The bundled English dictionary is generated from **Princeton WordNet®** and shipped on-device as a pre-built SQLite database (`base.db`, produced by `npm run build:base-db`).

- **Source.** Princeton University WordNet 2.x/3.x lexical database — <https://wordnet.princeton.edu/>.
- **License.** Distributed under the [WordNet license](https://wordnet.princeton.edu/license-and-commercial-use) — a permissive BSD-style license that allows use, copying, modification, and redistribution (including commercial) provided the copyright notice and this attribution are retained.
- **Required attribution.** *WordNet® is a registered trademark of Princeton University.* The lexical content carries Princeton University's copyright notice; any redistribution of `base.db` (e.g. inside a custom `.snplg`) must preserve this attribution.

No WordNet content is modified semantically by the build: the generator only re-shapes the existing StarDict triple into indexed SQLite rows (`scripts/buildBaseDb.mjs`).

### Bundled thesaurus content (Open English WordNet)

The thesaurus (synonyms / antonyms) is **English-only** and built from **Open English WordNet 2023**, stored in the same `base.db` (the `thesaurus` table). It is staged via `npm run prepare:omw` (fetch + build → `dict/omw/omw.tsv`) and folded into `base.db` by `npm run build:base-db`.

- **Source.** Open English WordNet 2023 — <https://en-word.net/> (`scripts/fetchOmw.mjs` downloads the WN-LMF release `english-wordnet-2023.xml.gz`).
- **License.** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) — free to use, share, and adapt (including commercially) provided appropriate credit is given. **Attribution:** *Open English WordNet 2023, https://en-word.net/, licensed under CC BY 4.0.* Any redistribution of `base.db` must preserve this attribution.
- **Scope used.** English (`lang='en'`) only; just the `synonym` and `antonym` relations are extracted (`scripts/buildOmw.mjs`). Synonyms are capped at 10 per headword to bound the bundle size; antonyms are uncapped. No other WordNet relations are bundled.

### Bundled thesaurus content (Moby Thesaurus)

In addition to OMW, the English synonyms from the **Moby Thesaurus** are folded into the same `base.db` `thesaurus` table (`lang='en'`, `rel='synonym'`), so a headword's synonym set is the union of OMW + Moby (de-duplicated against the WordNet senses at query time by `assembleThesaurus`). It is staged via `npm run prepare:moby` (a StarDict triple → `dict/moby/thesaurus-ee.{ifo,idx,dict}`) and folded into `base.db` by `npm run build:base-db`.

- **Source.** Moby Thesaurus II by **Grady Ward**, packaged as the "English Thesaurus" StarDict (tabo / Hu Zheng, huzheng.org mirror). `scripts/fetchMoby.mjs` stages it (pinned URL when available, else the local StarDict zip).
- **License.** **Public domain.** Grady Ward placed the Moby lexical project (including the Moby Thesaurus) in the public domain; no attribution is legally required, but it is credited here in good faith.
- **Scope used.** English synonyms only. Each Moby `.dict` block is parsed (`src/core/dict/sqlite/buildMobyThesaurus.ts`) into cleaned synonyms — `[POS]` tags, `(Category):` prefixes, `{marker}` / `<annotation>` editorial markup and `*` slang flags are stripped, the headword is excluded, and the list is capped at 10 per headword to match the OMW cap. Antonyms are not extracted from Moby.

> **Coverage note.** `scripts/fetchOmw.mjs`, `scripts/buildOmw.mjs`, and `scripts/fetchMoby.mjs` perform network I/O and filesystem extraction and are therefore **not** measured by the jest coverage gate (same posture as `scripts/fetchBaseDict.mjs` / `scripts/buildBaseDb.mjs`). The data-shaping logic they feed *is* covered: the OMW TSV parser (`parseOmwTsv`), the Moby block parser (`buildMobyThesaurus.ts`), and the DB population (`populateThesaurus`) live in `src/` and are unit-tested to the 97% gate against synthetic fixtures.

---

Hope you find this plugin useful. If you hit a bug or have a feature request, please open an [issue](https://github.com/j-raghavan/sn-dictionary/issues).
