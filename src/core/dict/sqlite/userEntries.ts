// User-added dictionary entries (TF7-FR5). Validates and persists a
// word + definition the user types into the popup's "Add definition"
// form. Stored in user.db's `entries` table (a superset of the base
// schema) so the existing user DictSource picks it up on the next
// lookup with no extra wiring.
//
// Validation is total — addUserEntry NEVER throws on bad input; it
// returns {ok:false, reason}. Only a real INSERT/IO failure rejects,
// so the caller can tell "you typed nothing" from "the save failed"
// and surface the latter to the user (Designer flag 2).

import {normalizeKey} from '../normalizeKey';
import type {SqliteDb} from './db';
import {INSERT_USER_ENTRY} from './schema';

export const MAX_HEADWORD_LEN = 128;
export const MAX_DEFINITION_LEN = 8192;

export type AddUserEntryResult =
  | {ok: true}
  | {ok: false; reason: 'empty-headword' | 'empty-body' | 'too-long' | 'no-db'};

// Persist a user entry. db null -> 'no-db' (user.db degraded — the
// caller surfaces a "can't save" affordance). Validation rejections
// are returned, never thrown; a genuine INSERT failure rejects.
export const addUserEntry = async (
  db: SqliteDb | null,
  word: string,
  definition: string,
  now: () => string = () => new Date().toISOString(),
): Promise<AddUserEntryResult> => {
  if (db === null) {
    return {ok: false, reason: 'no-db'};
  }
  const trimmedWord = word.trim();
  if (trimmedWord.length === 0) {
    return {ok: false, reason: 'empty-headword'};
  }
  const trimmedDef = definition.trim();
  if (trimmedDef.length === 0) {
    return {ok: false, reason: 'empty-body'};
  }
  if (
    trimmedWord.length > MAX_HEADWORD_LEN ||
    trimmedDef.length > MAX_DEFINITION_LEN
  ) {
    return {ok: false, reason: 'too-long'};
  }

  // Same folded key as every other source so the user entry is
  // reachable by the same normalized lookup. User entries render as
  // plain text and carry no resolved language ('und').
  await db.run(INSERT_USER_ENTRY, [
    normalizeKey(trimmedWord),
    trimmedWord,
    trimmedDef,
    'plain',
    'und',
    now(),
  ]);
  return {ok: true};
};
