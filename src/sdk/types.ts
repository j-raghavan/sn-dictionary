// Shared types for SDK-facing code (handlers, button registrations).
// Kept narrow on purpose — only the slices we actually use, so the
// real sn-plugin-lib classes match by structural typing without
// importing them at module-load time.

export type APIResponse<T> = {
  success: boolean;
  result?: T;
  error?: {code: number; message: string};
};

export type Logger = {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};
