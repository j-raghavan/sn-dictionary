# Architecture Decision Records

MADR-format ADRs for SnDict. Each records one architecturally-significant decision; newer ADRs may supersede older ones (noted in their status).

See `spec/SPEC-THESAURUS-NEW-FEATURES.md` (local/untracked) for the full feature spec these decisions implement.

| ADR | Title | Status | Date | Summary |
|---|---|---|---|---|
| [0001](0001-native-sqlite-engine.md) | Adopt a native SQLite engine (pure-JS → native pivot) | accepted | 2026-06-07 | Bundle `react-native-sqlite-storage` in a custom `app.npk`; indexed `SELECT` replaces the per-reload parse. Native is a hard dependency, gated by an on-device spike; no permanent JS fallback. |
| [0002](0002-bundled-english-db.md) | Bundle English as a prebuilt SQLite DB | accepted | 2026-06-07 | Single read-only `base.db` (EN + OMW), all-text, provisioned via `createFromLocation`; retire the 16 MB base64 blob after the spike + parity pass. |
| [0003](0003-sideload-stardict-import-and-delete.md) | Sideloaded dicts — StarDict-only, on-device import, verify-then-delete | accepted | 2026-06-07 | Drop StarDict + `meta.json` → background import to a self-contained all-text DB → delete sources after a verified commit. Re-add = replace/update; multiple dicts per language coexist. |
| [0004](0004-thesaurus-omw-toggle.md) | Thesaurus from bundled OMW, Definition/Thesaurus toggle | accepted | 2026-06-07 | OMW for all 5 languages, only in `base.db`; lazy `lookupThesaurus` (not on `LookupResult`); pure `assembleThesaurus` owns EN dedup. Synonyms non-tappable in v1. |
| [0005](0005-source-precedence-vs-dedup.md) | Source precedence by ordering (union); dedup deferred | accepted | 2026-06-07 | `[user.db, …imported, base.db]`; `multiDictLookup` returns the union (no suppression) in v1; key-dedup deferred (RO-8). |

**Dependency chain:** 0001 → 0002 / 0003 → 0004 / 0005.

**Still open (need measurement/data, not a decision):** RO-2 (`base.db` install size), RO-7 (OMW per-language coverage) — both have revisit triggers recorded in 0002 / 0004.
