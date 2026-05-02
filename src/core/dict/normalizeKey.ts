// Lookup-key normalizer. Folds typographic punctuation variants down
// to the ASCII forms a user can actually type on the Supernote
// keyboard, so a stored headword like "Muad’Dib" (with U+2019 curly
// right single quote — what Excel-on-Windows produces from a CSV
// auto-correct) matches the user's typed query "Muad'Dib" (with
// U+0027 straight apostrophe).
//
// Also applies NFC normalization so a file that stores "café" as
// e + combining acute (NFD) matches the user's "café" as the single
// composed codepoint (NFC) — relevant for macOS-edited files.
//
// Diacritics are *not* stripped: é stays é, ñ stays ñ. Those are
// semantically meaningful in many languages and remain reachable
// from the on-screen keyboard.

const PUNCT_FOLD: Record<number, string> = {
  // Single quotes / apostrophes
  0x2018: "'", // ‘ left single quotation mark
  0x2019: "'", // ’ right single quotation mark  (the Dune case)
  0x201a: "'", // ‚ single low-9 quotation mark
  0x201b: "'", // ‛ single high-reversed-9 quotation mark
  0x02bc: "'", // ʼ modifier letter apostrophe
  0xff07: "'", // ' fullwidth apostrophe
  // Double quotes
  0x201c: '"', // “ left double quotation mark
  0x201d: '"', // ” right double quotation mark
  0x201e: '"', // „ double low-9 quotation mark
  0x201f: '"', // ‟ double high-reversed-9 quotation mark
  // Dashes / hyphens
  0x2010: '-', // ‐ hyphen
  0x2011: '-', // ‑ non-breaking hyphen
  0x2012: '-', // ‒ figure dash
  0x2013: '-', // – en dash
  0x2014: '-', // — em dash
  0x2015: '-', // ― horizontal bar
  // Whitespace
  0x00a0: ' ', // non-breaking space
};

const ELLIPSIS_REPLACEMENT = '...';

export const normalizeKey = (word: string): string => {
  const nfc =
    typeof word.normalize === 'function' ? word.normalize('NFC') : word;
  let out = '';
  for (let i = 0; i < nfc.length; i++) {
    const cp = nfc.charCodeAt(i);
    if (cp === 0x2026) {
      out += ELLIPSIS_REPLACEMENT;
      continue;
    }
    const sub = PUNCT_FOLD[cp];
    out += sub !== undefined ? sub : nfc[i];
  }
  return out.trim().toLowerCase();
};
