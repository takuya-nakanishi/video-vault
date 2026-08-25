package com.saneiclover.videovault.ui.home

import com.saneiclover.videovault.domain.Bookmark
import com.saneiclover.videovault.domain.DownloadJob
import com.saneiclover.videovault.domain.DownloadedFile
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.Quality
import com.saneiclover.videovault.domain.Suggestion

/**
 * 画質を選ぶ前のダウンロード。候補カード・バッジ・⋮メニューのどこから来ても一度ここを通り、
 * 画質シートで選んでから走る(シートはホームでも内蔵ブラウザでも出る)。
 *
 * Cookieは**ファイルではなくヘッダ文字列のまま**持つ。ダウンロードはForegroundServiceが走らせるため、
 * シートを出した時点でファイル化すると「選ばずに閉じた」場合の消し忘れが起きる。
 * 認証情報を端末のファイルに落とすのは yt-dlp を起動する直前だけにする
 * ([com.saneiclover.videovault.data.DownloadCenter] が書き、使用後に必ず消す)。
 */
data class PendingDownload(
    val url: String,
    val siteName: String,
    /** 内蔵ブラウザ由来のときだけ入る。ログインが要るサイトのCookie */
    val cookieHeader: String? = null,
    /** ページURLで取れなかったときに一度だけ試す直リンク(`<video>` の src)。動画バッジ経由のみ */
    val fallbackUrl: String? = null,
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
