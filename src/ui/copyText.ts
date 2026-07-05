// Pure reducer: turns the popup's current view (active tab + hits +
// thesaurus) into the plain text the clipboard receives, mirroring what
// DefinitionPopup renders on screen so a copy matches what the user
// sees:
//   - 'plain'   -> the definition verbatim
//   - 'html'    -> htmlToPlainText. This uses the SAME HtmlBaseRenderer
//                  the on-screen rich path (htmlToSpans/HtmlText) builds
//                  from, so the text CONTENT is identical — only the span
//                  styling (bold/italic/colour) is dropped, which the
//                  clipboard can't carry anyway.
//   - 'wordnet' -> the parsed senses, formatted like SenseBlock
//                  (pos label + index, examples, "Synonyms: …")
//   - thesaurus tab -> labelled Synonyms / Antonyms lines (as rendered)
//
// Pure: no React, no SDK, no clipboard. The popup calls this, then hands
// the string to the native `copyToClipboard` wrapper (src/native/
// clipboard.ts). Out of scope: pasting into a handwritten note — that
// needs the firmware element clipboard (pushElementsToClipboard), which
// the SDK does not expose yet; this writes the OS clipboard only.

import type {SourceHit} from '../core/lookup';
import type {ThesaurusResult} from '../core/dict/sqlite/thesaurusLookup';
import {htmlToPlainText} from './htmlToPlainText';
import {containsRenderableHtml} from './htmlParser';
import {parseFvdpEntry, fvdpEntryToPlainText} from './fvdpFormatter';
import {labelForPos, parseWordNetEntry, type WordNetSense} from './wordnetFormatter';
import {t} from '../i18n/i18n';

// One WordNet sense as text, mirroring SenseBlock's on-screen layout:
//   "noun 1. <definition>"   (pos label omitted when the sense has none)
//     "<example>"
//     Synonyms: a, b
const senseToText = (sense: WordNetSense): string => {
  const head = sense.pos
    ? `${labelForPos(sense.pos)} ${sense.index}.`
    : `${sense.index}.`;
  const lines = [`${head} ${sense.definition}`.trim()];
  for (const example of sense.examples) {
    lines.push(`  "${example}"`);
  }
  if (sense.synonyms.length > 0) {
    lines.push(`  ${t('popup.synonyms')}: ${sense.synonyms.join(', ')}`);
  }
  return lines.join('\n');
};

// One hit's definition reduced to plain text matching the on-screen
// render. Exported for focused testing.
export const entryToPlainText = (hit: SourceHit): string => {
  const {definition, format} = hit.entry;
  if (format === 'html') {
    return htmlToPlainText(definition);
  }
  if (format === 'wordnet') {
    const parsed = parseWordNetEntry(definition);
    if (!parsed.parseFailed) {
      return parsed.senses.map(senseToText).join('\n\n');
    }
    // Declared WordNet but didn't parse — fall back to the raw text,
    // exactly as SourceSection does on screen.
    return definition;
  }
  // 'plain' — mirror SourceSection's ordered decision (HTML sniff -> FVDP
  // -> verbatim) so the clipboard matches the on-screen structured render.
  if (containsRenderableHtml(definition)) {
    return htmlToPlainText(definition);
  }
  const fvdp = parseFvdpEntry(definition);
  if (!fvdp.parseFailed) {
    return fvdpEntryToPlainText(fvdp);
  }
  return definition;
};

const thesaurusToText = (thesaurus: ThesaurusResult): string => {
  const parts: string[] = [];
  if (thesaurus.synonyms.length > 0) {
    parts.push(`${t('popup.synonyms')}: ${thesaurus.synonyms.join(', ')}`);
  }
  if (thesaurus.antonyms.length > 0) {
    parts.push(`${t('popup.antonyms')}: ${thesaurus.antonyms.join(', ')}`);
  }
  return parts.join('\n');
};

export type CopyTextParams = {
  tab: 'definition' | 'thesaurus';
  hits: SourceHit[];
  // The assembled thesaurus for the active headword, or null when the
  // Thesaurus tab hasn't resolved one yet.
  thesaurus: ThesaurusResult | null;
  // Whether the popup is showing per-source badges (≥2 sections) — when
  // it is, each definition section is prefixed with its source name so a
  // multi-dict copy is attributable, matching the badged on-screen layout.
  showSourceBadges: boolean;
};

// The plain text the "Copy" action puts on the clipboard for the ACTIVE
// tab. Returns '' when there's nothing to copy (the popup hides the
// action in that case; the guard keeps this reducer total).
export const buildCopyText = ({
  tab,
  hits,
  thesaurus,
  showSourceBadges,
}: CopyTextParams): string => {
  if (tab === 'thesaurus') {
    return thesaurus ? thesaurusToText(thesaurus) : '';
  }
  return hits
    .map(hit => {
      const body = entryToPlainText(hit);
      return showSourceBadges ? `${hit.source}\n${body}` : body;
    })
    .join('\n\n');
};
