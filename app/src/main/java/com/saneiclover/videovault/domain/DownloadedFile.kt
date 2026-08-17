package com.saneiclover.videovault.domain

/** ダウンロード済みファイル1件。UI層はこれだけを見るので、Previewにダミーを流し込める。 */
data class DownloadedFile(
    val name: String,
    val path: String,
    val sizeBytes: Long,
    val lastModified: Long,
)
