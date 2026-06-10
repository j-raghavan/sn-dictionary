package com.sndict.clipboard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap

// DEVICE-UNVERIFIED. Writes the Android OS clipboard via
// ClipboardManager.setPrimaryClip on the UI thread. Pattern ported from
// the sibling sn-copilot plugin (CopilotOverlayModule.copyToClipboard).
//
// Every call resolves (never rejects) with {success, code, message} so
// the JS wrapper (src/native/clipboard.ts) can branch on `code` without
// try/catch.
//
// IMPORTANT: setPrimaryClip populates the OS clipboard — pasteable in
// text fields and other Android apps — NOT the Supernote firmware
// "element" clipboard the lasso-Paste menu reads. The SDK hook for that
// (pushElementsToClipboard) is not yet exposed (Dunn, 2026-05-01), so
// pasting a copied definition into a handwritten note is out of scope.
class SnDictClipboardModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SnDictClipboard"

  @ReactMethod
  fun copyToClipboard(text: String, label: String?, promise: Promise) {
    // Clipboard access must run on the main looper.
    UiThreadUtil.runOnUiThread { copyOnUiThread(text, label, promise) }
  }

  private fun copyOnUiThread(text: String, label: String?, promise: Promise) {
    val cm =
      reactApplicationContext.applicationContext
        .getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    if (cm == null) {
      Log.e(TAG, "[clipboard] CLIPBOARD_SERVICE unavailable")
      promise.resolve(
        result(false, "NO_CLIPBOARD_SERVICE", "Application context has no CLIPBOARD_SERVICE"),
      )
      return
    }
    try {
      cm.setPrimaryClip(ClipData.newPlainText(label ?: "SnDict", text))
      Log.i(TAG, "[clipboard] copied ${text.length} chars")
      promise.resolve(
        result(true, "OK", "Copied ${text.length} chars to the system clipboard"),
      )
    } catch (e: Throwable) {
      val msg = "${e.javaClass.simpleName}: ${e.message}"
      Log.e(TAG, "[clipboard] copyToClipboard threw: $msg", e)
      promise.resolve(result(false, "CLIPBOARD_THREW", msg))
    }
  }

  private fun result(success: Boolean, code: String, message: String): WritableMap {
    val map = Arguments.createMap()
    map.putBoolean("success", success)
    map.putString("code", code)
    map.putString("message", message)
    return map
  }

  private companion object {
    const val TAG = "SnDict"
  }
}
