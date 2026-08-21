package com.saneiclover.videovault.ui.home

import com.saneiclover.videovault.domain.Bookmark
import com.saneiclover.videovault.domain.DownloadedFile
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.Quality
import com.saneiclover.videovault.domain.Suggestion
import java.io.File

/** 実行中のダウンロード1件。[percent] が null なら進捗率不明(準備中・後処理中)。 */
data class DownloadJob(
    val url: String,
    val siteName: String,
    val percent: Float? = null,
    val line: String = "",
)

/**
 * 画質を選ぶ前のダウンロード。候補カード・バッジ・⋮メニューのどこから来ても一度ここを通り、
 * ホームの画質シートで選んでから走る。[cookieFile] はシートを閉じたら消す(認証情報を残さない)。
 */
data class PendingDownload(
    val url: String,
    val siteName: String,
    val cookieFile: File? = null,
    /** 失敗時に一度だけやり直す先(Cookieファイルと URL を作る関数)。動画バッジ経由のみ */
    val retryWith: (() -> Pair<File?, String>)? = null,
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
    /** 保存先(公共の Download/videos)への書き込み許可を求める必要があるとき true。MainActivityが設定画面へ誘導する */
    val needStorageAccess: Boolean = false,
    /** 画質シートで選択待ちのダウンロード。null なら出ていない */
    val pendingDownload: PendingDownload? = null,
    /** 前回選んだ画質(シートの既定ハイライト) */
    val defaultQuality: Quality = Quality.DEFAULT,
)
