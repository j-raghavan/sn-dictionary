import pako from 'pako';

// .dict files in StarDict are either:
//   - raw concatenated UTF-8 definition payloads (.dict)
//   - dictzip-compressed (.dict.dz) — gzip with a random-access "RA"
//     extra field; pako reads this transparently as plain gzip
//
// For spike 3 we decompress the whole .dict.dz at startup and keep the
// uncompressed bytes in memory. Per-block random-access via the dictzip
// RA field is a v1.x optimisation if memory profiling shows we need it.

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

export const decompressDict = (bytes: Uint8Array): Uint8Array => {
  if (
    bytes.length >= 2 &&
    bytes[0] === GZIP_MAGIC_0 &&
    bytes[1] === GZIP_MAGIC_1
  ) {
    return pako.inflate(bytes);
  }
  return bytes;
};
