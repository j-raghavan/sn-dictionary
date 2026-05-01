// Scans the user-dict root (defaults to /storage/emulated/0/MyStyle/SnDict)
// and returns a DictSource for every recognised dictionary folder.
// Each DictSource is lazy — discovery only inspects file metadata
// and (optionally) reads each folder's small `meta.json`. Heavy
// parsing happens on first lookup against that source.
//
// Folder layout, per dict:
//
//   <SnDict-root>/<name>/
//     ├── meta.json                      (optional; just `{name}` today)
//     ├── *.ifo + *.idx + *.dict[.dz]    -> StarDict
//     ├── *.csv                          -> CSV
//     ├── *.json                         -> JSON
//     └── *.mdx                          -> logged as deferred (skipped)
//
// Per-folder failures are isolated and logged — one bad dict folder
// doesn't break discovery for the others.

import {decodeUtf8} from '../../sdk/utf8';
import type {DictSource} from '../lookup';
import {createCsvDictSource} from './csvDictSource';
import {createJsonDictSource} from './jsonDictSource';
import {createStardictLookup, type DictBytes} from './stardictLookup';

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

const readMetaName = async (
  files: FileEntry[],
  fetchFn: typeof fetch,
): Promise<string | undefined> => {
  const meta = files.find(f => f.type === 1 && basenameOf(f.path) === 'meta.json');
  if (!meta) {
    return undefined;
  }
  try {
    const text = decodeUtf8(await fetchAsUint8(meta.path, fetchFn));
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as {name?: unknown}).name === 'string' &&
      (parsed as {name: string}).name.trim().length > 0
    ) {
      return (parsed as {name: string}).name.trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
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
  // Exclude meta.json from JSON dict candidates.
  const json = filesOnly.find(
    f => extOf(f.path) === '.json' && basenameOf(f.path) !== 'meta.json',
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

  const metaName = await readMetaName(files, fetchFn);
  const displayName = metaName ?? folderName;

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
      logger,
    });
  }
  if (detected.kind === 'csv') {
    return createCsvDictSource({
      name: displayName,
      loadBytes: () => fetchAsArrayBuffer(detected.path, fetchFn),
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

// Build a source for a single dict file living directly in the root
// (no surrounding folder). StarDict is multi-file and never qualifies
// here — it must be in a subfolder. CSV and JSON are single-file and
// stand on their own. MDX is logged as deferred.
const buildSourceForRootFile = (
  file: FileEntry,
  fetchFn: typeof fetch,
  logger: Logger,
): DictSource | null => {
  const ext = extOf(file.path);
  const baseName = basenameOf(file.path);
  const displayName = nameFromFile(file.path);
  if (ext === '.csv') {
    return createCsvDictSource({
      name: displayName,
      loadBytes: () => fetchAsArrayBuffer(file.path, fetchFn),
      logger,
    });
  }
  if (ext === '.json' && baseName !== 'meta.json') {
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
  for (const file of rootFiles) {
    try {
      const source = buildSourceForRootFile(file, fetchFn, logger);
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
