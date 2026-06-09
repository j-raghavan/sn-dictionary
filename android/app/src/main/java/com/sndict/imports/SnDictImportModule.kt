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

  // Resolve a path the way the SQLite engine does: an ABSOLUTE path
  // (starting with '/') is used as-is; a RELATIVE one — e.g. the plugin DB
  // location "plugins/<id>/foo.db" — is resolved under the app's private
  // files dir, the SAME getFilesDir()+location base the SQLite plugin opens
  // DBs from. RTNFileUtils does NOT do this, so a bare relative plugin path
  // is ENOENT to it; that is why DB export/delete needs this module.
  private fun resolve(path: String): java.io.File =
    if (path.startsWith("/")) {
      java.io.File(path)
    } else {
      java.io.File(reactApplicationContext.filesDir, path)
    }

  // File size in bytes, for the on-device space guards. Double for the RN
  // bridge (no native long); 0 when the file is missing. Runs on the worker
  // thread to keep all native fs touches off the JS thread.
  @ReactMethod
  fun fileSize(path: String, promise: Promise) {
    executor.execute {
      try {
        val f = resolve(path)
        promise.resolve(if (f.exists()) f.length().toDouble() else 0.0)
      } catch (e: Exception) {
        promise.reject("FILE_SIZE_FAILED", e.message, e)
      }
    }
  }

  // Copy a plugin DB to an absolute (external-storage) destination — the
  // DB export. A REAL byte copy: RTNFileUtils.copyFile is a File.renameTo
  // under the hood, which cannot cross the internal(filesDir)->external
  // filesystem boundary (and would MOVE, not copy). The source may be
  // relative (resolved under filesDir); the dest is absolute. Resolves true.
  @ReactMethod
  fun copyToExternal(srcPath: String, destPath: String, promise: Promise) {
    executor.execute {
      try {
        val src = resolve(srcPath)
        val dest = java.io.File(destPath)
        dest.parentFile?.mkdirs()
        src.inputStream().use { input ->
          dest.outputStream().use { output -> input.copyTo(output) }
        }
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("COPY_FAILED", e.message, e)
      }
    }
  }

  // Delete a plugin file (resolving a relative path under filesDir, like
  // the slug DB at "plugins/<id>/<slug>.db") — used by F7 delete-imported-
  // dict, where RTNFileUtils.deleteFile can't reach the relative path.
  // An absolute path (a kept source file under MyStyle) passes through.
  // Resolves true if the file is gone afterwards (missing == success).
  @ReactMethod
  fun deleteResolved(path: String, promise: Promise) {
    executor.execute {
      try {
        val f = resolve(path)
        promise.resolve(!f.exists() || f.delete())
      } catch (e: Exception) {
        promise.reject("DELETE_FAILED", e.message, e)
      }
    }
  }
}
