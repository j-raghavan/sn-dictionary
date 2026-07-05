package com.sndict.ui

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

// DEVICE-UNVERIFIED. Registers the UI-layer native views. Currently just
// the pen-tool observer (SnDictPenToolObserver) that backs the pen-only
// tap-outside-to-close path; no native modules.
class SnDictUiPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext,
  ): List<NativeModule> = emptyList()

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = listOf(PenToolObserverViewManager())
}
