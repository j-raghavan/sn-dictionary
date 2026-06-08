# Architecture Decision Records

MADR-format ADRs for SnDict. Each records one architecturally-significant decision; newer ADRs may supersede older ones (noted in their status).

See `spec/SPEC-THESAURUS-NEW-FEATURES.md` (local/untracked) for the full feature spec these decisions implement.

| ADR | Title | Status | Date | Summary |
|---|---|---|---|---|
| [0001](0001-native-sqlite-engine.md) | Adopt a native SQLite engine (pure-JS → native pivot) | accepted | 2026-06-07 | Bundle `react-native-sqlite-storage` in a custom `app.npk`; indexed `SELECT` replaces the per-reload parse. Native is a hard dependency, gated by an on-device spike; no permanent JS fallback. |
| [0002](0002-bundled-english-db.md) | Bundle English as a prebuilt SQLite DB | **superseded by 0007** | 2026-06-07 | Single read-only `base.db` (EN + OMW), all-text; retire the 16 MB base64 blob. (Provisioning via `createFromLocation` superseded by 0007 — base.db ships in the `.snplg`.) |
| [0003](0003-sideload-stardict-import-and-delete.md) | Sideloaded dicts — StarDict-only, on-device import, verify-then-delete | **superseded by 0007** | 2026-06-07 | Drop StarDict → background import to a self-contained all-text DB → delete sources after a verified commit. (Required `meta.json` superseded by 0007 — now optional; import is native, 0006.) |
| [0004](0004-thesaurus-omw-toggle.md) | Thesaurus from bundled OMW, Definition/Thesaurus toggle | accepted | 2026-06-07 | OMW for all 5 languages, only in `base.db`; lazy `lookupThesaurus` (not on `LookupResult`); pure `assembleThesaurus` owns EN dedup. Synonyms non-tappable in v1. (EN-only OMW ships today.) |
| [0005](0005-source-precedence-vs-dedup.md) | Source precedence by ordering (union); dedup deferred | accepted | 2026-06-07 | `[user.db, …imported, base.db]`; `multiDictLookup` returns the union (no suppression) in v1; key-dedup deferred (RO-8). |
| [0006](0006-import-execution-model.md) | Import execution model — native Kotlin, off the JS thread | accepted | 2026-06-07 | Parse + insert run in a native React Native module on a private thread (not Hermes), streamed/constant-memory; JS keeps the verify-then-delete + audit orchestration. |
| [0007](0007-snplg-bundled-provisioning-and-optional-sidecar.md) | `.snplg`-bundled provisioning, optional sidecar, native streamed import (the on-device pivot) | accepted | 2026-06-07 | base.db ships IN the `.snplg` (host-extracted) + opened by `{name, location}` (not createFromLocation); `meta.json` is OPTIONAL; import is native + streamed. Supersedes 0002 (provisioning) + 0003 (required meta). On-device VERIFIED: ~250 ms cold start, 779,859-entry import no OOM. |
| [0008](0008-csv-sideload-import.md) | CSV sideload import — strictly backward-compatible, index-then-delete | accepted | 2026-06-08 | Re-add loose-file CSV sideload (issue #2) onto the SQLite engine: the v1.x RFC-4180 parser ported verbatim → a format-agnostic `runImport` spine + a JS CSV produce-step → a per-dict slug DB (nullable `phonetic` column, schema v3). Discovery gains a `kind` discriminator (`stardict` \| `csv`); same verify-then-delete + audit as StarDict. |

**Dependency chain:** 0001 → 0002 / 0003 → 0004 / 0005; 0003 → 0006 (execution model); **0007 supersedes the on-device-wrong parts of 0002 + 0003**; 0003 / 0006 / 0007 → **0008** (CSV onto the shared import spine).

**Still open (need measurement/data, not a decision):** RO-2 (`base.db` install size), RO-7 (OMW per-language coverage); plus the ADR-0007(d) device follow-ups — Kotlin `normalizeKey` parity spot-check, IME-over-overlay, 5-language latency.
