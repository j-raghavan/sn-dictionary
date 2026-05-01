import React, {useCallback, useEffect, useState} from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {
  getCurrentState,
  hideDefinition,
  subscribe,
  type PopupState,
} from './popupController';
import {SourceSection} from './SourceSection';
import {popupStyles as styles} from './popupStyles';
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

  if (!state.visible) {
    // Zero-size, non-interactive when nothing to show — matches the
    // sn-formula phase-1 pattern that avoids ghost-touching the page.
    return <View pointerEvents="none" style={styles.hidden} />;
  }

  const hits = state.result.hits;
  const headerWord =
    hits.length > 0 ? hits[0].entry.word : state.result.queriedFor;
  const showSourceBadges = hits.length >= 2;

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Text style={styles.word}>{headerWord}</Text>
        {state.ocrLabel ? (
          <Text style={styles.ocrLabel}>{state.ocrLabel}</Text>
        ) : null}
        <ScrollView style={styles.body}>
          {hits.length === 0 ? (
            <Text style={styles.notFound}>
              {`${t('popup.notFoundFor')} "${state.result.queriedFor}".`}
            </Text>
          ) : (
            hits.map((hit, i) => (
              <SourceSection
                key={`${hit.source}-${i}`}
                hit={hit}
                showBadge={showSourceBadges}
                showDivider={i > 0}
              />
            ))
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
