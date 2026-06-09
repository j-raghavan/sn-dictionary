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
  card: {
    minWidth: 480,
    maxWidth: 640,
    maxHeight: 520,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#000000',
    padding: 20,
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
  // Settings gear button — same 32×32 circular bordered touch target as
  // the font-size −/+ glyph buttons (crisp on e-ink; no emoji, no PNG).
  // marginRight nudges it left of the stepper so the header reads
  // [headword] … [⚙][−][A][+].
  gearButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
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
  // Placeholder body copy until F4/F5/F7 fill the rest of the panel in.
  settingsPlaceholder: {
    marginTop: 16,
    fontSize: 16,
    color: '#555555',
  },
  // --- F3 dictionary manager -----------------------------------------
  // Section heading above the dictionary list.
  settingsSectionTitle: {
    marginTop: 16,
    marginBottom: 4,
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  // One dictionary row: name on the left, controls on the right.
  dictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#DDDDDD',
  },
  // Name + language badge column (takes the remaining width).
  dictRowLabel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Disabled dicts render dimmed (the toggle still flips them back) — the
  // text itself, NOT a hidden row (hide-don't-grey applies to the move
  // arrows, not to enablement which needs a visible off-state).
  dictName: {
    fontSize: 16,
    color: '#000000',
  },
  dictNameDisabled: {
    color: '#999999',
  },
  // The control cluster on the right (toggle + the two move arrows).
  dictRowControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // A bordered tappable control (toggle + move arrows share the look).
  dictControl: {
    marginLeft: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
  },
  dictControlLabel: {
    fontSize: 14,
    color: '#000000',
  },
  // Fixed-width spacer that reserves the move-arrow slot on the top/bottom
  // rows where one direction is hidden, so rows don't reflow (hide-don't-
  // grey without a layout jump).
  dictControlSpacer: {
    marginLeft: 6,
    width: 44,
  },
  // The all-disabled warning banner (F3-FR5).
  settingsWarning: {
    marginTop: 12,
    fontSize: 14,
    color: '#000000',
    fontWeight: '700',
  },
  // --- F4 keep-sources toggle ----------------------------------------
  // One settings row: label + hint on the left, a toggle control on the
  // right (same bordered-control look as the dictionary manager).
  settingsToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  settingsToggleLabelCol: {
    flex: 1,
    paddingRight: 12,
  },
  settingsToggleLabel: {
    fontSize: 16,
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
  // The post-export result summary line.
  exportSummary: {
    marginTop: 12,
    fontSize: 14,
    color: '#000000',
  },
  // Body-text size selector: three circular elements in a row,
  // ( − )( A )( + ). The outer two are Pressables; the middle is a
  // static "A" indicator that anchors the meaning to "text size".
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
  // OCR-correction row (lasso flow): an editable text field + a
  // "Look up" button to re-run the lookup on the corrected word.
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  // Display mode for the OCR-correction field (lasso flow): the
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
