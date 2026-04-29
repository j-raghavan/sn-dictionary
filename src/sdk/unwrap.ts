import type {APIResponse} from './types';

export const unwrap = <T>(
  res: APIResponse<T> | null | undefined,
  name: string,
): T => {
  if (!res || !res.success || res.result === undefined) {
    const msg = res?.error?.message ?? 'no error message';
    throw new Error(`${name} failed: ${msg}`);
  }
  return res.result;
};
