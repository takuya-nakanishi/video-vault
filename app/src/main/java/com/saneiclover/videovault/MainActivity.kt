package com.saneiclover.videovault

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.saneiclover.videovault.ui.Screen
import com.saneiclover.videovault.ui.VideoVaultViewModel
import com.saneiclover.videovault.ui.browser.BrowserScreen
import com.saneiclover.videovault.ui.home.HomeScreen
import com.saneiclover.videovault.ui.theme.VideoVaultTheme

class MainActivity : ComponentActivity() {

    private val viewModel: VideoVaultViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)

        setContent {
            VideoVaultTheme {
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
                            onDeleteDownload = viewModel::onDeleteDownload,
                            onDismissMessage = viewModel::onDismissMessage,
                        )

                        is Screen.Browser -> BrowserScreen(
                            initialUrl = screen.url,
                            onBack = viewModel::onBackToHome,
                            onDownloadRequest = viewModel::onBrowserDownloadRequest,
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
}
