package com.saneiclover.videovault.ui

import android.app.Application
import android.content.ClipboardManager
import android.content.ClipDescription
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saneiclover.videovault.data.CookieJar
import com.saneiclover.videovault.data.DownloadRepository
import com.saneiclover.videovault.data.SiteCatalogLoader
import com.saneiclover.videovault.domain.DownloadedFile
import com.saneiclover.videovault.domain.InputClassifier
import com.saneiclover.videovault.domain.Suggestion
import com.saneiclover.videovault.ui.home.DownloadJob
import com.saneiclover.videovault.ui.home.HomeUiState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/**
 * 画面状態の保持と、判定・ダウンロードの起動。
 *
 * 状態は `mutableStateOf`(Composeのスナップショット状態)で持つ。Flowを挟まないのは、
 * **入力欄の更新を同期的に行うため**。非同期に値を戻すと日本語IMEの未確定文字列が確定させられる
 * (ui-ux.md「実装で最初に確かめること」)。
 */
class VideoVaultViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = DownloadRepository(application)
    private val classifier = InputClassifier(SiteCatalogLoader.load(application))

    var home by mutableStateOf(HomeUiState())
        private set

    var screen by mutableStateOf<Screen>(Screen.Home)
        private set

    private var processId: String? = null

    init {
        refreshDownloads()
    }

    // --- 入力欄 ---

    fun onInputChange(text: String) {
        home = home.copy(input = text, suggestions = classifier.classify(text))
    }

    /** 共有シートから受け取ったURLを入力済みの状態で開く(候補が既に並んでいる状態にする)。 */
    fun onSharedText(text: String) {
        if (text.isNotBlank()) onInputChange(text)
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

    /**
     * チップの出し分け。`getPrimaryClipDescription()` しか見ない。
     * 中身を読む `getPrimaryClip()` はAndroid 12以降で貼り付けトーストが出るため、タップ後まで遅らせる。
     */
    fun refreshClipboardHint() {
        val clipboard = getApplication<Application>()
            .getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        val hasText = clipboard?.primaryClipDescription
            ?.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) == true
        home = home.copy(clipboardChipVisible = hasText && home.input.isBlank())
    }

    fun onClipboardChipClick() {
        val clipboard = getApplication<Application>()
            .getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        val text = clipboard?.primaryClip?.takeIf { it.itemCount > 0 }
            ?.getItemAt(0)?.coerceToText(getApplication())?.toString().orEmpty()
        if (text.isBlank()) {
            home = home.copy(clipboardChipVisible = false)
            return
        }
        onInputChange(text)
        home = home.copy(clipboardChipVisible = false)
    }

    // --- ブラウザ ---

    fun onBackToHome() {
        screen = Screen.Home
    }

    /**
     * 内蔵ブラウザでログイン済みの状態から取得する導線(ui-ux.md 導線2)。
     * WebViewが持つCookieをNetscape形式に書き出して yt-dlp へ渡す。
     */
    fun onBrowserDownloadRequest(pageUrl: String, cookieHeader: String?) {
        val cookieFile = CookieJar.write(getApplication<Application>().cacheDir, pageUrl, cookieHeader)
        screen = Screen.Home
        startDownload(pageUrl, cookieFile)
    }

    // --- ダウンロード ---

    private fun startDownload(url: String, cookieFile: File?) {
        if (home.job != null) {
            home = home.copy(message = "ダウンロードは1件ずつ実行する(実行中のものを待つか中断する)。")
            return
        }
        val id = UUID.randomUUID().toString()
        processId = id
        home = home.copy(
            job = DownloadJob(url = url, line = "準備中(初回はpython環境の展開に数十秒かかる)…"),
            message = null,
        )
        viewModelScope.launch {
            val result = repository.download(url, cookieFile, id) { percent, line ->
                // 進捗はワーカースレッドから来る。スナップショット状態はスレッド安全なのでそのまま更新できる
                home = home.copy(job = home.job?.copy(percent = percent, line = line))
            }
            processId = null
            home = home.copy(
                job = null,
                message = result.fold(
                    onSuccess = { "完了: ${repository.outputDir.name}/ に保存した" },
                    onFailure = { "失敗: ${it.message ?: it::class.java.simpleName}" },
                ),
            )
            refreshDownloads()
        }
    }

    fun onCancelDownload() {
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
}
