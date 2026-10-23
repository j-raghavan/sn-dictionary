package com.sndict.imports

import android.database.sqlite.SQLiteDatabase
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.zip.GZIPOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class StarDictImporterTest {
  @get:Rule val temp = TemporaryFolder()

  private data class Entry(val word: String, val definition: String, val type: Char = 'm')
  private data class EntryRow(
    val rowid: Long,
    val key: String,
    val word: String,
    val definition: String,
    val format: String,
  )
  private data class AliasRow(val key: String, val entryRowid: Long, val word: String)
  private data class Imported(val entries: List<EntryRow>, val aliases: List<AliasRow>)

  // Builds a StarDict triple (+ .syn) on disk. `sts == null` writes the
  // sametypesequence-absent layout: each .dict record is the type char,
  // the payload and a trailing NUL (issue #28).
  private fun writeDict(
    entries: List<Entry>,
    sts: String? = "m",
    aliases: List<Pair<String, Int>> = emptyList(),
    gzip: Boolean = false,
    offsetBits: Int = 32,
  ): Array<File> {
    val folder = temp.newFolder()
    val body = ByteArrayOutputStream()
    val index = ByteArrayOutputStream()
    DataOutputStream(index).use { idx ->
      for (entry in entries) {
        val payload = entry.definition.toByteArray(Charsets.UTF_8)
        val record = if (sts == null) {
          byteArrayOf(entry.type.code.toByte()) + payload + byteArrayOf(0)
        } else {
          payload
        }
        idx.write(entry.word.toByteArray(Charsets.UTF_8))
        idx.writeByte(0)
        if (offsetBits == 64) idx.writeLong(body.size().toLong()) else idx.writeInt(body.size())
        idx.writeInt(record.size)
        body.write(record)
      }
    }
    val ifo = File(folder, "test.ifo").apply {
      writeText(
        "StarDict's dict ifo file\nversion=3.0.0\nwordcount=${entries.size}\n" +
          "idxfilesize=${index.size()}\nidxoffsetbits=$offsetBits\n" +
          (if (sts == null) "" else "sametypesequence=$sts\n"),
      )
    }
    val idx = File(folder, "test.idx").apply { writeBytes(index.toByteArray()) }
    val dict = File(folder, if (gzip) "test.dict.dz" else "test.dict")
    if (gzip) {
      GZIPOutputStream(dict.outputStream()).use { it.write(body.toByteArray()) }
    } else {
      dict.writeBytes(body.toByteArray())
    }
    val syn = File(folder, "test.syn")
    DataOutputStream(syn.outputStream()).use { out ->
      for ((word, target) in aliases) {
        out.write(word.toByteArray(Charsets.UTF_8))
        out.writeByte(0)
        out.writeInt(target)
      }
    }
    return arrayOf(ifo, idx, dict, syn, File(folder, "test.db"))
  }

  // Imports, then reads back every row. Also pins the count contract
  // runImport verifies: the returned count == COUNT(*) FROM entries.
  private fun import(files: Array<File>, formatOverride: String? = null): Imported {
    val (ifo, idx, dict, syn, output) = files
    val count = StarDictImporter.run(
      ifo.path, idx.path, dict.path, syn.path, output.path, formatOverride,
    )
    SQLiteDatabase.openDatabase(output.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
      val entries = db.rawQuery(
        "SELECT rowid, key, word, definition, format FROM entries ORDER BY rowid", null,
      ).use { c ->
        generateSequence { if (c.moveToNext()) c else null }
          .map { EntryRow(it.getLong(0), it.getString(1), it.getString(2), it.getString(3), it.getString(4)) }
          .toList()
      }
      val aliases = db.rawQuery(
        "SELECT key, entry_rowid, word FROM aliases ORDER BY rowid", null,
      ).use { c ->
        generateSequence { if (c.moveToNext()) c else null }
          .map { AliasRow(it.getString(0), it.getLong(1), it.getString(2)) }
          .toList()
      }
      assertEquals(entries.size, count)
      return Imported(entries, aliases)
    }
  }

  private fun importEntries(
    entries: List<Entry>,
    sts: String? = "m",
    aliases: List<Pair<String, Int>> = emptyList(),
    formatOverride: String? = null,
    gzip: Boolean = false,
  ): Imported = import(writeDict(entries, sts, aliases, gzip), formatOverride)

  @Test fun writesOneEntryPerIdxRecordAndOneAliasPerInRangeSynRecord() {
    val imported = importEntries(
      listOf(Entry("Guerra", "<p>A surname.</p>"), Entry("guerra", "<p>Armed conflict.</p>")),
      sts = "h",
      aliases = listOf("guerras" to 1, "GUERRA" to 1, "past-end" to 2, "bad" to 99, " " to 0),
      gzip = true,
    )
    assertEquals(
      listOf(
        EntryRow(1, "guerra", "Guerra", "<p>A surname.</p>", "html"),
        EntryRow(2, "guerra", "guerra", "<p>Armed conflict.</p>", "html"),
      ),
      imported.entries,
    )
    assertEquals(
      listOf(AliasRow("guerras", 2, "guerras"), AliasRow("guerra", 2, "GUERRA")),
      imported.aliases,
    )
  }

  @Test fun foldsUnicodeAndPunctuationAndKeepsEmptyKeyRecordsForTheRowidMapping() {
    val imported = importEntries(
      listOf(
        Entry("CAFÉ", "coffee"),
        Entry(" ", "not searchable"),
        Entry("rock’n’roll", "music"),
      ),
      aliases = listOf("cafés" to 0, "rock and roll" to 2),
    )
    assertEquals(
      listOf("café", "", "rock'n'roll"),
      imported.entries.map { it.key },
    )
    assertEquals(listOf(1L, 2L, 3L), imported.entries.map { it.rowid })
    assertEquals(
      listOf(AliasRow("cafés", 1, "cafés"), AliasRow("rock and roll", 3, "rock and roll")),
      imported.aliases,
    )
  }

  @Test fun stripsThePerEntryTypeByteWhenSametypesequenceIsAbsent() {
    val entries = listOf(Entry("plain", "x < y"), Entry("bold", "<b>HTML</b>", 'h'))
    assertEquals(
      listOf(
        EntryRow(1, "plain", "plain", "x < y", "plain"),
        EntryRow(2, "bold", "bold", "<b>HTML</b>", "html"),
      ),
      importEntries(entries, sts = null, aliases = listOf("strong" to 1)).entries,
    )
    assertEquals(
      listOf("plain", "plain"),
      importEntries(entries, sts = null, formatOverride = "plain").entries.map { it.format },
    )
  }

  @Test fun readsSixtyFourBitIdxOffsets() {
    val imported = import(
      writeDict(listOf(Entry("one", "first"), Entry("two", "second")), offsetBits = 64),
    )
    assertEquals(listOf("first", "second"), imported.entries.map { it.definition })
  }

  @Test fun sanitizesReplacementCharactersAtTheEdgesOnly() {
    val imported = importEntries(listOf(Entry("word", "�mean�ing�")))
    assertEquals("mean�ing", imported.entries.single().definition)
  }

  @Test fun rejectsATruncatedIdxRecord() {
    val files = writeDict(listOf(Entry("word", "def")))
    val idx = files[1]
    idx.writeBytes(idx.readBytes().copyOf(idx.length().toInt() - 1))
    val e = assertThrows(IllegalArgumentException::class.java) { import(files) }
    assertEquals("parseIdx: truncated record after word at offset 0", e.message)
  }

  @Test fun removesTheInflatedTempFileWhenAnImportFails() {
    val files = writeDict(listOf(Entry("word", "def")), gzip = true)
    val (_, idx, _, _, output) = files
    idx.writeBytes(idx.readBytes().copyOf(idx.length().toInt() - 1))
    assertThrows(IllegalArgumentException::class.java) { import(files) }
    assertEquals(listOf<String>(), output.parentFile!!.list()!!.filter { it.endsWith(".tmp") })
  }

  @Test fun sizesAPlainBodyFromTheFileAndAGzipBodyFromItsTrailer() {
    val entries = listOf(Entry("word", "x".repeat(70_000)), Entry("other", "def"))
    val plain = writeDict(entries)[2]
    assertEquals(
      StarDictImporter.BodySize(70_003, inflated = false),
      StarDictImporter.dictBodySize(plain.path),
    )
    val gzip = writeDict(entries, gzip = true)[2]
    assertEquals(
      StarDictImporter.BodySize(70_003, inflated = true),
      StarDictImporter.dictBodySize(gzip.path),
    )
  }

  @Test fun rejectsADzBodyWithoutTheGzipMagic() {
    val dz = File(temp.newFolder(), "plain.dict.dz").apply { writeText("not compressed at all") }
    val e = assertThrows(IllegalArgumentException::class.java) { StarDictImporter.dictBodySize(dz.path) }
    assertEquals("not gzip: ${dz.path}", e.message)
  }

  @Test fun rejectsAGzipBodyTooShortToHoldATrailer() {
    val dz = File(temp.newFolder(), "short.dict.dz").apply { writeBytes(byteArrayOf(0x1f, 0x8b.toByte())) }
    assertThrows(IllegalArgumentException::class.java) { StarDictImporter.dictBodySize(dz.path) }
  }

  @Test fun storesAnIdxRecordThatOverrunsTheBodyWithAnEmptyDefinition() {
    // "A" folds onto "a" and its slice reaches past the end of a truncated
    // .dict: it is kept (rowid and count stay aligned) but empty, and the
    // lookup still serves "a" first.
    val files = writeDict(listOf(Entry("a", "first"), Entry("A", "second")))
    val dict = files[2]
    dict.writeBytes(dict.readBytes().copyOf(8))
    assertEquals(
      listOf(
        EntryRow(1, "a", "a", "first", "plain"),
        EntryRow(2, "a", "A", "", "plain"),
      ),
      import(files).entries,
    )
  }

  @Test fun rejectsAWordLongerThanTheCap() {
    val files = writeDict(listOf(Entry("word", "def")))
    files[1].writeBytes(ByteArray(70_000) { 'x'.code.toByte() })
    val e = assertThrows(IllegalArgumentException::class.java) { import(files) }
    assertEquals("parseIdx: word too long at offset 0", e.message)
  }

  @Test fun rejectsAnEmptyIdxWord() {
    val e = assertThrows(IllegalArgumentException::class.java) {
      importEntries(listOf(Entry("word", "def"), Entry("", "orphan")))
    }
    assertEquals("parseIdx: empty word at offset 13", e.message)
  }

  @Test fun rejectsAnUnterminatedSynWord() {
    val files = writeDict(listOf(Entry("word", "def")), aliases = listOf("alias" to 0))
    files[3].appendBytes("tail".toByteArray(Charsets.UTF_8))
    val e = assertThrows(IllegalArgumentException::class.java) { import(files) }
    assertEquals("parseSyn: unterminated word at end of buffer", e.message)
  }

  // #44: a dict with a large .syn (reader-dict fr-fr: 523k words, 1.56M
  // synonyms) exhausted the ~192MB host heap because the importer held the
  // whole .idx/.syn plus entry lists and a dedup set. Run with the unit-test
  // heap capped (build.gradle testOptions) so a regression to whole-file or
  // per-record collections fails here instead of on a device.
  @Test fun importsHalfAMillionWordsWithTwoMillionSynonymsInABoundedHeap() {
    val words = 500_000
    val synonyms = 2_000_000
    val folder = temp.newFolder()
    val ifo = File(folder, "big.ifo").apply {
      writeText("StarDict's dict ifo file\nversion=3.0.0\nwordcount=$words\nsametypesequence=m\n")
    }
    val idx = File(folder, "big.idx")
    DataOutputStream(FileOutputStream(idx).buffered()).use { out ->
      for (i in 0 until words) {
        out.write("headword$i".toByteArray(Charsets.UTF_8))
        out.writeByte(0)
        out.writeInt(i)
        out.writeInt(1)
      }
    }
    val dict = File(folder, "big.dict").apply { writeBytes(ByteArray(words) { 'd'.code.toByte() }) }
    val syn = File(folder, "big.syn")
    DataOutputStream(FileOutputStream(syn).buffered()).use { out ->
      for (i in 0 until synonyms) {
        out.write("synonym$i".toByteArray(Charsets.UTF_8))
        out.writeByte(0)
        out.writeInt(i % words)
      }
    }
    val output = File(folder, "big.db")
    val count = StarDictImporter.run(ifo.path, idx.path, dict.path, syn.path, output.path, null)
    assertEquals(words, count)
    SQLiteDatabase.openDatabase(output.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
      db.rawQuery(
        "SELECT (SELECT COUNT(*) FROM entries), (SELECT COUNT(*) FROM aliases), " +
          "(SELECT e.word FROM aliases a JOIN entries e ON e.rowid = a.entry_rowid " +
          "WHERE a.key = 'synonym1999999')",
        null,
      ).use { c ->
        c.moveToFirst()
        assertEquals(words, c.getInt(0))
        assertEquals(synonyms, c.getInt(1))
        assertEquals("headword499999", c.getString(2))
      }
    }
  }
}
