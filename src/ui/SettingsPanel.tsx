import React from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import {closeSettings, getPopupActions, type ResultSnapshot} from './popupController';
import type {DictPref} from '../core/dict/sqlite/settings';
import {exportRootParent} from '../core/dict/sqlite/exportDbs';
import ExportSection from './ExportSection';
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
  // Dictionary enable/disable/reorder edits are staged LOCALLY and only
  // written when the user taps Save (explicit, single transaction, with a
  // confirmation) — not auto-persisted on every toggle. `dirty` gates the
  // Save button; cleared on (re)load and on a successful save.
  const [dirty, setDirty] = React.useState<boolean>(false);
  const [saving, setSaving] = React.useState<boolean>(false);
  // Inline save outcome shown next to the Save button — a 'Settings saved' /
  // 'Couldn't save settings' line, NOT a modal. The old confirmation reused the
  // native two-button RattaDialog as a notification, so it surfaced TWO
  // identical "Close" buttons for a single-action acknowledgement. An inline
  // status is the right shape (one action: read it), and it's host-testable
  // (no native overlay). Cleared the instant the user stages another edit.
  const [saveStatus, setSaveStatus] = React.useState<'saved' | 'failed' | null>(
    null,
  );
  // F7-AC3: after a Remove, the engine reports whether the on-disk source files
  // could also be deleted (`removed.sources`). When they couldn't, the dict can
  // re-import itself on the next reload — the user MUST be told, or a dict they
  // "removed" silently returns. Surfaced as an inline banner (not a modal),
  // cleared on the next edit/delete.
  const [sourcesLeftWarning, setSourcesLeftWarning] =
    React.useState<boolean>(false);
  // F4: keep-source-files toggle. Defaults to true (keep) until the engine
  // resolves the persisted flag — matching the engine default, so the
  // initial render never shows a misleading "delete" state.
  const [keepSources, setKeepSources] = React.useState<boolean>(true);

  // Re-fetch the current order+enablement (shared by the mount effect and
  // the post-delete refresh — F7). Null actions / a rejection leave the
  // current list untouched (no crash). `cancelledRef` guards a stale async
  // resolving after unmount.
  const cancelledRef = React.useRef(false);
  const refreshList = React.useCallback((): void => {
    getPopupActions()
      ?.listDictPrefs()
      .then(loaded => {
        if (!cancelledRef.current) {
          setPrefs(loaded);
          setDirty(false);
        }
      })
      .catch(() => {
        // The engine surfaces its own errors; the panel keeps the last
        // list rather than crashing the popup.
      });
  }, []);

  // Re-fetch the current order+enablement on every mount (EC6): a detached
  // import may have landed since the panel last opened, so the list must
  // reflect the live registry, not a stale snapshot. Null actions (engine
  // not yet wired) -> empty list, no crash.
  React.useEffect(() => {
    cancelledRef.current = false;
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
          setDirty(false);
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
      cancelledRef.current = true;
    };
  }, []);

  // F7: Remove an imported dict. Confirm via the device dialog port (only
  // the Delete button proceeds), then drop it through the engine and
  // re-fetch the list so the removed row disappears. Both ports are
  // optional (F3/F4 fakeActions omit them) — a missing one is a no-op. Any
  // rejection is swallowed (the engine logs it); the list just isn't
  // refreshed. Confirm runs FIRST so a stray tap never deletes silently.
  const removeDict = (pref: DictPref): void => {
    const actions = getPopupActions();
    if (!actions || !actions.confirmDeleteDict || !actions.deleteImportedDict) {
      return;
    }
    const {confirmDeleteDict, deleteImportedDict} = actions;
    // A new delete attempt clears any prior warning so it reflects THIS result.
    setSourcesLeftWarning(false);
    confirmDeleteDict(pref.name)
      .then(confirmed => {
        if (!confirmed) {
          return;
        }
        return deleteImportedDict(pref.prefKey).then(result => {
          // F7-AC3: warn ONLY when the source files were found but couldn't be
          // deleted (`sourcesAtRisk`) — the dict can re-import on reload. NOT on
          // `removed.sources === false` alone, which is also the benign
          // "nothing on disk to delete" case (keep=false import) and must not
          // warn.
          if (!cancelledRef.current && result.sourcesAtRisk) {
            setSourcesLeftWarning(true);
          }
          refreshList();
        });
      })
      .catch(() => {
        // Swallow — the engine logs its own failure; the panel stays put.
      });
  };

  // Stage a reordered/toggled set LOCALLY (renumbering sortOrder to the array
  // index so it round-trips deterministically) and mark the panel dirty. The
  // write happens on Save — not here — so a mis-tap is undone by re-toggling
  // before saving, and the persist is one explicit, confirmable transaction.
  const commit = (next: DictPref[]): void => {
    const renumbered = next.map((pref, index) => ({...pref, sortOrder: index}));
    setPrefs(renumbered);
    setDirty(true);
    // A fresh edit invalidates the previous save outcome — drop the inline
    // status so a stale "Settings saved" never lingers over unsaved changes.
    setSaveStatus(null);
    setSourcesLeftWarning(false);
  };

  // Persist the staged dict prefs on an explicit Save: one setDictPrefs call
  // (the engine recomputes the live `sources`), then clear dirty + show the
  // inline "saved" status. A failure surfaces the inline "couldn't save" status
  // and KEEPS dirty so the user can retry (the engine logs the detailed reason).
  // Guarded so a double-tap can't fire two overlapping writes.
  const save = (): void => {
    if (saving || !dirty) {
      return;
    }
    const actions = getPopupActions();
    const persist = actions?.setDictPrefs;
    if (!persist) {
      return;
    }
    setSaving(true);
    persist(prefs)
      .then(() => {
        if (cancelledRef.current) {
          return;
        }
        setDirty(false);
        setSaveStatus('saved');
      })
      .catch(() => {
        if (!cancelledRef.current) {
          setSaveStatus('failed');
        }
      })
      .finally(() => {
        if (!cancelledRef.current) {
          setSaving(false);
        }
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
  // Reorder controls only make sense with ≥2 dictionaries; with one
  // dictionary the row is just a checkbox (nothing to reorder).
  const multiDict = prefs.length > 1;

  return (
    <View style={styles.card}>
      <View style={styles.settingsHeaderRow}>
        <Text style={styles.settingsTitle}>{t('settings.title')}</Text>
        <View style={styles.settingsHeaderActions}>
          {/* Inline save outcome — an acknowledgement the user reads, not a
              modal to dismiss. Sits just left of Save; cleared on the next
              edit. */}
          {saveStatus ? (
            <Text
              accessibilityRole="alert"
              style={
                saveStatus === 'saved'
                  ? styles.settingsSaveStatus
                  : [styles.settingsSaveStatus, styles.settingsSaveStatusError]
              }>
              {saveStatus === 'saved'
                ? t('settings.saved')
                : t('settings.saveFailed')}
            </Text>
          ) : null}
          {/* Save: enabled only when there are unsaved edits (dirty). One
              explicit write, with an inline "Saved" confirmation. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: !dirty || saving}}
            accessibilityLabel={t('settings.save')}
            disabled={!dirty || saving}
            onPress={save}
            style={
              dirty && !saving
                ? styles.settingsSaveButton
                : [styles.settingsSaveButton, styles.settingsSaveButtonDisabled]
            }>
            <Text
              style={
                dirty && !saving
                  ? styles.settingsSaveLabel
                  : [styles.settingsSaveLabel, styles.settingsSaveLabelDisabled]
              }>
              {t('settings.save')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.back')}
            onPress={() => closeSettings()}
            style={styles.settingsBackButton}>
            <Text style={styles.settingsBackLabel}>{t('settings.back')}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.settingsBody}>
        {/* DICTIONARIES — a checkbox per dict (tap the row to enable/
            disable), circular up/down to reorder (only with ≥2), Remove on
            imported dicts. */}
        <Text style={styles.settingsSectionTitle}>
          {t('settings.dictionaries')}
        </Text>
        {/* F7-AC3: a removed dict whose source files couldn't be deleted may
            re-import on reload — warn so its return isn't a surprise. */}
        {sourcesLeftWarning ? (
          <Text accessibilityRole="alert" style={styles.settingsWarning}>
            {t('settings.deleteSourcesLeft')}
          </Text>
        ) : null}
        {prefs.map((pref, index) => (
          <View key={pref.prefKey} style={styles.dictRow}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{checked: pref.enabled}}
              accessibilityLabel={
                pref.enabled
                  ? `${t('settings.disableDict')}: ${pref.name}`
                  : `${t('settings.enableDict')}: ${pref.name}`
              }
              onPress={() => toggle(index)}
              style={styles.dictToggleTap}>
              <Text style={styles.dictCheckbox}>
                {pref.enabled ? '☑' : '☐'}
              </Text>
              <Text
                style={
                  pref.enabled
                    ? styles.dictName
                    : [styles.dictName, styles.dictNameDisabled]
                }
                numberOfLines={1}>
                {pref.name}
              </Text>
            </Pressable>
            <View style={styles.dictRowControls}>
              {multiDict && index > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('settings.moveUp')}: ${pref.name}`}
                  onPress={() => move(index, -1)}
                  style={styles.dictArrowButton}>
                  <Text style={styles.dictArrowLabel}>↑</Text>
                </Pressable>
              ) : null}
              {multiDict && index < prefs.length - 1 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('settings.moveDown')}: ${pref.name}`}
                  onPress={() => move(index, 1)}
                  style={styles.dictArrowButton}>
                  <Text style={styles.dictArrowLabel}>↓</Text>
                </Pressable>
              ) : null}
              {pref.removable ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('settings.removeDict')}: ${pref.name}`}
                  onPress={() => removeDict(pref)}
                  style={styles.removeButton}>
                  <Text style={styles.removeButtonLabel}>
                    {t('settings.removeDict')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
        {prefs.length > 0 && !anyEnabled ? (
          <Text accessibilityRole="alert" style={styles.settingsWarning}>
            {t('settings.allDisabled')}
          </Text>
        ) : null}

        {/* IMPORTS — keep-vs-delete the dropped source files after import. */}
        <Text style={styles.settingsSectionTitle}>{t('settings.sources')}</Text>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{checked: keepSources}}
          accessibilityLabel={t('settings.keepSources')}
          onPress={toggleKeepSources}
          style={styles.dictToggleTap}>
          <Text style={styles.dictCheckbox}>{keepSources ? '☑' : '☐'}</Text>
          <View style={styles.settingsToggleLabelCol}>
            <Text style={styles.settingsToggleLabel}>
              {t('settings.keepSources')}
            </Text>
            <Text style={styles.settingsToggleHint}>
              {t('settings.keepSourcesHint')}
            </Text>
          </View>
        </Pressable>

        {/* BACKUP — export all DBs. ExportSection renders its own section
            title + controls, or null when the export ports aren't wired. */}
        <ExportSection rootParent={exportRootParent()} />
      </ScrollView>
    </View>
  );
}
