package com.saneiclover.videovault.domain

/**
 * ダウンロードの画質(2026-08-21・人間の依頼)。解像度の上限だけを変え、
 * フレームレート・音声ビットレートはサイトが出している元のまま(音声は常に最良を選ぶ)。
 *
 * yt-dlp の `-f` に渡す形式選択式を持つ。上限を満たす形式が無いサイトでは最良へ退避する
 * (「SDが無いから失敗」にしない)。
 */
enum class Quality(val label: String, val detail: String, val formatSelector: String?) {
    /** yt-dlp既定(`bv*+ba/b`)。サイトが出している最高画質 */
    ORIGINAL("オリジナル", "サイトの最高画質", null),
    HD("HD", "1080pまで", "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b"),
    SD("SD", "480pまで", "bv*[height<=480]+ba/b[height<=480]/bv*+ba/b");

    companion object {
        val DEFAULT = ORIGINAL

        fun fromName(name: String?): Quality = entries.firstOrNull { it.name == name } ?: DEFAULT
    }
}
