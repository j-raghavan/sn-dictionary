import {
  showDefinition,
  hideDefinition,
  subscribe,
  getCurrentState,
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

  test('showDefinition broadcasts visible state with result and updates current', () => {
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
      ocrLabel: 'OCR: hello',
      result: {
        queriedFor: 'hello',
        hits: [{source: 'WordNet', entry: {word: 'hello', definition: 'greeting'}}],
        loading: [],
      },
    });
    expect(getCurrentState()).toEqual(seen[0]);
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
});
