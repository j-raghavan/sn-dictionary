// Shared StyleSheet for the popup and its sub-components. Kept in one
// place so tweaks to the visual language (font sizes, badge borders,
// dividers) don't require touching three files. e-ink-friendly: black
// text + bordered surfaces, no backgrounds beyond white.

import {StyleSheet} from 'react-native';

export const popupStyles = StyleSheet.create({
  hidden: {width: 0, height: 0},
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  // #32 — the transparent pen-only tap-outside-to-close layer. Fills the
  // backdrop UNDER the card (rendered as the backdrop's first child), so
  // the card occludes it for inside-card taps and only outside taps land.
  dismissLayer: {flex: 1},
  card: {
    // FIXED width (not min/max) so the popup is the SAME size on every tab and
    // state. With a min/max range the card sized to its content, so switching
    // Definition <-> Thesaurus (long body vs short synonym list) visibly
    // grew/shrank the window. A fixed width pins it; the body scrolls within.
    width: 640,
    maxHeight: 520,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#000000',
    padding: 20,
  },
  // #37 — the Maximized card geometry. Layered OVER `card` (never
  // instead of it) so border/radius/padding/background stay defined once.
  // width:'100%' overrides card's fixed 640 and flex:1 claims the
  // backdrop's full remaining height. maxHeight:'100%' is LOAD-BEARING:
  // without it, card's maxHeight:520 clamps the flexed height and the
  // card grows no taller than today.
  // NO pixel dimensions — the card fills whatever region the firmware
  // grants, so Nomad (~1404x1872) and Manta (~1920x2560) both work with
  // no device-density lookup and no Dimensions mock in the test suite.
  // The backdrop keeps its padding:24, so a 24dp frame of page stays
  // visible around a "maximized" card — window-manager maximize, not
  // fullscreen (the alioth9 comment on #37).
  cardMaximized: {
    width: '100%',
    maxHeight: '100%',
    flex: 1,
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
  // Phonetic line under the headword. Italic + medium grey so it
  // reads as supplementary chrome (like a real dictionary), not body
  // copy. Sized between the OCR label and the definition body so
  // it's clearly secondary to the headword but still scannable.
  phonetic: {
    marginTop: 2,
    fontSize: 16,
    fontStyle: 'italic',
    color: '#555555',
  },
  body: {
    marginTop: 12,
    marginBottom: 16,
    // #37 — this is a ScrollView, and RN's ScrollView already composes
    // baseVertical = {flexGrow:1, flexShrink:1, overflow:'scroll'} UNDER
    // props.style (ScrollView.js:1734,1842). These two lines restate that
    // default so it is visible at the call site and so the guard test has
    // something to pin; they change nothing on their own.
    //
    // What DOES matter: never write `flex: 1` here. props.style composes OVER
    // baseVertical, so `flex: 1` would replace all three (flexBasis:0%), and
    // inside the Normal card — auto height under maxHeight:520, so Yoga takes
    // the FitContent path and forces remainingFreeSpace to 0 — a basis-0 child
    // grows by nothing and the definition renders at height 0. Verified in
    // Yoga CalculateLayout.cpp:1518-1541. The guard test pins `flex` and
    // `flexBasis` undefined.
    flexGrow: 1,
    flexShrink: 1,
  },
  section: {
    paddingTop: 4,
  },
  sectionDivider: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#bbbbbb',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  // Source-of-definition badge above each section. Bumped from
  // fontSize 14 to 17 + heavier padding so the user can see at a
  // glance which dict produced each definition. e-ink renders solid
  // borders crisply at this size; the previous 14 / 8×3 padding was
  // perceptually faint relative to the 28-pt headword above.
  sourceBadge: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 4,
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
  loading: {
    fontSize: 16,
    color: '#555555',
    fontStyle: 'italic',
  },
  recognizing: {
    fontSize: 18,
    color: '#000000',
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 28,
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
  // Footer action row: copy actions on the left, Close on the right.
  // space-between with an (often empty) left group keeps Close pinned to
  // the right in every state, matching the previous solo-Close layout.
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  // Copy buttons mirror the bordered look of Close / Look up. Hidden
  // (not greyed) when there's nothing to copy — same rule as the rest of
  // the popup chrome.
  copyButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    marginRight: 8,
  },
  copyLabel: {
    fontSize: 16,
    color: '#000000',
  },
  // Transient "Copied" / "Couldn't copy" feedback shown next to the copy
  // buttons after a press. Italic grey so it reads as a status, not an
  // action. Clears on a new headword / tab switch (no timer — e-ink
  // shouldn't flap).
  copyStatus: {
    fontSize: 14,
    color: '#555555',
    fontStyle: 'italic',
    flexShrink: 1,
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
  // Top-of-card row with the headword on the left and the font-size
  // stepper on the right. Chrome, not body text — stepper sizes are
  // NOT scaled by the user's selection.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerWordWrap: {
    // Lets the headword shrink before the stepper does when long
    // words (e.g. de "Wörterbuch") would otherwise push it off-screen.
    flexShrink: 1,
    marginRight: 12,
  },
  // Right-aligned header control cluster: the font-size stepper, then the
  // settings gear pinned to the top-right corner. space-between in headerRow
  // pushes this whole group to the right edge.
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Settings gear button — same 32×32 circular bordered touch target as
  // the font-size −/+ glyph buttons (crisp on e-ink; no emoji, no PNG).
  // marginLeft separates it from the stepper; it is the rightmost element
  // so the header reads [headword] … [−][A][+][□] [⚙] — gear in the corner.
  gearButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  gearLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 20,
  },
  // Settings-Panel header: the title on the left, a Back button on the
  // right — same space-between layout as the result header row.
  settingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // The panel title — like the headword `word` but a step smaller, since
  // it's chrome rather than the looked-up term.
  settingsTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
  },
  // Back button mirrors the bordered Close button.
  settingsBackButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
  },
  settingsBackLabel: {
    fontSize: 16,
    color: '#000000',
  },
  // Save + Back sit together on the right of the header.
  settingsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Inline save outcome shown left of the Save button — italic grey so it
  // reads as a status, not an action (mirrors the popup's copyStatus). Replaces
  // the old two-"Close"-button RattaDialog confirmation. marginRight separates
  // it from Save; flexShrink lets it yield before the buttons on a narrow card.
  settingsSaveStatus: {
    fontSize: 14,
    color: '#555555',
    fontStyle: 'italic',
    flexShrink: 1,
    marginRight: 12,
  },
  // The failure variant keeps the same footprint but in solid black so a
  // "Couldn't save settings" reads as a problem the user must act on.
  settingsSaveStatusError: {
    color: '#000000',
    fontStyle: 'normal',
    fontWeight: '700',
  },
  // Save: a filled (black) button when there are unsaved edits, greyed/
  // outlined when clean or mid-save — so "enabled only when changed" reads at
  // a glance on e-ink. Sits just left of Back (marginRight gap).
  settingsSaveButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    backgroundColor: '#000000',
    marginRight: 10,
  },
  settingsSaveButtonDisabled: {
    backgroundColor: '#FFFFFF',
    borderColor: '#AAAAAA',
  },
  settingsSaveLabel: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  settingsSaveLabelDisabled: {
    color: '#AAAAAA',
  },
  // Placeholder body copy until F4/F5/F7 fill the rest of the panel in.
  settingsPlaceholder: {
    marginTop: 16,
    fontSize: 16,
    color: '#555555',
  },
  // --- F3 dictionary manager -----------------------------------------
  // Section heading above the dictionary list.
  // Section header inside the Settings panel — a small uppercase label with
  // a hairline divider, grouping the panel into Dictionaries / Import
  // sources / Backup. Shared by SettingsPanel + ExportSection.
  settingsSectionTitle: {
    marginTop: 18,
    marginBottom: 6,
    paddingBottom: 4,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#555555',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  // Scrollable settings body, below the fixed title + Back header.
  settingsBody: {
    marginTop: 4,
    // #37 — also a ScrollView, so as with `body` these restate RN's own
    // baseVertical default and are inert. See the note there for the trap
    // they mark: `flex: 1` here would collapse the panel body to height 0.
    flexGrow: 1,
    flexShrink: 1,
  },
  // One dictionary row: a tappable checkbox+name on the left, the reorder /
  // remove controls on the right.
  dictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  // The whole checkbox + name is one tap target (toggles enable/disable).
  dictToggleTap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    paddingVertical: 4,
  },
  // ☑ / ☐ enable glyph — a dingbat (crisp on e-ink), not an emoji.
  dictCheckbox: {
    fontSize: 22,
    color: '#000000',
    marginRight: 12,
    lineHeight: 24,
  },
  // A disabled dict greys out; the checkbox shows the off-state.
  dictName: {
    fontSize: 17,
    color: '#000000',
    flexShrink: 1,
  },
  dictNameDisabled: {
    color: '#999999',
  },
  // The right-side control cluster (move arrows + Remove).
  dictRowControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Circular move-up/down buttons — same 32×32 e-ink target as the
  // font-size stepper. Hidden (not greyed) at the top/bottom bound and
  // entirely when there is only one dictionary.
  dictArrowButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  dictArrowLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 20,
  },
  // Remove (imported dicts only) — a bordered text button, set slightly
  // apart so it isn't mistaken for a move arrow.
  removeButton: {
    marginLeft: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
  },
  removeButtonLabel: {
    fontSize: 14,
    color: '#000000',
  },
  // The all-disabled warning banner (F3-FR5).
  settingsWarning: {
    marginTop: 10,
    marginBottom: 4,
    fontSize: 14,
    color: '#000000',
    fontWeight: '700',
  },
  // --- F4 keep-sources toggle (a checkbox row) -----------------------
  // The label + hint sit to the right of the shared checkbox glyph.
  settingsToggleLabelCol: {
    flexShrink: 1,
    paddingRight: 12,
  },
  settingsToggleLabel: {
    fontSize: 17,
    color: '#000000',
  },
  settingsToggleHint: {
    marginTop: 2,
    fontSize: 13,
    color: '#777777',
  },
  // --- F5 export section ----------------------------------------------
  // The current export-target path, shown above the folder list.
  exportTargetLabel: {
    marginTop: 4,
    marginBottom: 8,
    fontSize: 14,
    color: '#000000',
  },
  // One navigable subfolder row in the chooser (full-width tappable).
  exportFolderRow: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  exportFolderRowLabel: {
    fontSize: 15,
    color: '#000000',
  },
  // The action-button row under the chooser (New folder + Export).
  exportActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  // A primary action button (Export / New folder / Use this folder).
  exportButton: {
    marginRight: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
  },
  exportButtonLabel: {
    fontSize: 14,
    color: '#000000',
  },
  // The post-export/restore result — a prominent bordered banner directly
  // below the action buttons (the can't-miss surface now that the modal is
  // gone). Bold black text in a boxed surface so a result can't be mistaken
  // for body chrome on a scrolled e-ink panel.
  exportSummary: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: '#000000',
    borderRadius: 4,
  },
  // Body-text size selector: three circular elements in a row,
  // ( − )( S )( + ). The outer two are Pressables; the middle shows the
  // CURRENT level (S / M / L / XL / 2X) — with five levels the greyed
  // ends no longer identify which one you are on. The − and + glyphs
  // carry the "text size" anchor the old static "A" used to.
  // Same paradigm as every browser zoom control, PDF / image
  // viewer, etc. — universally recognised, direction unambiguous.
  // At a bound the unusable button greys out instead of hiding so
  // the layout never shifts.
  fontSizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fontSizeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  fontSizeButtonDisabled: {
    borderColor: '#999999',
  },
  // The middle indicator is structurally a Text with no border — it
  // sits between the two Pressables but isn't itself one. Keeps the
  // touch targets unambiguous (only − and + are pressable).
  // It carries the current level label, which is bounded to TWO
  // capitals so it fits: at fontSize 18 two caps measure ~21dp inside
  // this 32dp box, while three ("XXL") measure ~32dp and would fill it
  // exactly and spill toward the + circle. That is why the top level
  // renders as "2X".
  fontSizeIndicator: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  fontSizeLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 20,
  },
  fontSizeLabelDisabled: {
    color: '#999999',
  },
  // Definition / Thesaurus tab strip below the header. Two pressable
  // tabs; the active one carries a heavier underline (e-ink renders a
  // solid border far more clearly than a fill or colour shift).
  tabRow: {
    flexDirection: 'row',
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#bbbbbb',
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginRight: 8,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#000000',
  },
  tabLabel: {
    fontSize: 16,
    color: '#555555',
  },
  tabLabelActive: {
    color: '#000000',
    fontWeight: '700',
  },
  // Thesaurus view: a labelled block per relation kind.
  thesaurusGroup: {
    marginTop: 12,
  },
  thesaurusLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 4,
  },
  thesaurusList: {
    fontSize: 17,
    lineHeight: 24,
    color: '#000000',
  },
  // Search-term correction row: an editable text field + a
  // "Look up" button to re-run the lookup on the corrected word.
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  // Display mode for the search-term correction field: the
  // recognized word on the left, a pencil glyph on the right. Tapping
  // the whole row enters edit mode. Read-first so the user isn't
  // confronted with an edit field when the recognition was correct.
  ocrDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  ocrDisplayText: {
    flexShrink: 1,
    fontSize: 18,
    color: '#555555',
    marginRight: 8,
  },
  // Pencil glyph button — same 32×32 circular touch target as the
  // font-size −/+ glyph buttons (crisp on e-ink; no emoji, no PNG).
  pencilButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pencilLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 20,
  },
  editInput: {
    flex: 1,
    fontSize: 18,
    color: '#000000',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  lookUpButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
  },
  lookUpLabel: {
    fontSize: 16,
    color: '#000000',
  },
  // Add-definition form (revealed from the not-found state).
  addFormButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
  },
  addFormButtonLabel: {
    fontSize: 16,
    color: '#000000',
  },
  addForm: {
    marginTop: 12,
  },
  addFieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 4,
    marginTop: 8,
  },
  addHeadwordInput: {
    fontSize: 18,
    color: '#000000',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addBodyInput: {
    fontSize: 17,
    color: '#000000',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 96,
    textAlignVertical: 'top',
  },
  addError: {
    marginTop: 8,
    fontSize: 14,
    color: '#000000',
    fontStyle: 'italic',
  },
  addSaveButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
  },
  addSaveLabel: {
    fontSize: 16,
    color: '#000000',
  },
});

// Body text the user can enlarge with A− / A+. `fontSize` alone is NOT
// enough: every scalable body style also carries a fixed `lineHeight`
// (definition 24, example 22, synonyms 20), and Roboto's line box is
// 1.171em — so at L the definition is 17*1.5 = 25.5dp of type inside a
// 24dp line box and consecutive lines collide. Scaling both keeps the
// leading ratio constant at every level.
//
// The `lineHeight === undefined` branch is LOAD-BEARING, not a nicety:
// returning `{lineHeight: undefined}` would be composed OVER the base
// style by StyleSheet.flatten (and by Object.assign in the test's
// `flatten` helper) and would ERASE a lineHeight the base did define.
// Emit the key only when there is a value for it.
//
// Takes the STYLE OBJECT rather than a bare number, which is what makes
// fontSize and lineHeight travel together and removes the
// `styles.X.fontSize` repetition from every call site.
//
// Prefer `scaled` below over calling this directly: RN composes a style
// array left-to-right, so a scaled result placed anywhere but LAST is
// silently overridden by the base and that element quietly stops
// scaling — with no error, and (as a mutation sweep showed) with the
// whole suite still green. `scaled` owns the composition so there is no
// order left to get wrong.
type ScalableText = {fontSize: number; lineHeight?: number};

export const scaleText = (base: ScalableText, scale: number): ScalableText =>
  base.lineHeight === undefined
    ? {fontSize: base.fontSize * scale}
    : {fontSize: base.fontSize * scale, lineHeight: base.lineHeight * scale};

// The style array for a scalable text element: the base, then its scaled
// sizes, in the only order that works. Use this at every call site whose
// registered style IS the style being scaled — which is all of them
// except the two synonym LABELS, where the element deliberately renders
// `synonymsLabel` (weight + colour, no size of its own) at `synonyms`'
// size; those two keep an explicit array and are covered by tests
// instead.
export const scaled = (base: ScalableText, scale: number): ScalableText[] => [
  base,
  scaleText(base, scale),
];
