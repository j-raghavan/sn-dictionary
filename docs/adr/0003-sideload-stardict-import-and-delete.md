# ADR-0003: Sideloaded dictionaries — StarDict-only, on-device import to self-contained SQLite, verify-then-delete

- Status: **Superseded by [ADR-0007](0007-snplg-bundled-provisioning-and-optional-sidecar.md)** — meta.json is now OPTIONAL (no-meta loads with the folder name + language `und`; we don't gate definition lookup on enhancement metadata). The import also moved to native Kotlin off the JS thread (ADR-0006). The StarDict-only / verify-then-delete decisions still hold.
- Date: 2026-06-07
- Deciders: J-Raghavan
- Spec: `spec/SPEC-THESAURUS-NEW-FEATURES.md` (TF5)

## Context and Problem Statement

Only English is bundled (ADR-0002). Additional languages (DE/NL/IT/FR and any other) come from the user. How are they supplied, ingested, and made fast — and what happens to the source files afterward? Today, `userDictDiscovery` supports StarDict **and** CSV/JSON, with an optional `meta.json` and a flat layout for single-file formats.

## Decision Drivers

- Same runtime win as EN: no per-reload parse for sideloaded dicts either.
- Self-contained result (the user expects to drop files in and have them "added to the DB").
- Minimal formats to support and test.
- Deterministic, safe handling of destructive cleanup.

## Considered Options

- **Formats:** keep StarDict + CSV + JSON, vs **StarDict only**.
- **Ingestion:** lazy parse-on-lookup (today's JS path) vs **one-time background import into SQLite**.
- **Body storage:** hybrid (keep `.dict.dz`, store offsets) vs **all-text copied into SQLite**.
- **Source files after import:** keep vs **delete**.
- **Re-add (same files dropped again after deletion):** skip vs **replace/update** vs duplicate.

## Decision Outcome

**Chosen: StarDict-only; background import into a self-contained, all-text SQLite DB (slug-named per `name`+`language`, see below); delete sources after a verified commit.**

- **StarDict only.** Remove `csvDictSource.ts`, `jsonDictSource.ts`, their tests, the CSV/JSON discovery layouts, and the MDX detect/skip branch (MDX is a Non-Goal). One format to support.
- **Sidecar `meta.json`.** The descriptor is named **`meta.json`** (or `<set>.meta.json`), reusing the existing `isMetaJsonName` exclusion so it is never mistaken for a dictionary file (this avoids the format-ambiguity that a `<name>.json` would cause). Required: `name`, `language` (ISO 639-1, drives OMW thesaurus matching and labelling). Folder-per-dict layout retained; the flat layout is removed with CSV/JSON. **This is a breaking change** from the current optional-`meta.json` contract — documented as a migration in README.
- **Background import + DB naming (multiple dicts per language).** On discovery of a not-yet-imported set, a background job parses it (reusing `parseIdx`/`parseSyn`/`dictReader`) and INSERTs **all** entries as **all-text** into a new read-only DB, batched in transactions with cooperative yields (`yieldOften`); the source is gated `'loading'` so a tap doesn't block. All-text is mandatory because the source files are deleted (below) — the DB must stand alone. The DB **filename derives from a slug of the sidecar `name` plus `language`** (e.g. `wikdict-de-en.de.db`), **not** a bare `<lang>.db` — so **two dictionaries for the same language coexist** as separate DB files, each registered as its own `DictSource` (its popup section labelled by `name`). The thesaurus still queries `base.db` by `language` (ADR-0004), which is shared across same-language dicts.
  - **Slug rules (before coding `importStardict.ts`):** lowercase the sidecar `name`; fold to `[a-z0-9-]` (non-matching runs → single `-`); trim leading/trailing `-`; cap length (e.g. 48 chars); the DB filename is `<slug>.<language>.db`. The **identity key for the audit + re-add is the raw `name`+`language`** (not the slug), so two distinct names that slug to the same string do **not** silently overwrite each other: on a slug-filename collision with a *different* raw `name`, disambiguate with a short suffix (e.g. `-2`). Empty/all-symbol names slug to a fallback derived from `language` (`dict-<language>`).
- **Verify-then-delete (invariant).** Source files (StarDict set **and** `meta.json`) are deleted via **`FileUtils.deleteFile`** (the import name used in `index.js`; backed by `NativeFileUtils.deleteFile`, `NativeFileUtils.d.ts:11`) **only after** the transaction commits **and** the inserted row count equals the parsed entry count. Any failure/partial import leaves the files in place to retry; the half-written DB is discarded. A storage pre-check (`FileUtils.getStorageAvailableSpace`, `NativeFileUtils.d.ts:20`) precedes import.
- **Audit + re-add policy.** A successful import writes an audit row `imports(name, lang, entry_count, imported_at, filename)` in `user.db` (survives the deletion). The `filename` column (the resolved slug DB filename, e.g. `wikdict-de-en.de.db`) is the 5th column as implemented: it drives slug-collision resolution (`resolveSlugCollision`) and re-add reconciliation — an audit-hit row points discovery at the exact existing slug DB to open or replace. **Re-add policy: replace/update, keyed by `name`+`language`** (the same key as the DB filename slug). If the user later re-drops a set with the same `name`+`language`, it is treated as an **update** — re-imported into a fresh DB and atomically swapped in to replace the existing one, audit updated. A set with a **different `name`** (even same language) imports into its **own** DB (coexists). This lets users refresh a dictionary by re-dropping a newer StarDict. (Considered "skip if audit match" — rejected because, with the source deleted, a re-add is a deliberate user action that most likely means "update".)

### Consequences

- Good: sideloaded dicts get the same fast, persistent SQLite lookups; one format; self-contained DBs.
- Good: import is one-time, backgrounded, and never repeats (audit-gated).
- Bad/Cost: the on-device import reintroduces a StarDict parse — but **one-time**, backgrounded, and durable (vs every reload today); CPU/time bounded by yields and the `'loading'` gate.
- Bad/Cost: destructive delete — mitigated by verify-then-delete (commit + row-count match) and the audit row.
- Migration: existing sideloaded StarDict folders need a `meta.json` with `name`+`language`; CSV/JSON dicts are no longer supported.

## More Information

Spec TF5, RO-3. SDK: `NativeFileUtils.d.ts` (`getStorageAvailableSpace:20`, `deleteFile:11`). This repo: `userDictDiscovery.ts` (`detectFormat`, `isMetaJsonName`, the MDX branch). Related: ADR-0001, ADR-0002, ADR-0004 (thesaurus uses the sidecar `language`).
