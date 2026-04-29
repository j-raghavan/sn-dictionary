// Module-level reentrancy guard. Matches the on-device-proven pattern in
// sn-formula/src/spike.ts:394 and guibor/supernote-shape-snap. The flag
// MUST be cleared synchronously before any subsequent await — clearing
// it after `await closePluginView` left it stuck `true` on a real
// device and rejected every future button press.
let busy = false;

export const tryAcquire = (): boolean => {
  if (busy) {
    return false;
  }
  busy = true;
  return true;
};

export const release = (): void => {
  busy = false;
};

export const isBusy = (): boolean => busy;
