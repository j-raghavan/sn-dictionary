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
        // The exact entry from issue #15. Pre-fix output glued
        // "ist" and "astre" into "istastre"; post-fix the
        // translation lands on its own line.
        word: 'Gestirn',
        contains: [
          'ɡəˈʃtɪʁn', // IPA
          'noun, neutral', // POS
          'Astronomie', // German definition body
          'astre', // French translation
        ],
        notContains: ['istastre'],
        matches: [/sichtbar ist\s*\n+\s*astre/],
      },
      {
        // Multi-translation entry under <ol><li><div>...</div></li>.
        // Bullets must survive AND each translation must be on its
        // own line.
        word: 'Hund',
        contains: ['noun, male', '• chien', '• chienne'],
        // Pre-fix forms: "ist<div>chien" produced "istchien" type
        // glue; the bullets should never collapse into a single
        // run of text.
        notContains: ['istchien', 'chien• chienne'],
        matches: [/• chien\s*\n\s*• chienne/],
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
        // Either way, the glue invariant is what matters: definition
        // body must not run into the German translation.
        word: 'chien',
        contains: ['ʃjɛ̃', 'Astrologie', 'zodiaque chinois', 'Hund'],
        notContains: ['chinoisHund'],
        matches: [/chinois\s*\n+\s*Hund/],
      },
      {
        word: 'maison',
        contains: ['mɛ.zɔ̃', 'adjective', 'Familier', 'hausgemacht'],
        notContains: ['maisonhausgemacht'],
        matches: [/maison\s*\n+\s*hausgemacht/],
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
        contains: ['buːx', 'noun, neutral', 'Schriftwerk', '• book'],
        notContains: ['Blattgold<', 'Blattgoldbook'],
        matches: [/• book/],
      },
    ],
  },
];
