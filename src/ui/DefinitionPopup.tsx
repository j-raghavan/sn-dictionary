import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {
  getCurrentState,
  hideDefinition,
  subscribe,
  type PopupState,
} from './popupController';
import {
  labelForPos,
  parseWordNetEntry,
  type WordNetSense,
} from './wordnetFormatter';
import {t} from '../i18n/i18n';

export default function DefinitionPopup(): React.JSX.Element {
  const [state, setState] = useState<PopupState>(getCurrentState);

  useEffect(() => subscribe(setState), []);

  // Closing the popup means closing the firmware's overlay region.
  // sn-shapes (ShapePalette.tsx:630) and sn-mindmap (MindmapCanvas.tsx:505)
  // both fire-and-forget closePluginView from the close button — its
  // promise can be slow on-device and we don't want the press handler
  // to block. We also clear local popup state immediately so the next
  // lookup invocation doesn't briefly flash the previous definition
  // before its own showResult lands.
  const handleClose = useCallback(() => {
    hideDefinition();
    PluginManager.closePluginView().catch(() => {
      /* ignore — overlay is going away regardless */
    });
  }, []);

  // Parse the WordNet entry once per definition change. Memoise so
  // subsequent re-renders (e.g. from popupController state echoes)
  // don't re-tokenise.
  const parsed = useMemo(() => {
    if (!state.visible || !state.result.found) {
      return null;
    }
    return parseWordNetEntry(state.result.entry.definition);
  }, [state]);

  if (!state.visible) {
    // Zero-size, non-interactive when nothing to show — matches the
    // sn-formula phase-1 pattern that avoids ghost-touching the page.
    return <View pointerEvents="none" style={styles.hidden} />;
  }

  const headerWord = state.result.found
    ? state.result.entry.word
    : state.result.queriedFor;

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Text style={styles.word}>{headerWord}</Text>
        {state.ocrLabel ? (
          <Text style={styles.ocrLabel}>{state.ocrLabel}</Text>
        ) : null}
        <ScrollView style={styles.body}>
          {state.result.found ? (
            parsed && !parsed.parseFailed ? (
              <SenseList senses={parsed.senses} />
            ) : (
              <Text style={styles.definition}>
                {state.result.entry.definition}
              </Text>
            )
          ) : (
            <Text style={styles.notFound}>
              {`${t('popup.notFoundFor')} "${state.result.queriedFor}".`}
            </Text>
          )}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          onPress={handleClose}
          style={styles.closeButton}>
          <Text style={styles.closeLabel}>{t('popup.close')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

type SenseListProps = {senses: WordNetSense[]};

const SenseList = ({senses}: SenseListProps): React.JSX.Element => (
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

const SenseBlock = ({sense, showDivider}: SenseBlockProps): React.JSX.Element => (
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

const styles = StyleSheet.create({
  hidden: {width: 0, height: 0},
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    minWidth: 480,
    maxWidth: 640,
    maxHeight: 520,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#000000',
    padding: 20,
  },
  word: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000000',
  },
  ocrLabel: {
    marginTop: 4,
    fontSize: 14,
    color: '#555555',
  },
  body: {
    marginTop: 12,
    marginBottom: 16,
  },
  definition: {
    fontSize: 17,
    lineHeight: 24,
    color: '#000000',
  },
  notFound: {
    fontSize: 18,
    color: '#555555',
    fontStyle: 'italic',
  },
  sense: {
    paddingVertical: 10,
  },
  senseDivider: {
    borderTopWidth: 1,
    borderTopColor: '#dddddd',
  },
  senseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  posBadge: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#555555',
    marginRight: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#888888',
    borderRadius: 3,
  },
  senseIndex: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  examples: {
    marginTop: 6,
    marginLeft: 12,
  },
  example: {
    fontSize: 15,
    fontStyle: 'italic',
    color: '#444444',
    lineHeight: 22,
  },
  synonyms: {
    marginTop: 8,
    fontSize: 14,
    color: '#444444',
    lineHeight: 20,
  },
  synonymsLabel: {
    fontWeight: '600',
    color: '#000000',
  },
  closeButton: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
  },
  closeLabel: {
    fontSize: 16,
    color: '#000000',
  },
});
