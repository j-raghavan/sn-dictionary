module.exports = {
  preset: 'react-native',
  passWithNoTests: true,
  // __tests__/_helpers/* are shared test utilities (not test suites).
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/_helpers/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    // Pure-types files have no executable code; istanbul reports
    // them as 0/0 but listing them still adds noise to the table.
    '!src/sdk/types.ts',
    '!src/core/lookup.ts',
    // Auto-generated base dictionary data — regenerable from
    // dict/wordnet/ via `npm run build:dict`. Not covered by tests
    // by design; the StarDict reader's behaviour is exercised
    // exhaustively against synthetic and placeholder fixtures.
    '!src/core/dict/data/baseDictData.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 97,
      branches: 97,
      functions: 97,
      lines: 97,
    },
  },
};
