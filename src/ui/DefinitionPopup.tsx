import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {LayoutChangeEvent} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {
  closeSettings,
  getCurrentState,
  getPopupActions,
  hideDefinition,
  shouldDismissOnBackdropTap,
  showSettings,
  subscribe,
  type PopupState,
} from './popupController';
import {getPenToolObserver} from '../native/penToolObserver';
import SettingsPanel from './SettingsPanel';
import {SourceSection} from './SourceSection';
import {popupStyles as styles, scaled} from './popupStyles';
import {t} from '../i18n/i18n';
import {parseWordNetEntry} from './wordnetFormatter';
import {buildCopyText} from './copyText';
import {copyToClipboard} from '../native/clipboard';
import {
  assembleThesaurus,
  type ThesaurusResult,
} from '../core/dict/sqlite/thesaurusLookup';

type Tab = 'definition' | 'thesaurus';

// One headword's fetched-and-assembled thesaurus. Held in popup-local
// state (the thesaurus is a separate lazy query, never a LookupResult
// field — IV-1). Cached by headword so flipping Definition<->Thesaurus
// re-renders from cache without a second fetch; a NEW headword
// invalidates it (TF4-FR4 single-fetch).
type ThesaurusCache = {
  headword: string;
  result: ThesaurusResult;
};

// Body-text size selector. The two-button A− / A+ control cycles
// through these in order and the middle of the stepper shows where you
// are. Default is 'S' (the historical body-text size). Persists across
// show/hide cycles within a session — the popup component never
// unmounts, only changes what it renders — so a user who picks L sees L
// on the next tap without re-clicking. Resets only when the JS bundle
// reloads, and is deliberately INDEPENDENT of `maximized`: big text in
// a small window is a legitimate combination (issue #37's reporter
// wanted page context preserved).
//
// Five levels, linear in +0.25 steps to a 2x body. 2x is a principled
// ceiling: 17dp * 2 = 34dp = 15.3pt physical (1dp = 1/160in), the top
// of the large-print range. Steps stay LINEAR rather than geometric so
// S/M/L keep their shipped values byte-for-byte and this change only
// appends. The side effect is desirable: the relative jump shrinks as
// you climb (+25%, +20%, +16.7%, +14.3%) — coarse control where the
// text is small, fine control at the top where the user is dialling in.
// Exported so tests derive the level count from the single source of
// truth rather than hard-coding "four presses to the top".
export const FONT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;
type FontSize = (typeof FONT_SIZES)[number];

const FONT_SCALE: Record<FontSize, number> = {
  S: 1,
  M: 1.25,
  L: 1.5,
  XL: 1.75,
  XXL: 2,
};

// What the middle of the ( − )( ? )( + ) stepper shows. With five levels
// the greyed end buttons no longer identify M / L / XL — three of the
// five present identically — and each probe costs a full e-ink repaint.
//
// 'XXL' renders as '2X' because three capitals at fontSize 18 measure
// ~32dp and exactly fill the 32dp fontSizeIndicator slot, while '2X'
// measures ~21dp and leaves the centering intact. Deliberately NOT
// localized: these are size codes rather than words, the two touch
// targets beside them already carry localized labels
// (popup.fontSmaller / popup.fontLarger) in all 7 locales, and a
// translated string would overflow the fixed 32dp box and knock on to
// the headword's width budget in every locale independently.
const FONT_LEVEL_LABEL: Record<FontSize, string> = {
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
  XXL: '2X',
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
  // #37 — Normal (the 640-wide card) vs Maximized (fills the plugin
  // view). Session-only component state, exactly like `fontSize` above:
  // the popup never unmounts, so a user who maximizes stays maximized
  // across show/hide AND across new headwords, and only a JS bundle
  // reload resets it. Deliberately NOT persisted (no PopupActions port,
  // no user.db) and deliberately NOT cleared by the reset effects below,
  // which key on queriedFor / headword.
  const [maximized, setMaximized] = useState(false);
  const [tab, setTab] = useState<Tab>('definition');
  const [thesaurus, setThesaurus] = useState<ThesaurusCache | null>(null);
  // The editable search-term field's current text. Seeded
  // from the queried word and re-seeded whenever a new result arrives.
  const [editText, setEditText] = useState('');
  // Display-first search-term correction: false = show the
  // search term + a pencil to edit; true = show the editable field
  // + Lookup. Reset to false on every new result so each lookup opens in
  // display mode (the common case — the term needs no correction).
  const [editing, setEditing] = useState(false);
  // Transient clipboard-copy feedback ('idle' until a copy fires, then
  // 'ok'/'fail'). No timer — it clears on a new headword or tab switch so
  // e-ink doesn't flap with a self-reverting label.
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  // Add-definition form (shown from the not-found state). headword is
  // seeded with the queried word; body is the user's definition.
  const [showAddForm, setShowAddForm] = useState(false);
  const [addHeadword, setAddHeadword] = useState('');
  const [addBody, setAddBody] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => subscribe(setState), []);

  // The word the current result was queried for — the edit field's seed.
  const queriedFor =
    state.visible && state.kind === 'result' ? state.result.queriedFor : '';
  useEffect(() => {
    setEditText(queriedFor);
    // A new result opens in display mode (the term is usually right).
    setEditing(false);
    // A new query resets the add-definition form (collapsed, headword
    // re-seeded, body + error cleared).
    setShowAddForm(false);
    setAddHeadword(queriedFor);
    setAddBody('');
    setAddError(null);
  }, [queriedFor]);

  // The canonical headword + its primary source for this result. Used
  // to drive the thesaurus fetch and to detect a NEW headword (which
  // resets the tab to Definition and invalidates the cache).
  const resultHits = state.visible && state.kind === 'result' ? state.result.hits : [];
  const headword = resultHits.length > 0 ? resultHits[0].entry.word : '';
  const primarySource = resultHits.length > 0 ? resultHits[0].source : '';
  const primaryHit = resultHits.length > 0 ? resultHits[0] : null;

  // Tracks the headword we've already started a thesaurus fetch for, so
  // the fetch effect can gate refetch WITHOUT depending on the
  // `thesaurus` state it writes (a self-dependency would re-run the
  // effect on its own setThesaurus). The ref is the fetch-dedup source
  // of truth; `thesaurus` state only drives rendering.
  const fetchedHeadwordRef = useRef<string | null>(null);

  // #32 — the last backdrop-layer ACTION_DOWN as a STAMPED reading
  // {tool, at}, populated by the native observer's onToolDown. Ordering:
  // toolDown fires at ACTION_DOWN, ahead of the backdrop Pressable's
  // onPress (which fires after ACTION_UP) on Paper's FIFO event queue, so
  // the ref is set before onPress reads it; if the native signal never
  // arrives it stays null and shouldDismissOnBackdropTap fails safe (no
  // close). The `at` timestamp is what makes a STALE reading fail safe:
  // the recency gate rejects an old tool value left over from an earlier
  // gesture. It is also a ONE-SHOT: cleared after every press.
  const lastToolTypeRef = useRef<{tool: string; at: number} | null>(null);

  // #37 — last logged region as "WxH", so the probe below fires once per
  // DISTINCT region rather than once per layout. A ref, never state: a
  // setState here would re-render and trigger a second layout pass for a
  // value the component deliberately never reads. See handleBackdropLayout.
  const loggedRegionRef = useRef<string | null>(null);

  // A new headword resets to the Definition tab and drops any cached
  // thesaurus (single-fetch is per-headword). EXCEPT when the result was
  // restored from Settings (Back) carrying an activeTab — then honour it
  // so Back doesn't clobber the tab the user left from (F1-AC2). On a
  // normal lookup activeTab is undefined and we default to 'definition'.
  useEffect(() => {
    const resumedTab =
      state.visible && state.kind === 'result' ? state.activeTab : undefined;
    setTab(resumedTab ?? 'definition');
    setThesaurus(null);
    setCopyStatus('idle');
    fetchedHeadwordRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headword]);

  // EN WordNet senses for the primary hit, memoised by the definition
  // string so assembleThesaurus only re-parses when the body changes.
  const senses = useMemo(() => {
    if (primaryHit && primaryHit.entry.format === 'wordnet') {
      return parseWordNetEntry(primaryHit.entry.definition).senses;
    }
    return [];
  }, [primaryHit]);

  // Lazy single fetch: when the Thesaurus tab is active and we don't
  // yet have this headword cached, call the registered action ONCE.
  // getPopupActions() may be null (not registered) — guard it; the
  // source->lang resolution + und short-circuit live inside the action.
  useEffect(() => {
    // primaryHit === null iff headword === '' (headword derives from it),
    // so guarding on primaryHit covers the no-hit case AND narrows the
    // type so format reads cleanly with no dead fallback branch.
    if (tab !== 'thesaurus' || primaryHit === null) {
      return;
    }
    // Dedup via the ref (NOT the thesaurus state) so this effect never
    // re-fires on its own setThesaurus — one fetch per headword across
    // tab flips. The reset effect clears the ref on a new headword.
    if (fetchedHeadwordRef.current === headword) {
      return;
    }
    const actions = getPopupActions();
    if (actions === null) {
      return; // disabled affordance; never crash
    }
    fetchedHeadwordRef.current = headword;
    const format = primaryHit.entry.format;
    let cancelled = false;
    actions
      .lookupThesaurus(headword, primarySource)
      .then(({omw}) => {
        if (cancelled) {
          return;
        }
        // EN merges senses + OMW; non-EN is OMW-only — assembleThesaurus
        // makes that call from `format` (the action already returned an
        // empty omw for 'und'/empty, so this also yields the empty-state).
        const result = assembleThesaurus(headword, format, senses, omw);
        setThesaurus({headword, result});
      })
      .catch(() => {
        if (!cancelled) {
          setThesaurus({headword, result: {synonyms: [], antonyms: []}});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, headword, primarySource, primaryHit, senses]);

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

  // #32 — the pen-only tap-outside-to-close layer. It sits UNDER the card
  // (rendered as the backdrop's first child) so the card occludes it for
  // inside-card taps; only taps that land OUTSIDE the card reach it. The
  // native observer reports the tool type via onToolDown WITHOUT stealing
  // the touch, and the Pressable's onPress runs the caller's `onDismiss`
  // ONLY for a recent stylus (shouldDismissOnBackdropTap). Parametrised on
  // `onDismiss` so each branch supplies its own non-destructive dismiss:
  // the result view closes (handleClose), the Settings panel goes Back
  // (closeSettings). Returns null off-device (no native component) → no
  // layer, existing behaviour unchanged. This is a SECOND, additive
  // dismiss path — the top-right Close/Back buttons are untouched.
  function renderDismissLayer(
    onDismiss: () => void,
  ): React.JSX.Element | null {
    const PenToolObserver = getPenToolObserver();
    if (PenToolObserver === null) {
      return null;
    }
    return (
      <PenToolObserver
        style={StyleSheet.absoluteFill}
        onToolDown={e => {
          lastToolTypeRef.current = {tool: e.nativeEvent.toolType, at: Date.now()};
        }}
        importantForAccessibility="no-hide-descendants">
        <Pressable
          style={styles.dismissLayer}
          onPress={() => {
            if (shouldDismissOnBackdropTap(lastToolTypeRef.current, Date.now())) {
              onDismiss();
            }
            lastToolTypeRef.current = null;
          }}
        />
      </PenToolObserver>
    );
  }

  const handleSmaller = useCallback(
    () => setFontSize(s => stepDown(s)),
    [],
  );
  const handleLarger = useCallback(
    () => setFontSize(s => stepUp(s)),
    [],
  );

  const handleToggleMaximize = useCallback(() => setMaximized(m => !m), []);

  // #37 — region probe. The popup renders inside a firmware-granted
  // overlay region, NOT the screen: both buttons register regionType:1
  // (center dialog) at 720x540 (registerNoteLassoButton.ts:72-75,
  // registerDocSelectButton.ts:60-63) and the SDK enum documents 2 =
  // fullscreen (NativePluginManager.d.ts:59-65). Whether the firmware
  // honours that request is UNVERIFIED, and it decides whether a
  // percentage-sized "maximized" card actually gains anything. `backdrop`
  // is flex:1 inside the region and onLayout reports its border box
  // (padding included), so this measures the grant directly, in dp.
  //
  // Write-only: the measurement goes to the log and nowhere else. The
  // component must never size itself from this number — the whole point
  // of the percentage/flex geometry is that it needs no device numbers.
  const handleBackdropLayout = useCallback((e: LayoutChangeEvent) => {
    // nativeEvent crosses from native — validate at the boundary.
    const layout = e?.nativeEvent?.layout;
    if (
      !layout ||
      typeof layout.width !== 'number' ||
      typeof layout.height !== 'number'
    ) {
      return;
    }
    const key = `${Math.round(layout.width)}x${Math.round(layout.height)}`;
    // Log once per distinct region: quiet in steady state, but still
    // catches the NOTE-lasso and DOC-selection buttons being granted
    // different regions (they are separate registerButton calls).
    if (loggedRegionRef.current === key) {
      return;
    }
    loggedRegionRef.current = key;
    // console.log, NOT warn/error: the Supernote RN host filters
    // console.warn / console.error out of logcat (index.js:76-77).
    // Single-bracket tag matches the repo convention ([discovery],
    // [settings], [import], [provision]).
    console.log(`[region] view=${key}dp requested=720x540 card=640`);
  }, []);
  const handleDefinitionTab = useCallback(() => {
    setTab('definition');
    setCopyStatus('idle');
  }, []);
  const handleThesaurusTab = useCallback(() => {
    setTab('thesaurus');
    setCopyStatus('idle');
  }, []);
  // Write `text` to the OS clipboard via the native module, reflecting
  // the typed result in the feedback label. Empty text is a no-op (the
  // copy affordance is hidden in that case anyway). getPopupActions-style
  // guarding lives inside copyToClipboard (returns MODULE_MISSING off
  // device); a thrown promise is treated as a failure, never a crash.
  const runCopy = useCallback((text: string) => {
    if (text === '') {
      return;
    }
    copyToClipboard(text)
      .then(result => setCopyStatus(result.success ? 'ok' : 'fail'))
      .catch(() => setCopyStatus('fail'));
  }, []);
  const handleEditOcr = useCallback(() => setEditing(true), []);

  // Re-run the lookup with the corrected search term. Empty/whitespace is
  // a no-op (nothing to look up). getPopupActions() may be null — guard.
  const handleLookUp = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed === '') {
      return;
    }
    const actions = getPopupActions();
    if (actions === null) {
      return;
    }
    actions.relookup(trimmed).catch(() => {
      /* the relookup pipeline surfaces its own failures via showDefinition */
    });
  }, [editText]);

  const handleShowAddForm = useCallback(() => {
    setAddError(null);
    setShowAddForm(true);
  }, []);

  // Save a user definition: local validation (instant inline error),
  // then the addUserEntry action; on success re-run the lookup so the
  // new entry renders as a User hit; a rejected action is a save
  // FAILURE (IO) surfaced inline (Designer flag 2).
  const handleSaveEntry = useCallback(() => {
    const word = addHeadword.trim();
    const body = addBody.trim();
    if (word === '' || body === '') {
      setAddError(t('popup.addEmptyError'));
      return;
    }
    const actions = getPopupActions();
    if (actions === null) {
      setAddError(t('popup.addFailedError'));
      return;
    }
    setAddError(null);
    actions
      .addUserEntry(word, body)
      .then(() => actions.relookup(word))
      .catch(() => {
        setAddError(t('popup.addFailedError'));
      });
  }, [addHeadword, addBody]);

  if (!state.visible) {
    // Zero-size, non-interactive when nothing to show — matches the
    // sn-formula phase-1 pattern that avoids ghost-touching the page.
    return <View pointerEvents="none" style={styles.hidden} />;
  }

  // One card geometry for every visible state, so opening Settings or
  // starting a new lookup never snaps the window between sizes — each
  // snap is a full-screen e-ink repaint.
  const cardStyle = maximized
    ? [styles.card, styles.cardMaximized]
    : styles.card;

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
    // over. The maximize toggle is hidden for the same reason (nothing
    // to maximize, and the state is transient), but the card STYLE is
    // still carried: a maximized user doing a second lookup would
    // otherwise get recognizing (small) then result (large) — two
    // geometry changes and two full repaints for one word of diff.
    return (
      <View style={styles.backdrop} onLayout={handleBackdropLayout}>
        <View style={cardStyle}>
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

  if (state.kind === 'settings') {
    // The Settings panel renders inside the same backdrop + card chrome;
    // SettingsPanel owns the card and the Back button (which restores the
    // stashed result via closeSettings).
    return (
      <View style={styles.backdrop} onLayout={handleBackdropLayout}>
        {renderDismissLayer(closeSettings)}
        <SettingsPanel resume={state.resume} maximized={maximized} />
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
  // Phonetic comes from the first hit that supplies one. Walking the
  // list (rather than strictly hits[0]) means a multi-dict lookup
  // where the first source — say, the base WordNet — has no phonetic
  // but an imported dict does, still surfaces the phonetic in the
  // header. The first wins; later disagreements stay visible per-source
  // in their section bodies.
  const headerPhonetic = hits.find(h => h.entry.phonetic)?.entry.phonetic;
  // Show source badges as soon as we have ≥2 distinct things to show
  // (hits + loading combined), so the layout doesn't reflow when a
  // loading section flips to a hit.
  const showSourceBadges = hits.length + loading.length >= 2;
  const fontScale = FONT_SCALE[fontSize];
  // The HEADWORD's rate — half the body's, and its only consumer.
  //
  // This damping is a HORIZONTAL-SPACE remedy, not a typographic one:
  // the headword shares one un-wrapping row with the control cluster, so
  // at full rate it would reach 56dp at 2X and ellipse a 13-character
  // word inside the Normal card's 392dp of header space. Half-rate caps
  // it at 42, where ~17 characters still fit, while keeping it strictly
  // above the body at every level (1.65x down to 1.24x).
  //
  // Nothing else may borrow it. Body text that merely LOOKS like a
  // heading — the thesaurus section labels — has no width constraint
  // (it sits in the scrolling body and wraps freely), and damping there
  // would shrink it relative to its own list at every level, which is
  // the opposite of what a heading wants.
  //
  // A single derived expression, NOT a second Record<FontSize, number>:
  // one scale table, one damping factor, so the two cannot drift apart.
  const headingScale = 1 + (fontScale - 1) / 2;
  // The editable search-term field is gated on an EXPLICIT
  // editable===true (Designer ruling 4 / flag 5) — never inferred from
  // ocrLabel presence. A caller that omits editable gets the read-only
  // view.
  const isEditable = state.editable === true;
  // The Definition/Thesaurus tab strip is only meaningful once we have
  // a real hit (a headword to fetch a thesaurus for).
  const showTabs = hits.length > 0;
  // Cached thesaurus for THIS headword, or null while it fetches /
  // before the Thesaurus tab is first opened.
  const thesaurusForHeadword =
    thesaurus !== null && thesaurus.headword === headword
      ? thesaurus.result
      : null;
  // Plain text for the active tab's "Copy" action — the on-screen
  // definitions (or thesaurus lists), reduced to clipboard-ready text.
  // '' when there's nothing to copy, which hides the button (hide-don't-
  // grey). The looked-up word copies separately via "Copy word".
  const copyActiveText = buildCopyText({
    tab,
    hits,
    thesaurus: thesaurusForHeadword,
    showSourceBadges,
  });
  // A single "Copy" copies the whole entry: the headword followed by the
  // active tab's visible text (definition or thesaurus). When the active
  // tab has nothing (e.g. an empty thesaurus), it falls back to the word.
  const copyAllText =
    copyActiveText !== '' ? `${headerWord}\n${copyActiveText}` : headerWord;
  const hasThesaurus =
    thesaurusForHeadword !== null &&
    (thesaurusForHeadword.synonyms.length > 0 ||
      thesaurusForHeadword.antonyms.length > 0);
  // At a bound the unusable button greys out instead of hiding, so the
  // header layout never shifts.
  //
  // Derived from the step functions, NOT from literal endpoints: stepUp
  // and stepDown already clamp on FONT_SIZES, so "a size that steps to
  // itself" IS the bound, and FONT_SIZES stays the single source of
  // truth. A hard-coded `fontSize !== 'L'` silently breaks the moment a
  // level is appended — A+ would stay disabled at L and the new level
  // would be permanently unreachable.
  //
  // The step-identity form is preferred over comparing against
  // FONT_SIZES[length - 1] because that would re-derive the clamp rule a
  // second time; this pins the button state to what the buttons actually
  // do, so a future non-linear or skip-a-level step cannot desync the
  // greying from the behaviour.
  const canShrink = stepDown(fontSize) !== fontSize;
  const canGrow = stepUp(fontSize) !== fontSize;

  return (
    <View style={styles.backdrop} onLayout={handleBackdropLayout}>
      {renderDismissLayer(handleClose)}
      <View style={cardStyle}>
        <View style={styles.headerRow}>
          <Text
            style={[
              styles.headerWordWrap,
              ...scaled(styles.word, headingScale),
            ]}
            numberOfLines={1}>
            {headerWord}
          </Text>
          {/* Right-aligned control cluster: the font-size stepper, the
              maximize toggle, then the settings gear pinned to the
              top-right corner of the card. */}
          <View style={styles.headerControls}>
          <View style={styles.fontSizeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('popup.fontSmaller')}
              onPress={handleSmaller}
              disabled={!canShrink}
              style={[
                styles.fontSizeButton,
                !canShrink && styles.fontSizeButtonDisabled,
              ]}>
              <Text
                style={[
                  styles.fontSizeLabel,
                  !canShrink && styles.fontSizeLabelDisabled,
                ]}>
                −
              </Text>
            </Pressable>
            {/* The middle slot shows WHICH level you are on. With five
                levels the greyed end buttons no longer identify M / L /
                XL, and each probe costs a full e-ink repaint. */}
            <View style={styles.fontSizeIndicator}>
              <Text style={styles.fontSizeLabel}>
                {FONT_LEVEL_LABEL[fontSize]}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('popup.fontLarger')}
              onPress={handleLarger}
              disabled={!canGrow}
              style={[
                styles.fontSizeButton,
                !canGrow && styles.fontSizeButtonDisabled,
              ]}>
              <Text
                style={[
                  styles.fontSizeLabel,
                  !canGrow && styles.fontSizeLabelDisabled,
                ]}>
                +
              </Text>
            </Pressable>
          </View>
          {/* #37 — Normal/Maximized window toggle. Reuses the stepper's
              button + label styles: it IS a size control, and the 6dp
              gap groups it with [−][A][+] while the gear keeps its 10dp
              gap as the settings separator. □/▣ are Geometric Shapes,
              the same non-emoji BMP family as the proven ↑↓ ☑☐ ⚙ ✎ —
              single code point, no variation selector. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              maximized ? t('popup.restore') : t('popup.maximize')
            }
            onPress={handleToggleMaximize}
            style={styles.fontSizeButton}>
            <Text style={styles.fontSizeLabel}>{maximized ? '▣' : '□'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.open')}
            onPress={() =>
              showSettings({
                ocrLabel: state.ocrLabel,
                result: state.result,
                editable: state.editable,
                activeTab: tab,
              })
            }
            style={styles.gearButton}>
            <Text style={styles.gearLabel}>⚙</Text>
          </Pressable>
          </View>
        </View>
        {headerPhonetic ? (
          <Text
            style={scaled(styles.phonetic, fontScale)}
            accessibilityLabel={`${t('popup.pronunciation')}: ${headerPhonetic}`}
            numberOfLines={1}>
            {headerPhonetic}
          </Text>
        ) : null}
        {/* Non-editable view: the bare OCR label, unchanged.
            The editable view shows the display/edit row below
            INSTEAD, so the recognized text isn't shown twice. */}
        {state.ocrLabel && !isEditable ? (
          <Text style={styles.ocrLabel}>{state.ocrLabel}</Text>
        ) : null}
        {isEditable ? (
          editing ? (
            // EDIT mode: editable field + Lookup. autoFocus so the caret
            // is ready when the user taps in to correct the word.
            <View style={styles.editRow}>
              <TextInput
                accessibilityLabel={t('popup.ocr')}
                style={styles.editInput}
                value={editText}
                onChangeText={setEditText}
                autoFocus
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('popup.lookUp')}
                onPress={handleLookUp}
                style={styles.lookUpButton}>
                <Text style={styles.lookUpLabel}>{t('popup.lookUp')}</Text>
              </Pressable>
            </View>
          ) : (
            // DISPLAY mode (default): show the search term + a pencil
            // to edit. Tapping the text OR the pencil enters edit mode.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('popup.editOcr')}
              onPress={handleEditOcr}
              style={styles.ocrDisplayRow}>
              <Text style={styles.ocrDisplayText} numberOfLines={1}>
                {editText}
              </Text>
              <View style={styles.pencilButton}>
                <Text style={styles.pencilLabel}>✎</Text>
              </View>
            </Pressable>
          )
        ) : null}
        {showTabs ? (
          <View style={styles.tabRow} accessibilityRole="tablist">
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={t('popup.definition')}
              accessibilityState={{selected: tab === 'definition'}}
              onPress={handleDefinitionTab}
              style={[styles.tab, tab === 'definition' && styles.tabActive]}>
              <Text
                style={[
                  styles.tabLabel,
                  tab === 'definition' && styles.tabLabelActive,
                ]}>
                {t('popup.definition')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={t('popup.thesaurus')}
              accessibilityState={{selected: tab === 'thesaurus'}}
              onPress={handleThesaurusTab}
              style={[styles.tab, tab === 'thesaurus' && styles.tabActive]}>
              <Text
                style={[
                  styles.tabLabel,
                  tab === 'thesaurus' && styles.tabLabelActive,
                ]}>
                {t('popup.thesaurus')}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <ScrollView style={styles.body}>
          {tab === 'thesaurus' && showTabs ? (
            hasThesaurus && thesaurusForHeadword !== null ? (
              <View>
                {thesaurusForHeadword.synonyms.length > 0 ? (
                  <View style={styles.thesaurusGroup}>
                    <Text style={scaled(styles.thesaurusLabel, fontScale)}>
                      {t('popup.synonyms')}
                    </Text>
                    {/* Synonyms are non-tappable (plain text list). */}
                    <Text
                      style={scaled(styles.thesaurusList, fontScale)}>
                      {thesaurusForHeadword.synonyms.join(', ')}
                    </Text>
                  </View>
                ) : null}
                {thesaurusForHeadword.antonyms.length > 0 ? (
                  <View style={styles.thesaurusGroup}>
                    <Text style={scaled(styles.thesaurusLabel, fontScale)}>
                      {t('popup.antonyms')}
                    </Text>
                    <Text
                      style={scaled(styles.thesaurusList, fontScale)}>
                      {thesaurusForHeadword.antonyms.join(', ')}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : thesaurusForHeadword !== null ? (
              // Resolved but empty (und language / no relations) — an
              // empty-state, NOT an error.
              <Text style={styles.notFound}>{t('popup.noThesaurus')}</Text>
            ) : (
              // Still fetching.
              <Text style={styles.loading}>{t('popup.loading')}</Text>
            )
          ) : (
            <>
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
                <>
                  <Text style={styles.notFound}>
                    {`${t('popup.notFoundFor')} "${state.result.queriedFor}".`}
                  </Text>
                  {showAddForm ? (
                    <View style={styles.addForm}>
                      <Text style={styles.addFieldLabel}>
                        {t('popup.headword')}
                      </Text>
                      <TextInput
                        accessibilityLabel={t('popup.headword')}
                        style={styles.addHeadwordInput}
                        value={addHeadword}
                        onChangeText={setAddHeadword}
                      />
                      <Text style={styles.addFieldLabel}>
                        {t('popup.definitionBody')}
                      </Text>
                      <TextInput
                        accessibilityLabel={t('popup.definitionBody')}
                        style={styles.addBodyInput}
                        value={addBody}
                        onChangeText={setAddBody}
                        multiline
                      />
                      {addError !== null ? (
                        <Text style={styles.addError}>{addError}</Text>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('popup.save')}
                        onPress={handleSaveEntry}
                        style={styles.addSaveButton}>
                        <Text style={styles.addSaveLabel}>
                          {t('popup.save')}
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('popup.addDefinition')}
                      onPress={handleShowAddForm}
                      style={styles.addFormButton}>
                      <Text style={styles.addFormButtonLabel}>
                        {t('popup.addDefinition')}
                      </Text>
                    </Pressable>
                  )}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
        <View style={styles.footerRow}>
          <View style={styles.copyActions}>
            {/* One Copy action — copies the word + the visible definition/
                thesaurus text in one go. Hidden when there's nothing to copy. */}
            {hits.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('popup.copy')}
                onPress={() => runCopy(copyAllText)}
                style={styles.copyButton}>
                <Text style={styles.copyLabel}>{t('popup.copy')}</Text>
              </Pressable>
            ) : null}
            {copyStatus !== 'idle' ? (
              <Text style={styles.copyStatus} numberOfLines={1}>
                {copyStatus === 'ok'
                  ? t('popup.copied')
                  : t('popup.copyFailed')}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('popup.close')}
            onPress={handleClose}
            style={styles.closeButton}>
            <Text style={styles.closeLabel}>{t('popup.close')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
