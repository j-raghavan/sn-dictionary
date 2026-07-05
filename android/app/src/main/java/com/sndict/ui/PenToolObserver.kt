package com.sndict.ui

import android.view.MotionEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.events.RCTEventEmitter
import com.facebook.react.views.view.ReactViewGroup

// DEVICE-UNVERIFIED. A pure OBSERVER of the pointer tool type. It reports
// the ACTION_DOWN tool (stylus / eraser / finger / mouse / unknown) up to
// JS as an `onToolDown` event, then RETURNS FALSE unconditionally so it
// never intercepts or consumes the touch — the existing RN responder
// system (the backdrop Pressable underneath) keeps its exact behaviour.
// The pen-vs-finger signal it emits is the only thing that gates the
// tap-outside-to-close path (src/ui/popupController.shouldDismissOnBackdropTap);
// geometry (inside vs outside the card) stays in JS.
//
// getToolType(0) is the ONLY Android API that distinguishes pen from
// finger, so this thin native seam is unavoidable and cannot run under
// jest (MotionEvent is unbound off-device). Its policy consumer is
// host-tested; this file is verified on the Manta.
class PenToolObserverView(context: ThemedReactContext) : ReactViewGroup(context) {

  private val themedContext: ThemedReactContext = context

  private fun toolTypeName(toolType: Int): String =
    when (toolType) {
      MotionEvent.TOOL_TYPE_STYLUS -> "stylus"
      MotionEvent.TOOL_TYPE_ERASER -> "eraser"
      MotionEvent.TOOL_TYPE_FINGER -> "finger"
      MotionEvent.TOOL_TYPE_MOUSE -> "mouse"
      else -> "unknown"
    }

  // Observe the DOWN and report the tool; NEVER steal the gesture.
  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
      val payload: WritableMap = Arguments.createMap()
      payload.putString("toolType", toolTypeName(ev.getToolType(0)))
      themedContext
        .getJSModule(RCTEventEmitter::class.java)
        .receiveEvent(id, "toolDown", payload)
    }
    // Unconditional false: observe without intercepting so the touch
    // continues to the child responder tree untouched.
    return false
  }

  // Belt-and-suspenders: even if a child never claims the gesture and it
  // bubbles back here, we still refuse to consume it.
  override fun onTouchEvent(ev: MotionEvent): Boolean = false
}

// DEVICE-UNVERIFIED. Exposes PenToolObserverView to JS as
// "SnDictPenToolObserver" with the direct `onToolDown` event.
class PenToolObserverViewManager : ViewGroupManager<PenToolObserverView>() {

  override fun getName(): String = "SnDictPenToolObserver"

  override fun createViewInstance(reactContext: ThemedReactContext): PenToolObserverView =
    PenToolObserverView(reactContext)

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
    MapBuilder.of(
      "toolDown",
      MapBuilder.of("registrationName", "onToolDown"),
    )
}
