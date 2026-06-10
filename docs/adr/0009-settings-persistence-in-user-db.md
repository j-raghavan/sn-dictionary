# ADR-0009: Settings-Panel preferences persist in user.db (additive tables, graceful degrade)

- Status: accepted
- Date: 2026-06-08
- Deciders: Jayasimha (maintainer)
- Relates to / refines: ADR-0001 (native SQLite engine — and its AsyncStorage failure), ADR-0005 (source precedence by ordering), ADR-0007 (bundled provisioning + writable user.db); enables F3 (source enable/order), F4 (keep-sources-after-import), F5/F7 (later panel features)

## Context and Problem Statement

The thesaurus spec adds a Settings Panel: the user enables/disables and reorders dictionary sources, chooses whether sideloaded source files survive an import, and (later) sets an export directory. Every one of these is a **persistent user preference** — it must survive a plugin reload and the JS-bundle lifecycle, unlike the in-session-only popup state (font size, active tab).

There is no general-purpose key-value store on the device. `AsyncStorage`'s native binding is **unbound** in the custom-APK build (the same class of failure that drove the ADR-0001 native-SQLite pivot away from a JS store), so it cannot be relied on. The only durable, already-provisioned, writable surface the plugin owns is **user.db** (ADR-0007) — the SQLite file that already carries user-added entries (TF7) and the imports audit (TF5). The open question for F1 is *where* and *how* Settings preferences live so the later features can read/write them without re-litigating storage.

## Decision

Persist **all** Settings-Panel preferences in **user.db**, via **additive** tables introduced by F1 and self-healing through `CREATE TABLE IF NOT EXISTS` (the imports-table precedent — user.db has no schema-version meta, so additive-only migrations are the contract):

1. **`dict_prefs`** — per-source enablement + ordering. `pref_key TEXT PRIMARY KEY` is the source's stable identity: `identityKey(name, lang)` for sideloaded imports, the bare source name for the built-in `User` + `WordNet` sources. Columns: `name TEXT`, `enabled INTEGER NOT NULL DEFAULT 1`, `sort_order INTEGER NOT NULL`. Read in `sort_order` order. This keeps enablement/order **outside** `DictSource` (IV-1): the registry order (ADR-0005) is still assembled by bootstrap; a pref row only *reorders/filters* it. F1 reads `removable` as always `false` (removal is F3/F4).

2. **`app_settings`** — a generic `key TEXT PRIMARY KEY / value TEXT` store for the scalar preferences (`keepSourcesAfterImport`, `exportDir`, …) that later features consume. One table for all scalars avoids a column-per-setting migration churn on user.db (which has no version gate).

3. **`user_meta`** (`schema_version INTEGER`) — a **forward-migration anchor** created now but with **no read/write helper** and **no gating** behavior in F1. It exists so a future non-additive change to user.db has a version stamp to branch on, rather than having to retrofit one onto an unstamped DB. Until then it is inert.

The CRUD surface is a single `settings.ts` module mirroring `userEntries.ts`/`importAudit.ts`: SQL constants live in `schema.ts`; every helper is **total** and **degrades gracefully** — a null user.db (degraded bootstrap) yields defaults on reads (`[]` / `null`) and a logged no-op on writes. Writes reuse the **DELETE+INSERT-in-a-single-transaction** upsert pattern (the imports-audit precedent) so re-writing the same key never leaves zero or two rows. F1 only wires the table-create into bootstrap (inside the existing degradable user.db `try`, so a throw degrades user.db to null exactly like the audit table); the CRUD helpers are consumed by F3/F4.

## Considered Options

- **A — A MyStyle JSON preferences file.** Rejected: it is **user-visible** in the device's file browser (an attractive-nuisance edit target) and would **race discovery** — discovery scans `MyStyle/SnDict/` for importable files, and a JSON prefs file there muddies that surface. It also reintroduces a parse-on-launch step the SQLite pivot removed.
- **B — `AsyncStorage` / a native key-value store.** Rejected: the binding is unbound in the custom APK (ADR-0001's failure mode); there is no reliable native KV store to target.
- **C — Persist preferences in user.db via additive tables (CHOSEN).** Reuses the one writable, provisioned, already-degradable store; one storage mechanism for entries + audit + prefs; no new file surface; no parse-on-launch. Cost: three additive tables and the additive-only migration discipline (acceptable — same as the imports table).

## Consequences

- user.db gains `dict_prefs`, `app_settings`, `user_meta` — additive, idempotent, created in bootstrap's degradable user.db path. A user.db failure degrades to defaults/no-op; base.db lookups are unaffected (F1-AC4).
- Enablement/order live outside `DictSource`, so IV-1 holds — the Settings Panel filters/reorders the bootstrap-assembled registry rather than mutating source objects.
- user.db has **no version meta gating**; migrations stay additive and self-healing. `user_meta` is the anchor for the day that stops being enough.
- `SCHEMA_VERSION` (base.db, ADR-0008) is untouched — these tables are user.db-only. ADR-0003's status is likewise untouched (the keep-sources-after-import policy change is F4 / a later ADR).

## More Information

Pattern oracles: `src/core/dict/sqlite/importAudit.ts` (DELETE+INSERT upsert, idempotent table-create), `src/core/dict/sqlite/userEntries.ts` (total + null-db degrade). SQL constants: `src/core/dict/sqlite/schema.ts`. CRUD: `src/core/dict/sqlite/settings.ts`.
