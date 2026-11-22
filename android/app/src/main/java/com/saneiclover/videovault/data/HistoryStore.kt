package com.saneiclover.videovault.data

import android.content.Context
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.HistoryLog
import com.saneiclover.videovault.domain.HistoryStatus
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** ダウンロード履歴の永続化。`files/history.json`。保存先パスは持たない(requirements.md)。 */
class HistoryStore(context: Context) {

    private val file = File(context.filesDir, "history.json")

    fun load(now: Long): HistoryLog {
        val json = JsonFile.read(file) ?: return HistoryLog()
        return runCatching { parse(json) }.getOrElse { HistoryLog() }.settleStale(now)
    }

    fun save(log: HistoryLog) {
        val array = JSONArray()
        log.entries.forEach { e ->
            array.put(
                JSONObject()
                    .put("id", e.id)
                    .put("url", e.url)
                    .put("siteName", e.siteName)
                    .put("title", e.title ?: JSONObject.NULL)
                    .put("startedAt", e.startedAt)
                    .put("finishedAt", e.finishedAt ?: JSONObject.NULL)
                    .put("status", e.status.name)
                    .put("error", e.error ?: JSONObject.NULL)
                    .put("quality", e.quality ?: JSONObject.NULL),
            )
        }
        JsonFile.write(file, JSONObject().put("version", 1).put("entries", array).toString())
    }

    private fun parse(json: String): HistoryLog {
        val array = JSONObject(json).getJSONArray("entries")
        val entries = (0 until array.length()).map { i ->
            val o = array.getJSONObject(i)
            HistoryEntry(
                id = o.getString("id"),
                url = o.getString("url"),
                siteName = o.optString("siteName"),
                title = o.optString("title").takeIf { !o.isNull("title") && it.isNotBlank() },
                startedAt = o.getLong("startedAt"),
                finishedAt = if (o.isNull("finishedAt")) null else o.getLong("finishedAt"),
                status = runCatching { HistoryStatus.valueOf(o.getString("status")) }
                    .getOrDefault(HistoryStatus.FAILED),
                error = o.optString("error").takeIf { !o.isNull("error") && it.isNotBlank() },
                quality = o.optString("quality").takeIf { !o.isNull("quality") && it.isNotBlank() },
            )
        }
        return HistoryLog(entries)
    }
}
