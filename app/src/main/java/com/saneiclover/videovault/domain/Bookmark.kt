package com.saneiclover.videovault.domain

/**
 * よく行くページへ1タップで飛ぶためのブックマーク。並び順は [createdAt] の古い順(追加した順)。
 * ダウンロード対象のサイトとは限らない(会員制サイトは内蔵ブラウザでログインしてから取る導線があるため)。
 */
data class Bookmark(
    val id: String,
    val name: String,
    val url: String,
    val createdAt: Long,
) {
    /** タイル上の1文字モノグラム。名前の先頭1文字(英字なら大文字)。 */
    val monogram: String
        get() = name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?"

    val host: String
        get() = InputClassifier.hostOf(url)?.removePrefix("www.") ?: url
}

/**
 * 初回起動時に入れておくブックマーク。自分がよく動画を取りに行くサイト(requirements.md)。
 * 消せるので、好みでなければ消せばよい。
 */
object DefaultBookmarks {
    fun seed(now: Long): List<Bookmark> = listOf(
        Bookmark("seed-newspicks", "NewsPicks", "https://newspicks.com/", now),
        Bookmark("seed-tiktok", "TikTok", "https://www.tiktok.com/", now + 1),
        Bookmark("seed-youtube", "YouTube", "https://m.youtube.com/", now + 2),
        Bookmark("seed-x", "X", "https://x.com/", now + 3),
    )
}
