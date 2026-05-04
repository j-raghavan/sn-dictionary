// Scans the user-dict root (defaults to /storage/emulated/0/MyStyle/SnDict)
// and returns a DictSource for every recognised dictionary folder.
// Each DictSource is lazy — discovery only inspects file metadata
// and (optionally) reads each dict's small `meta.json`. Heavy
// parsing happens on first lookup against that source.
//
// Two layouts are supported. Both can coexist in the same root.
//
// Organised layout (one dict per subfolder):
//
//   <SnDict-root>/<name>/
//     ├── meta.json                      (optional)
//     ├── *.ifo + *.idx + *.dict[.dz]    -> StarDict
//     ├── *.csv                          -> CSV
//     ├── *.json                         -> JSON
//     └── *.mdx                          -> logged as deferred (skipped)
//
// Flat layout (single-file dicts at the root):
//
//   <SnDict-root>/
//     ├── meta.json                      (optional, applies to ALL flat-
//     │                                   layout files unless overridden)
//     ├── Dune.csv                       -> CSV
//     ├── Dune.meta.json                 (optional sidecar; overrides
//     │                                   the shared meta.json for Dune.csv)
//     └── medical.json                   -> JSON
//
// StarDict has multiple required files and never qualifies for flat
// layout. CSV/JSON each stand on their own.
//
// meta.json schema (all fields optional):
//
//   {
//     "name": "Display Name",
//     "csv": {
//       "headwordCol": 0,
//       "definitionCol": 1,
//       "phoneticCol": 2,
//       "hasHeader": false
//     }
//   }
//
// Per-folder/per-file failures are isolated and logged — one bad
// dict doesn't break discovery for the others.

import {decodeUtf8} from '../../sdk/utf8';
import type {DictSource} from '../lookup';
import {createCsvDictSource} from './csvDictSource';
import {createJsonDictSource} from './jsonDictSource';
import {createStardictLookup, type DictBytes} from './stardictLookup';
import type {IndexCacheStorage} from './indexCacheStorage';

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
  // Optional persistent index cache. Threaded into discovered
  // StarDict sources so they hydrate from disk on subsequent loads
  // instead of re-parsing the .idx + .syn from scratch. CSV / JSON
  // sources don't get this — they parse fast enough to not justify
  // the complexity.
  cache?: IndexCacheStorage;
  logger?: Logger;
};

const TAG = '[discovery]';

const fetchAsArrayBuffer = async (
  path: string,
  fetchFn: typeof fetch,
): Promise<ArrayBuffer> => {
  const res = await fetchFn(`file://${path}`);
  if (!res.ok) {
    throw new Error(
      `fetch ${path} returned status ${res.status}`,
    );
  }
  return await res.arrayBuffer();
};

const fetchAsUint8 = async (
  path: string,
  fetchFn: typeof fetch,
): Promise<Uint8Array> =>
  new Uint8Array(await fetchAsArrayBuffer(path, fetchFn));

// Lower-cased extension or '' if none.
const extOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  // Special-case the .dict.dz double extension.
  if (base.toLowerCase().endsWith('.dict.dz')) {
    return '.dict.dz';
  }
  const dot = base.lastIndexOf('.');
  if (dot < 0) {
    return '';
  }
  return base.slice(dot).toLowerCase();
};

const basenameOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};

// `meta.json` is the shared/folder convention; `<basename>.meta.json`
// is the per-file sidecar convention at root level. Both must be
// excluded from JSON-dict detection so the meta config never gets
// mistaken for an actual dictionary file.
const isMetaJsonName = (name: string): boolean =>
  name === 'meta.json' || name.toLowerCase().endsWith('.meta.json');

type CsvMetaConfig = {
  headwordCol?: number;
  definitionCol?: number;
  phoneticCol?: number;
  hasHeader?: boolean;
};

type FolderMeta = {
  name?: string;
  csv?: CsvMetaConfig;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Pick a non-negative integer field from a parsed meta blob. Anything
// non-numeric, negative, or non-integer is dropped — there's no
// meaningful interpretation, and silently ignoring lets a typo in
// meta.json fall back to defaults instead of crashing discovery.
const pickNonNegInt = (
  obj: Record<string, unknown>,
  key: string,
): number | undefined => {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    return undefined;
  }
  return v;
};

const parseCsvMeta = (raw: unknown): CsvMetaConfig | undefined => {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const cfg: CsvMetaConfig = {};
  const hw = pickNonNegInt(raw, 'headwordCol');
  if (hw !== undefined) {
    cfg.headwordCol = hw;
  }
  const def = pickNonNegInt(raw, 'definitionCol');
  if (def !== undefined) {
    cfg.definitionCol = def;
  }
  const phon = pickNonNegInt(raw, 'phoneticCol');
  if (phon !== undefined) {
    cfg.phoneticCol = phon;
  }
  if (typeof raw.hasHeader === 'boolean') {
    cfg.hasHeader = raw.hasHeader;
  }
  return cfg;
};

const readMetaFile = async (
  meta: FileEntry,
  fetchFn: typeof fetch,
): Promise<FolderMeta> => {
  try {
    const text = decodeUtf8(await fetchAsUint8(meta.path, fetchFn));
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      return {};
    }
    const out: FolderMeta = {};
    if (typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
      out.name = parsed.name.trim();
    }
    const csv = parseCsvMeta(parsed.csv);
    if (csv !== undefined) {
      out.csv = csv;
    }
    return out;
  } catch {
    return {};
  }
};

const readFolderMeta = async (
  files: FileEntry[],
  fetchFn: typeof fetch,
): Promise<FolderMeta> => {
  const meta = files.find(f => f.type === 1 && basenameOf(f.path) === 'meta.json');
  return meta ? await readMetaFile(meta, fetchFn) : {};
};

type DetectedFormat =
  | {
      kind: 'stardict';
      ifo: string;
      idx: string;
      dict: string;
      // Optional StarDict synonym index file. Wiktionary-derived
      // dicts use this to ship Latin transliterations alongside
      // native-script headwords; reading it makes Latin lookups
      // work for non-Latin-script languages.
      syn?: string;
    }
  | {kind: 'csv'; path: string}
  | {kind: 'json'; path: string}
  | {kind: 'mdx'; path: string}
  | {kind: 'none'}
  | {kind: 'ambiguous'; reasons: string[]};

const detectFormat = (files: FileEntry[]): DetectedFormat => {
  const filesOnly = files.filter(f => f.type === 1);
  const ifo = filesOnly.find(f => extOf(f.path) === '.ifo');
  const idx = filesOnly.find(f => extOf(f.path) === '.idx');
  const dict = filesOnly.find(
    f => extOf(f.path) === '.dict.dz' || extOf(f.path) === '.dict',
  );
  const syn = filesOnly.find(f => extOf(f.path) === '.syn');
  const csv = filesOnly.find(f => extOf(f.path) === '.csv');
  // Exclude meta.json (and any *.meta.json sidecar) from JSON dict
  // candidates — these are config, not dictionary content.
  const json = filesOnly.find(
    f => extOf(f.path) === '.json' && !isMetaJsonName(basenameOf(f.path)),
  );
  const mdx = filesOnly.find(f => extOf(f.path) === '.mdx');

  const stardictComplete = ifo && idx && dict;
  const stardictPartial = (ifo || idx || dict) && !stardictComplete;

  // Format markers found in this folder.
  const present: string[] = [];
  if (stardictComplete) {
    present.push('stardict');
  }
  if (csv) {
    present.push('csv');
  }
  if (json) {
    present.push('json');
  }
  if (mdx) {
    present.push('mdx');
  }

  if (present.length === 0) {
    if (stardictPartial) {
      return {
        kind: 'ambiguous',
        reasons: ['partial StarDict triple — needs *.ifo + *.idx + *.dict[.dz]'],
      };
    }
    return {kind: 'none'};
  }
  if (present.length > 1) {
    return {
      kind: 'ambiguous',
      reasons: [`multiple formats present: ${present.join(', ')}`],
    };
  }
  // present.length === 1 by elimination: pick the matching detector.
  if (stardictComplete) {
    return {
      kind: 'stardict',
      ifo: ifo.path,
      idx: idx.path,
      dict: dict.path,
      syn: syn ? syn.path : undefined,
    };
  }
  if (csv) {
    return {kind: 'csv', path: csv.path};
  }
  if (json) {
    return {kind: 'json', path: json.path};
  }
  // mdx — the only remaining option since present.length === 1.
  return {kind: 'mdx', path: (mdx as FileEntry).path};
};

const buildSourceForFolder = async (
  folder: FileEntry,
  files: FileEntry[],
  fetchFn: typeof fetch,
  logger: Logger,
  cache: IndexCacheStorage | undefined,
): Promise<DictSource | null> => {
  const folderName = basenameOf(folder.path);
  const detected = detectFormat(files);

  if (detected.kind === 'none') {
    logger.warn(
      `${TAG} folder "${folderName}" has no recognised dict files — skipped`,
    );
    return null;
  }
  if (detected.kind === 'ambiguous') {
    logger.warn(
      `${TAG} folder "${folderName}" is ambiguous (${detected.reasons.join('; ')}) — skipped`,
    );
    return null;
  }
  if (detected.kind === 'mdx') {
    logger.warn(
      `${TAG} folder "${folderName}" contains MDX which is not yet supported — skipped`,
    );
    return null;
  }

  const meta = await readFolderMeta(files, fetchFn);
  const displayName = meta.name ?? folderName;

  if (detected.kind === 'stardict') {
    const synPath = detected.syn;
    return createStardictLookup({
      name: displayName,
      loadBase: async (): Promise<DictBytes | null> => {
        const [ifo, idx, dict, syn] = await Promise.all([
          fetchAsUint8(detected.ifo, fetchFn),
          fetchAsUint8(detected.idx, fetchFn),
          fetchAsUint8(detected.dict, fetchFn),
          // .syn is optional. Fetch failures here aren't fatal — fall
          // back to the .idx-only path, which is what we did before
          // .syn support landed.
          synPath
            ? fetchAsUint8(synPath, fetchFn).catch(e => {
                logger.warn(
                  `${TAG} folder "${folderName}" .syn fetch threw: ${(e as Error).message} — continuing without synonyms`,
                );
                return undefined;
              })
            : Promise.resolve(undefined),
        ]);
        return syn ? {ifo, idx, dict, syn} : {ifo, idx, dict};
      },
      cache,
      logger,
    });
  }
  if (detected.kind === 'csv') {
    return createCsvDictSource({
      name: displayName,
      loadBytes: () => fetchAsArrayBuffer(detected.path, fetchFn),
      headwordCol: meta.csv?.headwordCol,
      definitionCol: meta.csv?.definitionCol,
      phoneticCol: meta.csv?.phoneticCol,
      hasHeader: meta.csv?.hasHeader,
      logger,
    });
  }
  // detected.kind === 'json'
  return createJsonDictSource({
    name: displayName,
    loadBytes: () => fetchAsArrayBuffer(detected.path, fetchFn),
    logger,
  });
};

// Strip the trailing extension to derive a display name from a flat
// file: "medical.csv" -> "medical".
const nameFromFile = (filePath: string): string => {
  const base = basenameOf(filePath);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? base : base.slice(0, dot);
};

// Locate a per-file meta sidecar — `<base>.meta.json` next to the
// dict file. Lets users disambiguate when multiple CSVs share the
// root with different schemas (e.g. Dune.csv + Dune.meta.json,
// medical.csv + medical.meta.json). Sidecars take precedence over
// the shared root meta.json.
const findSidecarMeta = (
  file: FileEntry,
  rootFiles: FileEntry[],
): FileEntry | undefined => {
  const display = nameFromFile(file.path);
  const target = `${display}.meta.json`;
  return rootFiles.find(
    f => f.type === 1 && basenameOf(f.path) === target,
  );
};

// Build a source for a single dict file living directly in the root
// (no surrounding folder). StarDict is multi-file and never qualifies
// here — it must be in a subfolder. CSV and JSON are single-file and
// stand on their own. MDX is logged as deferred.
//
// `meta` carries the resolved config for this specific file (sidecar
// override, or fall-back to the shared root meta.json). For CSV that
// includes phoneticCol — a third column users overwhelmingly want
// surfaced as pronunciation in the popup header but which discovery
// previously had no way of binding to a flat-layout file. JSON has no
// configurable schema, so meta only contributes the display name.
const buildSourceForRootFile = (
  file: FileEntry,
  fetchFn: typeof fetch,
  logger: Logger,
  meta: FolderMeta,
): DictSource | null => {
  const ext = extOf(file.path);
  const baseName = basenameOf(file.path);
  const displayName = meta.name ?? nameFromFile(file.path);
  if (ext === '.csv') {
    return createCsvDictSource({
      name: displayName,
      loadBytes: () => fetchAsArrayBuffer(file.path, fetchFn),
      headwordCol: meta.csv?.headwordCol,
      definitionCol: meta.csv?.definitionCol,
      phoneticCol: meta.csv?.phoneticCol,
      hasHeader: meta.csv?.hasHeader,
      logger,
    });
  }
  if (ext === '.json' && !isMetaJsonName(baseName)) {
    return createJsonDictSource({
      name: displayName,
      loadBytes: () => fetchAsArrayBuffer(file.path, fetchFn),
      logger,
    });
  }
  if (ext === '.mdx') {
    logger.warn(
      `${TAG} root file "${baseName}" is MDX which is not yet supported — skipped`,
    );
    return null;
  }
  if (
    ext === '.ifo' ||
    ext === '.idx' ||
    ext === '.dict.dz' ||
    ext === '.dict'
  ) {
    logger.warn(
      `${TAG} root file "${baseName}" looks like StarDict — put it in a subfolder with its sibling files`,
    );
    return null;
  }
  // Anything else (README.md, .DS_Store, meta.json at root, …) is
  // silently ignored.
  return null;
};

export const discoverUserDicts = async (
  deps: DiscoveryDeps,
): Promise<DictSource[]> => {
  const root = deps.rootPath ?? DEFAULT_USER_DICT_ROOT;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const logger: Logger = deps.logger ?? {log: () => {}, warn: () => {}};

  // Discovery itself never throws — a missing or unreadable root just
  // yields zero user dicts, base dict still works.
  let entries: FileEntry[] | null | undefined;
  try {
    entries = await deps.fileUtils.listFiles(root);
  } catch (e) {
    // "Dir is not exists" is the firmware's normal "not present yet"
    // path; that's expected first-run state. Log at info level.
    logger.log(
      `${TAG} root "${root}" not listable (${(e as Error).message}) — no user dicts`,
    );
    return [];
  }
  if (!entries || entries.length === 0) {
    logger.log(`${TAG} root "${root}" is empty — no user dicts`);
    return [];
  }

  const folders = entries.filter(e => e.type === 0);
  const rootFiles = entries.filter(e => e.type === 1);

  if (typeof fetchFn !== 'function') {
    logger.warn(`${TAG} no fetch implementation — cannot read user dict files`);
    return [];
  }

  const sources: DictSource[] = [];

  // Root-level files (flat layout): each .csv / .json IS a complete
  // dict on its own — no subfolder wrapper needed. StarDict triples
  // can't live here; they require a subfolder.
  //
  // Two opt-in sources of per-file config exist at root level:
  //   1. `<basename>.meta.json` sidecar — wins if present, scoped to
  //      that one dict file.
  //   2. shared `meta.json` at root — applies as the fallback to every
  //      root-level dict that has no sidecar. Matches the simplest
  //      single-file layout (one CSV + one meta.json next to it),
  //      which is what most users reach for first.
  //
  // Skip the read entirely when there's no chance the caller cares —
  // i.e. when the only root file types are unrelated (.txt, .md, etc).
  const hasRootDictFile = rootFiles.some(f => {
    const ext = extOf(f.path);
    if (ext === '.csv') {
      return true;
    }
    if (ext === '.json' && !isMetaJsonName(basenameOf(f.path))) {
      return true;
    }
    return false;
  });
  const sharedRootMeta: FolderMeta = hasRootDictFile
    ? await readFolderMeta(rootFiles, fetchFn)
    : {};

  for (const file of rootFiles) {
    try {
      const sidecar = findSidecarMeta(file, rootFiles);
      // Sidecar meta is scoped to one file, so its `name` is safe to
      // honour. Shared root meta is broadcast to every flat-layout
      // dict — its `name` would collide if there's more than one, so
      // we strip it and only carry the schema config across.
      const fileMeta: FolderMeta = sidecar
        ? await readMetaFile(sidecar, fetchFn)
        : {csv: sharedRootMeta.csv};
      const source = buildSourceForRootFile(file, fetchFn, logger, fileMeta);
      if (source !== null) {
        sources.push(source);
      }
    } catch (e) {
      logger.warn(
        `${TAG} root file "${basenameOf(file.path)}" build threw: ${(e as Error).message} — skipped`,
      );
    }
  }

  // Subfolders (organised layout): each subfolder is one dict, in any
  // supported format. meta.json inside the folder may override the
  // display name.
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
      const source = await buildSourceForFolder(
        folder,
        folderFiles,
        fetchFn,
        logger,
        deps.cache,
      );
      if (source !== null) {
        sources.push(source);
      }
    } catch (e) {
      logger.warn(
        `${TAG} folder "${basenameOf(folder.path)}" build threw: ${(e as Error).message} — skipped`,
      );
    }
  }

  sources.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}),
  );
  logger.log(
    `${TAG} discovered ${sources.length} user dict(s): [${sources.map(s => s.name).join(', ')}]`,
  );
  return sources;
};
