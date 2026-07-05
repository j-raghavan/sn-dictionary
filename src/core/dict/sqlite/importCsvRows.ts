// CSV produce-step (M16 / ADR-0008): parse a sideloaded CSV in JS and
// insert it into a per-dict slug DB, returning the committed row count.
// This is the CSV analogue of the native StarDict importer — it is the
// ONE format-specific seam plugged into runImport's shared verify-then-
// delete spine. Unlike StarDict (parsed natively off the Hermes thread),
// a CSV is small (10 MB cap) so JS parses it directly via parseCsvRows
// and writes the rows in a single transaction.
//
// Backward-compat: the parse is byte-for-byte the v1.x contract
// (parseCsvRows). Folding + first-wins dedupe happen here (the old
// in-memory Map(key -> first row) behaviour); format is always 'plain'.
// phonetic is bound NULL when the row has none.

import {parseCsvRows, type CsvParseConfig} from '../parseCsvRows';
import {normalizeKey} from '../normalizeKey';
import type {SqliteDb} from './db';
import {
  CREATE_ENTRIES_INDEX,
  CREATE_ENTRIES_TABLE,
  INSERT_CSV_ENTRY,
} from './schema';

// 10 MB cap — the same budget the v1.x CSV source enforced (tuned to the
// ~0.85 MB/s bridge throughput so a worst-case first load completes in
// ~12 s). A too-large file throws here and surfaces as {ok:false} up the
// import spine, leaving the registry untouched.
export const CSV_MAX_BYTES = 10 * 1024 * 1024;

export const csvFileTooLargeMessage = (byteLength: number): string =>
  `file too large: ${byteLength} bytes > ${CSV_MAX_BYTES} cap`;

export interface CsvImportPorts {
  // Read the CSV bytes (fetch port). null = the file vanished between
  // discovery and import → produceCsvSlugDb THROWS ('csv source vanished'),
  // so the spine fails the import (discards the build target, leaves the old
  // DB + audit row intact) rather than producing an empty 0-row DB that would
  // verify clean and replace a healthy slug. This matches the native StarDict
  // importer, which also errors on a missing source.
  loadBytes(): Promise<ArrayBuffer | null>;
  // Open a WRITABLE handle to the slug DB the rows are inserted into
  // (resolved from `filename` by the host/runtime adapter).
  openWritableSlug(filename: string): Promise<SqliteDb>;
  // Cap override (tests). Defaults to CSV_MAX_BYTES.
  maxBytes?: number;
}

// Parse + insert a CSV into its slug DB; resolve the committed count.
// Throws on an over-cap file (surfaces as {ok:false} in runImport). All
// inserts run inside ONE transaction so a mid-write failure rolls back
// the whole DB (the spine then discards the file and leaves sources).
export const produceCsvSlugDb = async (
  ports: CsvImportPorts,
  config: CsvParseConfig,
  filename: string,
): Promise<{entryCount: number}> => {
  const maxBytes = ports.maxBytes ?? CSV_MAX_BYTES;
  const buf = await ports.loadBytes();
  // A vanished source FAILS the import (never a silent 0-row DB): the spine
  // discards the build target and leaves the old DB + audit row untouched.
  if (buf === null) {
    throw new Error('csv source vanished');
  }
  if (buf.byteLength > maxBytes) {
    throw new Error(csvFileTooLargeMessage(buf.byteLength));
  }
  // Two-layer start-clean, by design (R3-2). The spine (runImport) discards the
  // build target FILE before calling us — the cross-format guarantee that clears
  // corrupt / wrong-schema leftovers a DELETE FROM can't touch. This DELETE FROM
  // is the AUTHORITATIVE CSV ROW-level clean: it guarantees exactly the new rows
  // even if the spine's best-effort file discard was a no-op (a NO-OP discard
  // port, or an openable-but-dirty slot). Accepted residual: a slot that is BOTH
  // corrupt AND persistently un-unlinkable fails verify each boot — bounded
  // retry, old DB stays served.
  const db = await ports.openWritableSlug(filename);
  try {
    await db.run(CREATE_ENTRIES_TABLE);

    const rows = await parseCsvRows(new Uint8Array(buf), config);
    const seen = new Set<string>();
    let entryCount = 0;
    await db.transaction(async tx => {
      // Row-level start-clean (see above): clear any prior rows before inserting.
      await tx.run('DELETE FROM entries');
      for (const r of rows) {
        const key = normalizeKey(r.word);
        // Empty key (folds away) or duplicate (first-wins) -> skip.
        if (key.length === 0 || seen.has(key)) {
          continue;
        }
        seen.add(key);
        await tx.run(INSERT_CSV_ENTRY, [
          key,
          r.word,
          r.definition,
          'plain',
          r.phonetic ?? null,
        ]);
        entryCount++;
      }
    });

    await db.run(CREATE_ENTRIES_INDEX);
    return {entryCount};
  } finally {
    await db.close();
  }
};
