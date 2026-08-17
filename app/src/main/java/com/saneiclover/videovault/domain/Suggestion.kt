package com.saneiclover.videovault.domain

/**
 * 入力欄の内容から導いた行動候補。リストの順序がそのまま画面上の優先順になる。
 *
 * ユーザーが「これはURLだからこのボタン」と考えなくて済むように、判定は端末内で即座に行う(ui-ux.md)。
 */
sealed interface Suggestion {

    /** 動画サイトのURL。yt-dlpで直接取得する。 */
    data class Download(val url: String, val siteName: String) : Suggestion

    /** 内蔵ブラウザで開く。ログインが必要なサイトはここからCookie経由の導線に入る。 */
    data class OpenInBrowser(val url: String) : Suggestion

    /** URLとして解釈できない入力。内蔵ブラウザでGoogle検索する。 */
    data class WebSearch(val query: String) : Suggestion

    /**
     * DRM等で対象外と判定したサイト。失敗させるのではなく、対象外である旨を先に見せる(ui-ux.md)。
     */
    data class Unsupported(
        val url: String,
        val siteName: String,
        val reason: String,
    ) : Suggestion
}
