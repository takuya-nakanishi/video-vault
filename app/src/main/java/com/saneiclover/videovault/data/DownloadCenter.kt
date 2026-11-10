package com.saneiclover.videovault.data

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.saneiclover.videovault.domain.DownloadJob
import com.saneiclover.videovault.domain.DownloadedFile
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.HistoryLog
import com.saneiclover.videovault.domain.HistoryStatus
import com.saneiclover.videovault.domain.Quality
import com.saneiclover.videovault.domain.YtdlpOutput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * ダウンロードの実行状態と履歴を**プロセスの寿命で**保持する場所(2026-08-25新設)。
 *
 * それまでは ViewModel が両方を持っていたため、画面を閉じるとダウンロードごと死んだ。
 * 実処理は [DownloadService](ForegroundService)が走らせ、ここは
 * 「いま何が走っていて、履歴がどうなっているか」の唯一の持ち主になる。ViewModelは
 * [Listener] で受け取って画面に映すだけで、破棄されても実行には影響しない。
 *
 * **履歴の所有者をここへ移したのが要点**。アプリを閉じている間に終わったダウンロードも
 * 結果が履歴に残り、`files/history.json` へ保存される(ViewModelが生きている必要がない)。
 */
object DownloadCenter {

    /** 1回のダウンロードの申し込み。Intentには [id] しか載せない(Cookieを外へ出さないため) */
    data class Request(
        val id: String,
        val url: String,
        val siteName: String,
        val quality: Quality,
        /** 内蔵ブラウザ由来のときだけ入る。yt-dlp起動の直前にファイル化し、使用後に必ず消す */
        val cookieHeader: String? = null,
        /** ページURLで取れなかったときに一度だけ試す直リンク。動画バッジ経由のみ */
        val fallbackUrl: String? = null,
        /**
         * 動画のパスワード(いまは Vidyard だけ)。画質シートで入れたもの。
         * **メモリにだけ置き、履歴にもファイルにも書かない**(履歴からやり直すときは入れ直す)
         */
        val videoPassword: String? = null,
    ) {
        /** Cookieとパスワードは認証情報。ログや例外の文に出さないため、既定の toString を使わない */
        override fun toString() = "Request(id=$id, url=$url, siteName=$siteName, quality=$quality)"
    }

    interface Listener {
        fun onJobChanged(job: DownloadJob?)
        fun onHistoryChanged(history: HistoryLog)
        /** 完了・失敗・中断の1行。画面が開いていれば帯に出す(閉じていれば通知だけが残る) */
        fun onResult(message: String)
    }

    private const val TAG = "VideoVaultDownload"

    /** 進捗をUIへ流す間隔。yt-dlpは1秒に何度も出力するので間引く(通知側はさらに粗い) */
    private const val PROGRESS_THROTTLE_MS = 150L

    private val listeners = CopyOnWriteArraySet<Listener>()
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /**
     * 履歴の永続化は**この1本のスレッド**でしか行わない。保存のたびに独立したIO coroutineを起こすと、
     * 同じ一時ファイルを取り合って古い状態が最後に残り得る(2026-08-21 Codexレビュー指摘)。
     */
    private val persistExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "videovault-history") }
    private val persist = persistExecutor.asCoroutineDispatcher()

    // lintの StaticFieldLeak は「Contextを持つ値がstaticにある」という形だけを見る。
    // ここへ入れるのは [init] で受けた **applicationContext だけ**で、寿命はプロセスと同じ。
    // Activityを掴まないのでリークにならない(掴んだら本物のリークなので、init以外で代入しないこと)
    @SuppressLint("StaticFieldLeak")
    private lateinit var appContext: Context
    private lateinit var historyStore: HistoryStore

    @SuppressLint("StaticFieldLeak")
    private lateinit var repository: DownloadRepository
    private var initialized = false

    @Volatile
    var history: HistoryLog = HistoryLog()
        private set

    @Volatile
    var job: DownloadJob? = null
        private set

    /** Serviceの起動を待っている申し込み。Serviceが [execute] で引き取る */
    private var pending: Request? = null

    /**
     * 直近の結果のうち、**まだ人が読んでいないもの**。
     *
     * ForegroundService化で「アプリを閉じている間に終わる」のが普通の使い方になった。
     * 結果を [Listener] へ流すだけだと、その間に画面(ViewModel)が作り直されていた場合に
     * 誰も受け取らず、通知を切っている人には結果が届かない(2026-08-25に煙試験で顕在化)。
     * 次に画面が付いたとき1度だけ渡し、人が帯を閉じたら([dismissResult])捨てる。
     */
    @Volatile
    private var pendingResult: String? = null

    /** yt-dlpのプロセス識別子。中断([cancel])に使う。試行ごとに変わる */
    @Volatile
    private var processId: String? = null

    @Volatile
    private var cancelRequested = false

    private var lastProgressAt = 0L

    /** プロセスにつき1回。履歴の読み込み(前回の実行中は「中断」へ倒す)もここで行う。 */
    @Synchronized
    fun init(context: Context) {
        if (initialized) return
        appContext = context.applicationContext
        historyStore = HistoryStore(appContext)
        repository = DownloadRepository(appContext)
        // settleStale はここで1回だけ効く。ViewModelが作り直されても走らないので、
        // 実行中のダウンロードが画面の再生成で「中断」にされることはない
        history = historyStore.load(System.currentTimeMillis())
        initialized = true
    }

    fun addListener(listener: Listener) {
        listeners += listener
        listener.onJobChanged(job)
        listener.onHistoryChanged(history)
        // 画面が無い間・作り直された間に終わった結果をここで拾う
        pendingResult?.let {
            pendingResult = null
            listener.onResult(it)
        }
    }

    /** 人が結果の帯を閉じた。次に画面が作り直されても、もう出さない。 */
    fun dismissResult() {
        pendingResult = null
    }

    fun removeListener(listener: Listener) {
        listeners -= listener
    }

    val isBusy: Boolean get() = job != null

    fun hasStorageAccess(context: Context): Boolean {
        init(context)
        return repository.hasStorageAccess()
    }

    /**
     * ダウンロードを申し込む。UIには即座に「実行中」を出し、実処理は [DownloadService] が走らせる。
     * 実行中のものがあれば false(このアプリは1件ずつ)。
     */
    @Synchronized
    fun request(context: Context, request: Request): Boolean {
        init(context)
        if (job != null) return false
        pending = request
        processId = null
        cancelRequested = false
        // 新しく始めた以上、前回の結果は用済み
        pendingResult = null
        setJob(DownloadJob(request.url, request.siteName, line = PREPARING))
        commit(history.upsert(newEntry(request)))
        if (DownloadService.start(context, request.id)) return true

        // Serviceを起こせなかった。UIを「実行中」のまま放置しない
        Log.w(TAG, "ForegroundServiceを開始できなかった: ${request.url}")
        pending = null
        setJob(null)
        finishEntry(request.id, HistoryStatus.FAILED, null, "ダウンロードを開始できなかった")
        notifyResult("失敗: ダウンロードを開始できなかった")
        return false
    }

    /**
     * [DownloadService] から呼ぶ実処理。進捗は [onProgress](通知の更新)へ、
     * 終了は [onFinished] へ返す(Serviceが完了通知を出して自分を止める)。
     */
    fun execute(id: String, onProgress: (DownloadJob) -> Unit, onFinished: (HistoryEntry?) -> Unit) {
        val request = pending?.takeIf { it.id == id }
        pending = null
        if (request == null) {
            // プロセスが作り直されて申し込みが失われた等。UIを実行中のままにしない
            setJob(null)
            onFinished(null)
            return
        }
        scope.launch {
            var entry: HistoryEntry? = null
            try {
                entry = attempt(request, request.url, request.id, onProgress)
                // ページURLのextractorが無いサイトを `<video>` の直リンクで一度だけ救う。
                // 履歴には両方の試行が残る(何で失敗して何で通ったかが後から分かる)
                val fallback = request.fallbackUrl
                if (entry.status == HistoryStatus.FAILED && !cancelRequested && fallback != null) {
                    notifyResult("ページのURLでは取れなかったので、動画ファイルのURLで再試行する")
                    val retry = request.copy(id = UUID.randomUUID().toString(), url = fallback)
                    setJob(DownloadJob(fallback, request.siteName, line = PREPARING))
                    commit(history.upsert(newEntry(retry)))
                    entry = attempt(retry, fallback, retry.id, onProgress)
                }
            } catch (t: Throwable) {
                // yt-dlpの失敗は Result で返るので、ここに来るのは想定外(Cookieの書き出し失敗等)。
                // **握らずに落とすとForegroundServiceが止まらず、消せない通知が端末に残る**
                Log.w(TAG, "ダウンロードの実行が想定外に落ちた", t)
                entry = runCatching {
                    finishEntry(request.id, HistoryStatus.FAILED, null, firstLine(t.message ?: t::class.java.simpleName))
                }.getOrNull()
            } finally {
                setJob(null)
                entry?.let { notifyResult(resultMessage(it)) }
                onFinished(entry)
            }
        }
    }

    /** 1回分の実行。履歴を確定させて返す。 */
    private suspend fun attempt(
        request: Request,
        url: String,
        entryId: String,
        onProgress: (DownloadJob) -> Unit,
    ): HistoryEntry {
        processId = entryId
        // 進捗はワーカースレッドから来る。タイトルは呼び出し元のコルーチンで読むのでAtomicで渡す
        val title = AtomicReference<String?>(null)
        val result = repository.download(
            url = url,
            cookieFile = CookieJar.write(appContext.cacheDir, url, request.cookieHeader),
            quality = request.quality,
            processId = entryId,
            videoPassword = request.videoPassword,
            // yt-dlp を起動する前(本体の更新・Vidyard の解錠)に押された中断は、ここを通して止める
            isCancelled = { cancelRequested },
        ) { percent, line ->
            YtdlpOutput.titleFrom(line)?.let { title.set(it) }
            val next = DownloadJob(url, request.siteName, percent, line)
            job = next
            val now = System.currentTimeMillis()
            if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
                lastProgressAt = now
                main.post { listeners.forEach { it.onJobChanged(next) } }
                onProgress(next)
            }
        }
        processId = null
        val status = when {
            result.isSuccess -> HistoryStatus.SUCCESS
            cancelRequested -> HistoryStatus.CANCELLED
            else -> HistoryStatus.FAILED
        }
        val error = result.exceptionOrNull()?.let { firstLine(it.message ?: it::class.java.simpleName) }
        return finishEntry(entryId, status, title.get(), error)
    }

    /** 中断。実行中でなければ何もしない。 */
    fun cancel() {
        if (!initialized) return
        cancelRequested = true
        processId?.let { repository.cancel(it) }
    }

    fun removeHistory(id: String) = commit(history.remove(id))

    fun clearHistory() = commit(history.clear())

    fun listDownloads() = repository.listDownloads()

    fun deleteDownload(file: DownloadedFile) = repository.delete(file)

    // --- 内部 ---

    private fun newEntry(request: Request) = HistoryEntry(
        id = request.id,
        url = request.url,
        siteName = request.siteName,
        title = null,
        startedAt = System.currentTimeMillis(),
        finishedAt = null,
        status = HistoryStatus.RUNNING,
        error = null,
        quality = request.quality.name,
    )

    private fun finishEntry(id: String, status: HistoryStatus, title: String?, error: String?): HistoryEntry {
        val base = history.entries.firstOrNull { it.id == id }
            ?: HistoryEntry(id, "", "", null, System.currentTimeMillis(), null, status, error)
        val done = base.copy(
            title = title ?: base.title,
            finishedAt = System.currentTimeMillis(),
            status = status,
            error = error,
        )
        commit(history.upsert(done))
        return done
    }

    private fun resultMessage(entry: HistoryEntry): String = when (entry.status) {
        HistoryStatus.SUCCESS -> "完了: ${entry.title ?: entry.siteName}"
        HistoryStatus.CANCELLED -> "中断した"
        else -> "失敗: ${entry.error ?: "原因不明"}"
    }

    private fun setJob(next: DownloadJob?) {
        job = next
        lastProgressAt = 0L
        main.post { listeners.forEach { it.onJobChanged(next) } }
    }

    private fun commit(log: HistoryLog) {
        history = log
        main.post { listeners.forEach { it.onHistoryChanged(log) } }
        scope.launch(persist) { historyStore.save(log) }
    }

    private fun notifyResult(message: String) {
        pendingResult = message
        main.post { listeners.forEach { it.onResult(message) } }
    }

    /** yt-dlpのエラーは複数行で長い。履歴には要点だけ残す(全文はLogcatで見える)。 */
    private fun firstLine(text: String): String = text.trim().replace(Regex("\\s+"), " ").take(200)

    private const val PREPARING = "準備中(初回はpython環境の展開に数十秒かかる)…"
}
