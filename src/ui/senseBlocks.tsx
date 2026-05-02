// Renderer for parsed WordNet senses. Two components, both pure /
// presentational — no state, no controllers, no SDK access. Mounted
// from SourceSection's WordNet branch.
//
// fontScale is the multiplier the popup's A−/A+ buttons set on the
// definition body text (1.0 / 1.25 / 1.5 for S / M / L). Chrome
// (badge sizes, paddings) stays at its base size; only readable body
// text — definition, examples, sense index, synonym list — scales.

import React from 'react';
import {Text, View} from 'react-native';
import {labelForPos, type WordNetSense} from './wordnetFormatter';
import {popupStyles as styles} from './popupStyles';
import {t} from '../i18n/i18n';

// All callers pull fontSize off StyleSheet.create entries where the
// number is always defined; no need for an undefined branch.
const scaledFont = (base: number, scale: number): {fontSize: number} => ({
  fontSize: base * scale,
});

type SenseListProps = {senses: WordNetSense[]; fontScale: number};

export const SenseList = ({
  senses,
  fontScale,
}: SenseListProps): React.JSX.Element => (
  <View>
    {senses.map((sense, i) => (
      <SenseBlock
        key={`${sense.pos ?? '?'}-${sense.index}-${i}`}
        sense={sense}
        showDivider={i > 0}
        fontScale={fontScale}
      />
    ))}
  </View>
);

type SenseBlockProps = {
  sense: WordNetSense;
  showDivider: boolean;
  fontScale: number;
};

export const SenseBlock = ({
  sense,
  showDivider,
  fontScale,
}: SenseBlockProps): React.JSX.Element => (
  <View style={[styles.sense, showDivider && styles.senseDivider]}>
    <View style={styles.senseHeader}>
      {sense.pos ? (
        <Text style={styles.posBadge}>{labelForPos(sense.pos)}</Text>
      ) : null}
      <Text style={[styles.senseIndex, scaledFont(styles.senseIndex.fontSize, fontScale)]}>
        {`${sense.index}.`}
      </Text>
    </View>
    <Text style={[styles.definition, scaledFont(styles.definition.fontSize, fontScale)]}>
      {sense.definition}
    </Text>
    {sense.examples.length > 0 ? (
      <View style={styles.examples}>
        {sense.examples.map((ex, j) => (
          <Text
            key={j}
            style={[styles.example, scaledFont(styles.example.fontSize, fontScale)]}>
            “{ex}”
          </Text>
        ))}
      </View>
    ) : null}
    {sense.synonyms.length > 0 ? (
      <Text style={[styles.synonyms, scaledFont(styles.synonyms.fontSize, fontScale)]}>
        <Text
          style={[styles.synonymsLabel, scaledFont(styles.synonyms.fontSize, fontScale)]}>
          {`${t('popup.synonyms')}: `}
        </Text>
        {sense.synonyms.join(', ')}
      </Text>
    ) : null}
  </View>
);
