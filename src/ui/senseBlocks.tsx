// Renderer for parsed WordNet senses. Two components, both pure /
// presentational — no state, no controllers, no SDK access. Mounted
// from SourceSection's WordNet branch.

import React from 'react';
import {Text, View} from 'react-native';
import {labelForPos, type WordNetSense} from './wordnetFormatter';
import {popupStyles as styles} from './popupStyles';
import {t} from '../i18n/i18n';

type SenseListProps = {senses: WordNetSense[]};

export const SenseList = ({senses}: SenseListProps): React.JSX.Element => (
  <View>
    {senses.map((sense, i) => (
      <SenseBlock
        key={`${sense.pos ?? '?'}-${sense.index}-${i}`}
        sense={sense}
        showDivider={i > 0}
      />
    ))}
  </View>
);

type SenseBlockProps = {sense: WordNetSense; showDivider: boolean};

export const SenseBlock = ({
  sense,
  showDivider,
}: SenseBlockProps): React.JSX.Element => (
  <View style={[styles.sense, showDivider && styles.senseDivider]}>
    <View style={styles.senseHeader}>
      {sense.pos ? (
        <Text style={styles.posBadge}>{labelForPos(sense.pos)}</Text>
      ) : null}
      <Text style={styles.senseIndex}>{`${sense.index}.`}</Text>
    </View>
    <Text style={styles.definition}>{sense.definition}</Text>
    {sense.examples.length > 0 ? (
      <View style={styles.examples}>
        {sense.examples.map((ex, j) => (
          <Text key={j} style={styles.example}>
            “{ex}”
          </Text>
        ))}
      </View>
    ) : null}
    {sense.synonyms.length > 0 ? (
      <Text style={styles.synonyms}>
        <Text style={styles.synonymsLabel}>{`${t('popup.synonyms')}: `}</Text>
        {sense.synonyms.join(', ')}
      </Text>
    ) : null}
  </View>
);
