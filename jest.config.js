module.exports = {
  preset: 'react-native',
  passWithNoTests: true,
  // __tests__/_helpers/* are shared test utilities (not test suites).
  // __tests__/integration/manifest.ts is the typed data manifest for
  // the integration suite — a sibling to the test file, not a suite
  // itself; jest's default testMatch glob ('__tests__/**') would
  // otherwise try to load it as a (zero-test) suite and fail.
  // The actual integration test file (wikdictRegression.test.ts) is
  // NOT excluded — it gates on SNDICT_INTEGRATION=1 internally and
  // describe.skip's when the var is missing, so `npm test` runs it
  // in ~ms (all skipped).
  testPathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/_helpers/',
    '/__tests__/integration/manifest\\.ts$',
  ],
  // Integration tests exercise the full StarDict→htmlToPlainText
  // pipeline against real downloaded dicts (run only via
  // `npm run test:integration`). They are an end-to-end gate, not a
  // coverage source — exclude from coverage measurement so they
  // can't skew the unit-test gate either way.
  // rnSqliteDb.ts is the on-device SqliteDb adapter — it imports the
  // react-native-sqlite-storage native module, which isn't bound off
  // the device, so it cannot run under jest. It is DEVICE-UNVERIFIED
  // and deliberately kept thin; its behaviour is mirrored by the host
  // better-sqlite3 adapter that the sqlite suites exercise.
  // Device-only adapters import native modules unbound off the device,
  // so they can't run under jest. They are DEVICE-UNVERIFIED, kept
  // thin, and mirrored by host adapters / pure decision logic that the
  // sqlite suites exercise.
  coveragePathIgnorePatterns: [
    '/__tests__/integration/',
    '/src/core/dict/sqlite/rnSqliteDb\\.ts$',
    '/src/core/dict/sqlite/provisionRnPorts\\.ts$',
    '/src/core/dict/sqlite/importRnPorts\\.ts$',
    '/src/core/dict/sqlite/importCsvRnPorts\\.ts$',
    '/src/core/dict/sqlite/nativeImport\\.ts$',
    // Device-only clipboard bridge — touches NativeModules.SnDictClipboard
    // (unbound off-device); the copy reducer + popup handlers are
    // host-tested with it mocked.
    '/src/native/clipboard\\.ts$',
    // Device-only pen-tool observer shim — requireNativeComponent isn't
    // bound off-device; the dismiss policy (shouldDismissOnBackdropTap)
    // and the popup wiring are host-tested with it mocked.
    '/src/native/penToolObserver\\.ts$',
  ],
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
