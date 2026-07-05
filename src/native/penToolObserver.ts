// DEVICE-UNVERIFIED. Bridge to the native pen-tool observer view
// (PenToolObserver.kt). It is a transparent overlay that reports the
// ACTION_DOWN tool type (stylus / eraser / finger / mouse / unknown) via
// `onToolDown` WITHOUT ever intercepting the touch, so the backdrop
// Pressable underneath keeps its exact behaviour. The pen-vs-finger
// signal is what gates the tap-outside-to-close path.
//
// Coverage-excluded (jest.config.js) like nativeImport.ts / clipboard.ts:
// requireNativeComponent isn't bound off the device. getPenToolObserver()
// returns null off-device (jest, or the native view missing), and the
// popup renders no dismiss layer in that case — a fail-safe no-close.

import type React from 'react';
import type {ViewProps} from 'react-native';

export type ToolDownEvent = {
  nativeEvent: {toolType: string};
};

export type PenToolObserverProps = ViewProps & {
  onToolDown?: (event: ToolDownEvent) => void;
};

// Resolved once: null when the native component can't be required (jest,
// off-device, or the ViewManager isn't registered). Callers treat null as
// "no pen signal available" → the dismiss layer isn't rendered.
let cached: React.ComponentType<PenToolObserverProps> | null | undefined;

export const getPenToolObserver =
  (): React.ComponentType<PenToolObserverProps> | null => {
    if (cached === undefined) {
      try {
        const {requireNativeComponent} = require('react-native');
        cached = requireNativeComponent<PenToolObserverProps>(
          'SnDictPenToolObserver',
        );
      } catch {
        cached = null;
      }
    }
    return cached ?? null;
  };
