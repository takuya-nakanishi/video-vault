package com.saneiclover.videovault.ui.browser

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
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
import androidx.compose.material3.TextButton
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

private const val TAG = "VideoVaultBrowser"

/**
 * 内蔵ブラウザ。ログインが必要なサイトの導線(ui-ux.md 導線2)と、ブックマークの飛び先。
 *
 * 1. ここでユーザーが普通にログインする
 * 2. 目的の動画ページを開いた状態で下部の「このページをダウンロード」を押す
 * 3. WebViewが保持するCookieを取り出し、現在のURLと一緒に yt-dlp へ渡す
 *
 * 上部の栞アイコンで今のページをブックマークに出し入れできる(名前はページタイトル)。
 * 動画の通信を横取りして解析する方式は採らない。サイト側の実装が変わるたびに壊れるため。
 *
 * **サイトがネイティブアプリへ誘導してきても、このWebViewの中に留める。**
 * `newspicks://` や `intent://` への遷移をそのままWebViewに渡すと開けずに白い画面で止まる
 * (2026-08-21 Pixel実機・NewsPicksのGoogleログイン後に発生)。外へ出るとCookieが使えず、
 * このアプリの目的(ログイン済みCookieでダウンロード)が果たせないので、外のアプリは開かない。
 *
 * 遷移・エラー・JSコンソールは Logcat(タグ `VideoVaultBrowser`)に出す。実機でしか起きない
 * 不具合を `adb logcat -s VideoVaultBrowser` で追えるようにするため。
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
    /** サイトが外のアプリへ飛ばそうとしたスキームやパッケージ(`newspicks` など)。止めたことを帯で知らせる */
    var blockedScheme by remember { mutableStateOf<String?>(null) }
    /** 主フレームの読み込み失敗。白い画面のまま黙らない */
    var loadError by remember { mutableStateOf<String?>(null) }

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

        (blockedScheme ?: loadError)?.let { reason ->
            NoticeBar(
                text = if (blockedScheme != null) {
                    "サイトがアプリ($reason)へ移動しようとしたので止めた。ログイン状態はこの中に残っている"
                } else {
                    "読み込みに失敗: $reason"
                },
                actionLabel = "サイトのトップへ",
                onAction = {
                    blockedScheme = null
                    loadError = null
                    webView?.loadUrl(siteTopOf(currentUrl))
                },
                onDismiss = { blockedScheme = null; loadError = null },
            )
        }

        AndroidView(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            factory = { context ->
                val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
                // debugビルドは chrome://inspect / adb forward でページの中身を覗けるようにする
                // (実機でしか起きない白画面の調査用。releaseには効かない)
                WebView.setWebContentsDebuggingEnabled(debuggable)
                WebView(context).apply {
                    CookieManager.getInstance().setAcceptCookie(true)
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    // 素のWebViewはUAに「; wv」が入り、GoogleがJS無効扱いの「enablejs」ページへ
                    // 飛ばして検索結果が灰色の空白になる(2026-08-19にPixel実機で発生)。目印を外す
                    settings.userAgentString = settings.userAgentString.replace("; wv", "")
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val uri = request.url
                            val scheme = uri.scheme?.lowercase()
                            Log.i(TAG, "navigate main=${request.isForMainFrame} redirect=${request.isRedirect} $uri")
                            if (scheme == "http" || scheme == "https") return false
                            if (!request.isForMainFrame) return true
                            // 外のアプリへは出ない。intent:// に退避URLが付いていればそこへ、無ければ帯で知らせる
                            val fallback = intentFallbackUrl(uri.toString())
                            if (fallback != null) {
                                Log.i(TAG, "intent scheme -> browser_fallback_url: $fallback")
                                view.loadUrl(fallback)
                            } else {
                                Log.w(TAG, "blocked external scheme: $uri")
                                blockedScheme = if (scheme == "intent") {
                                    runCatching { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).`package` }
                                        .getOrNull() ?: "intent"
                                } else {
                                    scheme ?: uri.toString()
                                }
                            }
                            return true
                        }

                        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                            Log.i(TAG, "page started $url")
                            currentUrl = url
                            pageTitle = null
                            loading = true
                            loadError = null
                        }

                        override fun onPageFinished(view: WebView, url: String) {
                            Log.i(TAG, "page finished $url title=${view.title}")
                            currentUrl = url
                            pageTitle = view.title?.takeIf { it.isNotBlank() }
                            loading = false
                            // ログイン直後のCookieをすぐ永続化する(プロセスが死んでも残す)
                            CookieManager.getInstance().flush()
                        }

                        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                            Log.w(TAG, "error main=${request.isForMainFrame} code=${error.errorCode} ${error.description} ${request.url}")
                            if (request.isForMainFrame) loadError = "${error.description} (${request.url.host})"
                        }

                        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                            if (request.isForMainFrame) {
                                Log.w(TAG, "http error ${errorResponse.statusCode} ${request.url}")
                            }
                        }
                    }
                    webChromeClient = object : WebChromeClient() {
                        override fun onReceivedTitle(view: WebView, title: String?) {
                            pageTitle = title?.takeIf { it.isNotBlank() }
                        }

                        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                            Log.d(TAG, "console ${message.messageLevel()} ${message.sourceId()}:${message.lineNumber()} ${message.message()}")
                            return true
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

/** `intent://...#Intent;...;S.browser_fallback_url=...;end` から退避URLを取り出す。無ければ null。 */
internal fun intentFallbackUrl(url: String): String? {
    if (!url.startsWith("intent:", ignoreCase = true)) return null
    return runCatching {
        Intent.parseUri(url, Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url")
    }.getOrNull()?.takeIf { it.startsWith("http", ignoreCase = true) }
}

/** いま開いているページのサイトのトップ(`https://host/`)。 */
internal fun siteTopOf(url: String): String {
    val uri = runCatching { Uri.parse(url) }.getOrNull()
    val host = uri?.host ?: return url
    return "${uri.scheme ?: "https"}://$host/"
}

/** 外部アプリへの誘導を止めた・読み込みに失敗した、をWebViewの上に出す帯。 */
@Composable
private fun NoticeBar(text: String, actionLabel: String, onAction: () -> Unit, onDismiss: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.tertiaryContainer, contentColor = MaterialTheme.colorScheme.onTertiaryContainer) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onAction) { Text(actionLabel) }
            TextButton(onClick = onDismiss) { Text("閉じる") }
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
