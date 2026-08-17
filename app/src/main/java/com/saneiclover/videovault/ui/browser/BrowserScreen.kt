package com.saneiclover.videovault.ui.browser

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * 内蔵ブラウザ。ログインが必要なサイトの導線(ui-ux.md 導線2)。
 *
 * 1. ここでユーザーが普通にログインする
 * 2. 目的の動画ページを開いた状態で下部の「このページをダウンロード」を押す
 * 3. WebViewが保持するCookieを取り出し、現在のURLと一緒に yt-dlp へ渡す
 *
 * 動画の通信を横取りして解析する方式は採らない。サイト側の実装が変わるたびに壊れるため。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BrowserScreen(
    initialUrl: String,
    onBack: () -> Unit,
    onDownloadRequest: (pageUrl: String, cookieHeader: String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var currentUrl by remember { mutableStateOf(initialUrl) }
    var loading by remember { mutableStateOf(true) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    BackHandler {
        val view = webView
        if (view != null && view.canGoBack()) view.goBack() else onBack()
    }

    Column(modifier = modifier.fillMaxSize()) {
        Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                TextButton(onClick = onBack) { Text("ホーム") }
                Text(
                    text = if (loading) "読み込み中… $currentUrl" else currentUrl,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        AndroidView(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            factory = { context ->
                WebView(context).apply {
                    CookieManager.getInstance().setAcceptCookie(true)
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    webViewClient = object : WebViewClient() {
                        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                            currentUrl = url
                            loading = true
                        }

                        override fun onPageFinished(view: WebView, url: String) {
                            currentUrl = url
                            loading = false
                        }
                    }
                    loadUrl(initialUrl)
                    webView = this
                }
            },
        )

        Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(
                    onClick = { webView?.takeIf { it.canGoBack() }?.goBack() },
                ) { Text("戻る") }
                TextButton(onClick = { webView?.reload() }) { Text("再読込") }
                Button(
                    modifier = Modifier.weight(1f),
                    onClick = {
                        // ログイン直後のCookieが未書き出しのことがあるので確定させてから読む
                        CookieManager.getInstance().flush()
                        onDownloadRequest(currentUrl, CookieManager.getInstance().getCookie(currentUrl))
                    },
                ) { Text("このページをダウンロード") }
            }
        }
    }
}
