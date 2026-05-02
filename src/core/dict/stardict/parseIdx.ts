// StarDict `.idx` parser.
// Format: a packed sequence of records:
//   word (UTF-8) \0 [data-offset] [data-length]
// data-offset is 4 bytes (idxoffsetbits=32) or 8 bytes (idxoffsetbits=64),
// big-endian unsigned. data-length is always 4 bytes big-endian unsigned.
// The records are sorted by case-sensitive byte order in the original
// StarDict spec; we don't depend on that order — the orchestrator
// re-indexes case-insensitively for lookup.
//
// Async + cooperative-yield: large user-supplied dicts can have
// 200k–2M entries. Walking the buffer synchronously blocks the JS
// thread for many seconds on Hermes; we yield to the event loop
// every YIELD_PERIOD entries so background priming doesn't freeze
// the UI.

import {decodeUtf8} from '../../../sdk/utf8';
import {shouldYield, yieldToEventLoop} from './yieldOften';

export type IdxEntry = {
  word: string;
  offset: number;
  length: number;
};

export const parseIdx = async (
  bytes: Uint8Array,
  idxoffsetbits: 32 | 64,
): Promise<IdxEntry[]> => {
  const entries: IdxEntry[] = [];
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const offsetBytes = idxoffsetbits === 64 ? 8 : 4;
  const recordTrailerBytes = offsetBytes + 4;
  let i = 0;
  while (i < bytes.length) {
    let end = i;
    while (end < bytes.length && bytes[end] !== 0) {
      end++;
    }
    if (end >= bytes.length) {
      throw new Error('parseIdx: unterminated word at end of buffer');
    }
    if (end === i) {
      throw new Error(`parseIdx: empty word at offset ${i}`);
    }
    if (end + 1 + recordTrailerBytes > bytes.length) {
      throw new Error(
        `parseIdx: truncated record after word at offset ${i}`,
      );
    }
    const word = decodeUtf8(bytes.subarray(i, end));
    let pos = end + 1;
    let offset: number;
    if (idxoffsetbits === 64) {
      const hi = view.getUint32(pos, false);
      const lo = view.getUint32(pos + 4, false);
      // JS numbers are safe up to 2^53; .dict files larger than 8PiB
      // are not a concern for our use case.
      offset = hi * 0x100000000 + lo;
      pos += 8;
    } else {
      offset = view.getUint32(pos, false);
      pos += 4;
    }
    const length = view.getUint32(pos, false);
    pos += 4;
    entries.push({word, offset, length});
    i = pos;
    if (shouldYield(entries.length)) {
      await yieldToEventLoop();
    }
  }
  return entries;
};
