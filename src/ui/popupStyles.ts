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
    marginBottom: 8,
  },
  sourceBadge: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 3,
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
});
