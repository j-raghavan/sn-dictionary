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
// fontScale is the popup-level body-text multiplier (1.0 to 2.0, for
// S / M / L / XL / 2X). The badge is chrome and stays at its base
// size; only definition body text scales.
//
// An entry with `parts` (one key reaching several entries, #46) renders
// each part through the same routing, as its own block with the sense
// divider between blocks, and labels a part with its headword when that
// differs from the entry's.

import React, {useMemo} from 'react';
import {Text, View} from 'react-native';
import type {DefinitionFormat, SourceHit} from '../core/lookup';
import {parseWordNetEntry} from './wordnetFormatter';
import {SenseList} from './senseBlocks';
import {parseFvdpEntry} from './fvdpFormatter';
import {FvdpText} from './fvdpBlocks';
import {containsRenderableHtml} from './htmlParser';
import {HtmlText} from './HtmlText';
import {popupStyles as styles, scaled} from './popupStyles';

// One definition body through the format routing.
const renderBody = (
  definition: string,
  format: DefinitionFormat,
  fontScale: number,
  definitionStyle: ReturnType<typeof scaled>,
): React.JSX.Element => {
  if (format === 'wordnet') {
    const parsed = parseWordNetEntry(definition);
    if (parsed && !parsed.parseFailed) {
      return <SenseList senses={parsed.senses} fontScale={fontScale} />;
    }
    // The source declared WordNet but the body didn't parse as one.
    // Fall back to plain rendering rather than dropping content.
    return <Text style={definitionStyle}>{definition}</Text>;
  }
  if (format === 'html') {
    // Rich path (v1.0.9): translations bold, POS italic / coloured,
    // numbered lists indented. See HtmlText.tsx + htmlToSpans.ts.
    return <HtmlText html={definition} style={definitionStyle} />;
  }
  // 'plain' — an ordered decision. A plain-typed body may still carry
  // real HTML (matched tag pair or <br>) or the FVDP marker layout; try
  // each structured renderer before falling back to verbatim text.
  if (containsRenderableHtml(definition)) {
    return <HtmlText html={definition} style={definitionStyle} />;
  }
  const fvdp = parseFvdpEntry(definition);
  if (fvdp && !fvdp.parseFailed) {
    return <FvdpText parsed={fvdp} fontScale={fontScale} />;
  }
  return <Text style={definitionStyle}>{definition}</Text>;
};

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
  const {word, definition, format, parts} = hit.entry;
  const scaledDefinitionStyle = useMemo(
    () => scaled(styles.definition, fontScale),
    [fontScale],
  );
  const body = useMemo(() => {
    if (parts === undefined) {
      return renderBody(definition, format, fontScale, scaledDefinitionStyle);
    }
    return parts.map((part, i) => (
      <View key={i} style={[styles.sense, i > 0 && styles.senseDivider]}>
        {part.word !== word ? (
          <View style={styles.senseHeader}>
            <Text style={scaled(styles.senseIndex, fontScale)}>{part.word}</Text>
          </View>
        ) : null}
        {renderBody(part.definition, part.format, fontScale, scaledDefinitionStyle)}
      </View>
    ));
  }, [word, definition, format, parts, fontScale, scaledDefinitionStyle]);

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
