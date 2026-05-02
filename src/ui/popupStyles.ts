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
  // Body-text size stepper (NN/g input-stepper pattern): one
  // bordered widget visually, two stacked touch zones internally.
  // The top half scales body text up; the bottom half scales it
  // down. Arrows hide (not the whole zone) at the bounds so the
  // widget's outer dimensions stay constant — no layout shift on
  // press, no greyed-out states on e-ink.
  fontStepper: {
    width: 44,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 6,
    overflow: 'hidden',
  },
  fontStepperHalf: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fontStepperDivider: {
    height: 1,
    backgroundColor: '#000000',
  },
  fontStepperArrow: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 14,
  },
});
