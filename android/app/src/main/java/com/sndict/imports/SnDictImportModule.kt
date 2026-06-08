package com.sndict.imports

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

// DEVICE-UNVERIFIED. React Native bridge for the native StarDict
// importer. The ENTIRE parse+insert runs on a private single-thread
// executor — NEVER the JS/main thread — so a multi-hundred-thousand
// entry import doesn't freeze Hermes (the whole point of ADR-0006).
class SnDictImportModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  // One dedicated worker thread; imports are serialized (a user
  // sideloads one dict at a time).
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "SnDictImport"

  @ReactMethod
  fun importStardict(
    ifoPath: String,
    idxPath: String,
    dictPath: String,
    synPath: String?,
    dbPath: String,
    format: String?,
    promise: Promise,
  ) {
    // A RELATIVE dbPath (e.g. "plugins/<id>/foo.db") is resolved under
    // the host's files dir — the SAME getFilesDir()+location+name the
    // SQLite plugin resolves for {name, location}, so JS stays
    // getFilesDir-free. An absolute path passes through unchanged.
    val resolvedDbPath = if (dbPath.startsWith("/")) {
      dbPath
    } else {
      java.io.File(reactApplicationContext.filesDir, dbPath).absolutePath
    }
    executor.execute {
      try {
        val count = StarDictImporter.run(
          ifoPath = ifoPath,
          idxPath = idxPath,
          dictPath = dictPath,
          synPath = synPath,
          dbPath = resolvedDbPath,
          formatOverride = format,
        )
        promise.resolve(count)
      } catch (e: Exception) {
        promise.reject("IMPORT_FAILED", e.message, e)
      }
    }
  }
}
