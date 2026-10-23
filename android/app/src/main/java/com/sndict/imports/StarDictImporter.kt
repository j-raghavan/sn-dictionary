package com.sndict.imports

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteStatement
import android.util.Log
import java.io.BufferedInputStream
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.StandardOpenOption
import java.util.zip.GZIPInputStream

// DEVICE-UNVERIFIED. Native StarDict importer (ADR-0006 Option 2):
// parse the triple (+ optional .syn) and bulk-insert into a per-dict
// SQLite DB, ALL off the Hermes/JS thread. Logic mirrors the TS path
// EXACTLY so natively-imported dicts key and render like base.db:
//   - .ifo  -> parseIfo.ts (sametypesequence, idxoffsetbits 32|64)
//   - .dict -> dictReader (gzip inflate when .dz / 0x1f8b magic);
//             each entry's slice -> splitDictEntry (strip sts-absent
//             type byte + trailing NUL) + formatFromTypeChar (mirror
//             dictEntry.ts) before decode (issue #28)
//   - .idx  -> parseIdx.ts (word\0 + BE offset(u32|u64) + BE length(u32));
//              ONE `entries` row per record, rowid = ordinal + 1
//   - .syn  -> parseSyn.ts; ONE `aliases` row per in-range record
//              (normalizeKey-folded key -> entries rowid), never a copy of
//              the target's definition
//   - SQLite -> schema.ts DDL literals + SCHEMA_VERSION; meta LAST.
// Lookup (sqliteDictSource.ts) resolves a key to its first canonical row,
// else its first alias, so first-key-wins now happens at read time.
//
// MEMORY (M11, #44): the host process caps the Java heap at ~192MB and we
// can't raise it. So heap use is CONSTANT in the dict size:
//   - the .dict body is inflated to a TEMP FILE (streaming, ~constant
//     heap) and read OFF-HEAP via an mmap'd MappedByteBuffer (on-demand
//     paging — doesn't count against the Java heap);
//   - .idx and .syn are STREAMED record by record and each row is inserted
//     as it is read: no whole-file byte array, no entry list, no dedup set
//     (a 27MB .syn with 1.5M records used to exhaust the heap);
//   - only a single definition String is ever live.
//
// IMPORTER VERSIONING: any import- or render-affecting change to the logic
// here (parse, dedup, type-byte stripping, format mapping, insert) MUST be
// paired with a +1 bump of IMPORTER_VERSION in schema.ts, so a user-dict DB
// this importer produced is re-imported at bootstrap once the stamp falls
// behind. There is no Kotlin-side constant — schema.ts holds the single one.

private const val SCHEMA_VERSION = 3 // MUST match buildBaseDb.ts SCHEMA_VERSION (v3: + phonetic col, ADR-0008)

// SAME DDL as schema.ts (the single source of truth; sqliteSchema.test.ts
// fails if these drift). The nullable `phonetic TEXT` last column keeps
// StarDict slugs the same shape as CSV slugs + base.db; the INSERT below
// leaves it NULL (StarDict carries no phonetic).
private const val CREATE_ENTRIES_TABLE =
  "CREATE TABLE IF NOT EXISTS entries (" +
    "key TEXT NOT NULL, word TEXT NOT NULL, " +
    "definition TEXT NOT NULL, format TEXT NOT NULL, phonetic TEXT)"
private const val CREATE_ENTRIES_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_entries_key ON entries(key)"
private const val CREATE_ALIASES_TABLE =
  "CREATE TABLE IF NOT EXISTS aliases (" +
    "key TEXT NOT NULL, entry_rowid INTEGER NOT NULL, word TEXT NOT NULL)"
private const val CREATE_ALIASES_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_aliases_key ON aliases(key)"
private const val CREATE_META_TABLE =
  "CREATE TABLE IF NOT EXISTS meta (" +
    "schema_version INTEGER NOT NULL, built_at TEXT NOT NULL)"
private const val INSERT_STARDICT_ENTRY =
  "INSERT INTO entries (rowid, key, word, definition, format) VALUES (?, ?, ?, ?, ?)"
private const val INSERT_ALIAS =
  "INSERT INTO aliases (key, entry_rowid, word) VALUES (?, ?, ?)"
private const val INSERT_META =
  "INSERT INTO meta (schema_version, built_at) VALUES (?, ?)"

private const val PROGRESS_EVERY = 100_000
// Longest .idx/.syn word accepted; a corrupt file with no NUL fails here
// instead of growing the word buffer without bound.
private const val MAX_WORD_BYTES = 64 * 1024
private const val TAG = "StarDictImporter"

object StarDictImporter {

  // Returns the number of .idx records inserted (== COUNT(*) FROM entries).
  fun run(
    ifoPath: String,
    idxPath: String,
    dictPath: String,
    synPath: String?,
    dbPath: String,
    formatOverride: String?,
  ): Int {
    val ifo = parseIfo(File(ifoPath).readBytes())
    val builtAt = builtAt(ifo)

    // Inflate the .dict body to a temp file (streaming) and mmap it
    // off-heap. A raw .dict is mapped in place (no temp file).
    val prepared = prepareBody(dictPath, dbPath)
    var channel: FileChannel? = null
    try {
      channel = FileChannel.open(prepared.file.toPath(), StandardOpenOption.READ)
      val size = channel.size()
      val body: MappedByteBuffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, size)

      return writeDbStreaming(
        dbPath = dbPath,
        idxFile = File(idxPath),
        idxoffsetbits = ifo.idxoffsetbits,
        synPath = synPath,
        body = body,
        bodySize = size,
        sametypesequence = ifo.sametypesequence,
        formatOverride = formatOverride,
        builtAt = builtAt,
      )
    } finally {
      try {
        channel?.close()
      } catch (_: Exception) {
      }
      // Delete the temp inflated file (raw .dict files are left alone).
      if (prepared.isTemp) {
        prepared.file.delete()
      }
    }
  }

  // --- .dict body off-heap (inflate to temp file + mmap) --------------

  private data class PreparedBody(val file: File, val isTemp: Boolean)

  private fun prepareBody(dictPath: String, dbPath: String): PreparedBody {
    val src = File(dictPath)
    val isGzip = dictPath.lowercase(java.util.Locale.ROOT).endsWith(".dz") ||
      isGzipMagic(src)
    if (!isGzip) {
      return PreparedBody(src, isTemp = false)
    }
    // STREAM the inflate to a temp file next to the output DB (writable
    // dir) — never the whole body in heap. dictzip is a valid
    // end-to-end gzip stream, so a single GZIPInputStream decodes it.
    val temp = File("$dbPath.inflating.tmp")
    temp.delete()
    GZIPInputStream(src.inputStream().buffered()).use { gz ->
      FileOutputStream(temp).buffered().use { out ->
        gz.copyTo(out, bufferSize = 1 shl 16)
      }
    }
    return PreparedBody(temp, isTemp = true)
  }

  private fun isGzipMagic(file: File): Boolean {
    file.inputStream().use { ins ->
      val b0 = ins.read()
      val b1 = ins.read()
      return b0 == 0x1f && b1 == 0x8b
    }
  }

  // Read `length` raw bytes at `offset` from the mmap'd body, or null when
  // the slice falls outside it. Returns the RAW slice — the caller runs
  // splitDictEntry to strip any sts-absent type prefix/NUL BEFORE decoding
  // to UTF-8 (issue #28; mirrors dictEntry.ts).
  private fun readDef(
    body: MappedByteBuffer,
    bodySize: Long,
    offset: Long,
    length: Int,
  ): ByteArray? {
    if (offset < 0 || length < 0 || offset + length > bodySize) {
      return null
    }
    val buf = ByteArray(length)
    // Duplicate so concurrent position moves stay local (single-threaded
    // here, but cheap + safe). Absolute get keeps it explicit.
    val dup = body.duplicate()
    dup.position(offset.toInt())
    dup.get(buf, 0, length)
    return buf
  }

  // --- .dict entry split (mirror dictEntry.ts splitDictEntry EXACTLY) -

  private data class SplitEntry(val payload: ByteArray, val typeChar: Char?)

  // sts PRESENT  -> whole slice is the payload; typeChar = sts[0] so an
  //                 .ifo-level sametypesequence=h dict renders HTML even
  //                 with no per-entry prefix / no sidecar override.
  //                 multi-char sts (CASE C) still uses sts[0] for format;
  //                 field-splitting is out of scope.
  // sts ABSENT   -> raw[0] is the ASCII type char; the rest is the body
  //                 minus exactly one trailing 0x00 when present.
  // empty slice  -> {empty, null} (guard before indexing raw[0]).
  private fun splitDictEntry(sametypesequence: String?, raw: ByteArray): SplitEntry {
    if (raw.isEmpty()) {
      return SplitEntry(raw, null)
    }
    if (sametypesequence != null && sametypesequence.isNotEmpty()) {
      return SplitEntry(raw, sametypesequence.firstOrNull())
    }
    val typeChar = (raw[0].toInt() and 0xff).toChar()
    var end = raw.size
    if (raw[end - 1].toInt() == 0) {
      end -= 1
    }
    return SplitEntry(raw.copyOfRange(1, end), typeChar)
  }

  // Mirror dictEntry.ts formatFromTypeChar: 'h' -> html, else plain.
  // NEVER 'wordnet'.
  private fun formatFromTypeChar(typeChar: Char?): String =
    if (typeChar == 'h') "html" else "plain"

  // Mirror dictEntry.ts dictBodyOverrun: bytes the .idx reaches past the
  // .dict body, clamped at 0. Source of truth is dictEntry.ts.
  private fun dictBodyOverrun(maxOffsetEnd: Long, bodySize: Long): Long =
    maxOf(0L, maxOffsetEnd - bodySize)

  // Mirror dictEntry.ts sanitizeDefinition BYTE-IDENTICALLY: strip a run of
  // U+FFFD from the START and END only; INTERIOR U+FFFD is preserved (real
  // source corruption, not an edge mis-split). Source of truth is
  // dictEntry.ts — keep this regex in lockstep with FFFD_EDGES.
  //
  // End anchor is `\z` (absolute end), NOT `$`: Java's `$` without
  // MULTILINE also matches BEFORE a trailing line terminator, so `$` would
  // strip U+FFFD from "a�\n" while JS `/…$/` (no `m` flag) matches the
  // absolute end only and keeps it. `\z` matches JS `$`-no-`m` exactly.
  private val fffdEdges = Regex("^�+|�+\\z")

  private fun sanitizeDefinition(s: String): String = fffdEdges.replace(s, "")

  // --- .ifo (mirror parseIfo.ts) -------------------------------------

  private data class IfoMeta(
    // The raw sametypesequence field, or null when absent (mirror
    // parseIfo.ts IfoMeta.sametypesequence). Drives splitDictEntry +
    // the per-entry format derivation — NOT a single dict-wide format.
    val sametypesequence: String?,
    val idxoffsetbits: Int,
    val date: String?,
    val bookname: String?,
    val wordcount: String?,
  )

  private fun parseIfo(bytes: ByteArray): IfoMeta {
    val map = HashMap<String, String>()
    for (line in String(bytes, Charsets.UTF_8).split(Regex("\\r?\\n"))) {
      val eq = line.indexOf('=')
      if (eq <= 0) continue
      val k = line.substring(0, eq).trim()
      if (k.isNotEmpty()) map[k] = line.substring(eq + 1)
    }
    // idxoffsetbits: default 32; only 32|64 allowed (mirror parseIfo).
    val rawBits = map["idxoffsetbits"]
    val bits = when {
      rawBits.isNullOrEmpty() -> 32
      rawBits == "32" -> 32
      rawBits == "64" -> 64
      else -> throw IllegalArgumentException(
        "parseIfo: idxoffsetbits must be 32 or 64, got \"$rawBits\"",
      )
    }
    return IfoMeta(
      map["sametypesequence"],
      bits,
      map["date"],
      map["bookname"],
      map["wordcount"],
    )
  }

  // Deterministic built_at (mirror deterministicBuiltAt).
  private fun builtAt(ifo: IfoMeta): String {
    val date = ifo.date
    if (date != null && date.isNotEmpty()) return date
    return "${ifo.bookname ?: "base"}@${ifo.wordcount ?: ""}"
  }

  // --- .idx / .syn records (mirror parseIdx.ts / parseSyn.ts) --------

  // Streams `word\0` + big-endian unsigned fields from a .idx or .syn file
  // with a small reusable word buffer, so the file is never held in heap.
  // Same guards and messages as parseIdx.ts / parseSyn.ts: an unterminated
  // last word, an empty word, or a record cut short throws.
  private class RecordReader(file: File, private val what: String) : Closeable {
    private val input = BufferedInputStream(file.inputStream(), 1 shl 16)
    private var word = ByteArray(256)
    private var pos = 0L
    private var recordStart = 0L

    // The next record's word, or null at a clean end of file.
    fun nextWord(): String? {
      recordStart = pos
      var n = 0
      while (true) {
        val b = input.read()
        if (b < 0) {
          if (n == 0) return null
          throw IllegalArgumentException("$what: unterminated word at end of buffer")
        }
        pos++
        if (b == 0) break
        if (n == word.size) {
          if (n == MAX_WORD_BYTES) {
            throw IllegalArgumentException("$what: word too long at offset $recordStart")
          }
          word = word.copyOf(minOf(n * 2, MAX_WORD_BYTES))
        }
        word[n++] = b.toByte()
      }
      if (n == 0) {
        throw IllegalArgumentException("$what: empty word at offset $recordStart")
      }
      return String(word, 0, n, Charsets.UTF_8)
    }

    // A big-endian unsigned field of `bytes` width (4 or 8).
    fun unsigned(bytes: Int): Long {
      var v = 0L
      repeat(bytes) {
        val b = input.read()
        if (b < 0) {
          throw IllegalArgumentException(
            "$what: truncated record after word at offset $recordStart",
          )
        }
        v = (v shl 8) or b.toLong()
      }
      pos += bytes
      return v
    }

    override fun close() = input.close()
  }

  // --- SQLite write (STREAMING; schema.ts DDL literals; meta LAST) ----

  // Streams .idx into `entries` (rowid = ordinal + 1) and then .syn into
  // `aliases`, reading ONE definition at a time from the mmap'd body.
  // Returns the number of .idx records inserted.
  private fun writeDbStreaming(
    dbPath: String,
    idxFile: File,
    idxoffsetbits: Int,
    synPath: String?,
    body: MappedByteBuffer,
    bodySize: Long,
    // The .ifo sametypesequence (null = absent). Drives splitDictEntry
    // (strip the per-entry type byte + NUL) and the per-row format
    // derivation. `formatOverride` (from the validated sidecar) wins
    // over the derived format when set — precedence: override ?: derived.
    sametypesequence: String?,
    formatOverride: String?,
    builtAt: String,
  ): Int {
    // Start clean so reruns are deterministic. This DELIBERATELY duplicates the
    // TS spine's pre-clean discard(target) (runImport.ts): the native module
    // must be standalone-correct regardless of who calls it, so it never relies
    // on the caller having cleaned the slot. The CSV produce-step, by contrast,
    // dropped its own DELETE and leans on the spine (JS-only path).
    File(dbPath).delete()
    val db = SQLiteDatabase.openOrCreateDatabase(dbPath, null)
    val idxCount: Int
    try {
      db.execSQL(CREATE_ENTRIES_TABLE)
      db.execSQL(CREATE_ALIASES_TABLE)
      db.beginTransaction()
      try {
        idxCount = insertEntries(
          db.compileStatement(INSERT_STARDICT_ENTRY),
          idxFile,
          idxoffsetbits,
          body,
          bodySize,
          sametypesequence,
          formatOverride,
          dbPath,
        )
        val synFile = synPath?.let(::File)
        if (synFile != null && synFile.exists() && synFile.length() > 0) {
          insertAliases(
            db.compileStatement(INSERT_ALIAS),
            synFile,
            idxCount,
          )
        }
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
      // Indexes AFTER the bulk load (schema.ts CREATE_*_INDEX).
      db.execSQL(CREATE_ENTRIES_INDEX)
      db.execSQL(CREATE_ALIASES_INDEX)
      // meta LAST (schema.ts CREATE_META_TABLE + INSERT_META).
      db.execSQL(CREATE_META_TABLE)
      db.execSQL(
        INSERT_META,
        arrayOf<Any>(SCHEMA_VERSION, builtAt),
      )
    } finally {
      db.close()
    }
    return idxCount
  }

  // One `entries` row per .idx record, in file order, so rowid == ordinal
  // + 1 and a .syn ordinal maps straight to its row. No dedup: a folded
  // key shared by several records keeps every row, and lookup takes the
  // lowest rowid (first-key-wins). A record whose word folds to an empty
  // key is stored too (it keeps the rowid mapping) but is never looked up.
  // Each raw .dict slice is split (strip the sts-absent type byte + NUL)
  // BEFORE decode, and its format derived per entry from the type char
  // unless the sidecar overrides it (mirror dictEntry.ts).
  private fun insertEntries(
    stmt: SQLiteStatement,
    idxFile: File,
    idxoffsetbits: Int,
    body: MappedByteBuffer,
    bodySize: Long,
    sametypesequence: String?,
    formatOverride: String?,
    dbPath: String,
  ): Int {
    val offsetBytes = if (idxoffsetbits == 64) 8 else 4
    var count = 0
    RecordReader(idxFile, "parseIdx").use { reader ->
      while (true) {
        val word = reader.nextWord() ?: break
        val offset = reader.unsigned(offsetBytes)
        val length = reader.unsigned(4).toInt()
        // A corrupt/truncated dict (real: star_trungviet) has .idx records
        // reaching past the .dict body. Such a record is still inserted,
        // with an empty definition, so rowid == ordinal + 1 and the count
        // hold; the import used to fail on it. The keyed lookup skips
        // empty-definition rows, so such a word misses or falls through to
        // the next row for its key instead of showing a blank card. The
        // overrun arithmetic is unit-tested host-side via dictBodyOverrun
        // in dictEntry.ts.
        val raw = readDef(body, bodySize, offset, length) ?: ByteArray(0).also {
          Log.w(
            TAG,
            "dict \"$dbPath\": .idx record ${count + 1} \"$word\" overruns the .dict " +
              "body by ${dictBodyOverrun(offset + length, bodySize)} bytes; stored empty",
          )
        }
        val split = splitDictEntry(sametypesequence, raw)
        count++
        stmt.clearBindings()
        stmt.bindLong(1, count.toLong())
        stmt.bindString(2, NormalizeKey.fold(word))
        stmt.bindString(3, word)
        stmt.bindString(4, sanitizeDefinition(String(split.payload, Charsets.UTF_8)))
        stmt.bindString(5, formatOverride ?: formatFromTypeChar(split.typeChar))
        stmt.executeInsert()
        if (count % PROGRESS_EVERY == 0) Log.i(TAG, "entries: $count")
      }
    }
    Log.i(TAG, "entries: $count (done)")
    return count
  }

  // One `aliases` row per .syn record pointing at its target's entries
  // rowid. The definition is NOT copied (#44: a 1.5M-record .syn used to
  // duplicate every target body). Out-of-range ordinals and words that
  // fold to an empty key are skipped, as buildDict does.
  private fun insertAliases(stmt: SQLiteStatement, synFile: File, idxCount: Int) {
    var count = 0
    RecordReader(synFile, "parseSyn").use { reader ->
      while (true) {
        val word = reader.nextWord() ?: break
        val ordinal = reader.unsigned(4)
        val key = NormalizeKey.fold(word)
        if (ordinal >= idxCount || key.isEmpty()) continue
        stmt.clearBindings()
        stmt.bindString(1, key)
        stmt.bindLong(2, ordinal + 1)
        stmt.bindString(3, word)
        stmt.executeInsert()
        count++
        if (count % PROGRESS_EVERY == 0) Log.i(TAG, "aliases: $count")
      }
    }
    Log.i(TAG, "aliases: $count (done)")
  }
}
