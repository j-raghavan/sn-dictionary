module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: [
    'coverage/',
    'build/',
    'node_modules/',
    // Vendored third-party native module (react-native-sqlite-storage,
    // org.pgsqlite) copied verbatim under node_change/ for the custom-APK
    // build. Not our code to lint or style.
    'node_change/',
    // Auto-generated; ~16MB of base64 string literals — ESLint chokes
    // (Maximum call stack on no-octal-escape) and there's nothing
    // useful to lint anyway.
    'src/core/dict/data/baseDictData.ts',
  ],
};
