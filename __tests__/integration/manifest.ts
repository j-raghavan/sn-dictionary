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
      '2c4d1710086f4d65e00fb0e00a8beaac424d24f842722a5afd1e3f8546e523e3',
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
        // the renderer keeps them as block-mode items rather than
        // em-dash inline. v1.0.10: depth-2 markers are alpha
        // (a./b./…) at 4-space indent, replacing v1.0.9's depth-2
        // numeric and 2-space indent.
        word: 'Hund',
        contains: ['noun, male', 'a. chien', 'b. chienne'],
        // Pre-fix forms: "ist<div>chien" produced "istchien" type
        // glue; the alpha items must never collapse into a single
        // run of text. v1.0.9 depth-2 numeric markers are gone.
        notContains: ['istchien', 'chienb. chienne', '• chien', '  1. chien'],
        // Inner <ol> renders at depth 2 (4-space indent, alpha).
        matches: [/ {4}a\. chien\n {4}b\. chienne/],
      },
      {
        // Issue #19's worked example. Mixes all three v1.0.10 cases
        // in one entry:
        //   - sense 2 has a `body<div>tr</div>` inline em-dash join,
        //   - sense 1 has a sibling `<ol>` of pure-<div> translations
        //     (block-mode alpha-marker items at depth 2, all bold),
        //   - sense 3 has a body line followed by a nested alpha
        //     list of translations (also block-mode bold).
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
          '    a. ciel',
          '    b. dais',
        ],
        notContains: [
          // No glue across the inline-translation boundary.
          'Kosmosciel',
          // No v1.0.8 newline-only shape for the inline case.
          'Kosmos\nciel',
          // Bullets at depth ≤3 are gone (v1.0.9 dropped them; v1.0.10
          // kept that property — bullets only fire at depth ≥4).
          '• ciel',
          '• dais',
          // v1.0.9 depth-2 numeric markers must not appear either.
          '  1. ciel',
          '  2. dais',
        ],
        matches: [
          // Sense 2 em-dash join.
          /Astronomie: der Kosmos\s+—\s+ciel/,
          // Sense 3 body followed immediately by depth-2 alpha-marker
          // translations (no blank line, no fall-through bullet).
          /Decke aus Stoff[^\n]*\n {4}a\. ciel\n {4}b\. dais/,
        ],
      },
    ],
  },
  {
    name: 'wikdict-fr-de',
    url: 'https://download.wikdict.com/dictionaries/stardict/wikdict-fr-de.zip',
    sha256:
      '81658ead31852e926e4c739799b92da7958e72d749f6c6a6b391e95ab2b0d587',
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
      'c94ed34a7e925c1f7f0be1ff08b7032534eb2475352111fd46c1dc183d9390f2',
    description: 'WikDict German→English (Wiktionary-derived, CC-BY-SA)',
    entries: [
      {
        word: 'Buch',
        // v1.0.10: translations under nested <ol><li><div>book</div></li>
        // render as block-mode alpha items at depth 2 (4-space indent).
        contains: ['buːx', 'noun, neutral', 'Schriftwerk', 'book'],
        notContains: [
          'Blattgold<',
          'Blattgoldbook',
          '• book',
          // v1.0.9 depth-2 numeric form must not reappear.
          '  1. book',
        ],
        // Depth-2 alpha marker, 4-space indent. The first translation
        // at depth 2 is `a.`; further siblings climb the alphabet.
        matches: [/ {4}[a-z]+\. book/],
      },
    ],
  },
];
