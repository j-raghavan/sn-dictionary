module.exports = {
  preset: 'react-native',
  passWithNoTests: true,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    // Pure-types files have no executable code; istanbul reports
    // them as 0/0 but listing them still adds noise to the table.
    '!src/sdk/types.ts',
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
