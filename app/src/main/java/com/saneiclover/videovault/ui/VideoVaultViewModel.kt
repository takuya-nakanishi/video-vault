package com.saneiclover.videovault.ui

import android.app.Application
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saneiclover.videovault.data.BookmarkStore
import com.saneiclover.videovault.data.CookieJar
import com.saneiclover.videovault.data.DownloadRepository
import com.saneiclover.videovault.data.HistoryStore
import com.saneiclover.videovault.data.SiteCatalogLoader
import com.saneiclover.videovault.domain.Bookmark
import com.saneiclover.videovault.domain.DownloadedFile
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.HistoryLog
import com.saneiclover.videovault.domain.HistoryStatus
import com.saneiclover.videovault.domain.InputClassifier
import com.saneiclover.videovault.domain.Suggestion
import com.saneiclover.videovault.domain.YtdlpOutput
import com.saneiclover.videovault.ui.home.DownloadJob
import com.saneiclover.videovault.ui.home.HomeUiState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * 画面状態の保持と、判定・ダウンロード・ブックマーク・履歴の操作。
 *
 * 状態は `mutableStateOf`(Composeのスナップショット状態)で持つ。Flowを挟まないのは、
 * **入力欄の更新を同期的に行うため**。非同期に値を戻すと日本語IMEの未確定文字列が確定させられる
 * (ui-ux.md「実装で最初に確かめること」)。
 */
class VideoVaultViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = DownloadRepository(application)
    private val catalog = SiteCatalogLoader.load(application)
    private val classifier = InputClassifier(catalog)
    private val bookmarkStore = BookmarkStore(application)
    private val historyStore = HistoryStore(application)

    var home by mutableStateOf(HomeUiState())
        private set

    var screen by mutableStateOf<Screen>(Screen.Home)
        private set

    private var historyLog: HistoryLog
    private var processId: String? = null
    private var cancelRequested = false

    /**
     * 永続化は**この1本のスレッド**でしか行わない。保存のたびに独立したIO coroutineを起こすと、
     * 同じ一時ファイルを取り合って古い状態が最後に残り得る(2026-08-21 Codexレビュー指摘)。
     * 単一スレッドならFIFOで、最後に書かれるのは必ず最新の状態になる。
     */
    private val persistExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "videovault-persist") }
    private val persist = persistExecutor.asCoroutineDispatcher()

    init {
        // 起動時の読み込みは同期で行う。非同期にすると、共有シート起動→即ダウンロードのように
        // 読み込み完了前に状態が更新されたとき、遅れて届いた読み込み結果がそれを上書きして消す
        // (同上の指摘)。ファイルは数十KB以下のJSONで、読むのに数msしかかからない
        val now = System.currentTimeMillis()
        val bookmarks = bookmarkStore.load(now)
        historyLog = historyStore.load(now)
        home = home.copy(bookmarks = bookmarks, history = historyLog.entries)
        refreshDownloads()
    }

    override fun onCleared() {
        super.onCleared()
        // 書き込み待ちのタスクは流し切ってから閉じる(shutdownNowにしない)
        persistExecutor.shutdown()
    }

    // --- 入力欄 ---

    fun onInputChange(text: String) {
        home = home.copy(input = text, suggestions = classifier.classify(text))
    }

    /** 共有シートから受け取ったURLを入力済みの状態で開く(候補が既に並んでいる状態にする)。 */
    fun onSharedText(text: String) {
        if (text.isNotBlank()) {
            screen = Screen.Home
            onInputChange(text)
        }
    }

    fun onClearInput() = onInputChange("")

    /** 入力欄の確定(キーボードの実行キー)。第一候補を実行する。 */
    fun onSubmit() {
        home.suggestions.firstOrNull()?.let(::onSuggestionClick)
    }

    fun onSuggestionClick(suggestion: Suggestion) {
        when (suggestion) {
            is Suggestion.Download -> startDownload(suggestion.url, cookieFile = null)
            is Suggestion.OpenInBrowser -> screen = Screen.Browser(suggestion.url)
            is Suggestion.WebSearch -> screen = Screen.Browser(InputClassifier.searchUrl(suggestion.query))
            is Suggestion.Unsupported -> home = home.copy(
                message = "${suggestion.siteName}は${suggestion.reason}。",
            )
        }
    }

    // --- クリップボード ---

    private val clipboard: ClipboardManager?
        get() = getApplication<Application>().getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager

    /**
     * チップの出し分け。`getPrimaryClipDescription()` しか見ない。
     * 中身を読む `getPrimaryClip()` はAndroid 12以降で貼り付けトーストが出るため、タップ後まで遅らせる。
     */
    fun refreshClipboardHint() {
        val hasText = clipboard?.primaryClipDescription
            ?.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) == true
        home = home.copy(clipboardChipVisible = hasText && home.input.isBlank())
    }

    fun onClipboardChipClick() {
        val text = clipboard?.primaryClip?.takeIf { it.itemCount > 0 }
            ?.getItemAt(0)?.coerceToText(getApplication())?.toString().orEmpty()
        if (text.isBlank()) {
            home = home.copy(clipboardChipVisible = false)
            return
        }
        onInputChange(text)
        home = home.copy(clipboardChipVisible = false)
    }

    // --- 画面遷移 ---

    fun onBackToHome() {
        screen = Screen.Home
    }

    fun onOpenHistory() {
        screen = Screen.History
    }

    fun onOpenFiles() {
        refreshDownloads()
        screen = Screen.Files
    }

    // --- ブックマーク ---

    fun onBookmarkClick(bookmark: Bookmark) {
        screen = Screen.Browser(bookmark.url)
    }

    /** 名前とURLを手で入れて追加する(ホームの「追加」)。URLとして読めない入力は弾く。 */
    fun onAddBookmark(name: String, rawUrl: String): Boolean {
        val url = InputClassifier.normalizeUrl(rawUrl) ?: run {
            home = home.copy(message = "URLとして読めない: $rawUrl")
            return false
        }
        val label = name.trim().ifEmpty { InputClassifier.hostOf(url)?.removePrefix("www.") ?: url }
        addBookmark(label, url)
        return true
    }

    fun onRemoveBookmark(bookmark: Bookmark) {
        saveBookmarks(home.bookmarks.filterNot { it.id == bookmark.id })
    }

    fun isBookmarked(url: String): Boolean = home.bookmarks.any { sameUrl(it.url, url) }

    /** ブラウザの★。登録済みなら外し、未登録なら今のページを入れる。 */
    fun onToggleBookmark(pageTitle: String?, url: String) {
        val existing = home.bookmarks.firstOrNull { sameUrl(it.url, url) }
        if (existing != null) {
            onRemoveBookmark(existing)
            home = home.copy(message = "ブックマークから外した: ${existing.name}")
        } else {
            val name = pageTitle?.trim()?.takeIf { it.isNotEmpty() }
                ?: InputClassifier.hostOf(url)?.removePrefix("www.") ?: url
            addBookmark(name, url)
            home = home.copy(message = "ブックマークに追加: $name")
        }
    }

    private fun addBookmark(name: String, url: String) {
        val bookmark = Bookmark(
            id = UUID.randomUUID().toString(),
            name = name,
            url = url,
            createdAt = System.currentTimeMillis(),
        )
        saveBookmarks(home.bookmarks + bookmark)
    }

    private fun saveBookmarks(bookmarks: List<Bookmark>) {
        home = home.copy(bookmarks = bookmarks)
        viewModelScope.launch(persist) { bookmarkStore.save(bookmarks) }
    }

    private fun sameUrl(a: String, b: String) = a.trimEnd('/') == b.trimEnd('/')

    // --- ブラウザ ---

    /**
     * 内蔵ブラウザでログイン済みの状態から取得する導線(ui-ux.md 導線2)。
     * WebViewが持つCookieをNetscape形式に書き出して yt-dlp へ渡す。
     */
    fun onBrowserDownloadRequest(pageUrl: String, cookieHeader: String?) {
        val cookieFile = CookieJar.write(getApplication<Application>().cacheDir, pageUrl, cookieHeader)
        screen = Screen.Home
        startDownload(pageUrl, cookieFile)
    }

    // --- 履歴 ---

    /** 同じURLをもう一度。入力欄に戻して候補を出す(そのまま第一候補で再実行できる)。 */
    fun onRetryHistory(entry: HistoryEntry) {
        screen = Screen.Home
        onInputChange(entry.url)
    }

    fun onOpenHistoryInBrowser(entry: HistoryEntry) {
        screen = Screen.Browser(entry.url)
    }

    fun onCopyHistoryUrl(entry: HistoryEntry) {
        clipboard?.setPrimaryClip(ClipData.newPlainText("URL", entry.url))
        home = home.copy(message = "URLをコピーした")
    }

    fun onDeleteHistory(entry: HistoryEntry) {
        commitHistory(historyLog.remove(entry.id))
    }

    fun onClearHistory() {
        commitHistory(historyLog.clear())
    }

    private fun commitHistory(log: HistoryLog) {
        historyLog = log
        home = home.copy(history = log.entries)
        viewModelScope.launch(persist) { historyStore.save(log) }
    }

    // --- ダウンロード ---

    private fun startDownload(url: String, cookieFile: File?) {
        if (home.job != null) {
            home = home.copy(message = "ダウンロードは1件ずつ実行する(実行中のものを待つか中断する)。")
            return
        }
        val id = UUID.randomUUID().toString()
        val siteName = catalog.nameForUrl(url)
        processId = id
        cancelRequested = false
        home = home.copy(
            job = DownloadJob(url = url, siteName = siteName, line = "準備中(初回はpython環境の展開に数十秒かかる)…"),
            message = null,
        )
        var entry = HistoryEntry(
            id = id,
            url = url,
            siteName = siteName,
            title = null,
            startedAt = System.currentTimeMillis(),
            finishedAt = null,
            status = HistoryStatus.RUNNING,
            error = null,
        )
        commitHistory(historyLog.upsert(entry))

        viewModelScope.launch {
            val titleRef = AtomicReference<String?>(null)
            val result = repository.download(url, cookieFile, id) { percent, line ->
                // 進捗はワーカースレッドから来る。スナップショット状態はスレッド安全なのでそのまま更新できる
                YtdlpOutput.titleFrom(line)?.let { titleRef.set(it) }
                home = home.copy(job = home.job?.copy(percent = percent, line = line))
            }
            processId = null
            val title = titleRef.get()
            entry = entry.copy(
                title = title,
                finishedAt = System.currentTimeMillis(),
                status = when {
                    result.isSuccess -> HistoryStatus.SUCCESS
                    cancelRequested -> HistoryStatus.CANCELLED
                    else -> HistoryStatus.FAILED
                },
                error = result.exceptionOrNull()?.let { firstLine(it.message ?: it::class.java.simpleName) },
            )
            commitHistory(historyLog.upsert(entry))
            home = home.copy(
                job = null,
                message = result.fold(
                    onSuccess = { "完了: ${title ?: siteName}" },
                    onFailure = {
                        if (cancelRequested) "中断した" else "失敗: ${it.message ?: it::class.java.simpleName}"
                    },
                ),
            )
            refreshDownloads()
        }
    }

    fun onCancelDownload() {
        cancelRequested = true
        processId?.let { repository.cancel(it) }
    }

    fun refreshDownloads() {
        viewModelScope.launch {
            val files = withContext(Dispatchers.IO) { repository.listDownloads() }
            home = home.copy(downloads = files)
        }
    }

    fun onDeleteDownload(file: DownloadedFile) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { repository.delete(file) }
            refreshDownloads()
        }
    }

    fun onDismissMessage() {
        home = home.copy(message = null)
    }

    /** yt-dlpのエラーは複数行で長い。履歴には要点の1行だけ残す(全文は完了時のメッセージで見える)。 */
    private fun firstLine(text: String): String =
        text.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() }?.take(200) ?: text.take(200)
}
