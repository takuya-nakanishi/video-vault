package com.saneiclover.videovault.ui.browser

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.net.Uri
import android.os.Message
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
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
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.saneiclover.videovault.R
import com.saneiclover.videovault.domain.DownloadJob
import com.saneiclover.videovault.domain.InputClassifier
import com.saneiclover.videovault.domain.Quality
import com.saneiclover.videovault.ui.components.MessageBanner
import com.saneiclover.videovault.ui.components.QualitySheet
import com.saneiclover.videovault.ui.home.PendingDownload
import org.json.JSONObject

private const val TAG = "VideoVaultBrowser"
private const val BADGE_SCRIPT_ASSET = "video_badge.js"

/**
 * 内蔵ブラウザ。ログインが必要なサイトの導線(ui-ux.md 導線2)と、ブックマークの飛び先。
 *
 * **動画の取り方(2026-08-21変更)**: ページ内の `<video>`(と既知の埋め込みiframe)を検出し、
 * その枠の右下に弾むダウンロードバッジを重ねる(`assets/video_badge.js` を読み込み完了時に注入)。
 * バッジのタップは [VideoBridge] 経由でアプリに届き、ツイートのパーマリンクや `watch?v=` など
 * **動画そのもののURL**を推定して yt-dlp へ渡す。常設のフッターボタンは廃止し、
 * 検出できないサイト向けに下部バーの「⋮」に「このページのURLでダウンロード」を予備として残す。
 *
 * **外部アプリへの誘導はWebView内で止める**(`newspicks://` 等)。外へ出るとCookieが使えない。
 * **ポップアップ(別ウィンドウ)のログインに対応する**(X等の「Googleでログイン」は `window.open`)。
 * `setSupportMultipleWindows(true)` + `onCreateWindow` で子WebViewとして開き、オーバーレイで重ねる。
 *
 * 遷移・エラー・JSコンソールは Logcat(タグ `VideoVaultBrowser`)に出す。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BrowserScreen(
    initialUrl: String,
    isBookmarked: (url: String) -> Boolean,
    onToggleBookmark: (pageTitle: String?, url: String) -> Unit,
    onBack: () -> Unit,
    /** 予備: いまのページのURLでそのまま yt-dlp にかける(検出できないサイト用) */
    onDownloadRequest: (pageUrl: String, cookieHeader: String?) -> Unit,
    /** バッジのタップ。targetUrl は動画そのもののURLの推定、mediaSrc は `<video>` の src(予備) */
    onVideoDownload: (pageUrl: String, targetUrl: String, mediaSrc: String, cookieHeader: String?) -> Unit,
    /** ホームと同じダウンロードの状態。この画面から離れずに選び・見守り・中断できる */
    download: BrowserDownloadState,
    onQualityChosen: (Quality, String?) -> Unit,
    onDismissPendingDownload: () -> Unit,
    onCancelDownload: () -> Unit,
    onDismissMessage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val badgeScript = remember { loadAsset(context, BADGE_SCRIPT_ASSET) }

    var currentUrl by remember { mutableStateOf(initialUrl) }
    var pageTitle by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var popup by remember { mutableStateOf<WebView?>(null) }
    var blockedScheme by remember { mutableStateOf<String?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    /** ページ内で見えている動画の数(JSから通知)。下部バーに出す */
    var videoCount by remember { mutableIntStateOf(0) }
    var menuOpen by remember { mutableStateOf(false) }
    /** PC版サイト(デスクトップUA)で表示中か。モバイル版がアプリへ誘導するサイト(TikTok等)の逃げ道 */
    var desktopMode by remember { mutableStateOf(false) }
    /** サイトがパスキー(WebAuthn)を要求した。アプリ内WebViewでは使えないので理由と代替を出す */
    var passkeyNotice by remember { mutableStateOf(false) }

    fun closePopup() {
        popup?.let { it.webChromeClient = null; it.destroy() }
        popup = null
    }

    BackHandler {
        val view = webView
        when {
            popup != null -> closePopup()
            view != null && view.canGoBack() -> view.goBack()
            else -> onBack()
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            Surface(color = MaterialTheme.colorScheme.surface) {
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "ホームへ戻る")
                        }
                        UrlPill(url = currentUrl, title = pageTitle, modifier = Modifier.weight(1f))
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

            if (passkeyNotice) {
                NoticeBar(
                    text = "このアプリ内ブラウザではパスキーが使えない(Androidの制限。サイトが許可したアプリか" +
                        "ブラウザ権限が要る)。認証アプリ(TOTP)・SMS・パスワードなど別の方法でログインする",
                    actionLabel = null,
                    onAction = {},
                    onDismiss = { passkeyNotice = false },
                )
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
                factory = { ctx ->
                    val debuggable = (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
                    WebView.setWebContentsDebuggingEnabled(debuggable)
                    WebView(ctx).apply {
                        configureForBrowsing()
                        settings.setSupportMultipleWindows(true)
                        settings.javaScriptCanOpenWindowsAutomatically = true
                        val view = this
                        addJavascriptInterface(
                            VideoBridge(
                                onDownload = { payload ->
                                    // JSインターフェースは別スレッドで呼ばれる。UIスレッドへ戻す
                                    view.post {
                                        val pageUrl = payload.optString("pageUrl").ifBlank { currentUrl }
                                        val target = payload.optString("targetUrl").ifBlank { pageUrl }
                                        val media = payload.optString("mediaSrc")
                                        Log.i(TAG, "badge tapped page=$pageUrl target=$target media=${media.take(80)}")
                                        CookieManager.getInstance().flush()
                                        val cookies = CookieManager.getInstance().getCookie(target)
                                            ?: CookieManager.getInstance().getCookie(pageUrl)
                                        onVideoDownload(pageUrl, target, media, cookies)
                                    }
                                },
                                onCount = { n -> view.post { videoCount = n } },
                                onPasskey = { view.post { passkeyNotice = true } },
                            ),
                            "VideoVault",
                        )
                        webViewClient = browsingClient(
                            onSchemeBlocked = { blockedScheme = it },
                            onUrl = { currentUrl = it },
                            onTitle = { pageTitle = it },
                            onLoading = { started ->
                                loading = started
                                // 件数は遷移の「開始」で0に戻す。完了時に戻すとSPA(YouTube等)で
                                // 完了が複数回来たとき、検出済みの件数を消してしまう
                                if (started) videoCount = 0
                            },
                            onError = { loadError = it },
                            onPageReady = { v ->
                                if (badgeScript.isNotBlank()) v.evaluateJavascript(badgeScript, null)
                            },
                        )
                        webChromeClient = mainChromeClient(
                            context = ctx,
                            onTitle = { pageTitle = it },
                            onOpenPopup = { child -> popup = child },
                            onCloseChild = { closePopup() },
                        )
                        loadUrl(initialUrl)
                        webView = this
                    }
                },
            )

            download.message?.let { message ->
                Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
                    MessageBanner(
                        message = message,
                        onDismiss = onDismissMessage,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }

            download.job?.let { job -> BrowserProgressBar(job = job, onCancel = onCancelDownload) }

            Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    IconButton(onClick = { webView?.takeIf { it.canGoBack() }?.goBack() }) {
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "戻る")
                    }
                    IconButton(onClick = { webView?.reload() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "再読込")
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = if (videoCount > 0) "動画 ${videoCount}件 · 右下のバッジで取得" else "動画を探している…",
                        style = MaterialTheme.typography.labelMedium,
                        color = if (videoCount > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Box {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "その他")
                        }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(
                                text = { Text("このページのURLでダウンロード") },
                                leadingIcon = { Icon(painterResource(R.drawable.ic_download), contentDescription = null) },
                                onClick = {
                                    menuOpen = false
                                    CookieManager.getInstance().flush()
                                    onDownloadRequest(currentUrl, CookieManager.getInstance().getCookie(currentUrl))
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("動画を探し直す") },
                                leadingIcon = { Icon(Icons.Default.Refresh, contentDescription = null) },
                                onClick = {
                                    menuOpen = false
                                    webView?.evaluateJavascript(badgeScript, null)
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(if (desktopMode) "モバイル版サイトで表示" else "PC版サイトで表示") },
                                leadingIcon = { Icon(painterResource(R.drawable.ic_globe), contentDescription = null) },
                                onClick = {
                                    menuOpen = false
                                    desktopMode = !desktopMode
                                    webView?.let { v ->
                                        v.applyDesktopMode(desktopMode)
                                        v.reload()
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }

        popup?.let { child ->
            key(child) { PopupOverlay(child = child, onClose = { closePopup() }) }
        }

        // 画質シート。ホームへ戻さずここで選べるのが、見ながら落とせることの要
        download.pending?.let { pending ->
            QualitySheet(
                pending = pending,
                current = download.defaultQuality,
                onChoose = onQualityChosen,
                onDismiss = onDismissPendingDownload,
            )
        }
    }
}

/**
 * ブラウザ画面に重ねるダウンロードの状態。ホームの [com.saneiclover.videovault.ui.home.HomeUiState] の
 * 同名の値をそのまま映す(持ち主は [com.saneiclover.videovault.data.DownloadCenter])。
 */
data class BrowserDownloadState(
    /** 画質シートで選択待ちのダウンロード */
    val pending: PendingDownload? = null,
    val defaultQuality: Quality = Quality.DEFAULT,
    /** 実行中のダウンロード。ページを見ながら進捗を確認できる */
    val job: DownloadJob? = null,
    /** 完了・失敗の1行 */
    val message: String? = null,
)

/**
 * 下部バーの上に出る進捗。動画を見たまま進み具合が見え、そのまま中断もできる。
 *
 * **1行に詰めてある**。ここが厚いとWebViewがその分縮み、再生中のプレイヤーが動く。
 * yt-dlpの出力行はホームの進捗カードで見えるので、ここでは率と中断だけを出す。
 */
@Composable
private fun BrowserProgressBar(job: DownloadJob, onCancel: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = job.percent?.let { "ダウンロード中 ${(it * 100).toInt()}%" } ?: "ダウンロード中",
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                TextButton(onClick = onCancel) { Text("中断") }
            }
            if (job.percent != null) {
                LinearProgressIndicator(
                    progress = { job.percent },
                    modifier = Modifier.fillMaxWidth().height(2.dp),
                )
            } else {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth().height(2.dp))
            }
        }
    }
}

/**
 * ページ内JS(`video_badge.js`)からの橋渡し。`@JavascriptInterface` は**どのページからでも呼べる**。
 * できることはダウンロードの開始と件数の通知だけで、端末内の情報は返さない(私的利用のアプリでも
 * 外部ページに渡す口は最小にしておく)。
 */
private class VideoBridge(
    private val onDownload: (JSONObject) -> Unit,
    private val onCount: (Int) -> Unit,
    private val onPasskey: () -> Unit,
) {
    @JavascriptInterface
    fun onVideoDownload(json: String) {
        val payload = runCatching { JSONObject(json) }.getOrElse { JSONObject() }
        onDownload(payload)
    }

    @JavascriptInterface
    fun onVideoCount(n: Int) = onCount(n.coerceAtLeast(0))

    /** ページが `navigator.credentials.get/create`(パスキー)を呼んだ。 */
    @JavascriptInterface
    fun onPasskeyAttempt() = onPasskey()
}

private fun loadAsset(context: Context, name: String): String =
    runCatching { context.assets.open(name).bufferedReader().use { it.readText() } }
        .getOrElse { Log.e(TAG, "$name を読めない。動画バッジは出ない", it); "" }

/** ポップアップ(Googleログイン等)を全面に重ねる。 */
@Composable
private fun PopupOverlay(child: WebView, onClose: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("ログイン", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f).padding(start = 8.dp))
                IconButton(onClick = onClose) {
                    Icon(Icons.Default.Close, contentDescription = "ログインを閉じる")
                }
            }
            AndroidView(modifier = Modifier.weight(1f).fillMaxWidth(), factory = { child })
        }
    }
}

/** ブラウズ用の共通設定(メイン・ポップアップ両方に当てる)。 */
@SuppressLint("SetJavaScriptEnabled")
private fun WebView.configureForBrowsing() {
    // WebViewの既定のLayoutParams高さは WRAP_CONTENT。すると CSS の初期包含ブロック(ICB)の
    // 高さが0になり、`height:100vh` や `height:100%` が全部0に潰れる(幅は効くので vw は正常)。
    // X のログインは vh でレイアウトするため、モーダルが高さ0になり真っ白のまま固まっていた
    // (2026-08-21 実機。回転しても直らず、DevToolsで vh=0・html高さ0px を実測して特定)。
    // 高さを MATCH_PARENT にすると ICB に実寸が入り解消する
    layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
    )
    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    // 素のWebViewはUAに「; wv」が入り、GoogleがJS無効扱いの「enablejs」へ飛ばして空白になる(2026-08-19 実機)
    settings.userAgentString = settings.userAgentString.replace("; wv", "")
    // 端末既定のUAを覚えておき、PC版表示の切り替えで戻せるようにする
    setTag(R.id.vv_mobile_user_agent, settings.userAgentString)
}

/** PC版サイト表示の切り替え。UAに加え、広い表示幅で描いて縮小する(PC用レイアウトが収まるように)。 */
private fun WebView.applyDesktopMode(desktop: Boolean) {
    val mobileUa = getTag(R.id.vv_mobile_user_agent) as? String ?: settings.userAgentString
    settings.userAgentString = if (desktop) DESKTOP_USER_AGENT else mobileUa
    settings.useWideViewPort = desktop
    settings.loadWithOverviewMode = desktop
    settings.setSupportZoom(desktop)
    settings.builtInZoomControls = desktop
    settings.displayZoomControls = false
}

/** 遷移・エラーの共通クライアント。外部スキームは開かず帯で知らせる。 */
private fun browsingClient(
    onSchemeBlocked: (String) -> Unit,
    onUrl: (String) -> Unit,
    onTitle: (String?) -> Unit,
    onLoading: (Boolean) -> Unit,
    onError: (String?) -> Unit,
    onPageReady: (WebView) -> Unit = {},
): WebViewClient = object : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        val scheme = uri.scheme?.lowercase()
        Log.i(TAG, "navigate main=${request.isForMainFrame} redirect=${request.isRedirect} $uri")
        if (scheme == "http" || scheme == "https") {
            // アプリストアへの誘導(TikTok等が「アプリで開け」と飛ばす)はWebView内で止める。
            // 外へ出てもダウンロードには繋がらず、戻る手段も失う(2026-08-21 Pixel実機・tiktok.com)
            if (request.isForMainFrame && isAppStoreUrl(uri)) {
                Log.w(TAG, "blocked app store redirect: $uri")
                onSchemeBlocked(uri.host ?: "app store")
                return true
            }
            return false
        }
        if (!request.isForMainFrame) return true
        // intent:// の退避URLがアプリストアなら、それも止める(TikTokは退避先が Play ストア。
        // loadUrl で開くと shouldOverrideUrlLoading を通らず、ストア遮断をすり抜けていた)
        val fallback = intentFallbackUrl(uri.toString())?.takeUnless { isAppStoreUrl(Uri.parse(it)) }
        if (fallback != null) {
            Log.i(TAG, "intent scheme -> browser_fallback_url: $fallback")
            view.loadUrl(fallback)
        } else {
            Log.w(TAG, "blocked external scheme: $uri")
            onSchemeBlocked(
                if (scheme == "intent") {
                    runCatching { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).`package` }.getOrNull() ?: "intent"
                } else {
                    scheme ?: uri.toString()
                },
            )
        }
        return true
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        Log.i(TAG, "page started $url")
        onUrl(url); onTitle(null); onLoading(true); onError(null)
    }

    override fun onPageFinished(view: WebView, url: String) {
        Log.i(TAG, "page finished $url title=${view.title}")
        onUrl(url); onTitle(view.title?.takeIf { it.isNotBlank() }); onLoading(false)
        CookieManager.getInstance().flush()
        onPageReady(view)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        Log.w(TAG, "error main=${request.isForMainFrame} code=${error.errorCode} ${error.description} ${request.url}")
        if (request.isForMainFrame) onError("${error.description} (${request.url.host})")
    }

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
        if (request.isForMainFrame) Log.w(TAG, "http error ${errorResponse.statusCode} ${request.url}")
    }
}

/** メインWebViewのChromeClient。ポップアップ(別ウィンドウ)を子WebViewとして開く。 */
private fun mainChromeClient(
    context: Context,
    onTitle: (String?) -> Unit,
    onOpenPopup: (WebView) -> Unit,
    onCloseChild: () -> Unit,
): WebChromeClient = object : WebChromeClient() {
    override fun onReceivedTitle(view: WebView, title: String?) {
        onTitle(title?.takeIf { it.isNotBlank() })
    }

    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
        Log.d(TAG, "console ${message.messageLevel()} ${message.sourceId()}:${message.lineNumber()} ${message.message()}")
        return true
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
        Log.i(TAG, "onCreateWindow dialog=$isDialog gesture=$isUserGesture")
        val child = WebView(context).apply {
            configureForBrowsing()
            settings.setSupportMultipleWindows(true)
            settings.javaScriptCanOpenWindowsAutomatically = true
            webViewClient = browsingClient(
                onSchemeBlocked = { Log.w(TAG, "popup blocked scheme: $it") },
                onUrl = {}, onTitle = {}, onLoading = {}, onError = {},
            )
            webChromeClient = object : WebChromeClient() {
                override fun onCloseWindow(window: WebView) = onCloseChild()
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.d(TAG, "popup console ${message.sourceId()}:${message.lineNumber()} ${message.message()}")
                    return true
                }
            }
        }
        onOpenPopup(child)
        (resultMsg.obj as WebView.WebViewTransport).webView = child
        resultMsg.sendToTarget()
        return true
    }
}

/** Google Play / App Store のページか(サイトがアプリへ誘導する先)。 */
internal fun isAppStoreUrl(uri: Uri): Boolean {
    val host = uri.host?.lowercase() ?: return false
    return host == "play.google.com" || host == "market.android.com" || host == "apps.apple.com" || host == "itunes.apple.com"
}

/** PC版サイト用のUA。モバイル版がアプリへ誘導してくるサイト(TikTok等)の逃げ道。 */
internal const val DESKTOP_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

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
private fun NoticeBar(text: String, actionLabel: String?, onAction: () -> Unit, onDismiss: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.tertiaryContainer, contentColor = MaterialTheme.colorScheme.onTertiaryContainer) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text, style = MaterialTheme.typography.bodySmall, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (actionLabel != null) TextButton(onClick = onAction) { Text(actionLabel) }
            TextButton(onClick = onDismiss) { Text("閉じる") }
        }
    }
}

/** いま開いているページ。ホストを太く、タイトル(無ければURL全体)を添える。 */
@Composable
private fun UrlPill(url: String, title: String?, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = MaterialTheme.shapes.extraLarge, modifier = modifier) {
        Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            Column {
                Text(InputClassifier.hostOf(url) ?: url, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
