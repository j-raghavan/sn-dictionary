// React Native CLI / autolinking config.
//
// Exclude @react-native-async-storage/async-storage from ANDROID
// autolinking. The plugin does NOT use AsyncStorage's native module:
// per ADR-0001 the persistence path is native SQLite
// (react-native-sqlite-storage), and AsyncStorage's native module was
// always unbound on the Supernote host (it degraded to in-memory — the
// very problem the SQLite pivot fixes). The dependency only lingers as
// a lazy `require` inside the now-disused old-engine module
// `src/core/dict/indexCacheStorage.ts` (retained as revert-safety until
// the on-device spike passes; full removal is the documented post-spike
// cleanup). Without this exclusion, RN autolinking pulls AsyncStorage
// v3's KMP-split Android artifact (`org.asyncstorage.shared_storage:
// storage-android`) into the custom-APK build, which fails to resolve
// and breaks `buildCustomApkDebug`. The JS shim stays available for the
// retained module + its unit tests; only the Android native module is
// skipped.
module.exports = {
  dependencies: {
    '@react-native-async-storage/async-storage': {
      platforms: {
        android: null,
      },
    },
  },
};
