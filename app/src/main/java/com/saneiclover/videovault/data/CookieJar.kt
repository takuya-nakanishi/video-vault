package com.saneiclover.videovault.data

import com.saneiclover.videovault.domain.InputClassifier
import java.io.File

/**
 * WebViewが持つCookieを yt-dlp の `--cookies` が読むNetscape形式へ変換する。
 *
 * 動画の通信を横取りして解析する方式は採らない(ui-ux.md)。サイト側の実装が変わるたびに壊れるため、
 * Cookieを渡してサイト対応の追随を yt-dlp 本体に任せる。
 *
 * `CookieManager.getCookie()` は `name=value; name2=value2` しか返さず、有効期限もdomain属性も落ちる。
 * yt-dlpはセッション中しか使わないので、ホストと遠い期限を補って書けば足りる。
 *
 * **書き出したファイルは認証情報そのもの**。端末内のキャッシュ領域にだけ置き、使い終わったら消す
 * (repositoryのfinallyで削除する)。リポジトリにも共有ストレージにも書かない。
 */
object CookieJar {

    /** 期限切れ扱いを避けるための固定値(2038-01-01)。セッションCookieの寿命はサイト側が決める。 */
    private const val FAR_FUTURE_EPOCH_SECONDS = 2145916800L

    /**
     * @param cookieHeader `CookieManager.getInstance().getCookie(url)` の戻り値
     * @return 書き出したファイル。Cookieが空なら null
     */
    fun write(cacheDir: File, pageUrl: String, cookieHeader: String?): File? {
        val host = InputClassifier.hostOf(pageUrl) ?: return null
        val pairs = cookieHeader.orEmpty()
            .split(';')
            .mapNotNull { chunk ->
                val name = chunk.substringBefore('=', "").trim()
                val value = chunk.substringAfter('=', "").trim()
                if (name.isEmpty()) null else name to value
            }
        if (pairs.isEmpty()) return null

        val secure = if (pageUrl.startsWith("https://", ignoreCase = true)) "TRUE" else "FALSE"
        val file = File(cacheDir, "cookies-$host.txt")
        file.bufferedWriter().use { out ->
            out.appendLine("# Netscape HTTP Cookie File")
            out.appendLine("# video-vaultが内蔵ブラウザのCookieから生成。使用後に削除される")
            pairs.forEach { (name, value) ->
                out.appendLine(
                    listOf(
                        ".$host", "TRUE", "/", secure, FAR_FUTURE_EPOCH_SECONDS.toString(), name, value,
                    ).joinToString("\t")
                )
            }
        }
        return file
    }
}
