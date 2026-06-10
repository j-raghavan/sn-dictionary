package com.sndict.imports

import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.StandardOpenOption
import java.util.zip.GZIPInputStream

// DEVICE-UNVERIFIED. Native StarDict importer (ADR-0006 Option 2):
// parse the triple (+ optional .syn) and bulk-insert into a per-dict
// SQLite DB, ALL off the Hermes/JS thread. Logic mirrors the TS path
// EXACTLY so natively-imported dicts are byte-identical to base.db:
//   - .ifo  -> parseIfo.ts (sametypesequence, idxoffsetbits 32|64)
//   - .dict -> dictReader (gzip inflate when .dz / 0x1f8b magic);
//             each entry's slice -> splitDictEntry (strip sts-absent
//             type byte + trailing NUL) + formatFromTypeChar (mirror
//             dictEntry.ts) before decode (issue #28)
//   - .idx  -> parseIdx.ts (word\0 + BE offset(u32|u64) + BE length(u32))
//   - .syn  -> parseSyn.ts + buildDict merge (.idx first, then .syn,
//              first-key-wins, normalizeKey-folded, out-of-range skipped)
//   - SQLite -> schema.ts DDL literals + SCHEMA_VERSION; meta LAST.
//
// MEMORY (M11): the host process caps the Java heap at ~192MB and we
// can't raise it. So we NEVER materialize the whole dict in heap:
//   - the .dict body is inflated to a TEMP FILE (streaming, ~constant
//     heap) and read OFF-HEAP via an mmap'd MappedByteBuffer (on-demand
//     paging — doesn't count against the Java heap);
//   - we keep only the lightweight idxEntries (word + offset + length,
//     no definitions) plus a `seen` HashSet for first-key-wins dedup;
//   - definitions are read + inserted ONE AT A TIME inside the
//     transaction, so only a single definition String is ever live.
// The output DB is byte-identical to the prior all-in-heap version —
// only HOW we read the body and WHEN we insert changed.

private const val SCHEMA_VERSION = 3 // MUST match buildBaseDb.ts SCHEMA_VERSION (v3: + phonetic col, ADR-0008)

private data class IdxEntry(val word: String, val offset: Long, val length: Int)

object StarDictImporter {

  // Returns the number of entries inserted (== distinct folded keys).
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

    // .idx walk holds only words + offsets/lengths (no definitions).
    val idxEntries = parseIdx(File(idxPath).readBytes(), ifo.idxoffsetbits)

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
        idxEntries = idxEntries,
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

  // Read `length` raw bytes at `offset` from the mmap'd body. Bounds-
  // checked (same guard as before). Returns the RAW slice — the caller
  // runs splitDictEntry to strip any sts-absent type prefix/NUL BEFORE
  // decoding to UTF-8 (issue #28; mirrors dictEntry.ts).
  private fun readDef(
    body: MappedByteBuffer,
    bodySize: Long,
    offset: Long,
    length: Int,
  ): ByteArray {
    val end = offset + length
    if (offset < 0 || length < 0 || end > bodySize) {
      throw IndexOutOfBoundsException(
        "dict slice out of bounds: offset=$offset length=$length size=$bodySize",
      )
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

  // sts PRESENT  -> whole slice is the payload, typeChar null.
  // sts ABSENT   -> raw[0] is the ASCII type char; the rest is the body
  //                 minus exactly one trailing 0x00 when present.
  // empty slice  -> {empty, null} (guard before indexing raw[0]).
  // multi-char sts is out of scope: whole slice payload, typeChar null.
  private fun splitDictEntry(sametypesequence: String?, raw: ByteArray): SplitEntry {
    if (raw.isEmpty()) {
      return SplitEntry(raw, null)
    }
    if (sametypesequence != null && sametypesequence.isNotEmpty()) {
      return SplitEntry(raw, null)
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

  // --- .idx (mirror parseIdx.ts EXACTLY, big-endian) ------------------

  private fun parseIdx(bytes: ByteArray, idxoffsetbits: Int): List<IdxEntry> {
    val entries = ArrayList<IdxEntry>()
    val buf = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
    val offsetBytes = if (idxoffsetbits == 64) 8 else 4
    val recordTrailerBytes = offsetBytes + 4
    var i = 0
    while (i < bytes.size) {
      var end = i
      while (end < bytes.size && bytes[end].toInt() != 0) end++
      if (end >= bytes.size) {
        throw IllegalArgumentException("parseIdx: unterminated word at end of buffer")
      }
      if (end == i) {
        throw IllegalArgumentException("parseIdx: empty word at offset $i")
      }
      if (end + 1 + recordTrailerBytes > bytes.size) {
        throw IllegalArgumentException("parseIdx: truncated record after word at offset $i")
      }
      val word = String(bytes, i, end - i, Charsets.UTF_8)
      var pos = end + 1
      val offset: Long
      if (idxoffsetbits == 64) {
        val hi = buf.getInt(pos).toLong() and 0xffffffffL
        val lo = buf.getInt(pos + 4).toLong() and 0xffffffffL
        offset = hi * 0x100000000L + lo
        pos += 8
      } else {
        offset = buf.getInt(pos).toLong() and 0xffffffffL
        pos += 4
      }
      val length = (buf.getInt(pos).toLong() and 0xffffffffL).toInt()
      pos += 4
      entries.add(IdxEntry(word, offset, length))
      i = pos
    }
    return entries
  }

  // --- .syn (mirror parseSyn.ts) -------------------------------------

  private data class SynEntry(val word: String, val originalWordIndex: Int)

  private fun parseSyn(bytes: ByteArray): List<SynEntry> {
    val entries = ArrayList<SynEntry>()
    val buf = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
    var i = 0
    while (i < bytes.size) {
      var end = i
      while (end < bytes.size && bytes[end].toInt() != 0) end++
      if (end >= bytes.size) {
        throw IllegalArgumentException("parseSyn: unterminated word at end of buffer")
      }
      if (end == i) {
        throw IllegalArgumentException("parseSyn: empty word at offset $i")
      }
      if (end + 1 + 4 > bytes.size) {
        throw IllegalArgumentException("parseSyn: truncated record after word at offset $i")
      }
      val word = String(bytes, i, end - i, Charsets.UTF_8)
      val originalWordIndex = (buf.getInt(end + 1).toLong() and 0xffffffffL).toInt()
      entries.add(SynEntry(word, originalWordIndex))
      i = end + 1 + 4
    }
    return entries
  }

  // --- SQLite write (STREAMING; schema.ts DDL literals; meta LAST) ----

  // Streams the merge+insert: .idx first then .syn, first-key-wins via a
  // `seen` set, reading ONE definition at a time from the mmap'd body.
  // Returns the number of distinct keys inserted (== prior map.size).
  private fun writeDbStreaming(
    dbPath: String,
    idxEntries: List<IdxEntry>,
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
    // Start clean so reruns are deterministic.
    File(dbPath).delete()
    val db = SQLiteDatabase.openOrCreateDatabase(dbPath, null)
    val seen = HashSet<String>()
    try {
      // SAME DDL as schema.ts CREATE_ENTRIES_TABLE (schema v3): the
      // nullable `phonetic TEXT` last column keeps StarDict slugs the same
      // shape as CSV slugs + base.db. The 4-col INSERT below leaves it
      // NULL (StarDict carries no phonetic).
      db.execSQL(
        "CREATE TABLE IF NOT EXISTS entries (" +
          "key TEXT NOT NULL, word TEXT NOT NULL, " +
          "definition TEXT NOT NULL, format TEXT NOT NULL, phonetic TEXT)",
      )
      db.beginTransaction()
      try {
        val stmt = db.compileStatement(
          "INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)",
        )
        // .idx first (first-key-wins). Only one definition String is
        // live per iteration (GC-eligible after executeInsert). Each
        // entry's raw .dict slice is split (strip sts-absent type byte +
        // NUL) BEFORE decode, and its format derived per-entry from the
        // type char unless the sidecar overrides it (mirror dictEntry.ts).
        for (e in idxEntries) {
          val key = NormalizeKey.fold(e.word)
          if (key.isNotEmpty() && seen.add(key)) {
            val split = splitDictEntry(sametypesequence, readDef(body, bodySize, e.offset, e.length))
            val rowFormat = formatOverride ?: formatFromTypeChar(split.typeChar)
            insertRow(stmt, key, e.word, String(split.payload, Charsets.UTF_8), rowFormat)
          }
        }
        // .syn aliases -> canonical .idx entry (its headword + def),
        // mirroring buildDict's merge; out-of-range index skipped. The
        // body + format derive from the TARGET entry's slice.
        if (synPath != null) {
          val synFile = File(synPath)
          if (synFile.exists() && synFile.length() > 0) {
            for (syn in parseSyn(synFile.readBytes())) {
              val target = idxEntries.getOrNull(syn.originalWordIndex) ?: continue
              val key = NormalizeKey.fold(syn.word)
              if (key.isNotEmpty() && seen.add(key)) {
                val split = splitDictEntry(
                  sametypesequence,
                  readDef(body, bodySize, target.offset, target.length),
                )
                val rowFormat = formatOverride ?: formatFromTypeChar(split.typeChar)
                insertRow(
                  stmt,
                  key,
                  target.word,
                  String(split.payload, Charsets.UTF_8),
                  rowFormat,
                )
              }
            }
          }
        }
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
      // Index AFTER the bulk load (schema.ts CREATE_ENTRIES_INDEX).
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_entries_key ON entries(key)")
      // meta LAST (schema.ts CREATE_META_TABLE + INSERT_META).
      db.execSQL(
        "CREATE TABLE IF NOT EXISTS meta (" +
          "schema_version INTEGER NOT NULL, built_at TEXT NOT NULL)",
      )
      db.execSQL(
        "INSERT INTO meta (schema_version, built_at) VALUES (?, ?)",
        arrayOf<Any>(SCHEMA_VERSION, builtAt),
      )
    } finally {
      db.close()
    }
    return seen.size
  }

  private fun insertRow(
    stmt: android.database.sqlite.SQLiteStatement,
    key: String,
    word: String,
    definition: String,
    format: String,
  ) {
    stmt.clearBindings()
    stmt.bindString(1, key)
    stmt.bindString(2, word)
    stmt.bindString(3, definition)
    stmt.bindString(4, format)
    stmt.executeInsert()
  }
}
