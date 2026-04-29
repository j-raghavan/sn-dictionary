import {mockLookup} from '../src/core/lookup';

describe('mockLookup', () => {
  test('returns entry for known word', async () => {
    const result = await mockLookup.lookup('hello');
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.entry.word).toBe('hello');
      expect(result.entry.definition).toMatch(/greeting/i);
    }
  });

  test('normalizes case and whitespace', async () => {
    const result = await mockLookup.lookup('  WORLD  ');
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.entry.word).toBe('world');
    }
  });

  test('returns not-found for unknown word, preserving original input', async () => {
    const result = await mockLookup.lookup('xenoglossy');
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.queriedFor).toBe('xenoglossy');
    }
  });

  test('treats empty input as not-found', async () => {
    const result = await mockLookup.lookup('   ');
    expect(result.found).toBe(false);
  });
});
