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
import com.saneiclover.videovault.data.DownloadCenter
import com.saneiclover.videovault.data.SiteCatalogLoader
import com.saneiclover.videovault.domain.Bookmark
import com.saneiclover.videovault.domain.DownloadJob
import com.saneiclover.videovault.domain.DownloadedFile
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.HistoryLog
import com.saneiclover.videovault.domain.InputClassifier
import com.saneiclover.videovault.domain.Quality
import com.saneiclover.videovault.domain.Suggestion
import com.saneiclover.videovault.domain.Vidyard
import com.saneiclover.videovault.ui.home.HomeUiState
import com.saneiclover.videovault.ui.home.PendingDownload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import java.util.concurrent.Executors

/**
 * 画面状態の保持と、判定・ダウンロード・ブックマーク・履歴の操作。
 *
 * 状態は `mutableStateOf`(Composeのスナップショット状態)で持つ。Flowを挟まないのは、
 * **入力欄の更新を同期的に行うため**。非同期に値を戻すと日本語IMEの未確定文字列が確定させられる
 * (ui-ux.md「実装で最初に確かめること」)。
 *
 * **ダウンロードの実行状態と履歴は持たない**(2026-08-25変更)。それらは
 * [DownloadCenter] がプロセスの寿命で持ち、ここは [DownloadCenter.Listener] として
 * 受け取って画面に映すだけ。この ViewModel が破棄されてもダウンロードは走り続ける。
 */
class VideoVaultViewModel(application: Application) : AndroidViewModel(application),
    DownloadCenter.Listener {

    private val catalog = SiteCatalogLoader.load(application)
    private val classifier = InputClassifier(catalog)
    private val bookmarkStore = BookmarkStore(application)
    /** 画質の既定など、小さな設定。ファイルを増やさず SharedPreferences で足りる */
    private val prefs = application.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var home by mutableStateOf(HomeUiState())
        private set

    var screen by mutableStateOf<Screen>(Screen.Home)
        private set

    /**
     * ブックマークの永続化は**この1本のスレッド**でしか行わない。保存のたびに独立したIO coroutineを
     * 起こすと、同じ一時ファイルを取り合って古い状態が最後に残り得る(2026-08-21 Codexレビュー指摘)。
     * 単一スレッドならFIFOで、最後に書かれるのは必ず最新の状態になる。
     * (履歴側の同じ仕掛けは [DownloadCenter] が持つ)
     */
    private val persistExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "videovault-bookmarks") }
    private val persist = persistExecutor.asCoroutineDispatcher()

    init {
        // 起動時の読み込みは同期で行う。非同期にすると、共有シート起動→即ダウンロードのように
        // 読み込み完了前に状態が更新されたとき、遅れて届いた読み込み結果がそれを上書きして消す
        // (同上の指摘)。ファイルは数十KB以下のJSONで、読むのに数msしかかからない
        DownloadCenter.init(application)
        home = home.copy(
            bookmarks = bookmarkStore.load(System.currentTimeMillis()),
            defaultQuality = Quality.fromName(prefs.getString(PREF_QUALITY, null)),
        )
        // 履歴と実行中ジョブの現在値はここで届く。画面が作り直されても走行中のダウンロードが見える
        DownloadCenter.addListener(this)
        refreshDownloads()
    }

    override fun onCleared() {
        super.onCleared()
        DownloadCenter.removeListener(this)
        // 書き込み待ちのタスクは流し切ってから閉じる(shutdownNowにしない)
        persistExecutor.shutdown()
    }

    // --- DownloadCenter からの通知(実行中ジョブ・履歴・結果) ---

    override fun onJobChanged(job: DownloadJob?) {
        home = home.copy(job = job)
    }

    override fun onHistoryChanged(history: HistoryLog) {
        home = home.copy(history = history.entries)
    }

    override fun onResult(message: String) {
        home = home.copy(message = message)
        refreshDownloads()
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
            is Suggestion.Download -> requestDownload(suggestion.url)
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

    /** 長押し→「編集」。名前とURLを差し替える。id と追加順はそのまま(並びが変わらない)。 */
    fun onUpdateBookmark(bookmark: Bookmark, name: String, rawUrl: String): Boolean {
        val url = InputClassifier.normalizeUrl(rawUrl) ?: run {
            home = home.copy(message = "URLとして読めない: $rawUrl")
            return false
        }
        val label = name.trim().ifEmpty { InputClassifier.hostOf(url)?.removePrefix("www.") ?: url }
        saveBookmarks(home.bookmarks.map { if (it.id == bookmark.id) it.copy(name = label, url = url) else it })
        return true
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
     * WebViewが持つCookieはヘッダ文字列のまま預け、yt-dlpへ渡す直前にファイル化する。
     *
     * **ブラウザ画面のまま留まる**(2026-08-25変更)。以前はここでホームへ戻していたため、
     * 見ていた動画の再生が止まり、WebViewごと破棄されてページの読み直しになっていた。
     * 画質シート・進捗・結果はブラウザの上に重ねて出す。
     */
    fun onBrowserDownloadRequest(pageUrl: String, cookieHeader: String?) {
        requestDownload(pageUrl, cookieHeader = cookieHeader)
    }

    /**
     * ページ内の動画バッジのタップ。[targetUrl] は動画そのもののURLの推定(ツイートのパーマリンク・
     * `watch?v=` 等)。yt-dlp はページURLのextractorで取るのが本筋なのでまずそれで走らせ、
     * 失敗したら `<video>` の src([mediaSrc]。直リンクのmp4/m3u8)で一度だけやり直す。
     * こちらもブラウザ画面のまま留まる(上と同じ理由)。
     */
    fun onBrowserVideoDownload(pageUrl: String, targetUrl: String, mediaSrc: String, cookieHeader: String?) {
        val target = targetUrl.ifBlank { pageUrl }
        requestDownload(
            url = target,
            cookieHeader = cookieHeader,
            fallbackUrl = mediaSrc.takeIf { it.startsWith("http", ignoreCase = true) && it != target },
        )
    }

    // --- 画質の選択 ---

    /**
     * どの入口から来ても、まず画質シートを出す(2026-08-21・人間の依頼)。
     * 実行中が居るときはシートを出さず断る。
     */
    private fun requestDownload(url: String, cookieHeader: String? = null, fallbackUrl: String? = null) {
        if (DownloadCenter.isBusy) {
            home = home.copy(message = "ダウンロードは1件ずつ実行する(実行中のものを待つか中断する)。")
            return
        }
        home = home.copy(
            pendingDownload = PendingDownload(
                url = url,
                siteName = catalog.nameForUrl(url),
                cookieHeader = cookieHeader,
                fallbackUrl = fallbackUrl,
                askPassword = Vidyard.playerUuidOf(url) != null,
            ),
            message = null,
        )
    }

    /**
     * @param password 画質シートのパスワード欄の値(Vidyard のときだけ出る。空なら null)。
     * 保存しない。[DownloadCenter] の申し込みに載せて、yt-dlp を起動する直前の解錠にだけ使う
     */
    fun onQualityChosen(quality: Quality, password: String?) {
        val pending = home.pendingDownload ?: return
        prefs.edit().putString(PREF_QUALITY, quality.name).apply()
        home = home.copy(pendingDownload = null, defaultQuality = quality)
        startDownload(pending, quality, password)
    }

    fun onDismissPendingDownload() {
        // Cookieはまだファイルにしていない(PendingDownloadはヘッダ文字列のまま持つ)ので消すものはない
        home = home.copy(pendingDownload = null)
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

    fun onDeleteHistory(entry: HistoryEntry) = DownloadCenter.removeHistory(entry.id)

    fun onClearHistory() = DownloadCenter.clearHistory()

    // --- ダウンロード ---

    /**
     * 実行を [DownloadCenter] へ渡す。ここから先は ForegroundService([com.saneiclover.videovault.data.DownloadService])が
     * 走らせるので、**この画面が消えてもダウンロードは続く**。
     */
    private fun startDownload(pending: PendingDownload, quality: Quality, password: String?) {
        if (DownloadCenter.isBusy) {
            home = home.copy(message = "ダウンロードは1件ずつ実行する(実行中のものを待つか中断する)。")
            return
        }
        if (!DownloadCenter.hasStorageAccess(getApplication())) {
            // 公共の Download/videos へ書くには「すべてのファイルへのアクセス」が要る。
            // 未許可のまま始めると保存に失敗するので、先に設定画面へ誘導する(MainActivityが拾う)。
            home = home.copy(
                message = "保存先(Download/videos)へ書き込むには「すべてのファイルへのアクセス」を許可する。",
                needStorageAccess = true,
            )
            return
        }
        home = home.copy(message = null)
        DownloadCenter.request(
            getApplication(),
            DownloadCenter.Request(
                id = UUID.randomUUID().toString(),
                url = pending.url,
                siteName = pending.siteName,
                quality = quality,
                cookieHeader = pending.cookieHeader,
                fallbackUrl = pending.fallbackUrl,
                videoPassword = password,
            ),
        )
    }

    fun onCancelDownload() = DownloadCenter.cancel()

    fun refreshDownloads() {
        viewModelScope.launch {
            val files = withContext(Dispatchers.IO) { DownloadCenter.listDownloads() }
            home = home.copy(downloads = files)
        }
    }

    fun onDeleteDownload(file: DownloadedFile) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { DownloadCenter.deleteDownload(file) }
            refreshDownloads()
        }
    }

    fun onDismissMessage() {
        // 読んで閉じた結果は、画面が作り直されても二度と出さない
        DownloadCenter.dismissResult()
        home = home.copy(message = null)
    }

    /** MainActivityが設定画面へ誘導したら呼ぶ(二重に開かないようフラグを下ろす)。 */
    fun onStorageAccessRequested() {
        home = home.copy(needStorageAccess = false)
    }

    private companion object {
        const val PREF_QUALITY = "quality"
    }
}
