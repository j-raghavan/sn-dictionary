// User-added entries validation + persistence (TF7-FR5).

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  addUserEntry,
  MAX_DEFINITION_LEN,
  MAX_HEADWORD_LEN,
} from '../src/core/dict/sqlite/userEntries';
import {
  CREATE_USER_ENTRIES_TABLE,
  // user.db's 6-col table has no `phonetic` column, so query it with the
  // 4-col SELECT (the same fallback selectByKey uses defensively).
  SELECT_ENTRY_BY_KEY_NO_PHONETIC as SELECT_ENTRY_BY_KEY,
} from '../src/core/dict/sqlite/schema';
import type {SqliteDb} from '../src/core/dict/sqlite/db';

const userDb = (): Promise<SqliteDb> =>
  createSeededDb(async d => {
    await d.run(CREATE_USER_ENTRIES_TABLE);
  });

describe('addUserEntry — validation (never throws)', () => {
  it('rejects an empty / whitespace headword', async () => {
    const db = await userDb();
    expect(await addUserEntry(db, '', 'def')).toEqual({
      ok: false,
      reason: 'empty-headword',
    });
    expect(await addUserEntry(db, '   ', 'def')).toEqual({
      ok: false,
      reason: 'empty-headword',
    });
    await db.close();
  });

  it('rejects an empty / whitespace definition body', async () => {
    const db = await userDb();
    expect(await addUserEntry(db, 'word', '')).toEqual({
      ok: false,
      reason: 'empty-body',
    });
    expect(await addUserEntry(db, 'word', '   ')).toEqual({
      ok: false,
      reason: 'empty-body',
    });
    await db.close();
  });

  it('rejects an over-long headword or body', async () => {
    const db = await userDb();
    expect(
      await addUserEntry(db, 'a'.repeat(MAX_HEADWORD_LEN + 1), 'def'),
    ).toEqual({ok: false, reason: 'too-long'});
    expect(
      await addUserEntry(db, 'word', 'a'.repeat(MAX_DEFINITION_LEN + 1)),
    ).toEqual({ok: false, reason: 'too-long'});
    await db.close();
  });

  it('returns no-db when the db is null (degraded user.db)', async () => {
    expect(await addUserEntry(null, 'word', 'def')).toEqual({
      ok: false,
      reason: 'no-db',
    });
  });
});

describe('addUserEntry — persistence', () => {
  it('round-trips a trimmed entry queryable by normalizeKey', async () => {
    const db = await userDb();
    const res = await addUserEntry(db, '  Photon  ', '  a quantum of light  ');
    expect(res).toEqual({ok: true});
    // Folded key lookup (lowercased) hits the row; word/def are trimmed.
    const rows = await db.query(SELECT_ENTRY_BY_KEY, ['photon']);
    expect(rows).toEqual([
      {word: 'Photon', definition: 'a quantum of light', format: 'plain'},
    ]);
    await db.close();
  });

  it("stores format='plain' and lang='und' with a created_at stamp", async () => {
    const db = await userDb();
    await addUserEntry(db, 'word', 'def', () => '2026-06-07T00:00:00Z');
    const rows = await db.query<{
      format: string;
      lang: string;
      created_at: string;
    }>('SELECT format, lang, created_at FROM entries WHERE key = ?', ['word']);
    expect(rows).toEqual([
      {format: 'plain', lang: 'und', created_at: '2026-06-07T00:00:00Z'},
    ]);
    await db.close();
  });

  it('accepts a headword/body exactly at the length cap', async () => {
    const db = await userDb();
    const res = await addUserEntry(
      db,
      'a'.repeat(MAX_HEADWORD_LEN),
      'b'.repeat(MAX_DEFINITION_LEN),
    );
    expect(res).toEqual({ok: true});
    await db.close();
  });

  it('REJECTS (throws up) on a real INSERT failure', async () => {
    // A db whose run() rejects models an IO failure — addUserEntry must
    // propagate it (not swallow as {ok:false}) so the caller surfaces
    // "save failed" distinctly from validation.
    const faulty: SqliteDb = {
      query: async () => [],
      run: async () => {
        throw new Error('disk I/O error');
      },
      transaction: async () => undefined,
      close: async () => undefined,
    };
    await expect(addUserEntry(faulty, 'word', 'def')).rejects.toThrow(
      'disk I/O error',
    );
  });
});
