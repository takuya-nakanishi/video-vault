package com.saneiclover.videovault.data

import android.content.Context
import com.saneiclover.videovault.domain.DownloadedFile
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * yt-dlp(youtubedl-android)の呼び出し口。UI層はここより下を知らない。
 *
 * 保存先はアプリ専用外部ストレージ `files/downloads/`。公共の `Download/` へ出す対応は次版
 * (CLAUDE.md「既知の制約」1)。
 */
class DownloadRepository(
    private val context: Context,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {

    /** 初期化はpython環境の展開を伴い数十秒かかる。起動時ではなく最初のダウンロード時に行う。 */
    @Volatile
    private var initialized = false

    /** yt-dlp本体の更新をこのプロセスで済ませたか。 */
    @Volatile
    private var ytdlpUpdated = false

    val outputDir: File
        get() = File(context.getExternalFilesDir(null), "downloads").apply { mkdirs() }

    /**
     * @param cookieFile ログインが必要なサイト向け。使用後は呼び出し側で消さず、ここで必ず消す
     * @param processId 中断([cancel])に使う識別子
     */
    suspend fun download(
        url: String,
        cookieFile: File?,
        processId: String,
        onProgress: (percent: Float?, line: String) -> Unit,
    ): Result<Unit> = withContext(io) {
        runCatching {
            ensureInitialized()
            updateYtdlp(onProgress)
            val request = YoutubeDLRequest(url).apply {
                addOption("-o", "${outputDir.absolutePath}/%(title)s.%(ext)s")
                addOption("--no-mtime")
                // yt-dlpはYouTubeの署名解読に外部JavaScriptランタイムを要求するようになり、
                // 無いと403 Forbiddenで落ちる(2026-08-19実測)。ライブラリ0.18.1が同梱する
                // QuickJSを使うが、`--js-runtimes quickjs:<パス>` はライブラリが内部で付与するため
                // ここでは指定しない(パス無しで自前指定すると、その自動付与を壊して403に戻る)
                cookieFile?.let { addOption("--cookies", it.absolutePath) }
            }
            YoutubeDL.getInstance().execute(request, processId) { percent, _, line ->
                onProgress(percent.takeIf { it >= 0f }?.div(100f), line)
            }
            Unit
        }.also {
            // Cookieは認証情報。成否にかかわらず残さない
            cookieFile?.delete()
        }
    }

    /** 実行中のダウンロードを中断する。 */
    fun cancel(processId: String): Boolean =
        runCatching { YoutubeDL.getInstance().destroyProcessById(processId) }.getOrDefault(false)

    fun listDownloads(): List<DownloadedFile> =
        outputDir.listFiles()
            .orEmpty()
            .filter { it.isFile && !it.name.endsWith(".part") }
            .sortedByDescending { it.lastModified() }
            .map {
                DownloadedFile(
                    name = it.name,
                    path = it.absolutePath,
                    sizeBytes = it.length(),
                    lastModified = it.lastModified(),
                )
            }

    fun delete(file: DownloadedFile): Boolean = File(file.path).delete()

    /**
     * yt-dlp本体を最新安定版へ更新する(プロセスごとに1回)。
     *
     * ライブラリ同梱のyt-dlpは古く、YouTube側の仕様変化で「Precondition check failed /
     * Please sign in」を返す(2026-08-19にPixel実機で発生)。サイト対応の追随はyt-dlp本体に
     * 任せる方針(ui-ux.md)なので、ダウンロードのたびではなく初回に更新を確認する。
     * 失敗してもダウンロード自体は試みる(オフライン時に更新失敗で全機能を殺さない)。
     */
    private fun updateYtdlp(onProgress: (percent: Float?, line: String) -> Unit) {
        if (ytdlpUpdated) return
        onProgress(null, "yt-dlp本体を更新中(初回のみ・数十秒)…")
        runCatching {
            // nightlyを使う。YouTubeの変化への修正はまずnightlyに入り、安定版は数週間遅れる。
            // 実際に安定版では403 Forbiddenで落ちた(yt-dlp #17456。nightlyで修正済みとメンテナが回答)。
            // このアプリは自分専用でPlay配信もしないため、鮮度を安定性より優先してよい
            YoutubeDL.getInstance().updateYoutubeDL(
                context.applicationContext,
                YoutubeDL.UpdateChannel._NIGHTLY,
            )
        }.onSuccess { ytdlpUpdated = true }
    }

    /**
     * python環境とffmpegの展開。エミュレータ(x86_64)ではネイティブバイナリが無く失敗する想定で、
     * その失敗はダウンロード実行時のエラーとして表に出す(起動時に落とさない)。
     */
    private fun ensureInitialized() {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
            YoutubeDL.getInstance().init(context.applicationContext)
            FFmpeg.getInstance().init(context.applicationContext)
            initialized = true
        }
    }
}
