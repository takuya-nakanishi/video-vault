package com.saneiclover.videovault.data

import android.content.Context
import com.saneiclover.videovault.domain.Bookmark
import com.saneiclover.videovault.domain.DefaultBookmarks
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * ブックマークの永続化。`files/bookmarks.json`。
 * 初回(ファイルが無い)は既定のブックマークを入れる。全部消した状態はファイルに空配列として残り、
 * 既定は二度と復活しない(消したものが勝手に戻るのは不快なため)。
 */
class BookmarkStore(context: Context) {

    private val file = File(context.filesDir, "bookmarks.json")

    fun load(now: Long): List<Bookmark> {
        val json = JsonFile.read(file) ?: return DefaultBookmarks.seed(now).also(::save)
        return runCatching { parse(json) }.getOrElse { emptyList() }
    }

    fun save(bookmarks: List<Bookmark>) {
        val array = JSONArray()
        bookmarks.forEach { b ->
            array.put(
                JSONObject()
                    .put("id", b.id)
                    .put("name", b.name)
                    .put("url", b.url)
                    .put("createdAt", b.createdAt),
            )
        }
        JsonFile.write(file, JSONObject().put("version", 1).put("bookmarks", array).toString())
    }

    private fun parse(json: String): List<Bookmark> {
        val array = JSONObject(json).getJSONArray("bookmarks")
        return (0 until array.length()).map { i ->
            val o = array.getJSONObject(i)
            Bookmark(
                id = o.getString("id"),
                name = o.getString("name"),
                url = o.getString("url"),
                createdAt = o.optLong("createdAt"),
            )
        }.sortedBy { it.createdAt }
    }
}
