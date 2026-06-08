# ADR-0004: Thesaurus from bundled OMW, surfaced via a Definition/Thesaurus toggle (lazy, separate from LookupResult)

- Status: accepted
- Date: 2026-06-07
- Deciders: J-Raghavan
- Spec: `spec/SPEC-THESAURUS-NEW-FEATURES.md` (TF4)

## Context and Problem Statement

The product needs a thesaurus (synonyms/antonyms) across all five languages. StarDict `.syn` maps alternate **spellings** to a definition (lookup aliases) — it is **not** a synonym/antonym relation graph, and it cannot ride inside a user-sideloaded StarDict. WordNet senses already expose inline `[syn: …]` synonyms in the Definition tab (`wordnetFormatter.ts`). Where does thesaurus data come from, where does it live, and how is it shown without duplicating the inline synonyms or perturbing the lookup pipeline?

## Decision Drivers

- Uniform synonym/antonym coverage across EN/DE/NL/IT/FR.
- Don't slow or alter the definition lookup path.
- Avoid confusing duplication with WordNet's existing inline synonyms.
- Keep the `DictSource`/`LookupResult`/handler contracts unchanged.

## Considered Options

- **Data source:** EN-only (WordNet) vs **bundled OMW for all 5 languages** vs per-sideloaded-dict only.
- **Where it lives:** in each imported dict DB vs **only in `base.db`**.
- **Plumbing:** extend `LookupResult` with a thesaurus payload vs **a separate lazy query**.
- **UI:** inline "Synonyms" section vs **Definition/Thesaurus toggle** vs tappable synonyms.

## Decision Outcome

**Chosen: bundled OMW for all 5 languages, stored only in `base.db`; a separate lazy `lookupThesaurus(word, lang)`; a Definition/Thesaurus toggle.**

- **OMW for all five languages** (Open Multilingual WordNet; its English layer is Princeton WordNet, so EN stays consistent). Populated at build time into `base.db.thesaurus(key, lang, rel, target)`. OMW lives **only** in `base.db` — imported (slug-named, ADR-0003) DBs hold definitions exclusively; the thesaurus is never duplicated into them.
- **Separate lazy query, not on `LookupResult`.** A dedicated `lookupThesaurus(word, lang)` over `base.db` runs only when the Thesaurus tab is opened; the result is popup-local state. This keeps the `DictSource`/`LookupResult`/handler contracts literally unchanged.
- **Language selection.** `lang` is taken from `hits[0]`'s source (same precedence as the popup header): EN/base → `'en'`, imported → sidecar `language`, user entry → its `lang` column. **User-added entries default `lang='und'` (undetermined) in v1** — there is no language picker in the add-word form (TF7), so the Thesaurus tab shows the empty-state for a user word rather than risking a wrong-language OMW match (e.g. querying `'en'` for a German entry). A language picker on add is a deferred enhancement. Implementers **skip `lookupThesaurus` entirely when `lang === 'und'`** (treat as zero rows → empty-state) — no `base.db` query is issued.
- **EN dedup ownership.** When `hits[0].format === 'wordnet'`, a pure `assembleThesaurus(senses, omwRows)` unions the already-parsed WordNet senses with OMW, de-duplicates, and excludes the headword — so the Thesaurus tab is a consolidated view, not a duplicate of the Definition tab's inline `[syn]`. For `format ∈ {plain,html}` (imported/non-EN), the tab shows OMW only.
- **UI: Definition/Thesaurus toggle** (chosen over an inline section to give synonyms room and keep the definition uncluttered). Synonyms are plain text in v1; **tappable re-lookup is deferred** (RO-4).

### Consequences

- Good: consistent thesaurus across all languages; definition path untouched; no inline-synonym duplication.
- Good: pure `assembleThesaurus` is the clear, unit-testable owner of dedup/headword-exclusion.
- Bad/Cost: OMW relation tables add to `base.db` size (RO-2); coverage/quality varies by language (RO-7) — handled via an empty-state, never an error.
- Decided: **synonyms are non-tappable in v1** (closes RO-4); tappable re-lookup is a deferred enhancement. A future option could also feed user-entry synonyms and add a language picker on add (the `'und'` default above).

## More Information

Spec TF4 (FR1–FR6, FR3a), RO-4/RO-7. [Open Multilingual WordNet](https://omwn.org/). This repo: `wordnetFormatter.ts` (inline `[syn]`). Related: ADR-0002 (`base.db`), ADR-0003 (sidecar `language`), ADR-0005 (`hits[0]` precedence).
