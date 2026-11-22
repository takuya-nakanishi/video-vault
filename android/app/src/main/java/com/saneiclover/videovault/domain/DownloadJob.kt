package com.saneiclover.videovault.domain

/**
 * 実行中のダウンロード1件。[percent] が null なら進捗率不明(準備中・後処理中)。
 *
 * ホームの進捗カード・内蔵ブラウザの進捗行・通知の3箇所が同じこの型を見る。
 * ui層ではなくdomainに置くのは、**画面が無いときも生き続ける**値だから
 * (ForegroundServiceが走らせ、[com.saneiclover.videovault.data.DownloadCenter] が保持する)。
 */
data class DownloadJob(
    val url: String,
    val siteName: String,
    val percent: Float? = null,
    val line: String = "",
)
