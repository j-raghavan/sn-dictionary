// Scans the user-dict root (defaults to /storage/emulated/0/MyStyle/SnDict)
// for sideloadable dictionaries and returns an import-job descriptor for
// each (TF5-FR1, extended M16). Two layouts are discovered:
//
//   StarDict (subfolder) — each dict in its own folder:
//     <SnDict-root>/<folder>/
//       ├── meta.json                    (OPTIONAL sidecar — name+language)
//       ├── *.ifo + *.idx + *.dict[.dz]  (the StarDict triple)
//       └── *.syn                        (optional synonym index)
//
//   CSV (loose root file) — a single *.csv at the root:
//     <SnDict-root>/
//       ├── Dune.csv                     -> a CSV dict named "Dune"
//       ├── Dune.meta.json               (OPTIONAL per-file sidecar)
//       └── meta.json                    (OPTIONAL shared root sidecar —
//                                         its csv.* block applies to every
//                                         CSV; its name is NOT broadcast)
//
// Each descriptor carries a `kind` discriminator ('stardict' | 'csv').
// Discovery only LOCATES files + resolves the sidecar; it does not read
// the dictionary bytes or build any DictSource. The import pipeline
// (runImport + the kind-appropriate produce-step) consumes them.
//
// Per-item failures are isolated and logged — one bad folder/file doesn't
// break discovery for the rest. Discovery never throws: a missing or
// unreadable root yields an empty list (the bundled base.db still works).

import {decodeUtf8} from '../../sdk/utf8';
import {isMetaJsonName} from './metaJsonName';
import {
  parseCsvConfig,
  parseSidecar,
  type CsvColumnConfig,
  type Sidecar,
} from './sqlite/importSidecar';

export const DEFAULT_USER_DICT_ROOT = '/storage/emulated/0/MyStyle/SnDict';

export type FileEntry = {path: string; type: number}; // 0=dir, 1=file

export type FileUtilsLike = {
  exists: (path: string) => Promise<boolean>;
  listFiles: (path: string) => Promise<FileEntry[] | null | undefined>;
};

export type Logger = {
  log: (msg: string) => void;
  warn: (msg: string) => void;
};

export type DiscoveryDeps = {
  fileUtils: FileUtilsLike;
  // Override the scan root. Defaults to MyStyle/SnDict.
  rootPath?: string;
  // Injected for tests; defaults to globalThis.fetch at runtime.
  fetchFn?: typeof fetch;
  logger?: Logger;
};

// One sideloadable StarDict found on disk. setPath is the containing
// folder; the *Path fields are absolute file paths; sidecar is the
// resolved meta.json (or defaults).
export type StardictJobDescriptor = {
  kind: 'stardict';
  setPath: string;
  ifoPath: string;
  idxPath: string;
  dictPath: string;
  synPath?: string;
  // Absent when the folder ships no meta.json (the dict still loads with
  // a default sidecar). Present when a meta.json exists — used to read it
  // and to delete it after a verified import.
  sidecarPath?: string;
  // Always resolved: the parsed meta.json, or a default {name:
  // folderName, language:'und'} when meta.json is absent/invalid.
  sidecar: Sidecar;
  // F4-FR9: set true when a `.refresh` sentinel is present in the set
  // folder. reconcileImports then forces a re-import even for a kept,
  // already-imported set (overriding the keep+healthy 'open' rule); the
  // sentinel is deleted (best-effort) after a successful refresh import.
  forceRefresh?: boolean;
  // F4-FR9: absolute path of the `.refresh` sentinel (when present), so
  // the import can delete it after a verified refresh.
  refreshPath?: string;
};

// One sideloadable CSV found loose at the root. csvPath is the *.csv
// file; csvConfig is the resolved column layout (defaults applied
// downstream); sidecarPath (when present) is the meta.json deleted with
// the CSV after a verified import.
export type CsvJobDescriptor = {
  kind: 'csv';
  csvPath: string;
  csvConfig: CsvColumnConfig;
  sidecarPath?: string;
  // name = filename-sans-.csv; language from the sidecar or 'und'.
  sidecar: Sidecar;
  // F4-FR9: set true when a `<name>.refresh` sentinel sits beside the
  // `.csv`. Forces a re-import for a kept, already-imported CSV.
  forceRefresh?: boolean;
  // F4-FR9: absolute path of the `<name>.refresh` sentinel (when present).
  refreshPath?: string;
};

export type ImportJobDescriptor = StardictJobDescriptor | CsvJobDescriptor;

const TAG = '[discovery]';

const fetchAsUint8 = async (
  path: string,
  fetchFn: typeof fetch,
): Promise<Uint8Array> => {
  const res = await fetchFn(`file://${path}`);
  if (!res.ok) {
    throw new Error(`fetch ${path} returned status ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

// Lower-cased extension or '' if none. Special-cases the .dict.dz
// double extension.
const extOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  if (base.toLowerCase().endsWith('.dict.dz')) {
    return '.dict.dz';
  }
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot).toLowerCase();
};

const basenameOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};

type StardictTriple = {
  ifo: string;
  idx: string;
  dict: string;
  syn?: string;
};

// Locate a complete StarDict triple among a folder's files. Returns
// null when the triple is incomplete (missing one of ifo/idx/dict).
const findTriple = (files: FileEntry[]): StardictTriple | null => {
  const filesOnly = files.filter(f => f.type === 1);
  const ifo = filesOnly.find(f => extOf(f.path) === '.ifo');
  const idx = filesOnly.find(f => extOf(f.path) === '.idx');
  const dict = filesOnly.find(
    f => extOf(f.path) === '.dict.dz' || extOf(f.path) === '.dict',
  );
  const syn = filesOnly.find(f => extOf(f.path) === '.syn');
  if (!ifo || !idx || !dict) {
    return null;
  }
  return {
    ifo: ifo.path,
    idx: idx.path,
    dict: dict.path,
    syn: syn ? syn.path : undefined,
  };
};

// Find the meta.json sidecar in a folder — either the shared
// `meta.json` or a `<basename>.meta.json` sidecar (shared predicate).
const findSidecar = (files: FileEntry[]): FileEntry | undefined =>
  files.find(f => f.type === 1 && isMetaJsonName(basenameOf(f.path)));

// F4-FR9: the StarDict refresh sentinel is a file named exactly
// `.refresh` in the set folder. Its presence forces a re-import.
const findRefreshSentinel = (files: FileEntry[]): FileEntry | undefined =>
  files.find(f => f.type === 1 && basenameOf(f.path) === '.refresh');

const buildDescriptor = async (
  folder: FileEntry,
  files: FileEntry[],
  fetchFn: typeof fetch,
  logger: Logger,
): Promise<ImportJobDescriptor | null> => {
  const folderName = basenameOf(folder.path);

  // The triple IS the dictionary — it's the only hard requirement.
  const triple = findTriple(files);
  if (triple === null) {
    logger.warn(
      `${TAG} folder "${folderName}" has no complete StarDict triple (need *.ifo + *.idx + *.dict[.dz]) — skipped`,
    );
    return null;
  }

  // Default sidecar when meta.json is absent/invalid: the core feature
  // (definition lookup) must work with minimum input. name = folder
  // name, language 'und' (so the thesaurus tab cleanly short-circuits to
  // empty — thesaurus is an enhancement, not a gate). format undefined
  // -> importStardict derives it from the .ifo sametypesequence.
  const defaultSidecar: Sidecar = {name: folderName, language: 'und'};

  // F4-FR9: a `.refresh` sentinel in the folder forces a re-import even
  // for a kept, already-imported set.
  const refreshEntry = findRefreshSentinel(files);

  const sidecarEntry = findSidecar(files);
  // No meta.json -> load with defaults (NOT skipped).
  if (sidecarEntry === undefined) {
    logger.log(
      `${TAG} folder "${folderName}" has no meta.json — loading with defaults (name="${folderName}", language="und")`,
    );
    const descriptor: StardictJobDescriptor = {
      kind: 'stardict',
      setPath: folder.path,
      ifoPath: triple.ifo,
      idxPath: triple.idx,
      dictPath: triple.dict,
      synPath: triple.syn,
      sidecar: defaultSidecar,
    };
    if (refreshEntry !== undefined) {
      descriptor.forceRefresh = true;
      descriptor.refreshPath = refreshEntry.path;
    }
    return descriptor;
  }

  // meta.json present — try to use it, but DEGRADE to defaults on any
  // problem (read error / bad JSON / failed validation), never skip.
  let sidecar = defaultSidecar;
  try {
    const sidecarText = decodeUtf8(await fetchAsUint8(sidecarEntry.path, fetchFn));
    const parsed: unknown = JSON.parse(sidecarText);
    const result = parseSidecar(parsed);
    if (result.ok) {
      sidecar = result.sidecar;
    } else {
      logger.warn(
        `${TAG} folder "${folderName}" meta.json invalid: ${result.reason} — loading with defaults`,
      );
    }
  } catch (e) {
    logger.warn(
      `${TAG} folder "${folderName}" meta.json unreadable: ${(e as Error).message} — loading with defaults`,
    );
  }

  const descriptor: StardictJobDescriptor = {
    kind: 'stardict',
    setPath: folder.path,
    ifoPath: triple.ifo,
    idxPath: triple.idx,
    dictPath: triple.dict,
    synPath: triple.syn,
    sidecarPath: sidecarEntry.path,
    sidecar,
  };
  if (refreshEntry !== undefined) {
    descriptor.forceRefresh = true;
    descriptor.refreshPath = refreshEntry.path;
  }
  return descriptor;
};

// --- CSV (loose root file) discovery (M16) -------------------------

// Read + parse a JSON sidecar file; null on any read/parse failure.
const readJson = async (
  path: string,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown> | null> => {
  try {
    const text = decodeUtf8(await fetchAsUint8(path, fetchFn));
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

// The CSV display name is ALWAYS the filename sans .csv — a shared root
// meta.json's `name` is NOT broadcast across CSVs (only its csv.* config
// is). A per-file sidecar may still set language/format/etc., but not the
// name (each loose CSV is its own dict, named by its file).
const csvNameOf = (csvPath: string): string => {
  const base = basenameOf(csvPath);
  return base.slice(0, base.length - '.csv'.length);
};

// Build a CSV descriptor for a loose `*.csv`. Sidecar resolution, in
// precedence order: a per-file `<base>.meta.json` (language/format) over
// the shared root meta.json (csv.* config); the name is always the
// filename; language defaults to 'und'. Never throws — a malformed
// sidecar degrades to defaults.
const buildCsvDescriptor = async (
  csvPath: string,
  perFileSidecarPath: string | undefined,
  refreshPath: string | undefined,
  rootMeta: Record<string, unknown> | null,
  fetchFn: typeof fetch,
  logger: Logger,
): Promise<CsvJobDescriptor> => {
  const name = csvNameOf(csvPath);
  // The shared root meta.json's csv block is the BASE config for every
  // CSV; a per-file sidecar's csv block overrides it key-by-key.
  let csvConfig: CsvColumnConfig = rootMeta
    ? parseCsvConfig(rootMeta.csv)
    : {};
  let language = 'und';

  if (perFileSidecarPath !== undefined) {
    const obj = await readJson(perFileSidecarPath, fetchFn);
    if (obj === null) {
      logger.warn(
        `${TAG} CSV "${name}" sidecar unreadable/malformed — using defaults`,
      );
    } else {
      // Per-file csv block overrides the root one (per-key).
      csvConfig = {...csvConfig, ...parseCsvConfig(obj.csv)};
      // Language from the per-file sidecar when valid (name is fixed).
      const parsed = parseSidecar({name, language: obj.language ?? 'und'});
      if (parsed.ok) {
        language = parsed.sidecar.language;
      }
    }
  }

  logger.log(
    `${TAG} CSV "${name}" (language="${language}") -> ${basenameOf(csvPath)}`,
  );
  const descriptor: CsvJobDescriptor = {
    kind: 'csv',
    csvPath,
    csvConfig,
    sidecar: {name, language},
  };
  if (perFileSidecarPath !== undefined) {
    descriptor.sidecarPath = perFileSidecarPath;
  }
  // F4-FR9: a `<name>.refresh` sentinel beside the csv forces a re-import.
  if (refreshPath !== undefined) {
    descriptor.forceRefresh = true;
    descriptor.refreshPath = refreshPath;
  }
  return descriptor;
};

export const discoverUserDicts = async (
  deps: DiscoveryDeps,
): Promise<ImportJobDescriptor[]> => {
  const root = deps.rootPath ?? DEFAULT_USER_DICT_ROOT;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const logger: Logger = deps.logger ?? {log: () => {}, warn: () => {}};

  // Discovery never throws — a missing/unreadable root just yields zero
  // import jobs; base.db still works.
  let entries: FileEntry[] | null | undefined;
  try {
    entries = await deps.fileUtils.listFiles(root);
  } catch (e) {
    logger.log(
      `${TAG} root "${root}" not listable (${(e as Error).message}) — no user dicts`,
    );
    return [];
  }
  if (!entries || entries.length === 0) {
    logger.log(`${TAG} root "${root}" is empty — no user dicts`);
    return [];
  }

  if (typeof fetchFn !== 'function') {
    logger.warn(`${TAG} no fetch implementation — cannot read user dict files`);
    return [];
  }

  const folders = entries.filter(e => e.type === 0);
  const descriptors: ImportJobDescriptor[] = [];

  for (const folder of folders) {
    let folderFiles: FileEntry[] | null | undefined;
    try {
      folderFiles = await deps.fileUtils.listFiles(folder.path);
    } catch (e) {
      logger.warn(
        `${TAG} folder "${basenameOf(folder.path)}" listFiles threw: ${(e as Error).message} — skipped`,
      );
      continue;
    }
    if (!folderFiles || folderFiles.length === 0) {
      logger.warn(
        `${TAG} folder "${basenameOf(folder.path)}" is empty — skipped`,
      );
      continue;
    }
    try {
      const descriptor = await buildDescriptor(
        folder,
        folderFiles,
        fetchFn,
        logger,
      );
      if (descriptor !== null) {
        descriptors.push(descriptor);
      }
    } catch (e) {
      logger.warn(
        `${TAG} folder "${basenameOf(folder.path)}" build threw: ${(e as Error).message} — skipped`,
      );
    }
  }

  // --- loose CSV pass: root-level *.csv files (not *.meta.json) ------
  const rootFiles = entries.filter(e => e.type === 1);
  const csvFiles = rootFiles.filter(
    f => extOf(f.path) === '.csv' && !isMetaJsonName(basenameOf(f.path)),
  );
  if (csvFiles.length > 0) {
    // The shared root meta.json is the file named EXACTLY "meta.json"
    // (a `<base>.meta.json` is a per-file sidecar, never the shared one).
    const sharedMetaEntry = rootFiles.find(
      f => basenameOf(f.path).toLowerCase() === 'meta.json',
    );
    const rootMeta =
      sharedMetaEntry !== undefined
        ? await readJson(sharedMetaEntry.path, fetchFn)
        : null;
    // Index per-file sidecars + `.refresh` sentinels by basename for O(1)
    // `<base>.meta.json` / `<base>.refresh` hits (F4-FR9).
    const byBasename = new Map<string, string>();
    for (const f of rootFiles) {
      const fileBase = basenameOf(f.path);
      if (isMetaJsonName(fileBase) || fileBase.endsWith('.refresh')) {
        byBasename.set(fileBase, f.path);
      }
    }
    for (const csv of csvFiles) {
      const base = basenameOf(csv.path);
      const stem = base.slice(0, base.length - '.csv'.length);
      const perFileSidecarPath = byBasename.get(`${stem}.meta.json`);
      const refreshPath = byBasename.get(`${stem}.refresh`);
      try {
        descriptors.push(
          await buildCsvDescriptor(
            csv.path,
            perFileSidecarPath,
            refreshPath,
            rootMeta,
            fetchFn,
            logger,
          ),
        );
      } catch (e) {
        logger.warn(
          `${TAG} CSV "${base}" build threw: ${(e as Error).message} — skipped`,
        );
      }
    }
  }

  descriptors.sort((a, b) =>
    a.sidecar.name.localeCompare(b.sidecar.name, undefined, {
      sensitivity: 'base',
    }),
  );
  logger.log(
    `${TAG} discovered ${descriptors.length} import job(s): [${descriptors
      .map(d => d.sidecar.name)
      .join(', ')}]`,
  );
  return descriptors;
};
