package com.saneiclover.videovault.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap

/**
 * サイトのファビコン(ブックマーク・履歴の行に出すアイコン。2026-08-21・人間の依頼で
 * 頭文字のモノグラムから置き換え)。
 *
 * 取得元は Google の favicon サービス(`s2/favicons?domain=…&sz=128`)。どのサイトでも同じ形で
 * 128pxのPNGが返り、サイト側のHTMLを解析せずに済む。取れたら `files/favicons/<host>.png` に
 * 置いて次回以降はネットワークを使わない。取れないサイトは呼び出し側がモノグラムに退避する。
 *
 * 依存を増やさない(Coil等は入れない)。HttpURLConnection + BitmapFactory で足りる。
 */
class FaviconStore(context: Context) {

    private val dir = File(context.filesDir, "favicons").apply { mkdirs() }
    private val memory = ConcurrentHashMap<String, Bitmap>()
    /** 取れなかったホスト。セッション中は再試行しない(一覧の再描画のたびに叩かない) */
    private val missing = ConcurrentHashMap.newKeySet<String>()
    private val lock = Mutex()

    /** メモリにあれば即返す(描画中に同期で使える)。 */
    fun cached(host: String): Bitmap? = memory[host.lowercase()]

    /** ディスク→ネットワークの順に探す。無ければ null(モノグラムへ退避)。 */
    suspend fun load(host: String): Bitmap? {
        val key = host.lowercase().removePrefix("www.")
        memory[key]?.let { return it }
        if (key in missing) return null
        return withContext(Dispatchers.IO) {
            lock.withLock {
                memory[key]?.let { return@withLock it }
                val file = File(dir, "$key.png")
                val fromDisk = if (file.exists()) BitmapFactory.decodeFile(file.absolutePath) else null
                val bitmap = fromDisk ?: fetch(key)?.also { bmp ->
                    runCatching { file.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) } }
                }
                if (bitmap == null) missing.add(key) else memory[key] = bitmap
                bitmap
            }
        }
    }

    private fun fetch(host: String): Bitmap? = runCatching {
        val url = URL("https://www.google.com/s2/favicons?domain=${URLEncoder.encode(host, "UTF-8")}&sz=128")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 5_000
            readTimeout = 5_000
            instanceFollowRedirects = true
        }
        try {
            if (conn.responseCode != 200) return@runCatching null
            val bytes = conn.inputStream.use { it.readBytes() }
            // 16px の汎用アイコン(地球儀)しか無いサイトは「無い」扱いにしてモノグラムへ
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.takeIf { it.width >= 32 }
        } finally {
            conn.disconnect()
        }
    }.getOrElse {
        Log.w(TAG, "favicon for $host: ${it.message}")
        null
    }

    private companion object {
        const val TAG = "FaviconStore"
    }
}
