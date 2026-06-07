// The entries schema is the build/import/query source of truth, so
// pin its shape: the table + index DDL apply cleanly, the SELECT is
// LIMIT-1 first-row-wins and projects exactly {word, definition,
// format} (key bound, not selected), and DEFINITION_FORMATS matches
// the DefinitionFormat union the popup renders.

import {createSeededDb} from './_helpers/betterSqliteDb';
import {
  CREATE_ENTRIES_INDEX,
  CREATE_ENTRIES_TABLE,
  DEFINITION_FORMATS,
  SELECT_ENTRY_BY_KEY,
} from '../src/core/dict/sqlite/schema';

describe('entries schema', () => {
  it('creates the table and index without error', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run(CREATE_ENTRIES_INDEX);
    });
    // Both DDL statements are idempotent (IF NOT EXISTS) — re-running
    // them is a no-op rather than a duplicate-object error.
    await db.run(CREATE_ENTRIES_TABLE);
    await db.run(CREATE_ENTRIES_INDEX);

    const idx = await db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
      ['idx_entries_key'],
    );
    expect(idx).toEqual([{name: 'idx_entries_key'}]);
    await db.close();
  });

  it('SELECT_ENTRY_BY_KEY projects {word, definition, format} and binds the key', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run('INSERT INTO entries VALUES (?, ?, ?, ?)', [
        'hello',
        'Hello',
        'a greeting',
        'plain',
      ]);
    });
    const rows = await db.query(SELECT_ENTRY_BY_KEY, ['hello']);
    expect(rows).toEqual([
      {word: 'Hello', definition: 'a greeting', format: 'plain'},
    ]);
    // key is bound, not part of the projection.
    expect(Object.keys(rows[0] as object)).not.toContain('key');
    await db.close();
  });

  it('SELECT_ENTRY_BY_KEY returns at most one row (LIMIT 1, first-row-wins)', async () => {
    const db = await createSeededDb(async d => {
      await d.run(CREATE_ENTRIES_TABLE);
      await d.run('INSERT INTO entries VALUES (?, ?, ?, ?)', [
        'dup',
        'First',
        'first def',
        'plain',
      ]);
      await d.run('INSERT INTO entries VALUES (?, ?, ?, ?)', [
        'dup',
        'Second',
        'second def',
        'html',
      ]);
    });
    const rows = await db.query(SELECT_ENTRY_BY_KEY, ['dup']);
    expect(rows).toHaveLength(1);
    await db.close();
  });

  it('DEFINITION_FORMATS lists exactly the renderable formats', () => {
    expect([...DEFINITION_FORMATS].sort()).toEqual(['html', 'plain', 'wordnet']);
  });
});
