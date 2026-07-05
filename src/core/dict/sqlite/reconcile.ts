// The PURE reconcile layer (C5), extracted from bootstrap.ts with ZERO
// behaviour change: the identity/pref keying, the descriptor-vs-audit reconcile
// decision, the on-disk source-path mapping, and the derived live-sources
// computation. All I/O-free — bootstrap precomputes the `slugHealthy` Set and
// drives every side effect. bootstrap.ts re-exports these so existing importers
// (and tests) keep working unchanged.

import type {DictSource} from '../../lookup';
import {mergeDictPrefs, type DictPref, type DictSourceIdentity} from './settings';
import {isStaleImport, type ImportRow} from './schema';
import type {ImportJobDescriptor} from '../userDictDiscovery';

// --- reconcileImports (PURE) ----------------------------------------
// Decide, from the descriptors found on disk and the audit rows in
// user.db, what to do with each. Pure — NO file-existence probe inside
// the function (review fix 6 / F4-FR3): the slug-DB health probe runs in
// bootstrap, which passes the precomputed `slugHealthy` Set + `keepSources`
// flag. A missing/corrupt slug DB without an audit hit is still not a
// bucket here; the lazy source handles it as 'absent'/'failed' (Designer
// ruling 1).
//
//   'import' — a descriptor to (re)import. NEW (no audit hit -> fresh slug
//              filename) or a re-import carrying `prior` — which runImport
//              builds into the A/B SIBLING slot (refreshTargetFilename), NEVER
//              overwriting the still-serving audited file; the single-statement
//              upsertImport then atomically repoints the audit row to the new
//              slug. A `refreshInPlace` import is the rebuild half of the silent
//              stale/kept+healthy PAIR (its dict already serves via the paired
//              'open'); a plain re-import (sentinel / keep=false / unhealthy) is
//              spliced fresh this session.
//   'open'   — an audit row with no matching descriptor on disk
//              (already imported; just open its slug DB), OR — F4-FR3 — an
//              audit-hit descriptor whose sources were KEPT and whose slug
//              DB is healthy + current (skip the re-import; the kept-source loop
//              is broken here), OR the serve-now half of a silent refresh PAIR.
//   'skip'   — a duplicate (name, lang) descriptor (first wins as
//              'import', the rest skip — Designer flag 1).

export type ReconcileItem =
  // `prior` carries the audit row when this import REPLACES an existing slug
  // (any re-import flavor): runImport then builds into refreshTargetFilename
  // (prior.filename) — the A/B sibling — instead of the still-serving audited
  // file. `refreshInPlace` marks the rebuild half of a stale/forceRefresh
  // kept+healthy PAIR (see reconcileImports): its dict is ALREADY registered
  // via the paired 'open' item, so step-7 must NOT splice a second source.
  | {
      bucket: 'import';
      descriptor: ImportJobDescriptor;
      prior?: ImportRow;
      refreshInPlace?: boolean;
    }
  | {bucket: 'open'; row: ImportRow}
  | {bucket: 'skip'; reason: string; descriptor?: ImportJobDescriptor};

// Precomputed (I/O-free) inputs to keep reconcileImports pure (F4-FR3 /
// review fix 6). `keepSources` is the resolved keepSourcesAfterImport flag;
// `slugHealthy` is the set of audit `filename`s whose slug DB bootstrap
// has verified exists+opens. When keep=false (or the flag is unset and a
// caller passes false), the legacy RE-ADD-on-re-drop behaviour holds.
export type ReconcileOpts = {
  keepSources: boolean;
  slugHealthy: Set<string>;
};

// Composite (name, lang) identity, used as the dict_prefs PRIMARY KEY for
// imported sources. The separator must be a byte that can't occur in a real
// dict name or language code (so "ab"+"c" never collides with "a"+"bc") AND
// must survive being stored as SQLite TEXT through the native bridge. NUL
// (U+0000) satisfies the first but FAILS the second: on-device,
// react-native-sqlite-storage stores TEXT with C-string semantics, so an
// embedded NUL TRUNCATES the value at the separator — "Dune" + NUL + "und" was
// persisted as just "Dune". The live source recomputes the FULL key on the
// next open, so the truncated stored row never matches back, mergeDictPrefs
// falls through to its enabled-by-default branch, and every imported dict's
// saved enable/order silently reverts on reopen (the "settings not saved" bug
// — confirmed in the on-device [settings] logs, themselves cut off at the NUL).
// U+001F (ASCII Unit Separator) is just as absent from names/lang codes but is
// an ordinary byte that round-trips through TEXT untouched.
export const identityKey = (name: string, lang: string): string =>
  `${name}\u001f${lang}`;

// dict_prefs primary key for a source (resolution #6 / F3): an IMPORTED
// dict keys on its audit identity (identityKey(name,lang)) so two dicts
// sharing a display name in different languages get distinct prefs; the
// built-in base (WordNet) and User sources have no language ambiguity, so
// their bare name is the key (matching how sourceLang special-cases them).
export const dictPrefKey = (
  name: string,
  lang: string,
  removable: boolean,
): string => (removable ? identityKey(name, lang) : name);

// F7 — the on-disk source files + optional containing folder for one
// discovered descriptor, exactly the set runImport would have deleted
// (StarDict: ifo/idx/dict/syn + sidecar, then rmdir the setPath folder;
// CSV: the loose .csv + its per-file sidecar, no folder). PURE: maps a
// descriptor to paths; the caller does the I/O. `forceRefresh`/`refresh`
// sentinels are NOT included (they self-clean on the next import).
export const sourcePathsOf = (
  d: ImportJobDescriptor,
): {files: string[]; folder?: string} => {
  if (d.kind === 'csv') {
    const files = [d.csvPath];
    if (d.sidecarPath !== undefined) {
      files.push(d.sidecarPath);
    }
    return {files};
  }
  const files = [d.ifoPath, d.idxPath, d.dictPath];
  if (d.synPath !== undefined) {
    files.push(d.synPath);
  }
  if (d.sidecarPath !== undefined) {
    files.push(d.sidecarPath);
  }
  return {files, folder: d.setPath};
};

export const reconcileImports = (
  descriptors: ImportJobDescriptor[],
  auditRows: ImportRow[],
  opts: ReconcileOpts,
): ReconcileItem[] => {
  const auditByKey = new Map<string, ImportRow>();
  for (const row of auditRows) {
    auditByKey.set(identityKey(row.name, row.lang), row);
  }

  const items: ReconcileItem[] = [];
  const seen = new Set<string>();
  // Keys whose audit row is already consumed by a descriptor (as an
  // 'import' RE-ADD or a kept 'open') so the trailing audit-only pass
  // doesn't double-open them.
  const consumedKeys = new Set<string>();

  // Descriptors first: NEW + RE-ADD become 'import'; duplicates skip.
  for (const descriptor of descriptors) {
    const {name, language: lang} = descriptor.sidecar;
    const key = identityKey(name, lang);
    if (seen.has(key)) {
      items.push({
        bucket: 'skip',
        reason: 'duplicate name+lang on disk',
        descriptor,
      });
      continue;
    }
    seen.add(key);
    consumedKeys.add(key);
    const prior = auditByKey.get(key);
    if (prior === undefined) {
      // NEW dict (no audit hit) -> always import (fresh filename resolved).
      items.push({bucket: 'import', descriptor});
      continue;
    }
    // F4-FR3: an audit-hit descriptor whose sources were KEPT and whose
    // slug DB is healthy is "done" — 'open' the existing slug, skip the
    // re-import (this is what breaks the kept-source re-import loop). A
    // `.refresh` sentinel (forceRefresh) or a STALE stamp overrides this;
    // so does keep=false or an unhealthy slug.
    const forceRefresh =
      descriptor.kind === 'stardict' || descriptor.kind === 'csv'
        ? descriptor.forceRefresh === true
        : false;
    // A slug DB whose stamp is behind the current pipeline was built by an
    // older importer (e.g. HTML stored as raw tags); a version-0 pre-versioning
    // row is stale by definition. It still SERVES from the old DB — the
    // refresh rebuilds into the A/B sibling and repoints the audit row.
    const stale = isStaleImport(prior);
    const keptHealthy = opts.keepSources && opts.slugHealthy.has(prior.filename);
    if (keptHealthy && !forceRefresh && !stale) {
      // Fast path: nothing changed — just open the served slug.
      items.push({bucket: 'open', row: prior});
    } else if (keptHealthy && stale && !forceRefresh) {
      // SILENT auto-refresh (stale stamp, no user gesture): the OPEN+refresh
      // PAIR. Keep serving the OLD DB this session ('open') AND rebuild into the
      // sibling in the background ('import' + refreshInPlace). runImport swaps
      // the audit row atomically; the new content is served from the NEXT
      // bootstrap (bounded 2-boot convergence). A failed rebuild leaves the old
      // DB + audit row intact. refreshInPlace items are excluded from the
      // first-run prompt probe and always run keepSources=true.
      items.push({bucket: 'open', row: prior});
      items.push({bucket: 'import', descriptor, prior, refreshInPlace: true});
    } else {
      // EXPLICIT re-import: a `.refresh` sentinel (forceRefresh, any staleness),
      // OR keep=false re-drop, OR an unhealthy slug. Import-only carrying `prior`
      // (NOT refreshInPlace) — the build still routes into the sibling slot (the
      // served file is never overwritten), but the fresh file is spliced/opened
      // THIS session via the normal success handler (HEAD parity). A sentinel
      // refresh therefore counts toward the wouldImport prompt probe and honors
      // the user's keepSources flag (the keepSources=true override is only for
      // the silent refreshInPlace path).
      items.push({bucket: 'import', descriptor, prior});
    }
  }

  // Audit rows with no descriptor on disk -> 'open' the existing slug.
  for (const row of auditRows) {
    const key = identityKey(row.name, row.lang);
    if (!consumedKeys.has(key)) {
      items.push({bucket: 'open', row});
    }
  }

  return items;
};

// --- live `sources` derivation (F3) ---------------------------------
//
// The live `sources` array (the one multiDictLookup snapshots per
// lookup) is DERIVED from `allSources` (the full opened registry) by
// applying dict_prefs: keep only enabled sources, ordered by sort_order.
// `identities` resolves each source's prefKey/removable (base/User vs
// imported). Recomputed IN PLACE (clear + push) so the array reference
// the lookup closed over stays valid — a disabled source leaves
// `sources` but stays in `allSources`, so re-enabling needs no reopen.
//
// PURE save for the in-place mutation of `live`: given the same inputs it
// always produces the same ordered enabled set. Sources absent from
// `identities` (defensive) are treated as enabled at their natural index.
export const deriveLiveSources = (
  live: DictSource[],
  allSources: DictSource[],
  identities: Map<DictSource, DictSourceIdentity>,
  persisted: DictPref[],
): void => {
  const identityList: DictSourceIdentity[] = allSources.map(
    source =>
      identities.get(source) ?? {
        name: source.name,
        prefKey: source.name,
        removable: false,
      },
  );
  const merged = mergeDictPrefs(identityList, persisted);
  const sourceByKey = new Map<string, DictSource>();
  allSources.forEach((source, index) => {
    sourceByKey.set(identityList[index].prefKey, source);
  });
  const next: DictSource[] = [];
  for (const pref of merged) {
    const source = sourceByKey.get(pref.prefKey);
    if (source && pref.enabled) {
      next.push(source);
    }
  }
  live.length = 0;
  live.push(...next);
};
