package com.saneiclover.videovault.data

import android.content.Context
import android.util.Log
import com.saneiclover.videovault.domain.SiteCatalog
import com.saneiclover.videovault.domain.SiteRule
import org.json.JSONObject

/**
 * `assets/site_patterns.json` を読む。パースはAndroidの `org.json` を使うため、
 * 純粋Kotlinの [SiteCatalog] とは分けてある(こちらは単体テストの対象外)。
 */
object SiteCatalogLoader {

    private const val TAG = "SiteCatalogLoader"
    private const val ASSET_NAME = "site_patterns.json"

    fun load(context: Context): SiteCatalog = runCatching {
        val json = context.assets.open(ASSET_NAME).bufferedReader().use { it.readText() }
        parse(json)
    }.getOrElse {
        // 判定表が壊れていてもアプリは使える状態に落とす(全URLが「ブラウザで開く」になる)
        Log.e(TAG, "判定表を読めなかったため空の判定表で起動する", it)
        SiteCatalog.EMPTY
    }

    fun parse(json: String): SiteCatalog {
        val sites = JSONObject(json).getJSONArray("sites")
        val rules = (0 until sites.length()).map { i ->
            val site = sites.getJSONObject(i)
            val hosts = site.getJSONArray("hosts")
            SiteRule(
                id = site.getString("id"),
                name = site.getString("name"),
                hosts = (0 until hosts.length()).map { hosts.getString(it) },
                downloadable = site.optBoolean("downloadable", true),
                reason = site.optString("reason").takeIf { it.isNotBlank() },
            )
        }
        return SiteCatalog(rules)
    }
}
