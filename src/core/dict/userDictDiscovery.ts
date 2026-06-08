// Scans the user-dict root (defaults to /storage/emulated/0/MyStyle/SnDict)
// for sideloadable StarDict dictionaries and returns an import-job
// descriptor for each (TF5-FR1). Discovery is StarDict-only: each dict
// lives in its own subfolder holding the triple (*.ifo + *.idx +
// *.dict[.dz], optional *.syn) and a meta.json sidecar naming it.
//
//   <SnDict-root>/<folder>/
//     ├── meta.json                      (REQUIRED sidecar — name+language)
//     ├── *.ifo + *.idx + *.dict[.dz]    (the StarDict triple)
//     └── *.syn                          (optional synonym index)
//
// The import pipeline (importStardict) consumes these descriptors:
// discovery only LOCATES files + validates the sidecar; it does not
// read the dictionary bytes or build any DictSource. CSV / JSON / MDX
// and the old flat (root-level single-file) layout are no longer
// supported — sideload is StarDict-only.
//
// Per-folder failures are isolated and logged — one bad folder doesn't
// break discovery for the rest. Discovery never throws: a missing or
// unreadable root yields an empty list (the bundled base.db still
// works).

import {decodeUtf8} from '../../sdk/utf8';
import {isMetaJsonName} from './metaJsonName';
import {parseSidecar, type Sidecar} from './sqlite/importSidecar';

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

// One sideloadable StarDict found on disk, ready to hand to
// importStardict. setPath is the containing folder; the *Path fields
// are absolute file paths; sidecar is the validated meta.json.
export type ImportJobDescriptor = {
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
};

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

  const sidecarEntry = findSidecar(files);
  // No meta.json -> load with defaults (NOT skipped).
  if (sidecarEntry === undefined) {
    logger.log(
      `${TAG} folder "${folderName}" has no meta.json — loading with defaults (name="${folderName}", language="und")`,
    );
    return {
      setPath: folder.path,
      ifoPath: triple.ifo,
      idxPath: triple.idx,
      dictPath: triple.dict,
      synPath: triple.syn,
      sidecar: defaultSidecar,
    };
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

  return {
    setPath: folder.path,
    ifoPath: triple.ifo,
    idxPath: triple.idx,
    dictPath: triple.dict,
    synPath: triple.syn,
    sidecarPath: sidecarEntry.path,
    sidecar,
  };
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
