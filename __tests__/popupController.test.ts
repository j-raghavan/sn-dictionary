import {
  showDefinition,
  showRecognizing,
  hideDefinition,
  showSettings,
  closeSettings,
  subscribe,
  getCurrentState,
  setPopupActions,
  getPopupActions,
  type PopupActions,
  type ResultSnapshot,
  __testing__,
} from '../src/ui/popupController';

beforeEach(() => {
  __testing__.reset();
});

describe('popupController', () => {
  test('initial state is invisible via getCurrentState', () => {
    expect(getCurrentState()).toEqual({visible: false});
  });

  test('subscribe does not eager-fire (avoids React commit-phase setState warning)', () => {
    const seen: unknown[] = [];
    subscribe(s => seen.push(s));
    expect(seen).toEqual([]);
  });

  test('showDefinition broadcasts visible state with kind=result and updates current', () => {
    const seen: unknown[] = [];
    subscribe(s => seen.push(s));
    showDefinition(
      {
        queriedFor: 'hello',
        hits: [{source: 'WordNet', entry: {word: 'hello', definition: 'greeting'}}],
        loading: [],
      },
      'OCR: hello',
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      visible: true,
      kind: 'result',
      ocrLabel: 'OCR: hello',
      result: {
        queriedFor: 'hello',
        hits: [{source: 'WordNet', entry: {word: 'hello', definition: 'greeting'}}],
        loading: [],
      },
    });
    expect(getCurrentState()).toEqual(seen[0]);
  });

  test('showRecognizing broadcasts visible state with kind=recognizing and no result', () => {
    const seen: unknown[] = [];
    subscribe(s => seen.push(s));
    showRecognizing();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({visible: true, kind: 'recognizing'});
  });

  test('showRecognizing carries an OCR label when supplied', () => {
    const seen: unknown[] = [];
    subscribe(s => seen.push(s));
    showRecognizing('OCR: hi');
    expect(seen[0]).toEqual({
      visible: true,
      kind: 'recognizing',
      ocrLabel: 'OCR: hi',
    });
  });

  test('a recognizing-state can be replaced by a result-state without an interim hide', () => {
    const seen: unknown[] = [];
    subscribe(s => seen.push(s));
    showRecognizing();
    showDefinition(
      {queriedFor: 'hi', hits: [], loading: []},
      'OCR: hi',
    );
    expect(seen).toHaveLength(2);
    expect((seen[0] as {kind: string}).kind).toBe('recognizing');
    expect((seen[1] as {kind: string}).kind).toBe('result');
  });

  test('hideDefinition broadcasts not-visible state', () => {
    showDefinition({
      queriedFor: 'a',
      hits: [{source: 'WordNet', entry: {word: 'a', definition: 'b'}}],
      loading: [],
    });
    const seen: unknown[] = [];
    subscribe(s => seen.push(s));
    hideDefinition();
    expect(seen[seen.length - 1]).toEqual({visible: false});
  });

  test('unsubscribe stops further notifications', () => {
    const seen: unknown[] = [];
    const unsub = subscribe(s => seen.push(s));
    unsub();
    showDefinition({queriedFor: 'x', hits: [], loading: []});
    expect(seen).toEqual([]);
  });

  test('showDefinition carries editable=true when requested (lasso flow)', () => {
    const seen: Array<{editable?: boolean}> = [];
    subscribe(s => seen.push(s as {editable?: boolean}));
    showDefinition({queriedFor: 'x', hits: [], loading: []}, 'OCR: x', true);
    expect(seen[0].editable).toBe(true);
  });

  test('showDefinition omits editable when not requested (doc-select flow)', () => {
    const seen: Array<{editable?: boolean}> = [];
    subscribe(s => seen.push(s as {editable?: boolean}));
    showDefinition({queriedFor: 'x', hits: [], loading: []});
    expect(seen[0].editable).toBeUndefined();
  });
});

describe('popupController — settings panel (F1)', () => {
  const snapshot: ResultSnapshot = {
    ocrLabel: 'OCR: happy',
    result: {
      queriedFor: 'happy',
      hits: [
        {
          source: 'WordNet',
          entry: {word: 'happy', definition: 'joy', format: 'plain'},
        },
      ],
      loading: [],
    },
    editable: true,
    activeTab: 'thesaurus',
  };

  test('showSettings(snapshot) emits the settings kind carrying the resume', () => {
    const seen: unknown[] = [];
    subscribe(s => seen.push(s));
    showSettings(snapshot);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      visible: true,
      kind: 'settings',
      resume: snapshot,
    });
    expect(getCurrentState()).toEqual(seen[0]);
  });

  test('showSettings() with no snapshot leaves resume undefined', () => {
    const seen: unknown[] = [];
    subscribe(s => seen.push(s));
    showSettings();
    expect(seen[0]).toEqual({visible: true, kind: 'settings', resume: undefined});
  });

  test('closeSettings re-emits the stashed result incl. its activeTab', () => {
    showSettings(snapshot);
    const seen: unknown[] = [];
    subscribe(s => seen.push(s));
    closeSettings();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      visible: true,
      kind: 'result',
      ocrLabel: 'OCR: happy',
      result: snapshot.result,
      editable: true,
      activeTab: 'thesaurus',
    });
  });

  test('closeSettings with no resume hides the popup', () => {
    showSettings(); // no snapshot
    const seen: unknown[] = [];
    subscribe(s => seen.push(s));
    closeSettings();
    expect(seen[0]).toEqual({visible: false});
  });

  test('closeSettings when not in the settings state hides the popup', () => {
    showDefinition({queriedFor: 'x', hits: [], loading: []});
    closeSettings();
    expect(getCurrentState()).toEqual({visible: false});
  });
});

describe('popupController — actions registry', () => {
  const fakeActions: PopupActions = {
    lookupThesaurus: async () => ({lang: 'en', omw: {synonyms: [], antonyms: []}}),
    addUserEntry: async () => undefined,
    relookup: async () => undefined,
  };

  test('getPopupActions is null before registration', () => {
    expect(getPopupActions()).toBeNull();
  });

  test('setPopupActions registers, getPopupActions returns them', () => {
    setPopupActions(fakeActions);
    expect(getPopupActions()).toBe(fakeActions);
  });

  test('__testing__.reset nulls the registered actions (test isolation)', () => {
    setPopupActions(fakeActions);
    expect(getPopupActions()).toBe(fakeActions);
    __testing__.reset();
    expect(getPopupActions()).toBeNull();
  });
});
