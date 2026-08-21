package com.saneiclover.videovault

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import com.saneiclover.videovault.ui.Screen
import com.saneiclover.videovault.ui.VideoVaultViewModel
import com.saneiclover.videovault.ui.browser.BrowserScreen
import com.saneiclover.videovault.ui.files.FilesScreen
import com.saneiclover.videovault.ui.history.HistoryScreen
import com.saneiclover.videovault.ui.home.HomeScreen
import com.saneiclover.videovault.ui.theme.VideoVaultTheme

class MainActivity : ComponentActivity() {

    private val viewModel: VideoVaultViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // ステータスバー・ナビゲーションバーのアイコン色をライト/ダークに合わせる
        // (付けないとライトモードで時計やアイコンが白く沈む。エミュレータで実際に沈んだ)
        enableEdgeToEdge()
        handleIntent(intent)

        setContent {
            VideoVaultTheme {
                // 保存先(Download/videos)への書き込み許可が要るとき、システムの
                // 「すべてのファイルへのアクセス」設定画面へ誘導する。戻ってきたら onResume で再確認される
                LaunchedEffect(viewModel.home.needStorageAccess) {
                    if (viewModel.home.needStorageAccess) {
                        openAllFilesAccessSettings()
                        viewModel.onStorageAccessRequested()
                    }
                }
                Surface(
                    // targetSdk 35はedge-to-edgeが強制される。付けないとステータスバーと
                    // ナビゲーションバーの下に中身が潜り込む(エミュレータで実際に潜った)
                    modifier = Modifier.fillMaxSize().safeDrawingPadding(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    when (val screen = viewModel.screen) {
                        Screen.Home -> HomeScreen(
                            state = viewModel.home,
                            onInputChange = viewModel::onInputChange,
                            onSubmit = viewModel::onSubmit,
                            onClearInput = viewModel::onClearInput,
                            onClipboardChipClick = viewModel::onClipboardChipClick,
                            onSuggestionClick = viewModel::onSuggestionClick,
                            onCancelDownload = viewModel::onCancelDownload,
                            onDismissMessage = viewModel::onDismissMessage,
                            onBookmarkClick = viewModel::onBookmarkClick,
                            onAddBookmark = viewModel::onAddBookmark,
                            onRemoveBookmark = viewModel::onRemoveBookmark,
                            onOpenHistory = viewModel::onOpenHistory,
                            onOpenFiles = viewModel::onOpenFiles,
                            onHistoryRetry = viewModel::onRetryHistory,
                            onHistoryOpen = viewModel::onOpenHistoryInBrowser,
                            onHistoryCopy = viewModel::onCopyHistoryUrl,
                            onHistoryDelete = viewModel::onDeleteHistory,
                        )

                        is Screen.Browser -> BrowserScreen(
                            initialUrl = screen.url,
                            isBookmarked = viewModel::isBookmarked,
                            onToggleBookmark = viewModel::onToggleBookmark,
                            onBack = viewModel::onBackToHome,
                            onDownloadRequest = viewModel::onBrowserDownloadRequest,
                            onVideoDownload = viewModel::onBrowserVideoDownload,
                        )

                        Screen.History -> HistoryScreen(
                            history = viewModel.home.history,
                            onBack = viewModel::onBackToHome,
                            onRetry = viewModel::onRetryHistory,
                            onOpen = viewModel::onOpenHistoryInBrowser,
                            onCopy = viewModel::onCopyHistoryUrl,
                            onDelete = viewModel::onDeleteHistory,
                            onClearAll = viewModel::onClearHistory,
                            message = viewModel.home.message,
                            onDismissMessage = viewModel::onDismissMessage,
                        )

                        Screen.Files -> FilesScreen(
                            downloads = viewModel.home.downloads,
                            onBack = viewModel::onBackToHome,
                            onDelete = viewModel::onDeleteDownload,
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        // 他アプリでURLをコピーして戻ってくる動線があるので、復帰のたびに見直す
        viewModel.refreshClipboardHint()
        viewModel.refreshDownloads()
    }

    /** YouTube/Xアプリの共有シートから受け取ったURLを、判定済みの状態で入力欄に載せる。 */
    private fun handleIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        viewModel.onSharedText(intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty())
    }

    /** 「すべてのファイルへのアクセス」の設定画面を、可能ならこのアプリを選択した状態で開く。 */
    private fun openAllFilesAccessSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val intent = runCatching {
            Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:$packageName"),
            )
        }.getOrNull()
        runCatching { startActivity(intent) }.onFailure {
            // 端末によっては上のアクションが無い。アプリ指定なしの一覧へ落とす
            runCatching { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
        }
    }
}
