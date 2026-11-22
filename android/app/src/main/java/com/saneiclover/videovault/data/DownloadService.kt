package com.saneiclover.videovault.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.saneiclover.videovault.MainActivity
import com.saneiclover.videovault.R
import com.saneiclover.videovault.domain.DownloadJob
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.HistoryStatus

/**
 * ダウンロードを走らせるForegroundService(2026-08-25新設)。
 *
 * **これが無いと、画面を閉じた瞬間にダウンロードが死ぬ。** それまでは ViewModel の
 * `viewModelScope` で走らせていたため、ホームに戻る・他のアプリを見る・内蔵ブラウザで
 * 動画を再生し続ける、のいずれでもプロセスが落とされ得た(handoff「既知の制約3」)。
 *
 * 役割は「実行の器」に徹する。状態と履歴は [DownloadCenter] が持ち、ここは
 * 通知を出して [DownloadCenter.execute] を回し、終わったら自分を止めるだけ。
 *
 * サービス種別は `dataSync`(Manifest)。ユーザーが明示的に始めた転送で、Android 14 以降の
 * 「ユーザーが開始したデータ転送」の定義に合う。起動は前面のActivityからなので
 * バックグラウンド起動制限には掛からない。
 */
class DownloadService : Service() {

    private var lastNotifiedAt = 0L

    override fun onCreate() {
        super.onCreate()
        createChannels()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CANCEL -> {
                // 中断してもここでは止めない。yt-dlpが落ちると execute の完了経路が走り、そこで stopSelf する
                DownloadCenter.cancel()
                return START_NOT_STICKY
            }

            ACTION_START -> {
                val id = intent.getStringExtra(EXTRA_ID)
                if (id == null) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                // startForegroundService から5秒以内に呼ぶ必要がある。実処理より先に出す
                startForegroundCompat(progressNotification(DownloadCenter.job))
                DownloadCenter.execute(
                    id = id,
                    onProgress = ::updateProgress,
                    onFinished = ::finish,
                )
            }

            else -> stopSelf()
        }
        // 引数(どのURLか)を失った再起動には意味がないので、システムに作り直させない
        return START_NOT_STICKY
    }

    /**
     * タスク一覧からアプリをスワイプで消されたときも**止めない**。
     * ダウンロードの継続がこのサービスの存在理由で、通知から中断できる。
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.i(TAG, "タスクが消されたがダウンロードは継続する")
    }

    private fun updateProgress(job: DownloadJob) {
        // 通知の更新はUIより粗くてよい。頻繁に出すとシステム側で間引かれる
        val now = System.currentTimeMillis()
        if (now - lastNotifiedAt < NOTIFY_THROTTLE_MS) return
        lastNotifiedAt = now
        notify(NOTIF_PROGRESS, progressNotification(job))
    }

    private fun finish(entry: HistoryEntry?) {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        entry?.let { resultNotification(it)?.let { n -> notify(NOTIF_RESULT, n) } }
        stopSelf()
    }

    // --- 通知 ---

    private fun createChannels() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            // 進行中は音を鳴らさない。常駐する通知なので静かにする
            NotificationChannel(CHANNEL_PROGRESS, "ダウンロード中", NotificationManager.IMPORTANCE_LOW),
        )
        manager.createNotificationChannel(
            // 結果は気づきたい。アプリを離れている間に終わるのが普通の使い方になる
            NotificationChannel(CHANNEL_RESULT, "ダウンロードの結果", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    private fun progressNotification(job: DownloadJob?) = NotificationCompat.Builder(this, CHANNEL_PROGRESS)
        .setSmallIcon(R.drawable.ic_download)
        .setContentTitle(job?.siteName?.let { "ダウンロード中 · $it" } ?: "ダウンロード中")
        .setContentText(job?.line?.takeIf { it.isNotBlank() } ?: job?.url.orEmpty())
        .setStyle(NotificationCompat.BigTextStyle().bigText(job?.line.orEmpty()))
        .setProgress(100, ((job?.percent ?: 0f) * 100).toInt(), job?.percent == null)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(openAppIntent())
        .addAction(0, "中断", cancelIntent())
        .build()

    /** 中断は自分で止めたことなので通知を出さない(成功・失敗だけ知らせる)。 */
    private fun resultNotification(entry: HistoryEntry) = when (entry.status) {
        HistoryStatus.SUCCESS -> notificationOf(
            title = "完了: ${entry.title ?: entry.siteName}",
            text = "Download/videos に保存した",
        )

        HistoryStatus.FAILED -> notificationOf(
            title = "失敗: ${entry.siteName}",
            text = entry.error ?: entry.url,
        )

        else -> null
    }

    private fun notificationOf(title: String, text: String) = NotificationCompat.Builder(this, CHANNEL_RESULT)
        .setSmallIcon(R.drawable.ic_download)
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setAutoCancel(true)
        .setContentIntent(openAppIntent())
        .build()

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun cancelIntent(): PendingIntent = PendingIntent.getService(
        this,
        1,
        Intent(this, DownloadService::class.java).setAction(ACTION_CANCEL),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** 通知権限(Android 13以降)が無ければ黙って出ない。ダウンロード自体は続く。 */
    private fun notify(id: Int, notification: android.app.Notification) {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return
        runCatching { NotificationManagerCompat.from(this).notify(id, notification) }
            .onFailure { Log.w(TAG, "通知を出せない", it) }
    }

    private fun startForegroundCompat(notification: android.app.Notification) {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIF_PROGRESS, notification, type)
    }

    companion object {
        private const val TAG = "VideoVaultDownload"
        private const val CHANNEL_PROGRESS = "downloads"
        private const val CHANNEL_RESULT = "download_results"
        private const val NOTIF_PROGRESS = 1
        private const val NOTIF_RESULT = 2
        private const val NOTIFY_THROTTLE_MS = 1000L

        const val ACTION_START = "com.saneiclover.videovault.action.DOWNLOAD"
        const val ACTION_CANCEL = "com.saneiclover.videovault.action.CANCEL"
        private const val EXTRA_ID = "id"

        /**
         * 申し込み済みのダウンロード([DownloadCenter.request])を走らせる。
         * **Intentに載せるのは識別子だけ**。URLとCookieは [DownloadCenter] が持ったままにする
         * (認証情報をIntent経由でシステムへ渡さない)。
         */
        fun start(context: Context, id: String): Boolean = runCatching {
            ContextCompat.startForegroundService(
                context,
                Intent(context, DownloadService::class.java)
                    .setAction(ACTION_START)
                    .putExtra(EXTRA_ID, id),
            )
            true
        }.getOrElse {
            Log.w(TAG, "ForegroundServiceを開始できない", it)
            false
        }
    }
}
