package com.sndict.imports

// DEVICE-UNVERIFIED. EXACT parity port of src/core/dict/normalizeKey.ts.
// The lookup key MUST be byte-identical to the TS normalizeKey so that
// natively-imported user dicts key the same way base.db (built by the
// TS generator) and queries do (IV-4). The cross-language parity oracle
// is __tests__/_fixtures/normalizeKeyVectors.json — the TS test pins it
// host-side; the Kotlin port must produce identical outputs (verified
// when the .snplg is compiled + run on-device).
//
// Order MUST be: NFC -> fold/ellipsis by CODEPOINT -> trim -> lowercase
// (ROOT). The PUNCT_FOLD map is the same 17 codepoints as normalizeKey.ts,
// plus the U+2026 (…) -> "..." rule.
object NormalizeKey {
  private val PUNCT_FOLD: Map<Int, String> = mapOf(
    // Single quotes / apostrophes
    0x2018 to "'", 0x2019 to "'", 0x201a to "'", 0x201b to "'",
    0x02bc to "'", 0xff07 to "'",
    // Double quotes
    0x201c to "\"", 0x201d to "\"", 0x201e to "\"", 0x201f to "\"",
    // Dashes / hyphens
    0x2010 to "-", 0x2011 to "-", 0x2012 to "-", 0x2013 to "-",
    0x2014 to "-", 0x2015 to "-",
    // Whitespace
    0x00a0 to " ",
  )

  fun fold(word: String): String {
    val nfc = java.text.Normalizer.normalize(word, java.text.Normalizer.Form.NFC)
    val sb = StringBuilder()
    var i = 0
    while (i < nfc.length) {
      val cp = nfc.codePointAt(i)
      i += Character.charCount(cp)
      when {
        cp == 0x2026 -> sb.append("...")
        PUNCT_FOLD.containsKey(cp) -> sb.append(PUNCT_FOLD[cp])
        else -> sb.appendCodePoint(cp)
      }
    }
    return sb.toString().trim().lowercase(java.util.Locale.ROOT)
  }
}
