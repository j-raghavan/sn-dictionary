// Renderer for parsed FVDP (PhapVietPhap) entries. Pure / presentational
// like senseBlocks — no state, no controllers, no SDK. Mounted from
// SourceSection's 'plain' branch when parseFvdpEntry succeeds.
//
// Layout mirrors the WordNet renderer's visual language so the two
// structured paths read alike: a POS badge heads each POS section, its
// senses stack as numbered blocks with a hairline divider, and each
// bilingual example renders as "source — translation". A braced-term
// sense reads "1. **term** — gloss", under a forms line of the
// headword's kana / kanji forms when the entry has any.
//
// fontScale is the popup's A−/A+ body multiplier (1.0 to 2.0).
// Chrome (the POS badge) stays at base size; only readable body text —
// forms, gloss, sense index, examples, note body — scales, exactly as
// SenseList threads it.

import React from 'react';
import {Text, View} from 'react-native';
import {
  fvdpFormsLine,
  type FvdpSection,
  type FvdpSense,
  type ParsedFvdpEntry,
} from './fvdpFormatter';
import {popupStyles as styles, scaled, scaleText} from './popupStyles';

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
        <Text style={scaled(styles.synonyms, fontScale)}>
          {/* Not scaled(): this renders `synonymsLabel` — weight and
              colour, no size of its own — at `synonyms`' size, so the
              registered style and the scaled one deliberately differ.
              The scaled entry must stay LAST here. */}
          <Text
            style={[styles.synonymsLabel, scaleText(styles.synonyms, fontScale)]}>
            {`${section.label}: `}
          </Text>
          {section.body}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.sense, showDivider && styles.senseDivider]}>
      {section.forms ? (
        <Text style={scaled(styles.phonetic, fontScale)}>
          {fvdpFormsLine(section.forms)}
        </Text>
      ) : null}
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
    {/* The index runs inline with its gloss ("1. gloss"), as the copy
        text has it. Unlike SenseBlock there is no POS badge to share a
        header row with, so a header View would only break the line. */}
    <Text style={scaled(styles.definition, fontScale)}>
      <Text style={scaled(styles.senseIndex, fontScale)}>{`${index}.`}</Text>
      {/* Bold label style; its size inherits from the scaled definition. */}
      {sense.term ? (
        <Text style={styles.synonymsLabel}>{` ${sense.term}`}</Text>
      ) : null}
      {sense.gloss ? `${sense.term ? ' —' : ''} ${sense.gloss}` : null}
    </Text>
    {sense.examples.length > 0 ? (
      <View style={styles.examples}>
        {sense.examples.map((ex, j) => (
          <Text
            key={j}
            style={scaled(styles.example, fontScale)}>
            {ex.translation ? `${ex.source} — ${ex.translation}` : ex.source}
          </Text>
        ))}
      </View>
    ) : null}
  </View>
);
