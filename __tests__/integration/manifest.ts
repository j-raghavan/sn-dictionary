// Real-StarDict regression manifest. Listed dicts are downloaded by
// scripts/runIntegrationTests.mjs into .cache/integration-dicts/<name>/,
// SHA-256 verified against the pins below, then exercised by
// wikdictRegression.test.ts.
//
// To add a dict:
//   1. Pick a stable upstream URL (CC-BY-SA preferred).
//   2. Download once locally and `shasum -a 256 <file>` to capture
//      the pin. Hard-pinning means a future upstream rebuild fails
//      the suite loudly instead of silently letting a regression in.
//   3. Sample a few headwords (any node script that walks the .idx
//      and slices the .dict by offset/length works) and add their
//      expected substrings + glue regressions.
//   4. Re-run `npm run test:integration`.
//
// Why pin the SHA: Wikdict rebuilds quarterly. If a rebuild changes
// the HTML shape (extra <span>, restructured <div>, etc.), the pin
// fires before the assertions do — that's the signal to update both
// the pin AND verify the assertions still hold.

export type WordExpectation = {
  // Headword to look up. Lookup is case-insensitive; we normalise
  // upstream so any of `Gestirn`/`gestirn`/`GESTIRN` works.
  word: string;
  // Substrings the rendered (htmlToPlainText'd) definition must
  // contain. Keep them short and stable — no full sentences, just
  // distinctive fragments unlikely to change across Wikdict
  // rebuilds.
  contains: string[];
  // Substrings the rendered output must NOT contain. Use these to
  // pin the bug shape: `istastre`, `Wolf istchien`, etc. — exact
  // glued forms that v1.0.6 produced and v1.0.7+ must not.
  notContains?: string[];
  // Optional regex assertions. Useful for "translation appears on
  // its own line" patterns that can't be expressed as substrings.
  matches?: RegExp[];
};

export type DictManifest = {
  // Cache key: also the subfolder name under .cache/integration-dicts/.
  name: string;
  // Direct download URL. Must be a `.zip` containing a single
  // top-level directory with `stardict.ifo` + `stardict.idx` +
  // `stardict.dict.dz`.
  url: string;
  // SHA-256 of the .zip. Pinned; the runner refuses to extract on
  // mismatch and prints a remediation hint.
  sha256: string;
  // Friendly description shown in the test header.
  description: string;
  // Per-headword expectations. The test fails if any one entry
  // doesn't satisfy all of its `contains` / `notContains` /
  // `matches` rules, naming the offending dict + word.
  entries: WordExpectation[];
};

export const MANIFEST: DictManifest[] = [
  {
    name: 'wikdict-de-fr',
    url: 'https://download.wikdict.com/dictionaries/stardict/wikdict-de-fr.zip',
    sha256:
      '17d00ca43cd6e80089c66dd2959aff30535a355ba36c4d39d6537c0948d37c41',
    description: 'WikDict German→French (Wiktionary-derived, CC-BY-SA)',
    entries: [
      {
        // The exact entry from issue #15.
        //   - v1.0.6 glued "ist" and "astre" into "istastre".
        //   - v1.0.8 split them onto separate lines.
        //   - v1.0.9 (issue #19) joins them inline with " — ".
        word: 'Gestirn',
        contains: [
          'ɡəˈʃtɪʁn', // IPA
          'noun, neutral', // POS
          'Astronomie', // German definition body
          'astre', // French translation
        ],
        notContains: ['istastre'],
        // Em-dash separator between body and translation. The pin
        // is loose around whitespace either side of "—" because
        // upstream sometimes carries NBSP / multi-space before
        // the translation; the renderer normalises but the regex
        // shouldn't fight it.
        matches: [/sichtbar ist\s+—\s+astre/],
      },
      {
        // Multi-translation entry under <ol><li><div>...</div></li>.
        // Each translation is the SOLE content of an inner <li>, so
        // the renderer keeps them as numbered (block-mode) items
        // rather than em-dash inline. v1.0.9 numbering replaces the
        // v1.0.8 "• " bullets.
        word: 'Hund',
        contains: ['noun, male', '1. chien', '2. chienne'],
        // Pre-fix forms: "ist<div>chien" produced "istchien" type
        // glue; the numbered items must never collapse into a
        // single run of text.
        notContains: ['istchien', 'chien2. chienne', '• chien'],
        // Inner <ol> renders at depth 2 (two-space indent).
        matches: [/ {2}1\. chien\n {2}2\. chienne/],
      },
      {
        // Issue #19's worked example. Mixes all three v1.0.9 cases
        // in one entry:
        //   - sense 2 has a `body<div>tr</div>` inline em-dash join,
        //   - sense 1 has a sibling `<ol>` of pure-<div> translations
        //     (block-mode numbered items at depth 2),
        //   - sense 3 has a body line followed by a nested numbered
        //     list of translations.
        // Single integration entry covering the whole shape so a
        // future renderer change against the real .dict body is a
        // visible failure here.
        word: 'Himmel',
        contains: [
          'ˈhɪml̩', // IPA
          'noun, male', // POS
          'Luftraum', // sense 1 inner item 1
          'Religion:', // sense 1 inner item 2
          'Astronomie: der Kosmos — ciel', // sense 2 inline em-dash
          'Decke aus Stoff', // sense 3 body
          '  1. ciel',
          '  2. dais',
        ],
        notContains: [
          // No glue across the inline-translation boundary.
          'Kosmosciel',
          // No v1.0.8 newline-only shape for the inline case.
          'Kosmos\nciel',
          // Bullets are gone in v1.0.9.
          '• ciel',
          '• dais',
        ],
        matches: [
          // Sense 2 em-dash join.
          /Astronomie: der Kosmos\s+—\s+ciel/,
          // Sense 3 body followed immediately by depth-2 numbered
          // translations (no blank line, no fall-through bullet).
          /Decke aus Stoff[^\n]*\n {2}1\. ciel\n {2}2\. dais/,
        ],
      },
    ],
  },
  {
    name: 'wikdict-fr-de',
    url: 'https://download.wikdict.com/dictionaries/stardict/wikdict-fr-de.zip',
    sha256:
      '95f73aff4271c5eaf68d5c426b8fd1bc728880ead0e63b9e8cc84b9e934b3f68',
    description: 'WikDict French→German (Wiktionary-derived, CC-BY-SA)',
    entries: [
      {
        // The reverse-direction shape. The dict's case-insensitive
        // first match for "chien" is the (Astrologie) zodiac entry,
        // not the canine — both are present, and which is "first" is
        // a property of the .idx ordering pinned by the SHA above.
        // The glue invariant is what matters: definition body must
        // not run into the German translation. v1.0.9 expects
        // em-dash join.
        word: 'chien',
        contains: ['ʃjɛ̃', 'Astrologie', 'zodiaque chinois', 'Hund'],
        notContains: ['chinoisHund'],
        matches: [/chinois\s+—\s+Hund/],
      },
      {
        word: 'maison',
        contains: ['mɛ.zɔ̃', 'adjective', 'Familier', 'hausgemacht'],
        notContains: ['maisonhausgemacht'],
        matches: [/maison\s+—\s+hausgemacht/],
      },
    ],
  },
  {
    name: 'wikdict-de-en',
    url: 'https://download.wikdict.com/dictionaries/stardict/wikdict-de-en.zip',
    sha256:
      'e84d6ec7a5e92f2232fe9c1fe04f149dd0b4defab47b879705d1a395138f5024',
    description: 'WikDict German→English (Wiktionary-derived, CC-BY-SA)',
    entries: [
      {
        word: 'Buch',
        // v1.0.9: translations under nested <ol><li><div>book</div></li>
        // render as numbered items at depth 2 (block-mode div).
        contains: ['buːx', 'noun, neutral', 'Schriftwerk', 'book'],
        notContains: ['Blattgold<', 'Blattgoldbook', '• book'],
        matches: [/ {2}\d+\. book/],
      },
    ],
  },
];
