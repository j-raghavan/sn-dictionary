// Shared lazy-load + retry harness for async-loaded DictSources
// (CSV, JSON, MDX). StarDict is sync-loaded (bundled bytes) and
// uses its own helper in stardictLookup.ts.
//
// Contract:
//   - Loader returns null intentionally -> 'absent', sticks (no retry).
//   - Loader / parser throws            -> 'failed', leaves loaded=false
//                                          so the next lookup retries
//                                          (transient errors must not
//                                          permanently dead-end the
//                                          session).
//   - Loader returns bytes + parser ok  -> 'success', sticks.
//
// Concurrency: the load promise is memoised so concurrent first
// lookups share one underlying load+parse pass instead of racing.

import type {DictEntry, DictSource} from '../lookup';

export type LoadBytes = () => Promise<ArrayBuffer | null>;

export type LazyAsyncSourceDeps<TParsed> = {
  name: string;
  loadBytes: LoadBytes;
  parse: (bytes: Uint8Array) => TParsed;
  lookup: (parsed: TParsed, word: string) => DictEntry | null;
  // Optional cap; throw before parse if the file is larger.
  maxBytes?: number;
  logger?: {warn: (msg: string) => void};
};

export const createLazyAsyncSource = <TParsed>(
  deps: LazyAsyncSourceDeps<TParsed>,
): DictSource => {
  const warn = deps.logger?.warn ?? (() => {});
  const tag = deps.name;
  let parsed: TParsed | null = null;
  let absent = false;
  let inFlight: Promise<void> | null = null;

  const doLoad = async (): Promise<void> => {
    let buf: ArrayBuffer | null;
    try {
      buf = await deps.loadBytes();
    } catch (e) {
      warn(`[${tag}] loader threw: ${(e as Error).message}`);
      throw e;
    }
    if (buf === null) {
      absent = true;
      return;
    }
    if (deps.maxBytes !== undefined && buf.byteLength > deps.maxBytes) {
      const e = new Error(
        `file too large: ${buf.byteLength} bytes > ${deps.maxBytes} cap`,
      );
      warn(`[${tag}] ${e.message}`);
      throw e;
    }
    try {
      parsed = deps.parse(new Uint8Array(buf));
    } catch (e) {
      warn(`[${tag}] parse threw: ${(e as Error).message}`);
      throw e;
    }
  };

  const ensureLoaded = async (): Promise<void> => {
    if (parsed !== null || absent) {
      return;
    }
    if (inFlight === null) {
      // Memoise the in-flight promise so concurrent callers wait on
      // the same load. Clear on settle so a failed attempt can be
      // retried by the NEXT lookup (not by the racing concurrent
      // ones — they all observe the same failure here).
      inFlight = doLoad().finally(() => {
        inFlight = null;
      });
    }
    try {
      await inFlight;
    } catch {
      // swallow — caller observes via parsed===null
    }
  };

  return {
    name: deps.name,
    async lookup(word: string): Promise<DictEntry | null> {
      const trimmed = word.trim();
      if (!trimmed) {
        return null;
      }
      await ensureLoaded();
      if (parsed === null) {
        return null;
      }
      return deps.lookup(parsed, trimmed);
    },
  };
};
