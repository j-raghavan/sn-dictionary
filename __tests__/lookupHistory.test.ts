// Lookup history (ADR-0011): sentence extraction + best-effort persistence.

import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openBetterSqliteDb} from './_helpers/betterSqliteDb';
import {
  recordLookup,
  sentenceAround,
  type LookupHistoryDeps,
} from '../src/core/dict/sqlite/lookupHistory';
import type {OpenSqliteDb, SqliteDb} from '../src/core/dict/sqlite/db';

const ok = <T>(result: T) => ({success: true, result});
const fail = (message: string) => ({success: false, error: {code: 1, message}});

const PAGE =
  'It was a dark night. The crowd began to jeer at\nthe   speaker! Nobody left.';

// A real on-disk vocab.db per test: recordLookup opens + closes it on
// every call, so rows must survive a reopen.
let dir: string;
let openDb: OpenSqliteDb;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vocab-'));
  openDb = openBetterSqliteDb(join(dir, 'vocab.db'));
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

const buildDeps = (
  overrides: Partial<LookupHistoryDeps> = {},
): LookupHistoryDeps => ({
  openDb,
  comm: {
    getCurrentFilePath: jest.fn(async () => ok('/storage/emulated/0/Document/Dune.epub')),
    getCurrentPageNum: jest.fn(async () => ok(3)),
  },
  doc: {getCurrentDocText: jest.fn(async () => ok(PAGE))},
  logger: {log: jest.fn(), warn: jest.fn(), error: jest.fn()},
  now: () => '2026-10-06T12:00:00.000Z',
  ...overrides,
});

const rows = async () => {
  const db = (await openDb()) as SqliteDb;
  try {
    return await db.query<Record<string, unknown>>(
      'SELECT word, usage, book, timestamp FROM lookups',
    );
  } finally {
    await db.close();
  }
};

describe('sentenceAround', () => {
  it('returns the whitespace-collapsed sentence containing the word', () => {
    expect(sentenceAround(PAGE, 'jeer')).toBe('The crowd began to jeer at the speaker!');
  });

  it('handles the first and last sentence of the page', () => {
    expect(sentenceAround(PAGE, 'dark')).toBe('It was a dark night.');
    expect(sentenceAround('No full stop here', 'stop')).toBe('No full stop here');
  });

  it('matches a multi-word selection across a line break', () => {
    expect(sentenceAround(PAGE, 'jeer at the')).toBe(
      'The crowd began to jeer at the speaker!',
    );
  });

  it('caps unpunctuated context on both sides', () => {
    const long = `${'a '.repeat(200)}word${' b'.repeat(200)}`;
    const s = sentenceAround(long, 'word') as string;
    expect(s).toContain('word');
    expect(s.length).toBeLessThanOrEqual(2 * 150 + 'word'.length);
  });

  it('returns null when the word is not on the page or empty', () => {
    expect(sentenceAround(PAGE, 'absent')).toBeNull();
    expect(sentenceAround(PAGE, '  ')).toBeNull();
  });
});

describe('recordLookup', () => {
  it('creates vocab.db and stores word, usage sentence, book file name and timestamp', async () => {
    const deps = buildDeps();
    await recordLookup(deps, 'jeer');
    expect(deps.doc.getCurrentDocText).toHaveBeenCalledWith(3);
    expect(await rows()).toEqual([
      {
        word: 'jeer',
        usage: 'The crowd began to jeer at the speaker!',
        book: 'Dune.epub',
        timestamp: '2026-10-06T12:00:00.000Z',
      },
    ]);
  });

  it('switches to DELETE journal mode so no -journal file is left beside vocab.db', async () => {
    const run = jest.fn();
    const spying: OpenSqliteDb = async () => {
      const db = (await openDb()) as SqliteDb;
      return {
        ...db,
        run: async (sql, params) => {
          run(sql);
          return db.run(sql, params);
        },
      };
    };
    await recordLookup(buildDeps({openDb: spying}), 'jeer');
    expect(run.mock.calls[0][0]).toBe('PRAGMA journal_mode=DELETE');
    expect(existsSync(join(dir, 'vocab.db-journal'))).toBe(false);
  });

  it('appends across reopens and closes the DB after each write', async () => {
    const close = jest.fn();
    const tracking: OpenSqliteDb = async () => {
      const db = (await openDb()) as SqliteDb;
      return {
        ...db,
        close: async () => {
          close();
          await db.close();
        },
      };
    };
    await recordLookup(buildDeps({openDb: tracking}), 'jeer');
    await recordLookup(buildDeps({openDb: tracking}), 'dark');
    expect(close).toHaveBeenCalledTimes(2);
    expect((await rows()).map(r => r.word)).toEqual(['jeer', 'dark']);
  });

  it('degrades missing context to NULL instead of dropping the lookup', async () => {
    await recordLookup(
      buildDeps({
        comm: {
          getCurrentFilePath: jest.fn(async () => fail('no file')),
          getCurrentPageNum: jest.fn(async () => {
            throw new Error('boom');
          }),
        },
      }),
      'jeer',
    );
    expect(await rows()).toEqual([
      {word: 'jeer', usage: null, book: null, timestamp: '2026-10-06T12:00:00.000Z'},
    ]);
  });

  it('stores NULL usage when the page text fails or lacks the word', async () => {
    await recordLookup(
      buildDeps({doc: {getCurrentDocText: jest.fn(async () => fail('x'))}}),
      'jeer',
    );
    await recordLookup(buildDeps(), 'absent');
    expect((await rows()).map(r => r.usage)).toEqual([null, null]);
  });

  it('is a logged no-op when vocab.db is unavailable (e.g. no permission)', async () => {
    const deps = buildDeps({openDb: async () => null});
    await expect(recordLookup(deps, 'jeer')).resolves.toBeUndefined();
    expect(deps.logger.warn).not.toHaveBeenCalled();
    expect(deps.logger.log).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
  });

  it('records the word anyway when a context call hangs or throws synchronously', async () => {
    const deps = buildDeps({
      contextTimeoutMs: 20,
      comm: {
        getCurrentFilePath: jest.fn(() => new Promise<never>(() => {})),
        getCurrentPageNum: jest.fn(() => {
          throw new Error('sync boom');
        }),
      },
    });
    await recordLookup(deps, 'jeer');
    expect(await rows()).toEqual([
      {word: 'jeer', usage: null, book: null, timestamp: '2026-10-06T12:00:00.000Z'},
    ]);
    expect(deps.logger.log).toHaveBeenCalledWith(
      '[history] getCurrentFilePath unavailable: timed out',
    );
    expect(deps.logger.log).toHaveBeenCalledWith(
      '[history] getCurrentPageNum unavailable: sync boom',
    );
    expect(deps.doc.getCurrentDocText).not.toHaveBeenCalled();
  });

  it('never rejects: a failed open only logs a warning', async () => {
    const deps = buildDeps({
      openDb: async () => {
        throw new Error('EACCES');
      },
    });
    await expect(recordLookup(deps, 'jeer')).resolves.toBeUndefined();
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });

  it('never rejects: a failed INSERT logs and still closes the DB', async () => {
    const close = jest.fn(async () => {});
    const broken: SqliteDb = {
      query: jest.fn(),
      run: jest.fn(async () => {
        throw new Error('disk full');
      }),
      transaction: jest.fn(),
      close,
    };
    const deps = buildDeps({openDb: async () => broken});
    await expect(recordLookup(deps, 'jeer')).resolves.toBeUndefined();
    expect(close).toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });

  it('uses an ISO timestamp by default', async () => {
    await recordLookup({...buildDeps(), now: undefined}, 'jeer');
    const [row] = await rows();
    expect(String(row.timestamp)).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});
