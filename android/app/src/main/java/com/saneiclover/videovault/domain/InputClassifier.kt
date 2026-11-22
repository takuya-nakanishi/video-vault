package com.saneiclover.videovault.domain

import java.net.URI
import java.net.URLEncoder

/**
 * 単一入力欄(オムニボックス)の判定。ui-ux.md の判定表がそのまま [classify] の分岐になっている。
 *
 * | 入力内容 | 第一候補 | 第二候補 |
 * |---|---|---|
 * | 動画サイトのURL | ダウンロード | ブラウザで開く |
 * | その他のURL | ブラウザで開く | — |
 * | キーワード | Googleで検索 | — |
 *
 * Android APIに触れない純粋なKotlinにしてある(`android.net.Uri` を使うとJVMの単体テストで動かないため)。
 */
class InputClassifier(private val catalog: SiteCatalog) {

    fun classify(rawInput: String): List<Suggestion> {
        val text = rawInput.trim()
        if (text.isEmpty()) return emptyList()

        val url = normalizeUrl(text) ?: return listOf(Suggestion.WebSearch(text))
        val host = hostOf(url) ?: return listOf(Suggestion.WebSearch(text))
        val rule = catalog.ruleFor(host)

        return when {
            rule == null -> listOf(Suggestion.OpenInBrowser(url))
            !rule.downloadable -> listOf(
                Suggestion.Unsupported(url, rule.name, rule.reason ?: DEFAULT_UNSUPPORTED_REASON),
                Suggestion.OpenInBrowser(url),
            )
            else -> listOf(
                Suggestion.Download(url, rule.name),
                Suggestion.OpenInBrowser(url),
            )
        }
    }

    companion object {
        private const val DEFAULT_UNSUPPORTED_REASON = "対象外のサイト"

        /** ASCIIのホスト名だけをURLとみなす。日本語はここで弾かれ、キーワード扱いになる。 */
        private val HOST_PATTERN =
            Regex("^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\\.[A-Za-z]{2,}$")

        /** Google検索のURL。検索結果も内蔵ブラウザで開く(ui-ux.md)。 */
        fun searchUrl(query: String): String =
            "https://www.google.com/search?q=" + URLEncoder.encode(query, "UTF-8")

        /**
         * URLとして解釈できるなら正規化して返す。できなければ null(=キーワード)。
         *
         * スキームの無い `youtube.com/watch?v=x` も拾うため、https を補ってから検証する。
         * http/https 以外のスキームは扱わない。
         */
        fun normalizeUrl(input: String): String? {
            val text = input.trim()
            if (text.isEmpty() || text.any { it.isWhitespace() }) return null

            val withScheme = when {
                text.startsWith("http://", ignoreCase = true) ||
                    text.startsWith("https://", ignoreCase = true) -> text
                text.contains("://") -> return null
                else -> "https://$text"
            }
            val host = hostOf(withScheme) ?: return null
            if (!HOST_PATTERN.matches(host)) return null
            return withScheme
        }

        fun hostOf(url: String): String? =
            runCatching { URI(url).host?.lowercase() }.getOrNull()
    }
}
