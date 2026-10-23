package com.sndict.imports

import android.database.sqlite.SQLiteDatabase
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.util.zip.GZIPOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
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
  private data class Row(val word: String, val definition: String, val format: String)

  // Builds a StarDict triple (+ .syn) on disk. `sts == null` writes the
  // sametypesequence-absent layout: each .dict record is the type char,
  // the payload and a trailing NUL (issue #28).
  private fun writeDict(
    entries: List<Entry>,
    sts: String? = "m",
    aliases: List<Pair<String, Int>> = emptyList(),
    gzip: Boolean = false,
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
        idx.writeInt(body.size())
        idx.writeInt(record.size)
        body.write(record)
      }
    }
    val ifo = File(folder, "test.ifo").apply {
      writeText(
        "StarDict's dict ifo file\nversion=3.0.0\nwordcount=${entries.size}\n" +
          "idxfilesize=${index.size()}\n" +
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

  private fun importEntries(
    entries: List<Entry>,
    sts: String? = "m",
    aliases: List<Pair<String, Int>> = emptyList(),
    formatOverride: String? = null,
    gzip: Boolean = false,
  ): Map<String, Row> {
    val (ifo, idx, dict, syn, output) = writeDict(entries, sts, aliases, gzip)
    val count = StarDictImporter.run(
      ifo.path, idx.path, dict.path, syn.path, output.path, formatOverride,
    )
    val rows = linkedMapOf<String, Row>()
    SQLiteDatabase.openDatabase(output.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
      db.rawQuery("SELECT key, word, definition, format FROM entries", null).use { cursor ->
        while (cursor.moveToNext()) {
          rows[cursor.getString(0)] = Row(
            cursor.getString(1), cursor.getString(2), cursor.getString(3),
          )
        }
      }
      db.rawQuery("SELECT COUNT(*) FROM entries", null).use { cursor ->
        assertTrue(cursor.moveToFirst())
        assertEquals(count, cursor.getInt(0))
      }
    }
    assertEquals(rows.size, count)
    return rows
  }

  @Test fun firstKeyWinsAcrossIdxThenSynAndSkipsOutOfRangeAliases() {
    val rows = importEntries(
      listOf(Entry("Guerra", "<p>A surname.</p>"), Entry("guerra", "<p>Armed conflict.</p>")),
      sts = "h",
      aliases = listOf("guerras" to 1, "GUERRA" to 1, "bad" to 99),
      gzip = true,
    )
    assertEquals(
      mapOf(
        "guerra" to Row("Guerra", "<p>A surname.</p>", "html"),
        "guerras" to Row("guerra", "<p>Armed conflict.</p>", "html"),
      ),
      rows,
    )
  }

  @Test fun foldsUnicodeAndPunctuationAndSkipsEmptyKeys() {
    val rows = importEntries(listOf(
      Entry("CAFÉ", "coffee"),
      Entry("café", "a cafe"),
      Entry("rock’n’roll", "music"),
      Entry(" ", "not searchable"),
    ))
    assertEquals(
      mapOf(
        "café" to Row("CAFÉ", "coffee", "plain"),
        "rock'n'roll" to Row("rock’n’roll", "music", "plain"),
      ),
      rows,
    )
  }

  @Test fun stripsThePerEntryTypeByteWhenSametypesequenceIsAbsent() {
    val entries = listOf(Entry("plain", "x < y"), Entry("bold", "<b>HTML</b>", 'h'))
    assertEquals(
      mapOf(
        "plain" to Row("plain", "x < y", "plain"),
        "bold" to Row("bold", "<b>HTML</b>", "html"),
      ),
      importEntries(entries, sts = null),
    )
    assertEquals(
      Row("bold", "<b>HTML</b>", "plain"),
      importEntries(entries, sts = null, formatOverride = "plain")["bold"],
    )
  }

  @Test fun sanitizesReplacementCharactersAtTheEdgesOnly() {
    val rows = importEntries(listOf(Entry("word", "�mean�ing�")))
    assertEquals("mean�ing", rows["word"]!!.definition)
  }

  @Test fun rejectsATruncatedIdxRecord() {
    val (ifo, idx, dict, syn, output) = writeDict(listOf(Entry("word", "def")))
    idx.writeBytes(idx.readBytes().copyOf(idx.length().toInt() - 1))
    assertThrows(IllegalArgumentException::class.java) {
      StarDictImporter.run(ifo.path, idx.path, dict.path, syn.path, output.path, null)
    }
  }
}
