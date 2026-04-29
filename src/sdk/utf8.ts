// UTF-8 codec that works on any JS engine. RN 0.79 ships TextEncoder /
// TextDecoder via its polyfills, but the Supernote firmware's JS engine
// has been observed silently throwing on `new TextEncoder()` (no
// `[stardict:base] loader threw` warn shows in logcat after a known-
// failing lookup, but no warn output of any level lands either, so the
// safest assumption is that the constructor reference is undefined and
// throws a ReferenceError that bubbles into the safeBuild catch).
//
// We try the platform globals first for speed, then fall back to a
// portable inline implementation so the StarDict reader works
// regardless of the host's polyfill state.

const hasTextEncoder = typeof TextEncoder !== 'undefined';
const hasTextDecoder = typeof TextDecoder !== 'undefined';

const manualEncodeUtf8 = (s: string): Uint8Array => {
  /* eslint-disable no-bitwise */
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let codepoint = s.charCodeAt(i);
    if (codepoint >= 0xd800 && codepoint <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (codepoint < 0x80) {
      out.push(codepoint);
    } else if (codepoint < 0x800) {
      out.push(0xc0 | (codepoint >> 6));
      out.push(0x80 | (codepoint & 0x3f));
    } else if (codepoint < 0x10000) {
      out.push(0xe0 | (codepoint >> 12));
      out.push(0x80 | ((codepoint >> 6) & 0x3f));
      out.push(0x80 | (codepoint & 0x3f));
    } else {
      out.push(0xf0 | (codepoint >> 18));
      out.push(0x80 | ((codepoint >> 12) & 0x3f));
      out.push(0x80 | ((codepoint >> 6) & 0x3f));
      out.push(0x80 | (codepoint & 0x3f));
    }
  }
  /* eslint-enable no-bitwise */
  return new Uint8Array(out);
};

const manualDecodeUtf8 = (bytes: Uint8Array): string => {
  /* eslint-disable no-bitwise */
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++];
    let codepoint: number;
    if (b1 < 0x80) {
      codepoint = b1;
    } else if (b1 < 0xc0) {
      // Stray continuation byte — replace and continue.
      codepoint = 0xfffd;
    } else if (b1 < 0xe0) {
      const b2 = bytes[i++] ?? 0;
      codepoint = ((b1 & 0x1f) << 6) | (b2 & 0x3f);
    } else if (b1 < 0xf0) {
      const b2 = bytes[i++] ?? 0;
      const b3 = bytes[i++] ?? 0;
      codepoint = ((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
    } else {
      const b2 = bytes[i++] ?? 0;
      const b3 = bytes[i++] ?? 0;
      const b4 = bytes[i++] ?? 0;
      codepoint =
        ((b1 & 0x07) << 18) |
        ((b2 & 0x3f) << 12) |
        ((b3 & 0x3f) << 6) |
        (b4 & 0x3f);
    }
    if (codepoint < 0x10000) {
      result += String.fromCharCode(codepoint);
    } else {
      const adjusted = codepoint - 0x10000;
      result += String.fromCharCode(0xd800 | (adjusted >> 10));
      result += String.fromCharCode(0xdc00 | (adjusted & 0x3ff));
    }
  }
  /* eslint-enable no-bitwise */
  return result;
};

export const encodeUtf8 = (s: string): Uint8Array => {
  if (hasTextEncoder) {
    try {
      return new TextEncoder().encode(s);
    } catch {
      // fall through
    }
  }
  return manualEncodeUtf8(s);
};

export const decodeUtf8 = (bytes: Uint8Array): string => {
  if (hasTextDecoder) {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      // fall through
    }
  }
  return manualDecodeUtf8(bytes);
};

// Test-only escape hatch so we can exercise the manual path even when
// TextEncoder/TextDecoder ARE available in the host.
export const __testing__ = {manualEncodeUtf8, manualDecodeUtf8};
