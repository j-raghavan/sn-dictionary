# ADR-0008: CSV sideload import (loose-file, index-then-delete) — strictly backward-compatible

- Status: accepted
- Date: 2026-06-08
- Deciders: Jayasimha (maintainer)
- Relates to / refines: ADR-0003 (sideload import-and-delete), ADR-0006 (import execution model), ADR-0007 (bundled provisioning + optional sidecar)

## Context and Problem Statement

GitHub issue #2 (mavproductions) asked for personal import dictionaries: drop a spreadsheet/CSV — one column headwords, another definitions — and look those words up on-device. This shipped (≈ v1.0.4–v1.0.8) as a runtime-parsed `csvDictSource`: an RFC-4180 parser, configurable columns via `meta.json`, an **optional phonetic column**, and CP1252/UTF-16/BOM decoding + typographic-quote folding for real spreadsheet exports.

The native-SQLite pivot (ADR-0001/0002) moved every dictionary into a SQLite DB indexed at build/import time, and the StarDict-only pivot (commit `76aa679`) **deleted** `csvDictSource`/`jsonDictSource`. The maintainer wants CSV back — loose-file, with the **same feature set** (the `meta.json` column config and the optional phonetic column), using the real sample `Dune.csv` (CP1252 smart quotes, no header, uppercase headwords, RFC-4180-quoted definitions, 301 rows).

**Hard constraint (maintainer, explicit): losing backward compatibility is not an option.** An existing user's CSV must parse and look up **identically** to the old plugin.

## Decision

Re-add CSV as a **second sideload import format** that plugs into the existing StarDict import-and-delete pipeline, with the parsing semantics reproduced **byte-for-byte** from the removed `csvDictSource`.

1. **Discovery** finds **loose `*.csv` files** directly in `MyStyle/SnDict/` (alongside StarDict subfolders). Each yields an import-job descriptor with `kind:'csv'`. An optional `<basename>.meta.json` per-file sidecar (or a shared root `meta.json` carrying `csv.*` defaults) provides `{name?, language?, csv:{headwordCol, definitionCol, phoneticCol?, hasHeader?}}`. No sidecar → defaults (`name`=filename, `language='und'`, col0=word, col1=def, no phonetic, no header) — the M9/ADR-0007 optional-meta principle: a bare `Dune.csv` imports.

2. **Import** runs a **JS parse+insert** (CSV files are small — the native Kotlin parser exists only to avoid OOM on 100k–2M-entry StarDicts, which CSV never hits): `decodeText` (CP1252/UTF-16/BOM) → the RFC-4180 `parseRow` loop **ported verbatim** from the old `csvDictSource` → `normalizeKey` keys, first-occurrence-wins → INSERT into a per-dict slug DB → the SAME verify-then-delete + reconcile + audit orchestration as StarDict. The verify-then-delete spine is refactored into a format-agnostic `runImport(ports)`; StarDict injects the native parse+insert, CSV injects the JS one. IV-6 stays tested once.

3. **Phonetic** is restored by adding a **nullable `phonetic TEXT` column** to the base `entries` table. base.db and StarDict imports write `NULL` (unchanged); CSV writes the phonetic cell or `NULL`. `SELECT_ENTRY_BY_KEY` projects `phonetic`; `sqliteDictSource` maps a non-null/non-empty value onto `DictEntry.phonetic` and omits it otherwise — reproducing the old `lookupCsv` contract. The popup already renders `entry.phonetic` — no popup change. `SCHEMA_VERSION` bumps 2→3; base.db is rebuilt each release so provisioning reprovisions the stale v2 DB automatically (no in-place base migration). Newly written slug DBs (StarDict + CSV) use the 5-col `CREATE`; `selectByKey` tolerates a pre-existing 4-col slug (reads `phonetic` as absent) so nothing crashes.

4. CSV definitions are stored `format='plain'` — rendered as-is (the #15/#19 HTML fixes are scoped to `sametypesequence=h` StarDicts).

### BACKWARD-COMPATIBILITY CONTRACT (non-negotiable)

- The removed `master:__tests__/csvDictSource.test.ts` is the **mandatory regression oracle**: every assertion is re-expressed against the new parser/import and **must pass unchanged**.
- **No behavior changes** to parsing. In particular: the headword is trimmed, the **definition is NOT trimmed** (leading/trailing whitespace inside the field is preserved exactly — e.g. `Dune.csv`'s `ABA, loose robe…` stores `" loose robe…"`). RFC-4180 quoting, `""`→`"`, embedded commas/newlines, `\r\n`/`\n`/lone-`\r`, trailing-no-newline, UTF-8 BOM strip, CP1252 + UTF-16 LE/BE decode, the curly-quote (U+2019/0x92) key-fold, optional `phoneticCol` (empty/out-of-range → omitted, never `''`), `hasHeader` skip, configurable headword/definition columns, first-occurrence-wins, the 10 MB cap, and empty-headword skip are all preserved verbatim.
- The shipped samples `Dune.csv` (→ `assets/sample-dicts/`) and `assets/sample-dicts/cooking-terms.csv` must import + look up correctly end-to-end.

## Considered Options

- **A — Restore the runtime-parsed `csvDictSource` (old code as-is).** Rejected: it re-parses the whole CSV into a Map on every launch — the exact per-launch cost the SQLite pivot eliminated — and has no audit/reconcile/index story. Backward compatibility is about *parsing + results*, which Option B preserves verbatim; it is not about keeping the slow runtime-parse lifecycle.
- **B — Import CSV into a slug DB via the StarDict pipeline (CHOSEN).** One import lifecycle, one runtime source kind, the proven verify-then-delete safety reused (not re-implemented), and the parser ported verbatim. Cost: a second produce-slug-DB path (JS vs native) and a nullable `phonetic` column.

## Consequences

- Two produce-slug-DB paths (native StarDict, JS CSV) behind one shared `runImport` spine.
- `entries` gains a nullable `phonetic` column; `SCHEMA_VERSION` 3; base.db reprovisions on upgrade.
- **Lifecycle (maintainer-chosen, ADR-0003-consistent):** a verified CSV import indexes the data into the slug DB + audit, then deletes the `.csv` (+ sidecar). A failed/aborted import leaves the file untouched and retryable. This is a *lifecycle* difference from the old runtime source, NOT a parsing/behavior change — existing CSVs produce identical lookup results.
- CSV bodies are plain text; no HTML/WordNet structure.

## More Information

Backward-compat oracle: `git show master:src/core/dict/csvDictSource.ts` + `master:__tests__/csvDictSource.test.ts`. Encoding: `src/sdk/textDecode.ts`. Samples: `Dune.csv`, `assets/sample-dicts/cooking-terms.csv`.
