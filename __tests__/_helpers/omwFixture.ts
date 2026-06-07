// Tiny synthetic OMW TSV builder for thesaurus tests. Emits the same
// 4-column (key, lang, rel, target) tab-separated shape the real
// build consumes, so parseOmwTsv / populateThesaurus run against
// realistic input without a network fetch. Lives under
// __tests__/_helpers/ which jest excludes from coverage.

export type OmwFixtureLine = {
  key: string;
  lang: string;
  rel: string;
  target: string;
};

export const buildOmwTsv = (lines: OmwFixtureLine[]): string =>
  lines.map(l => `${l.key}\t${l.lang}\t${l.rel}\t${l.target}`).join('\n');

// A small EN/DE sample covering synonyms + antonyms across languages.
export const SAMPLE_OMW_TSV = buildOmwTsv([
  {key: 'happy', lang: 'en', rel: 'synonym', target: 'glad'},
  {key: 'happy', lang: 'en', rel: 'synonym', target: 'joyful'},
  {key: 'happy', lang: 'en', rel: 'antonym', target: 'sad'},
  {key: 'froh', lang: 'de', rel: 'synonym', target: 'glücklich'},
]);
