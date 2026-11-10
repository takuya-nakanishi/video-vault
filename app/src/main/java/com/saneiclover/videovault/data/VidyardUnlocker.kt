package com.saneiclover.videovault.data

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

/**
 * Vidyard のパスワード保護(Vidyard の中の呼び名は access code)を、Vidyard のプレイヤーと同じ手順で解く。
 *
 * yt-dlp の Vidyard 抽出器はパスワードを扱えない(2026-11-10 の master でも同じ)。保護された動画では
 * `player/<uuid>.json` が `type: "secure"` を返し、動画の URL(`chapters`)が入っていない。そのため抽出器が
 * `KeyError('chapters')` で落ち、「An extractor error has occurred」になる(2026-11-10 に実物で確かめた)。
 *
 * プレイヤーは次の手順で解錠している(play.vidyard.com のプレイヤーの JS を読んで確かめた。2026-11-10):
 *
 * 1. `GET /player/<uuid>.json` → `type: "secure"` ならパスワードの入力欄を出す
 * 2. `POST /secure/verify-access-code` に `{"uuid", "token": パスワード}` → `{"accessToken"}`。
 *    パスワードの誤りは 401 `{"error":"Password is incorrect"}`
 * 3. ヘッダ `X-Video-Access: <accessToken>` を付けて 1 を取り直す → 動画の URL が入った通常の応答
 *
 * **このアプリは 2 までを自分で行い、3 は yt-dlp に任せる**(`--add-header` でヘッダを渡す)。
 * 動画の URL を自分で読まないので、画質の選び方・字幕・HLS といったサイト対応の追随は yt-dlp 本体に残る。
 * WebView の通信を横取りしてトークンを抜く方式は採らない(ui-ux.md の方針と同じ)。
 *
 * パスワードとトークンは認証情報。ログにも履歴にも書かない(ここで作る例外の文にも入れない)。
 */
object VidyardUnlocker {

    /** トークンを載せるヘッダの名前。プレイヤーの JS と同じ */
    const val ACCESS_HEADER = "X-Video-Access"

    private const val BASE = "https://play.vidyard.com"
    private const val TIMEOUT_MS = 20_000

    /** 保護された動画で、パスワードが無い・通らないときの失敗。文はそのまま履歴と結果の帯に出る */
    class LockedException(message: String) : IOException(message)

    /**
     * yt-dlp に付けるヘッダの値(accessToken)を返す。保護されていなければ null(何も付けずに yt-dlp へ)。
     *
     * 保護の有無を確かめられなかったとき(通信の失敗・想定外の応答)も null を返し、判断を yt-dlp に任せる。
     * ここで止めると、Vidyard 側の小さな変更で、保護されていない動画まで取れなくなる。
     *
     * 通信するので、メインスレッドから呼ばない([DownloadRepository] が IO スレッドで呼ぶ)。
     *
     * @param isCancelled 中断が押されたか。パスワードを送る直前に見る。Vidyard はパスワードに使用回数の上限を
     *   付けられるので、中断したのに解錠して1回分を使ってしまうことを避ける
     */
    fun accessTokenFor(uuid: String, password: String?, isCancelled: () -> Boolean = { false }): String? {
        val type = runCatching { playerType(uuid) }.getOrNull() ?: return null
        if (type != SECURE) return null
        if (password.isNullOrEmpty()) {
            throw LockedException("パスワードで保護された動画。ダウンロードを押し直し、画質の選択でパスワードを入れる")
        }
        if (isCancelled()) throw CancelledBeforeStartException()
        return verify(uuid, password)
    }

    /** プレイヤーの JSON の `type`。保護された動画は `secure`、通常は `pomo-player` */
    private fun playerType(uuid: String): String? {
        val conn = open("$BASE/player/$uuid.json")
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) return null
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            return JSONObject(body).optString("type").takeIf { it.isNotEmpty() }
        } finally {
            conn.disconnect()
        }
    }

    /** パスワードを一時トークンに替える。通らなければ [LockedException] */
    private fun verify(uuid: String, password: String): String {
        val conn = open("$BASE/secure/verify-access-code").apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        try {
            val body = JSONObject().put("uuid", uuid).put("token", password).toString()
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val ok = code in 200..299
            val text = (if (ok) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }
                .orEmpty()
            val json = runCatching { JSONObject(text) }.getOrNull()
            if (ok) {
                return json?.optString("accessToken")?.takeIf { it.isNotEmpty() }
                    ?: throw IOException("Vidyardの解錠の応答にトークンが無い(HTTP $code)")
            }
            val reason = json?.optString("error")?.takeIf { it.isNotEmpty() } ?: "HTTP $code"
            if (code == HttpURLConnection.HTTP_UNAUTHORIZED || code == HttpURLConnection.HTTP_FORBIDDEN) {
                throw LockedException("パスワードが通らなかった(Vidyard: $reason)")
            }
            throw IOException("Vidyardのパスワードを確かめられなかった(Vidyard: $reason)")
        } finally {
            conn.disconnect()
        }
    }

    private fun open(url: String): HttpURLConnection =
        // URL(String) は JDK 20 で非推奨になったので、URI から作る
        (URI.create(url).toURL().openConnection() as HttpURLConnection).apply {
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            setRequestProperty("Accept", "application/json")
        }

    private const val SECURE = "secure"
}
