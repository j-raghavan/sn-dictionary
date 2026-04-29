module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: [
    'coverage/',
    'build/',
    'node_modules/',
    // Auto-generated; ~16MB of base64 string literals — ESLint chokes
    // (Maximum call stack on no-octal-escape) and there's nothing
    // useful to lint anyway.
    'src/core/dict/data/baseDictData.ts',
  ],
};
