package com.saneiclover.videovault.ui.home

import com.saneiclover.videovault.domain.Bookmark
import com.saneiclover.videovault.domain.DownloadedFile
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.Suggestion

/** 実行中のダウンロード1件。[percent] が null なら進捗率不明(準備中・後処理中)。 */
data class DownloadJob(
    val url: String,
    val siteName: String,
    val percent: Float? = null,
    val line: String = "",
)

/**
 * ホーム画面の状態。**UI層はこの型とコールバックだけを見る**。
 * Compose Previewはネットワークもファイルも触れないため、ダミーを流し込めるようにこの形にしてある
 * (dev-setup.md「UIを詰めるループ」)。
 */
data class HomeUiState(
    val input: String = "",
    val suggestions: List<Suggestion> = emptyList(),
    /** クリップボードにテキストがある。中身は読んでいない(タップ後に初めて読む) */
    val clipboardChipVisible: Boolean = false,
    val bookmarks: List<Bookmark> = emptyList(),
    /** 履歴の全件(新しい順)。ホームは先頭数件だけ見せ、履歴画面は全部見せる */
    val history: List<HistoryEntry> = emptyList(),
    val downloads: List<DownloadedFile> = emptyList(),
    val job: DownloadJob? = null,
    val message: String? = null,
)
