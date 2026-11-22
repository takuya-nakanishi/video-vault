package com.saneiclover.videovault.data

import android.content.Context
import android.os.Build
import android.os.Environment
import android.util.Log
import com.saneiclover.videovault.domain.DownloadedFile
import com.saneiclover.videovault.domain.Quality
import com.saneiclover.videovault.domain.Vidyard
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

/** yt-dlp を起動する前に中断が押された。失敗ではなく「中断」として履歴に残る */
class CancelledBeforeStartException : IOException("中断した")

/**
 * yt-dlp(youtubedl-android)の呼び出し口。UI層はここより下を知らない。
 *
 * 保存先は公共の **`Download/videos/`**(2026-08-21・人間の指定)。他のアプリ(ギャラリー・
 * ファイル・PCへのMTP転送)から見える。この領域へ書くには「すべてのファイルへのアクセス」
 * (`MANAGE_EXTERNAL_STORAGE`)が要る。yt-dlpは実ファイルパスへ書くため、MediaStoreの
 * content URIではなくこの権限で直接パスに書く([hasStorageAccess] で事前に確認する)。
 * サイドロード専用アプリなのでこの権限を使ってよい(AGENTS.md「位置づけと公開ルール」)。
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

    /**
     * 公共の `Download/videos`。存在しなければ作る(権限が無いと作れないので事前に [hasStorageAccess])。
     *
     * `getExternalStoragePublicDirectory` は非推奨だが、公式の代替(MediaStore)は
     * **content URIしか返さず実ファイルパスを与えない**。yt-dlpは `-o <パス>` に実パスを要求するため
     * ここでは非推奨APIを使い続ける(全リポジトリ共通ルール「代替が機能不足なら理由を記録して継続」)。
     */
    @Suppress("DEPRECATION")
    val outputDir: File
        get() = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "videos",
        ).apply { mkdirs() }

    /**
     * 公共領域へ書ける状態か。minSdkは26なので、30以上では「すべてのファイルへのアクセス」を要求する
     * (30未満は常にtrueで、旧APIのWRITE_EXTERNAL_STORAGE前提の従来動作にしておく)。
     */
    fun hasStorageAccess(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()

    /**
     * @param cookieFile ログインが必要なサイト向け。使用後は呼び出し側で消さず、ここで必ず消す
     * @param processId 中断([cancel])に使う識別子
     * @param videoPassword 動画のパスワード(いまは Vidyard だけが使う)。メモリにだけ置き、ログにも履歴にも書かない
     * @param isCancelled 中断が押されたか。yt-dlp を起動する前の段で見る(下の [ensureNotCancelled])
     */
    suspend fun download(
        url: String,
        cookieFile: File?,
        quality: Quality,
        processId: String,
        videoPassword: String? = null,
        isCancelled: () -> Boolean = { false },
        onProgress: (percent: Float?, line: String) -> Unit,
    ): Result<Unit> = withContext(io) {
        runCatching {
            ensureInitialized()
            updateYtdlp(onProgress)
            ensureNotCancelled(isCancelled)
            // Vidyard のパスワード保護は yt-dlp が解けない。ここで解錠し、トークンだけを yt-dlp へ渡す
            // (VidyardUnlocker。保護されていなければ null で、何も付けない)
            val vidyardToken = Vidyard.playerUuidOf(url)?.let { uuid ->
                onProgress(null, "Vidyardの保護を確認中…")
                VidyardUnlocker.accessTokenFor(uuid, videoPassword, isCancelled)
            }
            ensureNotCancelled(isCancelled)
            val request = YoutubeDLRequest(url).apply {
                addOption("-o", "${outputDir.absolutePath}/%(title)s.%(ext)s")
                addOption("--no-mtime")
                // 画質(解像度の上限)。オリジナルは yt-dlp の既定に任せる(Quality.kt)
                quality.formatSelector?.let { addOption("-f", it) }
                // IPv4を強制する。デュアルスタック(IPv6あり)の実回線で、CloudFront配信の
                // 動画ホスト(例: vod.newspicks.com)のセグメント取得が
                // 「[Errno 7] No address associated with hostname」でDNS解決に失敗し、
                // 10回リトライして落ちた(2026-08-21 Pixel実機/自宅Wi-Fi)。同梱pythonの
                // getaddrinfoがAAAA解決で詰まるのがyoutubedl-androidの定番の落とし穴。
                // IPv4に固定するとAレコードだけを引くので回避できる(IPv4のみのエミュレータでは元々発生せず、
                // 固定しても実ダウンロードは通ることを煙試験で確認済み)。
                addOption("--force-ipv4")
                // yt-dlpはYouTubeの署名解読に外部JavaScriptランタイムを要求するようになり、
                // 無いと403 Forbiddenで落ちる(2026-08-19実測)。ライブラリ0.18.1が同梱する
                // QuickJSを使うが、`--js-runtimes quickjs:<パス>` はライブラリが内部で付与するため
                // ここでは指定しない(パス無しで自前指定すると、その自動付与を壊して403に戻る)
                cookieFile?.let { addOption("--cookies", it.absolutePath) }
                // 解錠したトークン。yt-dlp は全ての通信にこのヘッダを付け、Vidyard がそれを見て動画の URL を返す
                vidyardToken?.let { addOption("--add-header", "${VidyardUnlocker.ACCESS_HEADER}:$it") }
            }
            YoutubeDL.getInstance().execute(request, processId) { percent, _, line ->
                onProgress(percent.takeIf { it >= 0f }?.div(100f), line)
            }
            Unit
        }.onFailure {
            // 実機でしか出ない失敗を後から追えるよう全文をLogcatに残す(履歴には1行しか持たない)
            Log.w(TAG, "download failed: $url", it)
        }.also {
            // Cookieは認証情報。成否にかかわらず残さない
            cookieFile?.delete()
        }
    }

    /**
     * 中断が押されていたら、yt-dlp を起動せずに止める。
     *
     * [cancel] は起動済みの yt-dlp のプロセスしか止められない。起動前の段(python 環境の展開・本体の更新・
     * Vidyard の解錠)で押された中断は、そのままだと解錠の後に yt-dlp が走って取得が始まってしまう
     * (2026-11-10 Codex レビュー指摘)。段の切れ目でここを呼ぶ。履歴は「中断」になる
     * ([DownloadCenter] が失敗の理由ではなく中断の印を見て決める)。
     */
    private fun ensureNotCancelled(isCancelled: () -> Boolean) {
        if (isCancelled()) throw CancelledBeforeStartException()
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

    private companion object {
        const val TAG = "VideoVaultDownload"
    }
}
