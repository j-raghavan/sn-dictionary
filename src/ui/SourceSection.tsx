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
//
// fontScale is the popup-level body-text multiplier (1.0 / 1.25 /
// 1.5 for S / M / L). The badge is chrome and stays at its base
// size; only definition body text scales.

import React, {useMemo} from 'react';
import {Text, View} from 'react-native';
import type {SourceHit} from '../core/lookup';
import {parseWordNetEntry} from './wordnetFormatter';
import {SenseList} from './senseBlocks';
import {HtmlText} from './HtmlText';
import {popupStyles as styles} from './popupStyles';

type SourceSectionProps = {
  hit: SourceHit;
  showBadge: boolean;
  showDivider: boolean;
  fontScale: number;
};

export const SourceSection = ({
  hit,
  showBadge,
  showDivider,
  fontScale,
}: SourceSectionProps): React.JSX.Element => {
  // Memoise the format-specific transformation. Key on the primitive
  // fields rather than the entry object so a parent re-creating
  // {word, definition, format} with the same values doesn't churn
  // the WordNet parser. Today's call paths produce a fresh entry
  // only when a new lookup completes, but keying on primitives makes
  // that property explicit and footgun-free for future call sites.
  const {definition, format} = hit.entry;
  const scaledDefinitionStyle = useMemo(
    () => [styles.definition, {fontSize: styles.definition.fontSize * fontScale}],
    [fontScale],
  );
  const body = useMemo(() => {
    if (format === 'wordnet') {
      const parsed = parseWordNetEntry(definition);
      if (parsed && !parsed.parseFailed) {
        return <SenseList senses={parsed.senses} fontScale={fontScale} />;
      }
      // The source declared WordNet but the body didn't parse as one.
      // Fall back to plain rendering rather than dropping content.
      return <Text style={scaledDefinitionStyle}>{definition}</Text>;
    }
    if (format === 'html') {
      // Rich path (v1.0.9): translations bold, POS italic / coloured,
      // numbered lists indented. See HtmlText.tsx + htmlToSpans.ts.
      return <HtmlText html={definition} style={scaledDefinitionStyle} />;
    }
    // 'plain'
    return <Text style={scaledDefinitionStyle}>{definition}</Text>;
  }, [definition, format, fontScale, scaledDefinitionStyle]);

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
