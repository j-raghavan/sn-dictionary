# Repository instructions for GitHub Copilot

You are reviewing code for an open source project.

## Review priorities
Focus on:
- correctness and edge cases
- security issues and unsafe defaults
- backward compatibility
- performance regressions in hot paths
- unnecessary complexity
- missing tests for changed behavior
- API and schema stability
- maintainability and readability

## What to avoid
Do not suggest:
- large refactors unless clearly necessary
- stylistic churn without concrete benefit
- adding dependencies unless justified
- speculative changes not grounded in the diff

## Project expectations
Prefer:
- small targeted fixes
- explicit error handling
- clear naming
- simple designs over clever abstractions
- preserving existing public behavior unless the PR explicitly changes it

## Testing expectations
Flag when:
- behavior changes without tests
- edge cases are untested
- error paths are untested
- docs should be updated because user-facing behavior changed

## Review style
Be concise and specific.
Reference the exact risk and the likely impact.
When possible, suggest a minimal fix.

---

## Engineering principles

This project enforces a principal-engineer quality bar. Apply these consistently when reviewing.

### SOLID
- **Single Responsibility** — every module / component / function should have one clear reason to change. Flag handlers that grow side concerns (logging policy, state persistence, UI decisions) into the same unit.
- **Open / Closed** — prefer extension via new modules, configuration, or strategy injection over editing core logic. Flag conditional branches that pile up to cover new cases when polymorphism or a registry would scale better.
- **Liskov Substitution** — when a function takes a `*Like` interface (the project's DI pattern, e.g. `CommAPILike`, `PluginManagerLike`), every implementation must honour the contract. Flag mocks or test doubles that diverge in observable behavior from production callers.
- **Interface Segregation** — narrow `*Like` interfaces to the methods the consumer actually calls. Flag deps objects that pull in API surface the handler never invokes.
- **Dependency Inversion** — handlers, the StarDict reader, and the popup all depend on abstractions (interfaces / event buses), not on concrete `sn-plugin-lib` symbols. Flag direct turbomodule imports inside handler / pure modules — those belong only in `index.js`.

### KISS
- Pick the simplest design that satisfies the requirement.
- A 30-line handler with one clear branch is better than a 10-line handler that needs a comment to explain.
- Flag clever one-liners, dynamic dispatch, or meta-programming when a straightforward function suffices.

### DRY
- Extract a helper when the same logic appears 3+ times *and* the abstraction names the concept naturally. Two near-duplicates are usually fine; three is the rule-of-three threshold.
- Flag copy-pasted SDK call sequences, copy-pasted try/catch blocks around the same fallback, and copy-pasted log prefixes.
- Reuse existing helpers (`unwrap`, `safeClosePluginView`, `resolveIconUri`, `tryAcquire/release`, `t()`, `decodeBase64`, `decodeUtf8`) rather than re-rolling them inline.

### DDD-flavored boundaries
The codebase is small but follows clear ubiquitous-language boundaries — keep them.
- `src/buttons/` — registration with the firmware.
- `src/handlers/` — entry-gesture pipelines (orchestration only; no SDK turbomodule imports, no React).
- `src/core/dict/` — the StarDict reader and lookup contract; pure functions, no React, no SDK.
- `src/core/dict/stardict/` — file-format parsers (`.ifo`, `.idx`, `.dict.dz`); each module owns one responsibility.
- `src/sdk/` — narrow utilities that bridge platform quirks (`utf8`, `base64`, `unwrap`, `closeView`, `types`).
- `src/i18n/` — locale resolution and string tables.
- `src/ui/` — React Native components and the event-bus that connects them to async handlers.

Flag changes that **leak across these boundaries** — e.g. a handler reaching into popup state, a parser importing React, a button-registration module pulling in dictionary types.

---

## Plugin-specific gotchas (do not regress)

These bit me on-device and are documented in PR notes / commit messages. Flag any change that breaks them.

### Reentrancy guard must clear synchronously before any await
`src/core/reentrancyGuard.ts` is module-level. Handlers must call `release()` **before** awaiting `closePluginView` in the `finally` block. Clearing it after the await leaves the flag stuck `true` if the host's `state:stop` transition suspends the JS context — every subsequent button press is then rejected as busy.

### Handler does NOT close the firmware overlay on the success path
When a popup is rendered, the firmware overlay must stay open until the user dismisses the popup. Closing it from the handler's `finally` while the popup is still on-screen orphans the overlay and the device hangs on subsequent pen taps. The popup's Close button calls `PluginManager.closePluginView()` directly, fire-and-forget. The handler's `finally` only closes the view on early-exit paths (busy / empty / failed) — track this with a `popupShown` flag.

Flag any PR that:
- Calls `closePluginView` unconditionally in a handler's `finally`.
- Removes the `popupShown` guard.
- Awaits `closePluginView` before the synchronous `release()`.

### `editDataTypes` is firmware-filter sensitive
The Supernote firmware filters lasso buttons more strictly than the SDK doc suggests. Empirical evidence: a button with `editDataTypes:[0, 3]` (stroke + text-box) is hidden on every lasso. The shipped value is `[0]` (stroke-family only); the handler covers `trailNum + trailLinkNum + titleNum` so all three stroke-family content types route through the same OCR path.

Flag any PR that:
- Adds non-stroke-family entries (`3` text-box, `2` image) to the NOTE lasso button without explicit on-device validation.
- Splits into multiple lasso buttons (causes duplicate "Lookup" entries in the toolbar).

### `console.warn` and `console.error` are NOT reliably visible in on-device logcat
Every `ReactNativeJS:` line on the Supernote firmware lands at info level. The logger in `index.js` routes every level through `console.log` with `[WARN]` / `[ERROR]` prefixes so diagnostics are visible. Flag any PR that:
- Reverts the logger to use `console.warn` / `console.error` directly.
- Drops the eager-load probe (`lookup.lookup('__sndict_init__')`) — that's how startup-time dict-load failures surface in logcat without waiting for first user lookup.

### Platform globals must be polyfilled defensively
`TextEncoder` / `TextDecoder` / `atob` are unreliable on the Supernote JS engine — they may be undefined, throw on construction, or return malformed values. `src/sdk/utf8.ts` and `src/sdk/base64.ts` try the platform globals first then fall back to portable inline implementations. Flag any PR that:
- Uses `new TextEncoder()` / `new TextDecoder()` / `atob()` directly in `src/`. Use `encodeUtf8` / `decodeUtf8` / `decodeBase64` instead.
- Removes the fallback paths or the `jest.isolateModules`-based fallback tests.

### License: project is MIT, runtime deps must stay permissive
The vendored StarDict reader exists because `js-mdict` is **AGPL-3.0** and bundling it would force the whole `.snplg` to AGPL. Flag any PR that:
- Adds a runtime dependency without checking its license.
- Adds a GPL / AGPL / LGPL runtime dependency.
- Bundles MDX-format reading on-device (use the future Prong B converter for that — it can be AGPL because it never enters the `.snplg`).

`pako` (MIT) is the only third-party runtime dep. New deps should clear that bar.

---

## Coverage and lint policy

- `jest.config.js` enforces **97% global coverage** on statements / branches / functions / lines.
- Generated files (`src/core/dict/data/baseDictData.ts`) and pure-types files (`src/sdk/types.ts`, `src/core/lookup.ts`) are excluded from coverage; flag PRs that exclude additional files without justifying it.
- Lint must be clean (`npm run lint`). The `@react-native/eslint-config` ruleset includes `no-bitwise`; bitwise ops in the UTF-8 / base64 / StarDict writer code are bracketed by `/* eslint-disable no-bitwise */` — flag broad disables that aren't scoped.
- `npx tsc --noEmit` must be clean.

## Build and CI

- `buildPlugin.sh` is the single entry point; it transitively runs `npm run prepare:dict` to fetch + emit the WordNet data module before Metro bundles. Flag PRs that bypass this (e.g. `npx react-native bundle` directly).
- `dict/wordnet/*` (binary input) and `src/core/dict/data/baseDictData.ts` (~16MB generated artefact) are gitignored. Flag PRs that commit either.
- `.github/workflows/release.yml` rewrites `package.json` and `PluginConfig.json` versions on the runner. Flag PRs that hand-edit those version fields outside a release.

## Commit and PR hygiene
- Commit messages are first-person singular and never attribute Claude or any AI assistant.
- Specific files / line numbers go in commit bodies, not PR descriptions.
- PR descriptions follow `## Summary`, `## Test plan`, `## Verified locally` headings (see PR #1 as the template).
- Force-pushes to `master` are forbidden. Force-pushes to feature branches require explicit approval.
