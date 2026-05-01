// Shared in-memory virtual-filesystem helper for tests that need
// real `discoverUserDicts` running against a controlled file layout.
// Used by both the discovery unit tests and the end-to-end
// integration test.

import type {
  FileEntry,
  FileUtilsLike,
} from '../../src/core/dict/userDictDiscovery';

// Mapping path -> contents. A value of `'dir'` makes the path an
// explicitly-empty directory (otherwise directories are inferred
// from the presence of files under them).
export type Vfs = Record<string, ArrayBuffer | 'dir'>;

const fileEntry = (path: string, type: 0 | 1): FileEntry => ({path, type});

export const makeVfs = (
  entries: Vfs,
): {fileUtils: FileUtilsLike; fetchFn: typeof fetch} => {
  const childrenOf = (dir: string): FileEntry[] => {
    const prefix = dir.endsWith('/') ? dir : dir + '/';
    const seen = new Set<string>();
    const out: FileEntry[] = [];
    for (const path of Object.keys(entries)) {
      if (!path.startsWith(prefix)) {
        continue;
      }
      const tail = path.slice(prefix.length);
      const slash = tail.indexOf('/');
      const childName = slash < 0 ? tail : tail.slice(0, slash);
      if (childName.length === 0 || seen.has(childName)) {
        continue;
      }
      seen.add(childName);
      const childPath = prefix + childName;
      const isDir =
        entries[childPath] === 'dir' ||
        Object.keys(entries).some(
          p => p !== childPath && p.startsWith(childPath + '/'),
        );
      out.push(fileEntry(childPath, isDir ? 0 : 1));
    }
    return out;
  };
  const fileUtils: FileUtilsLike = {
    exists: jest.fn(async path => path in entries),
    listFiles: jest.fn(async path => {
      if (
        !(path in entries) &&
        !Object.keys(entries).some(p => p.startsWith(path + '/'))
      ) {
        throw new Error('Dir is not exists');
      }
      return childrenOf(path);
    }),
  };
  const fetchFn = jest.fn(async (url: string) => {
    const path = url.replace(/^file:\/\//, '');
    const data = entries[path];
    if (data === undefined || data === 'dir') {
      return {
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => data,
    } as unknown as Response;
  });
  return {fileUtils, fetchFn: fetchFn as unknown as typeof fetch};
};

export const enc = (s: string): ArrayBuffer =>
  new TextEncoder().encode(s).buffer as ArrayBuffer;

export const u8ToArrayBuffer = (u8: Uint8Array): ArrayBuffer =>
  u8.buffer.slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength,
  ) as ArrayBuffer;
