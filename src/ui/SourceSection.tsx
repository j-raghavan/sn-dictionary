// Per-hit popup section. Renders the bordered source badge (only
// when the parent decides ≥2 hits warrant disambiguation) followed
// by the format-appropriate body renderer.
//
// The render mode is now driven by `hit.entry.format` set explicitly
// by the source factory at lookup time — no per-render heuristic
// detection. Three modes:
//
//   'wordnet' — parse with parseWordNetEntry + render SenseList
//   'html'    — strip tags via htmlToPlainText and render as text
//   'plain'   — render the definition string verbatim

import React, {useMemo} from 'react';
import {Text, View} from 'react-native';
import type {SourceHit} from '../core/lookup';
import {parseWordNetEntry} from './wordnetFormatter';
import {SenseList} from './senseBlocks';
import {htmlToPlainText} from './htmlToPlainText';
import {popupStyles as styles} from './popupStyles';

type SourceSectionProps = {
  hit: SourceHit;
  showBadge: boolean;
  showDivider: boolean;
};

export const SourceSection = ({
  hit,
  showBadge,
  showDivider,
}: SourceSectionProps): React.JSX.Element => {
  // Memoise the format-specific transformation. Key on the primitive
  // fields rather than the entry object so a parent re-creating
  // {word, definition, format} with the same values doesn't churn
  // the WordNet parser. Today's call paths produce a fresh entry
  // only when a new lookup completes, but keying on primitives makes
  // that property explicit and footgun-free for future call sites.
  const {definition, format} = hit.entry;
  const body = useMemo(() => {
    if (format === 'wordnet') {
      const parsed = parseWordNetEntry(definition);
      if (parsed && !parsed.parseFailed) {
        return <SenseList senses={parsed.senses} />;
      }
      // The source declared WordNet but the body didn't parse as one.
      // Fall back to plain rendering rather than dropping content.
      return <Text style={styles.definition}>{definition}</Text>;
    }
    if (format === 'html') {
      return <Text style={styles.definition}>{htmlToPlainText(definition)}</Text>;
    }
    // 'plain'
    return <Text style={styles.definition}>{definition}</Text>;
  }, [definition, format]);

  return (
    <View style={[styles.section, showDivider && styles.sectionDivider]}>
      {showBadge ? (
        <View style={styles.sectionHeader}>
          <Text style={styles.sourceBadge}>{hit.source}</Text>
        </View>
      ) : null}
      {body}
    </View>
  );
};
