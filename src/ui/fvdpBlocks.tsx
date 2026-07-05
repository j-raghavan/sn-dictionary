// Renderer for parsed FVDP (PhapVietPhap) entries. Pure / presentational
// like senseBlocks — no state, no controllers, no SDK. Mounted from
// SourceSection's 'plain' branch when parseFvdpEntry succeeds.
//
// Layout mirrors the WordNet renderer's visual language so the two
// structured paths read alike: a POS badge heads each POS section, its
// senses stack as numbered blocks with a hairline divider, and each
// bilingual example renders as "source — translation".
//
// fontScale is the popup's A−/A+ body multiplier (1.0 / 1.25 / 1.5).
// Chrome (the POS badge) stays at base size; only readable body text —
// gloss, sense index, examples, note body — scales, exactly as SenseList
// threads it.

import React from 'react';
import {Text, View} from 'react-native';
import type {
  FvdpSection,
  FvdpSense,
  ParsedFvdpEntry,
} from './fvdpFormatter';
import {popupStyles as styles} from './popupStyles';

const scaledFont = (base: number, scale: number): {fontSize: number} => ({
  fontSize: base * scale,
});

type FvdpTextProps = {parsed: ParsedFvdpEntry; fontScale: number};

export const FvdpText = ({
  parsed,
  fontScale,
}: FvdpTextProps): React.JSX.Element => (
  <View>
    {parsed.sections.map((section, i) => (
      <FvdpSectionBlock
        key={i}
        section={section}
        showDivider={i > 0}
        fontScale={fontScale}
      />
    ))}
  </View>
);

type FvdpSectionBlockProps = {
  section: FvdpSection;
  showDivider: boolean;
  fontScale: number;
};

const FvdpSectionBlock = ({
  section,
  showDivider,
  fontScale,
}: FvdpSectionBlockProps): React.JSX.Element => {
  if (section.kind === 'note') {
    return (
      <View style={[styles.sense, showDivider && styles.senseDivider]}>
        <Text style={[styles.synonyms, scaledFont(styles.synonyms.fontSize, fontScale)]}>
          <Text
            style={[styles.synonymsLabel, scaledFont(styles.synonyms.fontSize, fontScale)]}>
            {`${section.label}: `}
          </Text>
          {section.body}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.sense, showDivider && styles.senseDivider]}>
      {section.pos ? (
        <View style={styles.senseHeader}>
          <Text style={styles.posBadge}>{section.pos}</Text>
        </View>
      ) : null}
      {section.senses.map((sense, i) => (
        <FvdpSenseBlock
          key={i}
          sense={sense}
          index={i + 1}
          showDivider={i > 0}
          fontScale={fontScale}
        />
      ))}
    </View>
  );
};

type FvdpSenseBlockProps = {
  sense: FvdpSense;
  index: number;
  showDivider: boolean;
  fontScale: number;
};

const FvdpSenseBlock = ({
  sense,
  index,
  showDivider,
  fontScale,
}: FvdpSenseBlockProps): React.JSX.Element => (
  <View style={[styles.sense, showDivider && styles.senseDivider]}>
    <View style={styles.senseHeader}>
      <Text style={[styles.senseIndex, scaledFont(styles.senseIndex.fontSize, fontScale)]}>
        {`${index}.`}
      </Text>
    </View>
    {sense.gloss ? (
      <Text style={[styles.definition, scaledFont(styles.definition.fontSize, fontScale)]}>
        {sense.gloss}
      </Text>
    ) : null}
    {sense.examples.length > 0 ? (
      <View style={styles.examples}>
        {sense.examples.map((ex, j) => (
          <Text
            key={j}
            style={[styles.example, scaledFont(styles.example.fontSize, fontScale)]}>
            {ex.translation ? `${ex.source} — ${ex.translation}` : ex.source}
          </Text>
        ))}
      </View>
    ) : null}
  </View>
);
