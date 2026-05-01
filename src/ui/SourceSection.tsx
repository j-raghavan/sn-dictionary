// Per-hit popup section. Renders the bordered source badge (only
// when the parent decides ≥2 hits warrant disambiguation) followed
// by either the parsed-WordNet view or the HTML-stripped fallback.
//
// Decision of which renderer to use today is heuristic — based on
// whether parseWordNetEntry succeeded. Issue #6 will move this to an
// explicit format hint on the hit.

import React from 'react';
import {Text, View} from 'react-native';
import type {SourceHit} from '../core/lookup';
import type {parseWordNetEntry} from './wordnetFormatter';
import {SenseList} from './senseBlocks';
import {htmlToPlainText} from './htmlToPlainText';
import {popupStyles as styles} from './popupStyles';

type SourceSectionProps = {
  hit: SourceHit;
  parsed: ReturnType<typeof parseWordNetEntry>;
  showBadge: boolean;
  showDivider: boolean;
};

export const SourceSection = ({
  hit,
  parsed,
  showBadge,
  showDivider,
}: SourceSectionProps): React.JSX.Element => (
  <View style={[styles.section, showDivider && styles.sectionDivider]}>
    {showBadge ? (
      <View style={styles.sectionHeader}>
        <Text style={styles.sourceBadge}>{hit.source}</Text>
      </View>
    ) : null}
    {parsed && !parsed.parseFailed ? (
      <SenseList senses={parsed.senses} />
    ) : (
      // Fallback for non-WordNet content. Run through the HTML
      // stripper so dicts with sametypesequence=h (Wiktionary-derived
      // StarDicts and similar) render as readable plain text instead
      // of leaking <i>/<br>/<ol>/<li> tags into the popup. No-op for
      // genuinely plain text (no `<` or `&`).
      <Text style={styles.definition}>
        {htmlToPlainText(hit.entry.definition)}
      </Text>
    )}
  </View>
);
