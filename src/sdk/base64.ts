// Base64 decoder that works on any JS engine. Same defensive shape as
// src/sdk/utf8.ts: try the platform `atob` (RN polyfills it; most
// modern Hermes/JSC have it); fall back to a portable inline decoder
// when it's missing or throws. The bundled WordNet StarDict is held
// as base64 strings inside baseDictData.ts and decoded once at first
// lookup, so this is the load-bearing entry point for runtime data.

const hasAtob = typeof atob !== 'undefined';

const TABLE = new Uint8Array(256);
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
TABLE.fill(0xff);
for (let i = 0; i < ALPHABET.length; i++) {
  TABLE[ALPHABET.charCodeAt(i)] = i;
}
TABLE['='.charCodeAt(0)] = 0;

const manualDecodeBase64 = (b64: string): Uint8Array => {
  /* eslint-disable no-bitwise */
  // Strip whitespace defensively (line breaks may slip in if the
  // generated file ever wraps).
  const clean = b64.replace(/[\s]/g, '');
  let pad = 0;
  if (clean.length >= 1 && clean.charCodeAt(clean.length - 1) === 0x3d) {
    pad++;
  }
  if (clean.length >= 2 && clean.charCodeAt(clean.length - 2) === 0x3d) {
    pad++;
  }
  const outLength = (clean.length / 4) * 3 - pad;
  const out = new Uint8Array(outLength);
  let outPos = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = TABLE[clean.charCodeAt(i)];
    const c1 = TABLE[clean.charCodeAt(i + 1)];
    const c2 = TABLE[clean.charCodeAt(i + 2)];
    const c3 = TABLE[clean.charCodeAt(i + 3)];
    out[outPos++] = (c0 << 2) | (c1 >> 4);
    if (outPos < outLength) {
      out[outPos++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    }
    if (outPos < outLength) {
      out[outPos++] = ((c2 & 0x03) << 6) | c3;
    }
  }
  /* eslint-enable no-bitwise */
  return out;
};

const decodeViaAtob = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
};

export const decodeBase64 = (b64: string): Uint8Array => {
  if (hasAtob) {
    try {
      return decodeViaAtob(b64);
    } catch {
      // fall through
    }
  }
  return manualDecodeBase64(b64);
};

// Test-only escape hatch — same pattern as utf8.ts.
export const __testing__ = {manualDecodeBase64};
