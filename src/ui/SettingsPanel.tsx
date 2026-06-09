import React from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import {closeSettings, getPopupActions, type ResultSnapshot} from './popupController';
import type {DictPref} from '../core/dict/sqlite/settings';
import {popupStyles as styles} from './popupStyles';
import {t} from '../i18n/i18n';

// The Settings-Panel dictionary manager (F3). Renders INSIDE styles.card —
// the DefinitionPopup supplies the backdrop + card. A title + Back button
// (closeSettings restores the stashed result + tab) frame the dictionary
// list: every source in current precedence order, each with an enable/
// disable toggle and Move-up/Move-down controls (no drag — resolution #4;
// e-ink). Reads through the registry seam (getPopupActions, guard-null) so
// it stays engine-free. F4/F5/F7 add more sections below this one.
export default function SettingsPanel(_props: {
  resume?: ResultSnapshot;
}): React.JSX.Element {
  const [prefs, setPrefs] = React.useState<DictPref[]>([]);
  // F4: keep-source-files toggle. Defaults to true (keep) until the engine
  // resolves the persisted flag — matching the engine default, so the
  // initial render never shows a misleading "delete" state.
  const [keepSources, setKeepSources] = React.useState<boolean>(true);

  // Re-fetch the current order+enablement on every mount (EC6): a detached
  // import may have landed since the panel last opened, so the list must
  // reflect the live registry, not a stale snapshot. Null actions (engine
  // not yet wired) -> empty list, no crash.
  React.useEffect(() => {
    let cancelled = false;
    const actions = getPopupActions();
    if (!actions) {
      return;
    }
    actions
      .listDictPrefs()
      .then(loaded => {
        if (!cancelled) {
          setPrefs(loaded);
        }
      })
      .catch(() => {
        // The engine surfaces its own errors; the panel just shows an
        // empty list rather than crashing the popup.
      });
    // F4: load the persisted keep/delete preference (default keep on any
    // failure / degraded user.db — never surface a wrong "delete" state).
    actions
      .getKeepSources()
      .then(keep => {
        if (!cancelled) {
          setKeepSources(keep);
        }
      })
      .catch(() => {
        // Keep the safe default (keep=true); the engine logs its own error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist a whole reordered/toggled set (renumbering sortOrder to the
  // array index so it round-trips deterministically) and optimistically
  // reflect it locally. setDictPrefs also recomputes the live `sources`
  // array, so the next lookup honours the change with no reload.
  const commit = (next: DictPref[]): void => {
    const renumbered = next.map((pref, index) => ({...pref, sortOrder: index}));
    setPrefs(renumbered);
    getPopupActions()
      ?.setDictPrefs(renumbered)
      .catch(() => {
        // No rethrow — the optimistic UI stays; the engine logs the write
        // failure (degraded user.db just no-ops the persist).
      });
  };

  const toggle = (index: number): void => {
    const next = prefs.slice();
    next[index] = {...next[index], enabled: !next[index].enabled};
    commit(next);
  };

  // Swap a row with its neighbour. Only ever called from a rendered arrow,
  // which is hidden at the top/bottom bound (index 0 has no Move-up, the
  // last has no Move-down), so the target is always in range.
  const move = (index: number, delta: number): void => {
    const target = index + delta;
    const next = prefs.slice();
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  // F4: flip the keep-source-files preference. Optimistic local update +
  // best-effort persist (a degraded user.db just no-ops). Applies to FUTURE
  // imports only (F4-FR7) — never retroactively deletes kept sources.
  const toggleKeepSources = (): void => {
    const next = !keepSources;
    setKeepSources(next);
    getPopupActions()
      ?.setKeepSources(next)
      .catch(() => {
        // No rethrow — optimistic UI stays; the engine logs the failure.
      });
  };

  const anyEnabled = prefs.some(pref => pref.enabled);

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

      <Text style={styles.settingsSectionTitle}>
        {t('settings.dictionaries')}
      </Text>

      <ScrollView>
        {prefs.map((pref, index) => (
          <View key={pref.prefKey} style={styles.dictRow}>
            <View style={styles.dictRowLabel}>
              <Text
                style={
                  pref.enabled
                    ? styles.dictName
                    : [styles.dictName, styles.dictNameDisabled]
                }>
                {pref.name}
              </Text>
            </View>
            <View style={styles.dictRowControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  pref.enabled
                    ? `${t('settings.disableDict')}: ${pref.name}`
                    : `${t('settings.enableDict')}: ${pref.name}`
                }
                onPress={() => toggle(index)}
                style={styles.dictControl}>
                <Text style={styles.dictControlLabel}>
                  {pref.enabled
                    ? t('settings.disableDict')
                    : t('settings.enableDict')}
                </Text>
              </Pressable>
              {index > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('settings.moveUp')}: ${pref.name}`}
                  onPress={() => move(index, -1)}
                  style={styles.dictControl}>
                  <Text style={styles.dictControlLabel}>↑</Text>
                </Pressable>
              ) : (
                <View style={styles.dictControlSpacer} />
              )}
              {index < prefs.length - 1 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('settings.moveDown')}: ${pref.name}`}
                  onPress={() => move(index, 1)}
                  style={styles.dictControl}>
                  <Text style={styles.dictControlLabel}>↓</Text>
                </Pressable>
              ) : (
                <View style={styles.dictControlSpacer} />
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {prefs.length > 0 && !anyEnabled ? (
        <Text
          accessibilityRole="alert"
          style={styles.settingsWarning}>
          {t('settings.allDisabled')}
        </Text>
      ) : null}

      <Text style={styles.settingsSectionTitle}>{t('settings.sources')}</Text>
      <View style={styles.settingsToggleRow}>
        <View style={styles.settingsToggleLabelCol}>
          <Text style={styles.settingsToggleLabel}>
            {t('settings.keepSources')}
          </Text>
          <Text style={styles.settingsToggleHint}>
            {t('settings.keepSourcesHint')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{checked: keepSources}}
          accessibilityLabel={t('settings.keepSources')}
          onPress={toggleKeepSources}
          style={styles.dictControl}>
          <Text style={styles.dictControlLabel}>
            {keepSources ? t('common.keep') : t('common.delete')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
