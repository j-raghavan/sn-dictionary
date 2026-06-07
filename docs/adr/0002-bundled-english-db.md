# ADR-0002: Bundle English as a prebuilt SQLite DB (createFromLocation, all-text), retire the base64 blob

- Status: accepted
- Date: 2026-06-07
- Deciders: J-Raghavan
- Spec: `spec/SPEC-THESAURUS-NEW-FEATURES.md` (TF3)

## Context and Problem Statement

Given the native SQLite engine (ADR-0001), how is the bundled English dictionary built, stored, shipped, and provisioned on-device — and what happens to the existing 16 MB `src/core/dict/data/baseDictData.ts` base64 blob?

## Decision Drivers

- Eliminate the per-reload parse (the cold-start fix) — the DB must *be* the index.
- Keep the shipped artifact and provisioning simple and idempotent.
- Reduce, not grow, resident memory and Hermes bundle parse time.
- Reuse the existing StarDict parsers and `normalizeKey` at build time.

## Considered Options

**Storage of definition bodies:**
- (a) **All-text in SQLite** — store the decoded definition text in the row. One query, no companion files, no on-device dictzip reader. Larger DB.
- (b) **Hybrid** — store key→(offset,length); keep the `.dict.dz` body + `dictReader` on device. Smaller, but two artifacts to keep in sync and a second hop per lookup.

**Provisioning of the bundled DB:**
- (i) **`createFromLocation`** — native copies the DB from APK assets into the plugin dir on first open.
- (ii) **Zip-in-APK + unzip on first launch** (needs `react-native-zip-archive`).
- (iii) **Sideload** the DB.

## Decision Outcome

**Chosen: all-text (a) + `createFromLocation` (i), and retire the base64 blob.**

A single read-only `base.db` (EN `entries` + OMW `thesaurus`, see ADR-0004) is generated at build time by `scripts/buildBaseDb.mjs`, **reusing** `parseIdx`/`parseSyn`/`normalizeKey`/`dictReader` (bodies decoded at build time). It ships in `app.npk` assets and is provisioned via `createFromLocation` on first open into `plugins/<pluginID>/base.db`. Because it is one DB, `createFromLocation` is simpler than zip (no extra native dep, no unzip step) — this directly follows the stakeholder rationale "use createFromLocation since it is just one DB". All-text keeps lookup to a single indexed `SELECT` and removes the dictzip reader from the bundled path.

The 16 MB `baseDictData.ts` blob and its `buildBaseDict.mjs` generation are **retired** once EN-via-SQLite is verified on-device (TF3-FR4) — this is what reclaims bundle-parse time and resident memory. Sequencing: retire **after** the ADR-0001 spike + EN parity pass, never before.

Provisioning is idempotent and versioned (a `meta(schema_version, built_at)` row); a bumped version re-provisions `base.db` only, never `user.db` or imported DBs.

### Consequences

- Good: single indexed query per lookup; no on-device dictzip code for EN; simplest provisioning.
- Good: retiring the blob cuts memory + bundle parse time.
- Bad/Cost: `base.db` (EN all-text + OMW) is the dominant contributor to `app.npk` size — **must be measured** (RO-2); the one-time first-run `createFromLocation` copy may exceed 1 s (acceptable; distinct from the post-provision cold-start gate, TF3-AC2/TF8-FR3).
- Edge: the first-run `createFromLocation` copy needs free space for a second copy of `base.db`; a `getStorageAvailableSpace` pre-check guards it (shared with the sideload-import pre-check, ADR-0003) and fails cleanly rather than half-copying.
- Revisit trigger: if measured `base.db` size exceeds the agreed install budget, switch EN to hybrid (b) — the build tooling already produces offsets via `dictReader`.

## More Information

Spec TF3, RO-2. Sticker demo `createFromLocation` (`lib/sqlite.core.js:770`). Related: ADR-0001, ADR-0004 (OMW lives in `base.db`).
