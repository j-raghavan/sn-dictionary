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

// Body-text size selector. The two-button A−/A+ control cycles
// through these in order. Default is 'S' (the historical body-text
// size); the user can step up to M or L when a definition is hard
// to read at the default. Persists across show/hide cycles within
// a session — the popup component never unmounts, only changes
// what it renders — so a user who picks L sees L on the next tap
// without re-clicking. Resets only when the JS bundle reloads.
const FONT_SIZES = ['S', 'M', 'L'] as const;
type FontSize = (typeof FONT_SIZES)[number];

const FONT_SCALE: Record<FontSize, number> = {
  S: 1,
  M: 1.25,
  L: 1.5,
};

const stepUp = (size: FontSize): FontSize => {
  const i = FONT_SIZES.indexOf(size);
  return FONT_SIZES[Math.min(i + 1, FONT_SIZES.length - 1)];
};

const stepDown = (size: FontSize): FontSize => {
  const i = FONT_SIZES.indexOf(size);
  return FONT_SIZES[Math.max(i - 1, 0)];
};

export default function DefinitionPopup(): React.JSX.Element {
  const [state, setState] = useState<PopupState>(getCurrentState);
  const [fontSize, setFontSize] = useState<FontSize>('S');

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

  const handleSmaller = useCallback(
    () => setFontSize(s => stepDown(s)),
    [],
  );
  const handleLarger = useCallback(
    () => setFontSize(s => stepUp(s)),
    [],
  );

  if (!state.visible) {
    // Zero-size, non-interactive when nothing to show — matches the
    // sn-formula phase-1 pattern that avoids ghost-touching the page.
    return <View pointerEvents="none" style={styles.hidden} />;
  }

  if (state.kind === 'recognizing') {
    // Tap-to-popup speedup: the lasso flow opens the popup
    // immediately on tap, BEFORE the firmware finishes lasso-element
    // marshalling and OCR. Without this state, the user stares at
    // the page for 5–8 s while those SDK calls run; with it, the
    // popup pops within ~300 ms and shows a localised "Recognizing…"
    // until the OCR'd word and dictionary results arrive.
    //
    // Font-size buttons are intentionally hidden here — there's no
    // body text to scale. They reappear when the result kind takes
    // over.
    return (
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.recognizing}>{t('popup.recognizing')}</Text>
          {state.ocrLabel ? (
            <Text style={styles.ocrLabel}>{state.ocrLabel}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('popup.close')}
            onPress={handleClose}
            style={styles.closeButton}>
            <Text style={styles.closeLabel}>{t('popup.close')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // state.kind === 'result'
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
  const fontScale = FONT_SCALE[fontSize];
  // Hide the bound buttons rather than greying them — disabled-state
  // styling on e-ink can look like dead pixels.
  const canShrink = fontSize !== 'S';
  const canGrow = fontSize !== 'L';

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={[styles.word, styles.headerWordWrap]} numberOfLines={1}>
            {headerWord}
          </Text>
          <View style={styles.fontControls}>
            {canShrink ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('popup.fontSmaller')}
                onPress={handleSmaller}
                style={styles.fontButton}>
                <Text style={styles.fontButtonLabel}>A−</Text>
              </Pressable>
            ) : null}
            {canGrow ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('popup.fontLarger')}
                onPress={handleLarger}
                style={styles.fontButton}>
                <Text style={styles.fontButtonLabel}>A+</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
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
              fontScale={fontScale}
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
          accessibilityLabel={t('popup.close')}
          onPress={handleClose}
          style={styles.closeButton}>
          <Text style={styles.closeLabel}>{t('popup.close')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
