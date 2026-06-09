// DEVICE-UNVERIFIED. Bridge to the native clipboard module
// (SnDictClipboardModule.kt). Writes the Android OS clipboard via
// ClipboardManager.setPrimaryClip on the UI thread. Pattern ported from
// the sibling sn-copilot plugin (CopilotOverlayModule.copyToClipboard).
//
// Coverage-excluded (jest.config.js) like nativeImport.ts / rnSqliteDb.ts:
// it touches NativeModules, which aren't bound off the device. The copy
// reducer (copyText.ts) and the popup handlers that consume this are
// host-tested with this module mocked.
//
// IMPORTANT: this populates the OS clipboard — pasteable in text fields
// and other Android apps (OSS-Dict, Aard2, a browser) — NOT the Supernote
// firmware "element" clipboard the lasso-Paste menu reads. The SDK hook
// for that (pushElementsToClipboard) is not yet exposed (Dunn, 2026-05-01),
// so pasting a copied definition into a handwritten note is out of scope.

export type ClipboardCode =
  | 'OK'
  | 'NO_CLIPBOARD_SERVICE'
  | 'CLIPBOARD_THREW'
  | 'MODULE_MISSING';

// Always resolves (never rejects) so callers branch on `success`/`code`
// without try/catch — same contract as the native module's Promise.
export type ClipboardResult = {
  success: boolean;
  code: ClipboardCode;
  message: string;
};

// Lazily require react-native so importing this module off-device (a
// stray import, a host test that didn't mock it) doesn't blow up before
// the native module is bound.
export const copyToClipboard = async (
  text: string,
  label: string | null = null,
): Promise<ClipboardResult> => {
  const {NativeModules} = require('react-native');
  const mod = NativeModules.SnDictClipboard;
  if (mod === undefined || typeof mod.copyToClipboard !== 'function') {
    return {
      success: false,
      code: 'MODULE_MISSING',
      message: '[clipboard] native SnDictClipboard module is unavailable',
    };
  }
  return mod.copyToClipboard(text, label);
};
