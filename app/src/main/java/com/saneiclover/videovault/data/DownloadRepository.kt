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
            val request = YoutubeDLRequest(url).apply {
                addOption("-o", "${outputDir.absolutePath}/%(title)s.%(ext)s")
                addOption("--no-mtime")
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
