package com.sndict.imports

import android.database.sqlite.SQLiteDatabase
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.GZIPInputStream

// DEVICE-UNVERIFIED. Native StarDict importer (ADR-0006 Option 2):
// parse the triple (+ optional .syn) and bulk-insert into a per-dict
// SQLite DB, ALL off the Hermes/JS thread. Logic mirrors the TS path
// EXACTLY so natively-imported dicts are byte-identical to base.db:
//   - .ifo  -> parseIfo.ts (sametypesequence, idxoffsetbits 32|64)
//   - .dict -> dictReader (gzip inflate when .dz / 0x1f8b magic)
//   - .idx  -> parseIdx.ts (word\0 + BE offset(u32|u64) + BE length(u32))
//   - .syn  -> parseSyn.ts + buildDict merge (.idx first, then .syn,
//              first-key-wins, normalizeKey-folded, out-of-range skipped)
//   - SQLite -> schema.ts DDL literals + SCHEMA_VERSION; meta LAST.

private const val SCHEMA_VERSION = 2 // MUST match buildBaseDb.ts SCHEMA_VERSION

private data class IdxEntry(val word: String, val offset: Long, val length: Int)
private data class StoredEntry(val word: String, val definition: String)

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
    val format = formatOverride ?: ifo.format

    val body = readDictBody(dictPath)
    val idxEntries = parseIdx(File(idxPath).readBytes(), ifo.idxoffsetbits)

    // Merge into a LinkedHashMap: .idx first (first-key-wins), then .syn.
    val entries = LinkedHashMap<String, StoredEntry>()
    for (e in idxEntries) {
      val key = NormalizeKey.fold(e.word)
      if (key.isNotEmpty() && !entries.containsKey(key)) {
        entries[key] = StoredEntry(e.word, sliceUtf8(body, e.offset, e.length))
      }
    }
    if (synPath != null) {
      val synFile = File(synPath)
      if (synFile.exists() && synFile.length() > 0) {
        for (syn in parseSyn(synFile.readBytes())) {
          val target = idxEntries.getOrNull(syn.originalWordIndex) ?: continue
          val key = NormalizeKey.fold(syn.word)
          if (key.isNotEmpty() && !entries.containsKey(key)) {
            // Alias keys point at the canonical .idx entry (its headword
            // + definition), exactly like buildDict's .syn merge.
            entries[key] = StoredEntry(
              target.word,
              sliceUtf8(body, target.offset, target.length),
            )
          }
        }
      }
    }

    writeDb(dbPath, entries, format, builtAt(ifo))
    return entries.size
  }

  // --- .ifo (mirror parseIfo.ts) -------------------------------------

  private data class IfoMeta(
    val format: String,
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
    // sametypesequence -> format (matches formatFromSametypesequence).
    val sts = map["sametypesequence"]
    val format = if (sts == "h") "html" else "plain"
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
    return IfoMeta(format, bits, map["date"], map["bookname"], map["wordcount"])
  }

  // Deterministic built_at (mirror deterministicBuiltAt).
  private fun builtAt(ifo: IfoMeta): String {
    val date = ifo.date
    if (date != null && date.isNotEmpty()) return date
    return "${ifo.bookname ?: "base"}@${ifo.wordcount ?: ""}"
  }

  // --- .dict body (mirror dictReader: gzip inflate when .dz/magic) ----

  private fun readDictBody(dictPath: String): ByteArray {
    val raw = File(dictPath).readBytes()
    val isGzip = dictPath.lowercase(java.util.Locale.ROOT).endsWith(".dz") ||
      (raw.size >= 2 && raw[0].toInt() and 0xff == 0x1f && raw[1].toInt() and 0xff == 0x8b)
    if (!isGzip) return raw
    // dictzip is a valid end-to-end gzip stream — full inflate is fine
    // at import time (no per-entry random access needed here).
    GZIPInputStream(raw.inputStream()).use { gz ->
      val out = ByteArrayOutputStream(raw.size * 3)
      gz.copyTo(out)
      return out.toByteArray()
    }
  }

  private fun sliceUtf8(body: ByteArray, offset: Long, length: Int): String {
    val start = offset.toInt()
    val end = start + length
    if (start < 0 || end > body.size || start > end) {
      throw IndexOutOfBoundsException(
        "dict slice out of bounds: offset=$offset length=$length size=${body.size}",
      )
    }
    return String(body, start, length, Charsets.UTF_8)
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

  // --- SQLite write (schema.ts DDL literals; meta LAST) ---------------

  private fun writeDb(
    dbPath: String,
    entries: LinkedHashMap<String, StoredEntry>,
    format: String,
    builtAt: String,
  ) {
    // Start clean so reruns are deterministic.
    File(dbPath).delete()
    val db = SQLiteDatabase.openOrCreateDatabase(dbPath, null)
    try {
      // SAME DDL as schema.ts CREATE_ENTRIES_TABLE.
      db.execSQL(
        "CREATE TABLE IF NOT EXISTS entries (" +
          "key TEXT NOT NULL, word TEXT NOT NULL, " +
          "definition TEXT NOT NULL, format TEXT NOT NULL)",
      )
      db.beginTransaction()
      try {
        val stmt = db.compileStatement(
          "INSERT INTO entries (key, word, definition, format) VALUES (?, ?, ?, ?)",
        )
        for ((key, e) in entries) {
          stmt.clearBindings()
          stmt.bindString(1, key)
          stmt.bindString(2, e.word)
          stmt.bindString(3, e.definition)
          stmt.bindString(4, format)
          stmt.executeInsert()
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
  }
}
