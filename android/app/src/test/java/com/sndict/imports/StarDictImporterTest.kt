package com.sndict.imports

import android.database.sqlite.SQLiteDatabase
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.util.zip.GZIPOutputStream
import org.junit.Assert.assertEquals
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

  private fun import(
    entries: List<Entry>,
    sts: String? = "m",
    aliases: List<Pair<String, Int>> = emptyList(),
    override: String? = null,
    gzip: Boolean = false,
  ): Map<String, Row> {
    val folder = temp.newFolder()
    val body = ByteArrayOutputStream()
    val index = ByteArrayOutputStream()
    DataOutputStream(index).use { idx ->
      for (entry in entries) {
        val payload = entry.definition.toByteArray(Charsets.UTF_8)
        val record = if (sts == null) byteArrayOf(entry.type.code.toByte()) +
          payload + byteArrayOf(0) else payload
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
    val output = File(folder, "test.db")
    val count = StarDictImporter.run(
      ifo.path, idx.path, dict.path, syn.path, output.path, override,
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
    assertTrue(ifo.exists() && idx.exists() && dict.exists() && syn.exists())
    return rows
  }

  @Test fun preservesGuerraSensesAndExactAliasTargets() {
    val rows = import(
      listOf(Entry("Guerra", "<p>A surname.</p>"), Entry("guerra", "<p>Armed conflict.</p>")),
      sts = "h",
      aliases = listOf("guerras" to 1, "GUERRA" to 1, "bad" to 99),
      gzip = true,
    )
    assertEquals(2, rows.size)
    assertEquals(
      Row("Guerra", "<p>A surname.</p><br/><br/><p>Armed conflict.</p>", "html"),
      rows["guerra"],
    )
    assertEquals(Row("guerra", "<p>Armed conflict.</p>", "html"), rows["guerras"])
  }

  @Test fun retainsSameSpellingHomographsAndDeduplicatesIdenticalBodies() {
    val rows = import(listOf(
      Entry("same", "first"),
      Entry("same", "second"),
      Entry("same", "first"),
      Entry("single", "unchanged"),
    ))
    assertEquals(Row("same", "first\n\nsecond", "plain"), rows["same"])
    assertEquals(Row("single", "unchanged", "plain"), rows["single"])
  }

  @Test fun handlesUnicodeAndPunctuationCollisions() {
    val rows = import(listOf(
      Entry("CAF\u00c9", "coffee"),
      Entry("cafe\u0301", "coffee"),
      Entry("caf\u00e9", "a cafe"),
      Entry("rock'n'roll", "a dance"),
      Entry("rock\u2019n\u2019roll", "music"),
      Entry(" ", "not searchable"),
    ))
    assertEquals(2, rows.size)
    assertEquals("coffee\n\na cafe", rows["caf\u00e9"]!!.definition)
    assertEquals("a dance\n\nmusic", rows["rock'n'roll"]!!.definition)
  }

  @Test fun escapesPlainTextWhenMergingMixedFormats() {
    val entries = listOf(
      Entry("Test", "x < y & z > 0\r\nnext"),
      Entry("test", "<b>HTML</b>", 'h'),
    )
    assertEquals(
      Row("Test", "x &lt; y &amp; z &gt; 0<br/>next<br/><br/><b>HTML</b>", "html"),
      import(entries, sts = null)["test"],
    )
    assertEquals(
      Row("Test", "x < y & z > 0\r\nnext\n\n<b>HTML</b>", "plain"),
      import(entries, sts = null, override = "plain")["test"],
    )
  }

  @Test fun sanitizesEachCollisionBeforeDeduplication() {
    val rows = import(listOf(
      Entry("EMPTY", ""),
      Entry("Empty", "\uFFFDmeaning\uFFFD"),
      Entry("empty", "meaning"),
    ))
    assertEquals("\n\nmeaning", rows["empty"]!!.definition)
  }
}
