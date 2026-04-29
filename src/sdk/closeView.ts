// Best-effort closePluginView wrapper. The host's overlay window
// keeps capturing pen touches at the OS InputDispatcher layer if we
// don't close it (sn-formula/src/spike.ts:447-451), so we always try
// — but a thrown error here can't recover us, so we just warn.

export type ClosablePluginView = {
  closePluginView: () => Promise<boolean>;
};

export type WarnLogger = {warn: (msg: string) => void};

export const safeClosePluginView = async (
  comm: ClosablePluginView,
  logger: WarnLogger,
): Promise<void> => {
  try {
    await comm.closePluginView();
  } catch (e) {
    logger.warn(`closePluginView threw: ${(e as Error).message}`);
  }
};
