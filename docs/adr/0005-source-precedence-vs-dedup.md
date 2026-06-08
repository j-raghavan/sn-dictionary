# ADR-0005: Source precedence by ordering (union), key-dedup deferred

- Status: accepted
- Date: 2026-06-07
- Deciders: J-Raghavan
- Spec: `spec/SPEC-THESAURUS-NEW-FEATURES.md` (TF7, RO-8)

## Context and Problem Statement

The README describes "custom dict precedes base" / "user shadows base". The actual code does not suppress lower-priority sources: `multiDictLookup` "fans out to every source … and returns the **union** of hits, in source-array order"; `index.js` does `sources.unshift(...userDicts)` so user/discovered dicts come first and `hits[0]` drives the popup header — but a base hit for the same word still renders its own section. With user-added words (TF7) and multiple SQLite sources, do we keep the union or add a key-dedup filter so only the highest-precedence hit per word shows?

## Decision Drivers

- Match user expectation that their own entry "wins" for a word.
- Don't silently hide content the user might want (multiple dictionaries' takes).
- Don't change `multiDictLookup`'s long-standing, well-tested behaviour without cause.

## Considered Options

1. **Union + ordering (status quo).** All matching sources render; user/imported first, base last; `hits[0]` is the header.
2. **Key-dedup filter.** A new step in `multiDictLookup` shows only the first (highest-precedence) hit per normalized key — true "shadowing".

## Decision Outcome

**Chosen: Option 1 (union + ordering) for v1; defer key-dedup (Option 2) as RO-8.**

Source order is fixed and deterministic: **`[user.db, …imported, base.db]`** — user first (header + first section), bundled EN last; this preserves today's `unshift`-based ordering exactly, so existing users see no header/section-order change. A user entry for a word also in `base.db` renders first, badged "User"; the `base.db` section still renders below it. This is honest (nothing hidden) and avoids touching `multiDictLookup`'s behaviour or its test suite.

If true suppression is wanted later, it is a **new, explicitly-gated, tested** key-dedup step in `multiDictLookup` (changes observable behaviour — must update `multiDictLookup.test.ts` and the popup expectations). Deferred, not adopted, in v1.

### Consequences

- Good: no behaviour change to a core, well-tested module; nothing hidden from the user; deterministic order.
- Good: `hits[0]` precedence gives the user-entry the header and drives thesaurus language selection (ADR-0004).
- Bad/Cost: a word in both the user DB and a bundled/imported DB shows **two** sections — could read as redundant. Mitigated by the "User" badge + ordering; revisit via RO-8 if users find it noisy.

## More Information

Spec TF7 (FR2/FR4), IV-3, RO-8. This repo: `multiDictLookup.ts` (union, source order), `index.js` (`sources.unshift`). Related: ADR-0004 (`hits[0]` drives thesaurus language).
