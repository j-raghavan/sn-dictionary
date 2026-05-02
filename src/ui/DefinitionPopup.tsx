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
  const loading = state.result.loading ?? [];
  const isWaitingForFirstHit = hits.length === 0 && loading.length > 0;
  // The popup may render before any source resolves (streaming
  // emission). In that "waiting" state we have no canonical word
  // yet, so fall back to whatever the user queried so the header
  // still shows something meaningful.
  const headerWord =
    hits.length > 0 ? hits[0].entry.word : state.result.queriedFor;
  // Show source badges as soon as we have ≥2 distinct things to show
  // (hits + loading combined), so the layout doesn't reflow when a
  // loading section flips to a hit.
  const showSourceBadges = hits.length + loading.length >= 2;

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Text style={styles.word}>{headerWord}</Text>
        {state.ocrLabel ? (
          <Text style={styles.ocrLabel}>{state.ocrLabel}</Text>
        ) : null}
        <ScrollView style={styles.body}>
          {hits.map((hit, i) => (
            <SourceSection
              key={`hit-${hit.source}-${i}`}
              hit={hit}
              showBadge={showSourceBadges}
              showDivider={i > 0}
            />
          ))}
          {loading.map((sourceName, i) => (
            <View
              key={`loading-${sourceName}-${i}`}
              style={[
                styles.section,
                (hits.length > 0 || i > 0) && styles.sectionDivider,
              ]}>
              {showSourceBadges ? (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sourceBadge}>{sourceName}</Text>
                </View>
              ) : null}
              <Text style={styles.loading}>{t('popup.loading')}</Text>
            </View>
          ))}
          {hits.length === 0 && !isWaitingForFirstHit ? (
            <Text style={styles.notFound}>
              {`${t('popup.notFoundFor')} "${state.result.queriedFor}".`}
            </Text>
          ) : null}
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
