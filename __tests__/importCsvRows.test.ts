// FR3: produceCsvSlugDb — parse a CSV in JS and insert it into a slug DB.
// Host-tested against a real better-sqlite3 file (so we can reopen a
// DISTINCT handle and read COMMITTED rows, the way the import spine
// verifies). Covers the Dune fixture (quoted field, CP1252 0x92,
// leading-space-in-definition preserved), the phoneticCol path, the
// 10 MB cap, and first-wins dedupe.

import {readFileSync} from 'node:fs';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  produceCsvSlugDb,
  csvFileTooLargeMessage,
  type CsvImportPorts,
} from '../src/core/dict/sqlite/importCsvRows';
import {openBetterSqliteDb} from './_helpers/betterSqliteDb';
import type {CsvParseConfig} from '../src/core/dict/parseCsvRows';

const enc = (s: string): ArrayBuffer =>
  new TextEncoder().encode(s).buffer as ArrayBuffer;

// A ports impl backed by a real temp-file slug DB. loadBytes returns the
// supplied buffer; openWritableSlug opens a fresh better-sqlite3 handle
// at a temp path so the test can reopen it after produce closes it.
const portsFor = (
  bytes: ArrayBuffer | null,
  extra: {maxBytes?: number} = {},
): {ports: CsvImportPorts; dbPath: string} => {
  const dir = mkdtempSync(join(tmpdir(), 'csvslug-'));
  const dbPath = join(dir, 'slug.db');
  return {
    dbPath,
    ports: {
      loadBytes: async () => bytes,
      openWritableSlug: async () => {
        const open = openBetterSqliteDb(dbPath);
        const db = await open();
        if (db === null) {
          throw new Error('unexpected null slug DB');
        }
        return db;
      },
      maxBytes: extra.maxBytes,
    },
  };
};

const reopen = (dbPath: string) => openBetterSqliteDb(dbPath)();

const lookup = async (
  dbPath: string,
  key: string,
): Promise<{
  word: string;
  definition: string;
  format: string;
  phonetic: string | null;
} | null> => {
  const db = await reopen(dbPath);
  const rows = await db!.query<{
    word: string;
    definition: string;
    format: string;
    phonetic: string | null;
  }>('SELECT word, definition, format, phonetic FROM entries WHERE key = ?', [
    key,
  ]);
  await db!.close();
  return rows[0] ?? null;
};

const DEFAULTS: CsvParseConfig = {};

describe('produceCsvSlugDb', () => {
  it('parses the Dune fixture: quoted field, CP1252 0x92, leading-space definition', async () => {
    // Real user file, CRLF + CP1252 (raw bytes, no re-encode).
    // The committed sample (spec/ is gitignored, so CI can't read it).
    const bytes = readFileSync('assets/sample-dicts/Dune.csv');
    const {ports, dbPath} = portsFor(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    const {entryCount} = await produceCsvSlugDb(ports, DEFAULTS, 'Dune.en.db');
    expect(entryCount).toBeGreaterThan(0);

    // ARRAKIS — the planet.
    const arrakis = await lookup(dbPath, 'arrakis');
    expect(arrakis).toEqual({
      word: 'ARRAKIS',
      definition: ' the planet known as Dune; third planet of Canopus.',
      format: 'plain',
      phonetic: null,
    });

    // ABA — definition is NOT trimmed: leading space preserved.
    const aba = await lookup(dbPath, 'aba');
    expect(aba?.definition).toBe(
      ' loose robe worn by Fremen women; usually black.',
    );

    // AQL — a quoted field (the definition contains a leading quote +
    // curly quotes); RFC-4180 unquoting applied.
    const aql = await lookup(dbPath, 'aql');
    expect(aql?.word).toBe('AQL');
    expect(aql?.definition).toContain('the test of reason');

    // MUAD’DIB — headword stored with the CP1252 0x92 curly quote, found
    // by an ASCII apostrophe query (punctuation fold).
    const muad = await lookup(dbPath, "muad'dib");
    expect(muad?.word).toBe('MUAD’DIB');
    expect(muad?.definition).toContain('kangaroo mouse');
  });

  it('phoneticCol: stores the configured column as phonetic', async () => {
    const {ports, dbPath} = portsFor(
      enc('ARRAKIS,the planet known as Dune,uh-RAK-is\n'),
    );
    const {entryCount} = await produceCsvSlugDb(
      ports,
      {phoneticCol: 2},
      'p.en.db',
    );
    expect(entryCount).toBe(1);
    expect(await lookup(dbPath, 'arrakis')).toEqual({
      word: 'ARRAKIS',
      definition: 'the planet known as Dune',
      format: 'plain',
      phonetic: 'uh-RAK-is',
    });
  });

  it('binds NULL phonetic when no phoneticCol is configured', async () => {
    const {ports, dbPath} = portsFor(enc('apple,a fruit\n'));
    await produceCsvSlugDb(ports, DEFAULTS, 'a.en.db');
    expect((await lookup(dbPath, 'apple'))?.phonetic).toBeNull();
  });

  it('first occurrence wins on duplicate folded keys', async () => {
    const {ports, dbPath} = portsFor(enc('apple,first\nApple,second\n'));
    const {entryCount} = await produceCsvSlugDb(ports, DEFAULTS, 'd.en.db');
    expect(entryCount).toBe(1);
    expect((await lookup(dbPath, 'apple'))?.definition).toBe('first');
  });

  it('rejects a file over the 10 MB cap (throws -> surfaces {ok:false})', async () => {
    const big = new ArrayBuffer(11 * 1024 * 1024);
    const {ports} = portsFor(big, {maxBytes: 10 * 1024 * 1024});
    await expect(
      produceCsvSlugDb(ports, DEFAULTS, 'big.en.db'),
    ).rejects.toThrow(csvFileTooLargeMessage(11 * 1024 * 1024));
  });

  it('a vanished source (loadBytes null) THROWS — never a silent 0-row DB', async () => {
    // A/B slots + aligned host/device semantics: a missing source FAILS the
    // import so the spine discards the build target and leaves the served DB +
    // audit row intact, rather than producing an empty DB that verifies clean
    // and would replace a healthy slug.
    const {ports} = portsFor(null);
    await expect(
      produceCsvSlugDb(ports, DEFAULTS, 'gone.en.db'),
    ).rejects.toThrow('csv source vanished');
  });
});

// NOTE: start-clean is TWO layers (R3-2). produceCsvSlugDb owns the
// AUTHORITATIVE row-level clean (its DELETE FROM, reinstated); the spine
// (runImport) owns the cross-format FILE-level clean (discard, for corrupt /
// wrong-schema leftovers). The stronger, end-to-end dirty-slot verification —
// a dirty-but-openable slot with a NO-OP file discard verifying clean in ONE
// pass — lives at spine level: see csvImportE2E.test.ts "spine start-clean: a
// DIRTY-but-openable slot verifies clean in ONE pass with a NO-OP discard".
