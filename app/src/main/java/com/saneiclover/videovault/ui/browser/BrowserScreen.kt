package com.saneiclover.videovault.ui.browser

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.saneiclover.videovault.R
import com.saneiclover.videovault.domain.InputClassifier

/**
 * 内蔵ブラウザ。ログインが必要なサイトの導線(ui-ux.md 導線2)と、ブックマークの飛び先。
 *
 * 1. ここでユーザーが普通にログインする
 * 2. 目的の動画ページを開いた状態で下部の「このページをダウンロード」を押す
 * 3. WebViewが保持するCookieを取り出し、現在のURLと一緒に yt-dlp へ渡す
 *
 * 上部の栞アイコンで今のページをブックマークに出し入れできる(名前はページタイトル)。
 * 動画の通信を横取りして解析する方式は採らない。サイト側の実装が変わるたびに壊れるため。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BrowserScreen(
    initialUrl: String,
    isBookmarked: (url: String) -> Boolean,
    onToggleBookmark: (pageTitle: String?, url: String) -> Unit,
    onBack: () -> Unit,
    onDownloadRequest: (pageUrl: String, cookieHeader: String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var currentUrl by remember { mutableStateOf(initialUrl) }
    var pageTitle by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    BackHandler {
        val view = webView
        if (view != null && view.canGoBack()) view.goBack() else onBack()
    }

    Column(modifier = modifier.fillMaxSize()) {
        Surface(color = MaterialTheme.colorScheme.surface) {
            Column {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "ホームへ戻る")
                    }
                    UrlPill(
                        url = currentUrl,
                        title = pageTitle,
                        modifier = Modifier.weight(1f),
                    )
                    val bookmarked = isBookmarked(currentUrl)
                    IconButton(onClick = { onToggleBookmark(pageTitle, currentUrl) }) {
                        Icon(
                            painterResource(if (bookmarked) R.drawable.ic_bookmark_filled else R.drawable.ic_bookmark),
                            contentDescription = if (bookmarked) "ブックマークから外す" else "ブックマークに追加",
                            tint = if (bookmarked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (loading) {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth().height(2.dp))
                } else {
                    Spacer(Modifier.height(2.dp))
                }
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
                    // 素のWebViewはUAに「; wv」が入り、GoogleがJS無効扱いの「enablejs」ページへ
                    // 飛ばして検索結果が灰色の空白になる(2026-08-19にPixel実機で発生)。目印を外す
                    settings.userAgentString = settings.userAgentString.replace("; wv", "")
                    webViewClient = object : WebViewClient() {
                        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                            currentUrl = url
                            pageTitle = null
                            loading = true
                        }

                        override fun onPageFinished(view: WebView, url: String) {
                            currentUrl = url
                            pageTitle = view.title?.takeIf { it.isNotBlank() }
                            loading = false
                        }
                    }
                    webChromeClient = object : WebChromeClient() {
                        override fun onReceivedTitle(view: WebView, title: String?) {
                            pageTitle = title?.takeIf { it.isNotBlank() }
                        }
                    }
                    loadUrl(initialUrl)
                    webView = this
                }
            },
        )

        Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                IconButton(onClick = { webView?.takeIf { it.canGoBack() }?.goBack() }) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "戻る")
                }
                IconButton(onClick = { webView?.reload() }) {
                    Icon(Icons.Default.Refresh, contentDescription = "再読込")
                }
                Button(
                    modifier = Modifier.weight(1f).height(48.dp),
                    onClick = {
                        // ログイン直後のCookieが未書き出しのことがあるので確定させてから読む
                        CookieManager.getInstance().flush()
                        onDownloadRequest(currentUrl, CookieManager.getInstance().getCookie(currentUrl))
                    },
                ) {
                    Icon(painterResource(R.drawable.ic_download), contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("このページをダウンロード")
                }
            }
        }
    }
}

/** いま開いているページ。ホストを太く、タイトル(無ければURL全体)を添える。 */
@Composable
private fun UrlPill(url: String, title: String?, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = MaterialTheme.shapes.extraLarge,
        modifier = modifier,
    ) {
        Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            Column {
                Text(
                    InputClassifier.hostOf(url) ?: url,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    title ?: url,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
