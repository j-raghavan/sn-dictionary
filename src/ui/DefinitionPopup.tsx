import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {
  getCurrentState,
  getPopupActions,
  hideDefinition,
  subscribe,
  type PopupState,
} from './popupController';
import {SourceSection} from './SourceSection';
import {popupStyles as styles} from './popupStyles';
import {t} from '../i18n/i18n';
import {parseWordNetEntry} from './wordnetFormatter';
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
  const [tab, setTab] = useState<Tab>('definition');
  const [thesaurus, setThesaurus] = useState<ThesaurusCache | null>(null);
  // The OCR-correction field's current text (lasso flow only). Seeded
  // from the queried word and re-seeded whenever a new result arrives.
  const [editText, setEditText] = useState('');
  // Add-definition form (shown from the not-found state). headword is
  // seeded with the queried word; body is the user's definition.
  const [showAddForm, setShowAddForm] = useState(false);
  const [addHeadword, setAddHeadword] = useState('');
  const [addBody, setAddBody] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => subscribe(setState), []);

  // The word the current result was queried for — the OCR field's seed.
  const queriedFor =
    state.visible && state.kind === 'result' ? state.result.queriedFor : '';
  useEffect(() => {
    setEditText(queriedFor);
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

  // A new headword resets to the Definition tab and drops any cached
  // thesaurus (single-fetch is per-headword).
  useEffect(() => {
    setTab('definition');
    setThesaurus(null);
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
    if (thesaurus !== null && thesaurus.headword === headword) {
      return; // cache hit — no refetch across tab flips
    }
    const actions = getPopupActions();
    if (actions === null) {
      return; // disabled affordance; never crash
    }
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
  }, [tab, headword, primarySource, primaryHit, senses, thesaurus]);

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
  const handleDefinitionTab = useCallback(() => setTab('definition'), []);
  const handleThesaurusTab = useCallback(() => setTab('thesaurus'), []);

  // Re-run the lookup with the corrected OCR text. Empty/whitespace is
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
  // Phonetic comes from the first hit that supplies one. Walking the
  // list (rather than strictly hits[0]) means a multi-dict lookup
  // where the first source — say, WordNet — has no phonetic but a
  // user CSV does, still surfaces the phonetic in the header. The
  // first wins; later disagreements stay visible per-source in their
  // section bodies.
  const headerPhonetic = hits.find(h => h.entry.phonetic)?.entry.phonetic;
  // Show source badges as soon as we have ≥2 distinct things to show
  // (hits + loading combined), so the layout doesn't reflow when a
  // loading section flips to a hit.
  const showSourceBadges = hits.length + loading.length >= 2;
  const fontScale = FONT_SCALE[fontSize];
  // OCR-correction field shows ONLY in the lasso flow, gated on an
  // EXPLICIT editable===true (Designer ruling 4 / flag 5) — never
  // inferred from ocrLabel presence. doc-select omits editable and so
  // gets the read-only view.
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
  const hasThesaurus =
    thesaurusForHeadword !== null &&
    (thesaurusForHeadword.synonyms.length > 0 ||
      thesaurusForHeadword.antonyms.length > 0);
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
            <View style={styles.fontSizeIndicator}>
              <Text style={styles.fontSizeLabel}>A</Text>
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
        </View>
        {headerPhonetic ? (
          <Text
            style={[
              styles.phonetic,
              {fontSize: styles.phonetic.fontSize * fontScale},
            ]}
            accessibilityLabel={`${t('popup.pronunciation')}: ${headerPhonetic}`}
            numberOfLines={1}>
            {headerPhonetic}
          </Text>
        ) : null}
        {state.ocrLabel ? (
          <Text style={styles.ocrLabel}>{state.ocrLabel}</Text>
        ) : null}
        {isEditable ? (
          <View style={styles.editRow}>
            <TextInput
              accessibilityLabel={t('popup.ocr')}
              style={styles.editInput}
              value={editText}
              onChangeText={setEditText}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('popup.lookUp')}
              onPress={handleLookUp}
              style={styles.lookUpButton}>
              <Text style={styles.lookUpLabel}>{t('popup.lookUp')}</Text>
            </Pressable>
          </View>
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
                    <Text style={styles.thesaurusLabel}>
                      {t('popup.synonyms')}
                    </Text>
                    {/* Synonyms are non-tappable (plain text list). */}
                    <Text
                      style={[
                        styles.thesaurusList,
                        {fontSize: styles.thesaurusList.fontSize * fontScale},
                      ]}>
                      {thesaurusForHeadword.synonyms.join(', ')}
                    </Text>
                  </View>
                ) : null}
                {thesaurusForHeadword.antonyms.length > 0 ? (
                  <View style={styles.thesaurusGroup}>
                    <Text style={styles.thesaurusLabel}>
                      {t('popup.antonyms')}
                    </Text>
                    <Text
                      style={[
                        styles.thesaurusList,
                        {fontSize: styles.thesaurusList.fontSize * fontScale},
                      ]}>
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
