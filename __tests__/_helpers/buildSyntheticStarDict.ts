// Re-export of the StarDict writer for tests. The actual implementation
// lives in src/ so tests, runtime placeholder builders, and any future
// build-time script all use one source-of-truth.
//
// Backwards-compatible alias kept so older test imports keep working.

import {
  writeStarDict,
  type StarDictBytes,
  type WriteOptions,
} from '../../src/core/dict/stardict/writeStardict';

export type SyntheticStarDict = StarDictBytes;
export type BuildOptions = WriteOptions;

export const buildSyntheticStarDict = (
  entries: Record<string, string>,
  options: WriteOptions = {},
): StarDictBytes => writeStarDict(entries, options);
