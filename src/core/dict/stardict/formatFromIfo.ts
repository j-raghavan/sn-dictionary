// Derive a DefinitionFormat from a parsed .ifo's sametypesequence.
//
// StarDict spec: `sametypesequence=m` is plain UTF-8 text, `=h` is
// HTML, and several others (`x`, `y`, `n`, …) are dict-specific
// formats we don't currently render. Anything other than `h` falls
// back to plain text — the strings still display, just without
// structure.
//
// Extracted from stardictLookup.ts's private formatFromMeta so the
// import pipeline (TF5) can stamp imported rows with the right format
// without depending on the lookup module. The lookup module's own
// copy is rewired onto this in M5; for now this is the canonical
// definition the new code imports.

import type {IfoMeta} from './parseIfo';
import type {DefinitionFormat} from '../../lookup';

export const formatFromSametypesequence = (
  meta: IfoMeta,
): DefinitionFormat => {
  if (meta.sametypesequence === 'h') {
    return 'html';
  }
  return 'plain';
};
