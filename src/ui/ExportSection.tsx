import React from 'react';
import {Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import {getPopupActions} from './popupController';
import type {ExportSummary} from '../core/dict/sqlite/settings';
import {joinPath} from '../core/dict/sqlite/exportDbs';
import {popupStyles as styles} from './popupStyles';
import {t} from '../i18n/i18n';

// The Settings-Panel DB-export section (F5). A minimal in-panel folder
// chooser (the SDK ships no folder picker) over the engine ports the
// host wires in index.js: `listFolders` (type-tagged FileUtils.listFiles,
// dirs only), `createFolder` (makeDir), and `exportDbs(target)` (the
// host-tested orchestration — space pre-check, plugin-dir guard, user.db
// checkpoint, per-file copy). Every port is OPTIONAL on PopupActions; a
// missing one renders the section inert (no crash), matching the F7
// Remove-port guard.
//
// Navigation: the chooser opens at `rootParent` (MyStyle), lists its
// subfolders, and lets the user descend (tap a row) or go up. "New
// folder" creates a named child via createFolder and descends into it.
// "Export here" runs exportDbs over the current folder and shows the
// per-file summary. A rejection (plugin-dir guard / no-space abort)
// surfaces its localised reason as the summary — nothing partially
// copied (the orchestration aborts BEFORE any copyFile).
export default function ExportSection(props: {
  // The folder the chooser opens at (MyStyle; the host derives it from
  // getExternalDirPath, falling back to DEFAULT_EXPORT_DIR's parent).
  rootParent: string;
}): React.JSX.Element | null {
  const actions = getPopupActions();
  // The whole section is gated on the export ports being wired — if the
  // engine hasn't registered them (F3/F4/F7-only fakeActions, or a
  // not-yet-bootstrapped runtime), render nothing rather than a dead UI.
  const exportFn = actions?.exportDbs;
  const listFoldersFn = actions?.listFolders;

  const [current, setCurrent] = React.useState(props.rootParent);
  const [folders, setFolders] = React.useState<string[]>([]);
  const [newName, setNewName] = React.useState('');
  const [summary, setSummary] = React.useState<string | null>(null);
  const cancelledRef = React.useRef(false);

  // Load the subfolders of `dir` into the chooser. Null list-port / a
  // rejection -> empty list (the folder is still selectable as a target).
  const loadFolders = React.useCallback(
    (dir: string): void => {
      if (!listFoldersFn) {
        setFolders([]);
        return;
      }
      listFoldersFn(dir)
        .then(found => {
          if (!cancelledRef.current) {
            setFolders(found);
          }
        })
        .catch(() => {
          if (!cancelledRef.current) {
            setFolders([]);
          }
        });
    },
    [listFoldersFn],
  );

  React.useEffect(() => {
    cancelledRef.current = false;
    loadFolders(props.rootParent);
    return () => {
      cancelledRef.current = true;
    };
  }, [loadFolders, props.rootParent]);

  if (!exportFn) {
    return null;
  }

  const basename = (p: string): string => {
    const slash = p.lastIndexOf('/');
    return slash >= 0 ? p.slice(slash + 1) : p;
  };

  // Descend into a listed subfolder: make it current + reload its
  // children. Clears any stale summary (a new target, a fresh export).
  const enter = (dir: string): void => {
    setSummary(null);
    setCurrent(dir);
    loadFolders(dir);
  };

  // Go up one level (no-op at the root parent — the Up control is hidden
  // there, so this only fires below it).
  const goUp = (): void => {
    const slash = current.lastIndexOf('/');
    const parent = slash > 0 ? current.slice(0, slash) : current;
    enter(parent);
  };

  // Create a named child of the current folder via makeDir, then descend
  // into it (it becomes the target). A blank name / null port / a failed
  // makeDir is a no-op (the create port resolves false on failure).
  const createFolder = (): void => {
    const name = newName.trim();
    const createFn = actions?.createFolder;
    if (name.length === 0 || !createFn) {
      return;
    }
    const child = joinPath(current, name);
    createFn(child)
      .then(ok => {
        if (cancelledRef.current || !ok) {
          return;
        }
        setNewName('');
        enter(child);
      })
      .catch(() => {
        // makeDir failed — keep the typed name so the user can retry.
      });
  };

  // Export every DB into the current folder. exportDbs orchestrates the
  // guard + space check + checkpoint + copy; it REJECTS (with a localised
  // reason) on the plugin-dir guard / no-space abort — show that verbatim
  // as the summary. On success, summarise copied/failed counts.
  const runExport = (): void => {
    setSummary(null);
    exportFn(current)
      .then((result: ExportSummary) => {
        if (cancelledRef.current) {
          return;
        }
        const parts = [
          `${t('settings.exportDone')}: ${result.copied.length}`,
        ];
        if (result.failed.length > 0) {
          parts.push(
            `${result.failed.length} (${result.failed
              .map(f => f.file)
              .join(', ')})`,
          );
        }
        setSummary(`${parts.join(' · ')} → ${result.targetDir}`);
      })
      .catch((e: unknown) => {
        if (!cancelledRef.current) {
          // The orchestration throws the localised reason (no-space /
          // plugin-dir guard) — surface it directly.
          setSummary((e as Error).message);
        }
      });
  };

  const atRoot = current === props.rootParent;

  return (
    <View>
      <Text style={styles.settingsSectionTitle}>{t('settings.export')}</Text>
      <Text style={styles.exportTargetLabel}>{current}</Text>

      <ScrollView>
        {!atRoot ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('settings.moveUp')}: ${current}`}
            onPress={goUp}
            style={styles.exportFolderRow}>
            <Text style={styles.exportFolderRowLabel}>..</Text>
          </Pressable>
        ) : null}
        {folders.map(dir => (
          <Pressable
            key={dir}
            accessibilityRole="button"
            accessibilityLabel={`${t('settings.exportFolder')}: ${basename(dir)}`}
            onPress={() => enter(dir)}
            style={styles.exportFolderRow}>
            <Text style={styles.exportFolderRowLabel}>{basename(dir)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.exportActionRow}>
        <TextInput
          accessibilityLabel={t('settings.newFolder')}
          placeholder={t('settings.newFolder')}
          value={newName}
          onChangeText={setNewName}
          style={[styles.exportButton, styles.exportButtonLabel]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.newFolder')}
          onPress={createFolder}
          style={styles.exportButton}>
          <Text style={styles.exportButtonLabel}>+</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.export')}
          onPress={runExport}
          style={styles.exportButton}>
          <Text style={styles.exportButtonLabel}>{t('settings.export')}</Text>
        </Pressable>
      </View>

      {summary !== null ? (
        <Text accessibilityRole="text" style={styles.exportSummary}>
          {summary}
        </Text>
      ) : null}
    </View>
  );
}
