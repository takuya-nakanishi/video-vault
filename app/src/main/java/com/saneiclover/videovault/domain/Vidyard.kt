package com.saneiclover.videovault.domain

import java.net.URI

/**
 * Vidyard(企業向けの動画配信)の URL から、プレイヤーの識別子(uuid)を取り出す。
 *
 * パスワード付きの動画は、yt-dlp に渡す前にこのアプリが解錠する
 * ([com.saneiclover.videovault.data.VidyardUnlocker])。そのときに要るのが uuid。
 * URL の形は yt-dlp の Vidyard 抽出器(`yt_dlp/extractor/vidyard.py` の `_VALID_URL`)に揃えてある。
 * 揃えておけば、アプリが解錠した動画と yt-dlp が取りに行く動画が食い違わない。
 *
 * Android API に触れない純粋な Kotlin にしてある(JVM の単体テストで回すため)。
 */
object Vidyard {

    /** 共有ページ: `share.vidyard.com/watch/<uuid>`・`<会社>.vidyard.com/watch/<uuid>`・`<会社>.hubs.vidyard.com/watch/<uuid>` */
    private val WATCH_HOST = Regex("^[A-Za-z0-9_-]+(\\.hubs)?\\.vidyard\\.com$")
    private val WATCH_PATH = Regex("^/watch/([A-Za-z0-9_-]+)")

    /** 古い共有ページ: `share.vidyard.com/share/<uuid>`・`embed.vidyard.com/share/<uuid>` */
    private val SHARE_HOSTS = setOf("share.vidyard.com", "embed.vidyard.com")
    private val SHARE_PATH = Regex("^/share/([A-Za-z0-9_-]+)")

    /** プレイヤー本体(埋め込みの iframe): `play.vidyard.com/<uuid>`・`<uuid>.html`・`player/<uuid>.json` */
    private const val PLAYER_HOST = "play.vidyard.com"
    private val PLAYER_PATH = Regex("^/(?:player/)?([A-Za-z0-9_-]+)")

    /** Vidyard の動画の URL ならプレイヤーの uuid を、そうでなければ null を返す。 */
    fun playerUuidOf(url: String): String? {
        val uri = runCatching { URI(url.trim()) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.lowercase() ?: return null
        val path = uri.rawPath.orEmpty()
        // yt-dlp と同じ順に当てる(play.vidyard.com/watch/<uuid> は watch の形として読む)
        if (WATCH_HOST.matches(host)) WATCH_PATH.find(path)?.let { return it.groupValues[1] }
        if (host in SHARE_HOSTS) SHARE_PATH.find(path)?.let { return it.groupValues[1] }
        if (host == PLAYER_HOST) PLAYER_PATH.find(path)?.let { return it.groupValues[1] }
        return null
    }
}
