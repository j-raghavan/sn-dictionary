import React from 'react';
import {Pressable, Text, View} from 'react-native';
import {closeSettings, type ResultSnapshot} from './popupController';
import {popupStyles as styles} from './popupStyles';
import {t} from '../i18n/i18n';

// The Settings-Panel shell (F1). Renders INSIDE styles.card — the
// DefinitionPopup supplies the backdrop + card. A title + a Back button
// (which re-emits the stashed result via closeSettings, restoring the
// prior view + tab) frame a placeholder body that F3/F4/F5/F7 fill in.
// Deliberately engine-free: it imports nothing from the lookup engine.
export default function SettingsPanel(_props: {
  resume?: ResultSnapshot;
}): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={styles.settingsHeaderRow}>
        <Text style={styles.settingsTitle}>{t('settings.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.back')}
          onPress={() => closeSettings()}
          style={styles.settingsBackButton}>
          <Text style={styles.settingsBackLabel}>{t('settings.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.settingsPlaceholder}>{t('settings.title')}</Text>
    </View>
  );
}
