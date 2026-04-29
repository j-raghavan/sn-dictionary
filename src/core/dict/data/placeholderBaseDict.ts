// Placeholder base dictionary for spike 3 wiring. Builds StarDict
// bytes in-memory at first lookup so the runtime path
// (writeStarDict -> stardictLookup -> buildDict -> lookupDict) is
// fully exercised on-device. Real WordNet bundling via a build-time
// base64-emit step is the follow-up — at that point this module
// will be replaced by a generated `baseDictData.ts` and the loader
// will base64-decode three pre-emitted strings instead of running
// writeStarDict at boot.

import type {DictBytes} from '../stardictLookup';
import {writeStarDict} from '../stardict/writeStardict';

const ENTRIES: Record<string, string> = {
  anatomy:
    'The branch of biology concerned with the bodily structure of living organisms.',
  apple: 'A round fruit with red, green, or yellow skin and white flesh.',
  banana:
    'A long curved tropical fruit with soft yellow flesh and a thick skin.',
  biology: 'The scientific study of living organisms.',
  cat: 'A small domesticated carnivorous mammal kept as a pet.',
  cherry:
    'A small, round stone fruit, typically bright or dark red.',
  define: 'To state or describe exactly the meaning of (a word).',
  dictionary:
    'A book or electronic resource that lists the words of a language and gives their meaning.',
  dog: 'A domesticated carnivorous mammal commonly kept as a pet.',
  elephant:
    'A very large plant-eating mammal with a trunk, large ears, and ivory tusks.',
  galaxy:
    'A system of millions or billions of stars, gas, and dust held together by gravity.',
  hello: 'Used as a greeting or to begin a phone conversation.',
  knowledge:
    'Facts, information, and skills acquired through experience or education.',
  language:
    'The principal method of human communication, consisting of words used in a structured way.',
  meaning: 'What is meant by a word, text, concept, or action.',
  ocean:
    'A very large expanse of sea, especially each of the main areas into which it is divided.',
  paper:
    'A thin material produced by pressing together moist fibres, used for writing or printing.',
  question:
    'A sentence worded or expressed so as to elicit information.',
  river:
    'A large natural stream of water flowing in a channel to the sea or a lake.',
  science:
    'The intellectual and practical activity encompassing the systematic study of the structure and behaviour of the physical and natural world.',
  test:
    'A procedure intended to establish the quality, performance, or reliability of something.',
  word:
    'A single distinct meaningful element of speech or writing.',
  world: 'The earth, together with all of its countries and peoples.',
};

let cached: DictBytes | null = null;

export const loadPlaceholderBaseDict = (): DictBytes => {
  if (!cached) {
    cached = writeStarDict(ENTRIES, {bookname: 'SnDict Placeholder'});
  }
  return cached;
};
