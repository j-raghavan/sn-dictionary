# ADR-0010: Opt-in post-import source deletion (keep by default; explicit refresh)

- Status: accepted
- Date: 2026-06-08
- Deciders: Jayasimha (maintainer)
- Supersedes: ADR-0003's **verify-then-delete _invariant_** (deletion is now conditional/opt-in) and its **RE-ADD-on-re-drop _default_** (a kept, already-imported set is idempotent-open, not a re-add). ADR-0003's StarDict-only format choice and the verify → audit → delete _ordering_ are unchanged.
- Relates to / refines: ADR-0006 (import execution model), ADR-0008 (CSV onto the shared `runImport` spine), ADR-0009 (settings persistence in `user.db`)
- Spec: `spec/SPEC-SETTINGS-PANEL.md` (F4)

## Context and Problem Statement

ADR-0003 established that a verified sideload import **deletes** the source files (`deleteFile` per path, then a best-effort `deleteFolder`) after the audit row is written. The user dropped files in; the plugin indexed them into a self-contained slug DB and removed the originals. A re-drop of the same set was treated as a deliberate **re-add** (re-import / update).

Two problems with deletion-as-an-invariant surfaced as the Settings Panel (F-series) landed:

1. **Users want their files back.** Deleting the only copy of a sideloaded dictionary is surprising and irreversible; several users keep their `.csv` / StarDict folders as the canonical source and re-export them. The maintainer chose to make **keep the default**.
2. **Keeping sources breaks reconcile (blocker 1).** `reconcileImports` made any **audit-hit descriptor still on disk** a `'import'` / RE-ADD. With sources kept, the descriptor is _always_ still on disk, so **every reload re-imports** — an infinite loop that also writes duplicate/colliding slug DBs.

So opt-in deletion is **two coupled changes**: gate the delete, AND teach reconcile that a kept, already-imported, healthy set is "done" (open, not re-import) — while preserving a deliberate refresh path so ADR-0003's intentional re-add stays reachable.

## Decision

1. **Keep by default (opt-IN to delete).** A new `app_settings('keepSourcesAfterImport')` row (`'1'`=keep / `'0'`=delete) gates the delete step. **Absent / degraded `user.db` / any non-`'0'` value reads as keep=true** — the safe default never deletes. A Settings-Panel toggle (`t('settings.keepSources')`) owns it after first run; reads/writes go through `getKeepSources` / `setKeepSources` over `user.db` (ADR-0009; no native KV store — AsyncStorage is unbound).

2. **`runImport` delete is conditional.** `runImport` gains a `keepSources` port. The verify → **audit-first** → delete **ordering is unchanged** (ADR-0003 data-safety holds): the audit row + slug DB are always written first; only the final `deleteFile` / `deleteFolder` step is skipped when keeping. A failed/partial import still leaves sources and discards the half-built DB — identical for keep and delete.

3. **`reconcileImports` stays PURE; bootstrap precomputes its inputs.** The decision takes **no I/O**. Bootstrap probes slug-DB health (existence is enough for v1) and reads the keep flag _first_, then passes `reconcileImports(descriptors, auditRows, {keepSources, slugHealthy: Set<filename>})`. The new rule: an **audit-hit descriptor reconciles to `'open'`** (open the existing slug; skip re-import) **when** `keepSources && slugHealthy.has(filename) && !forceRefresh`; otherwise it falls back to the ADR-0003 `'import'` / RE-ADD. The `'open'` bucket shape is reused — no `ReconcileItem` type change. This is what **breaks the kept-source re-import loop**: the second bootstrap opens the existing slug instead of building a duplicate.

4. **Explicit refresh preserves ADR-0003 intent.** A user who wants to re-import a kept dict signals it: either (a) drop a **`.refresh` sentinel** in the set folder (`<setFolder>/.refresh` for StarDict; `<name>.refresh` beside the `.csv`) — discovery sets `forceRefresh: true` on the descriptor, which overrides the kept-`'open'` rule back to RE-ADD; or (b) toggle keep=false and re-drop. After a verified refresh import the `.refresh` sentinel is deleted (best-effort) so it doesn't loop. Absent a signal, a re-drop of a kept set is **idempotent (open), not an update** — by design.

5. **First-run prompt, once, at bootstrap.** The first time an import is about to dispatch with the flag unset, bootstrap (before the detached `toImport` loop, via an injected UI port) shows a one-time keep/delete dialog (`NativeUIUtils.showRattaDialog`) and persists the choice. The DECISION/orchestration is host-testable through the port; the actual dialog is device-only. Detached imports never block on a per-import dialog. Default if the port is absent/throws: keep.

6. **Toggle applies to FUTURE imports only.** Changing the setting later never retroactively deletes already-kept sources.

## Considered Options

- **A — Keep the unconditional delete (ADR-0003 as-is).** Rejected: deletes the user's only copy; the maintainer wants keep-by-default.
- **B — Keep sources but leave reconcile unchanged.** Rejected: the infinite re-import loop (blocker 1) — every reload rebuilds the slug DB.
- **C — Opt-in delete + reconcile keep-rule + explicit refresh (CHOSEN).** Keep is the safe default; the loop is broken by the pure reconcile rule; the deliberate re-add stays reachable via `.refresh` / keep=false. Cost: a slug-health probe at bootstrap and a `forceRefresh` descriptor flag.
- **D — Probe slug health _inside_ reconcile.** Rejected: it would make `reconcileImports` do I/O and become host-untestable. Bootstrap precomputes `{keepSources, slugHealthy}` so the function stays pure (review fix 6).

## Consequences

- `reconcileImports` takes a third `opts` argument; its call site + tests pass `{keepSources, slugHealthy}`. The function remains pure.
- A kept, already-imported, healthy set reconciles to `'open'` on every subsequent bootstrap — no re-import, no duplicate slug DB (the loop is broken).
- The verify → audit → (conditional) delete ordering and the failure/atomicity contracts are unchanged from ADR-0003/0008.
- Discovery gains a `forceRefresh?` + `refreshPath?` on the descriptor, driven by a `.refresh` sentinel; `runImport` deletes the sentinel after a verified refresh (regardless of keep).
- A legacy host that omits the slug-health probe treats every audited slug as unhealthy → a kept set RE-ADDs (the safe fallback), never silently skips an import.

## More Information

Spec: `spec/SPEC-SETTINGS-PANEL.md` F4 (FR1–FR9, AC1–AC6) + Review resolutions #1 (the reconcile change — blocker 1) and #7 (first-run prompt placement). Code: `runImport.ts` (delete gate), `bootstrap.ts` (`reconcileImports` opts + slug-health probe + first-run prompt), `userDictDiscovery.ts` (`.refresh` detection), `settings.ts` (`getKeepSources`/`setKeepSources`).
