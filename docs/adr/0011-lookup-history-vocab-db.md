# ADR-0011: Lookup history in a USB-visible vocab.db (Kindle Vocabulary Builder parity)

- Status: proposed
- Date: 2026-11-04
- Relates to / refines: ADR-0001 (SQLite unblocks "future history"), ADR-0009 (why prefs did NOT go to MyStyle)

## Context and Problem Statement

Kindle readers rely on the Vocabulary Builder: every dictionary lookup lands in `vocab.db` together with the sentence it came from. People plug the Kindle into a computer and turn that file into flashcards (Anki etc.) — no export step. The plugin shows definitions but forgets them.

## Decision

Record every **DOC** lookup into a standalone SQLite file in shared storage, **`EXPORT/SnDict/vocab.db`**, table:

`lookups (word TEXT NOT NULL, usage TEXT, book TEXT, timestamp TEXT NOT NULL)`

- `word` — the trimmed selection (what was looked up, hit or miss).
- `usage` — the sentence around the selection, cut from `PluginDocAPI.getCurrentDocText(page)`. The SDK exposes no selection offset, so the first occurrence on the page wins.
- `book` — the document file name (`PluginCommAPI.getCurrentFilePath`).
- `timestamp` — ISO-8601, like `entries.created_at`.

Mechanics:

- **Location.** `EXPORT` is one of the six shared-storage dirs Chauvet lets a plugin write with `FILE:WRITE`; it is where users already look for files produced on the device, and it is not scanned by dictionary discovery (`MyStyle/SnDict/`). The vendored `SQLitePlugin.java` gains one branch: a `location` starting with `/` is used as an absolute directory (everything else still resolves under the plugin's files dir).
- **Permissions.** Touching shared storage without a grant kills the plugin, so the opener only *checks* `FILE:READ/WRITE/DELETE` (requested at launch by the existing discovery path) and returns null when any is missing — no dialog mid-lookup. DELETE is included because SQLite unlinks its journal/WAL files.
- **Open per write.** Each lookup opens vocab.db, switches the connection to `journal_mode=DELETE` (Android's default TRUNCATE leaves an empty `vocab.db-journal` beside the user-visible file), creates the table if needed, inserts, and closes. No handle is held between lookups, so a user deleting or replacing the file (after importing it on a computer) cannot swallow later rows. Writes are queued in `index.js` so two quick lookups never open it concurrently.
- **Context with a deadline.** `getCurrentFilePath`, `getCurrentPageNum` and `getCurrentDocText` each get a 3 s timeout (a synchronous throw is caught too) and degrade to NULL, so a stalled SDK call can never block the write queue; the word is always recorded.
- **Best-effort.** `recordLookup` never rejects: missing context is stored as NULL, a failed open/INSERT only logs. The DOC handler fires it after the final `showResult` without awaiting it, so the popup and the reentrancy guard are untouched.

## Considered Options

- **Table in user.db, retrieved via Settings → Export.** Zero native change, but every transfer needs a manual export that also copies base.db and every imported dictionary (tens of MB) — not Kindle-like.
- **Auto-copy user.db to shared storage after each lookup.** Kindle-like, but copies settings/user words too and duplicates the export path.
- **`MyStyle/`.** Rejected for the same reasons as ADR-0009 (attractive-nuisance edits next to dictionary discovery).
- **CSV file.** The SDK has no text-file write API; it would need a new native module.
- **Also record NOTE (lasso) lookups.** Deferred: handwriting has no surrounding text short of OCR-ing the whole page.
- **A Settings toggle.** Deferred: rows are tiny and stay on the device; can be added if users ask.

## Consequences

- One small row per DOC lookup in `EXPORT/SnDict/vocab.db`; nothing prunes it. Deleting the file resets the history (it is recreated on the next lookup).
- vocab.db is not part of Settings → Export/Restore (it is already user-visible).
- Device-verified on Chauvet 3.29 beta: vocab.db is created in `EXPORT/SnDict/`, `usage` is filled (the page index from `getCurrentPageNum` is the one `getCurrentDocText` expects), and the plugin keeps appending after the file was replaced from a computer over ADB.
