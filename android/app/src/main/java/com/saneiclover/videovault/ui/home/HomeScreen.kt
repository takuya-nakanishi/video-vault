@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)

package com.saneiclover.videovault.ui.home

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.saneiclover.videovault.R
import com.saneiclover.videovault.domain.Bookmark
import com.saneiclover.videovault.domain.DefaultBookmarks
import com.saneiclover.videovault.domain.DownloadJob
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.HistoryStatus
import com.saneiclover.videovault.domain.InputClassifier
import com.saneiclover.videovault.domain.Quality
import com.saneiclover.videovault.domain.Suggestion
import com.saneiclover.videovault.ui.components.BookmarkActionSheet
import com.saneiclover.videovault.ui.components.BookmarkDialog
import com.saneiclover.videovault.ui.components.EmptyState
import com.saneiclover.videovault.ui.components.HistoryActionSheet
import com.saneiclover.videovault.ui.components.HistoryRow
import com.saneiclover.videovault.ui.components.MessageBanner
import com.saneiclover.videovault.ui.components.QualitySheet
import com.saneiclover.videovault.ui.components.SectionHeader
import com.saneiclover.videovault.ui.components.SiteIcon
import com.saneiclover.videovault.ui.theme.VideoVaultTheme
import com.saneiclover.videovault.ui.theme.WordmarkStyle

/** ホームに見せる履歴の件数。それ以上は履歴画面で。 */
private const val RECENT_LIMIT = 5

/**
 * ホーム画面。**単一の入力欄がすべての入口**(ui-ux.md)。FABは置かない。
 *
 * 入力欄が空のときはブックマークと最近の履歴を見せ、何か入ると候補カードに置き換わる。
 * 状態を持たない。呼び出し側から [HomeUiState] を渡すだけで描けるので、
 * ネットワークもファイルも触れないCompose Previewでそのまま確認できる。
 */
@Composable
fun HomeScreen(
    state: HomeUiState,
    onInputChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onClearInput: () -> Unit,
    onClipboardChipClick: () -> Unit,
    onSuggestionClick: (Suggestion) -> Unit,
    onCancelDownload: () -> Unit,
    onDismissMessage: () -> Unit,
    onBookmarkClick: (Bookmark) -> Unit,
    onAddBookmark: (name: String, url: String) -> Boolean,
    onUpdateBookmark: (bookmark: Bookmark, name: String, url: String) -> Boolean,
    onRemoveBookmark: (Bookmark) -> Unit,
    onOpenHistory: () -> Unit,
    onOpenFiles: () -> Unit,
    onHistoryRetry: (HistoryEntry) -> Unit,
    onHistoryOpen: (HistoryEntry) -> Unit,
    onHistoryCopy: (HistoryEntry) -> Unit,
    onHistoryDelete: (HistoryEntry) -> Unit,
    onQualityChosen: (Quality, String?) -> Unit,
    onDismissPendingDownload: () -> Unit,
    modifier: Modifier = Modifier,
    now: Long = System.currentTimeMillis(),
) {
    var addingBookmark by remember { mutableStateOf(false) }
    /** 長押しで操作シートを出しているブックマーク */
    var bookmarkMenu by remember { mutableStateOf<Bookmark?>(null) }
    /** 「編集」で開いているブックマーク */
    var editingBookmark by remember { mutableStateOf<Bookmark?>(null) }
    var selectedEntry by remember { mutableStateOf<HistoryEntry?>(null) }
    val browsing = state.suggestions.isNotEmpty()

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "header") {
            Header(onOpenHistory = onOpenHistory, onOpenFiles = onOpenFiles)
        }

        item(key = "omnibox") {
            Omnibox(
                value = state.input,
                onValueChange = onInputChange,
                onSubmit = onSubmit,
                onClear = onClearInput,
            )
        }

        if (state.clipboardChipVisible) {
            item(key = "clipboard") {
                AssistChip(
                    onClick = onClipboardChipClick,
                    label = { Text("クリップボードの内容を使う") },
                    leadingIcon = {
                        Icon(painterResource(R.drawable.ic_clipboard), contentDescription = null, modifier = Modifier.size(18.dp))
                    },
                )
            }
        }

        state.message?.let { message ->
            item(key = "message") { MessageBanner(message = message, onDismiss = onDismissMessage) }
        }

        state.job?.let { job ->
            item(key = "job") { RunningJobCard(job = job, onCancel = onCancelDownload) }
        }

        if (browsing) {
            items(state.suggestions, key = { it.toString() }) { suggestion ->
                SuggestionCard(
                    suggestion = suggestion,
                    primary = suggestion == state.suggestions.first(),
                    onClick = { onSuggestionClick(suggestion) },
                )
            }
        } else {
            item(key = "bookmarks-header") {
                SectionHeader(
                    title = "ブックマーク",
                    modifier = Modifier.padding(top = 8.dp),
                    action = {
                        TextButton(onClick = { addingBookmark = true }) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("追加")
                        }
                    },
                )
            }
            val rows = state.bookmarks.chunked(2)
            items(rows, key = { row -> "bm-" + row.joinToString("|") { it.id } }) { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { bookmark ->
                        BookmarkTile(
                            bookmark = bookmark,
                            onClick = { onBookmarkClick(bookmark) },
                            onLongClick = { bookmarkMenu = bookmark },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            if (state.bookmarks.isEmpty()) {
                item(key = "bookmarks-empty") {
                    AddBookmarkTile(onClick = { addingBookmark = true })
                }
            }

            item(key = "recent-header") {
                SectionHeader(
                    title = "最近のダウンロード",
                    modifier = Modifier.padding(top = 12.dp),
                    action = {
                        if (state.history.isNotEmpty()) {
                            TextButton(onClick = onOpenHistory) { Text("すべて見る") }
                        }
                    },
                )
            }
            if (state.history.isEmpty()) {
                item(key = "recent-empty") {
                    EmptyState(
                        icon = R.drawable.ic_download,
                        title = "まだ何も取っていない",
                        body = "上の入力欄にURLを貼るか、YouTubeやXの共有メニューからこのアプリへ送る。",
                    )
                }
            } else {
                items(state.history.take(RECENT_LIMIT), key = { "h-" + it.id }) { entry ->
                    HistoryRow(entry = entry, now = now, onClick = { selectedEntry = entry })
                }
            }
        }
    }

    if (addingBookmark) {
        BookmarkDialog(
            onConfirm = { name, url -> if (onAddBookmark(name, url)) addingBookmark = false },
            onDismiss = { addingBookmark = false },
        )
    }
    bookmarkMenu?.let { bookmark ->
        BookmarkActionSheet(
            bookmark = bookmark,
            onEdit = { bookmarkMenu = null; editingBookmark = bookmark },
            onDelete = { bookmarkMenu = null; onRemoveBookmark(bookmark) },
            onDismiss = { bookmarkMenu = null },
        )
    }
    editingBookmark?.let { bookmark ->
        // 追加時と同じ画面に、登録内容を入れて開く(人間の依頼)
        key(bookmark.id) {
            BookmarkDialog(
                title = "ブックマークを編集",
                initialName = bookmark.name,
                initialUrl = bookmark.url,
                onConfirm = { name, url -> if (onUpdateBookmark(bookmark, name, url)) editingBookmark = null },
                onDismiss = { editingBookmark = null },
            )
        }
    }
    selectedEntry?.let { entry ->
        HistoryActionSheet(
            entry = entry,
            onRetry = { selectedEntry = null; onHistoryRetry(entry) },
            onOpen = { selectedEntry = null; onHistoryOpen(entry) },
            onCopy = { selectedEntry = null; onHistoryCopy(entry) },
            onDelete = { selectedEntry = null; onHistoryDelete(entry) },
            onDismiss = { selectedEntry = null },
        )
    }
    state.pendingDownload?.let { pending ->
        QualitySheet(
            pending = pending,
            current = state.defaultQuality,
            onChoose = onQualityChosen,
            onDismiss = onDismissPendingDownload,
        )
    }
}

/** ワードマークと、履歴・保存済みファイルへの入口。 */
@Composable
private fun Header(onOpenHistory: () -> Unit, onOpenFiles: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(
            text = buildAnnotatedString {
                append("ゲット")
                withStyle(SpanStyle(color = MaterialTheme.colorScheme.primary)) { append("VIDEO") }
            },
            style = WordmarkStyle,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onOpenHistory) {
            Icon(painterResource(R.drawable.ic_history), contentDescription = "履歴")
        }
        IconButton(onClick = onOpenFiles) {
            Icon(painterResource(R.drawable.ic_folder), contentDescription = "保存済みファイル")
        }
    }
}

/** 単一入力欄。画面で最も目立つピル型。 */
@Composable
private fun Omnibox(
    value: String,
    onValueChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onClear: () -> Unit,
) {
    TextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        placeholder = { Text("URLか検索したい言葉") },
        singleLine = true,
        shape = MaterialTheme.shapes.extraLarge,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent,
        ),
        leadingIcon = {
            Icon(painterResource(R.drawable.ic_search), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        },
        // 日本語IMEの未確定文字列を巻き込まないよう、変換確定の妨げになる設定は入れない
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
        keyboardActions = KeyboardActions(onGo = { onSubmit() }),
        trailingIcon = {
            if (value.isNotEmpty()) {
                IconButton(onClick = onClear) { Icon(Icons.Default.Close, contentDescription = "消去") }
            }
        },
    )
}

@Composable
private fun RunningJobCard(job: DownloadJob, onCancel: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
        shape = MaterialTheme.shapes.large,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SiteIcon(
                    host = InputClassifier.hostOf(job.url)?.removePrefix("www.") ?: job.url,
                    label = job.siteName,
                    size = 40.dp,
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text("ダウンロード中", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${job.siteName} · ${job.url}",
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (job.percent != null) {
                LinearProgressIndicator(progress = { job.percent }, modifier = Modifier.fillMaxWidth())
            } else {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            Text(
                job.line,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onCancel) { Text("中断") }
            }
        }
    }
}

/** 入力に応じた候補。第一候補は塗り、第二候補は淡い面。対象外は押せない。 */
@Composable
private fun SuggestionCard(suggestion: Suggestion, primary: Boolean, onClick: () -> Unit) {
    val c = MaterialTheme.colorScheme
    val (title, detail, icon) = when (suggestion) {
        is Suggestion.Download -> Triple(
            "ダウンロード",
            "${suggestion.siteName} · ${suggestion.url.removePrefix("https://").removePrefix("http://")}",
            R.drawable.ic_download,
        )
        is Suggestion.OpenInBrowser -> Triple(
            "ブラウザで開く",
            InputClassifier.hostOf(suggestion.url) ?: suggestion.url,
            R.drawable.ic_globe,
        )
        is Suggestion.WebSearch -> Triple("Googleで検索", suggestion.query, R.drawable.ic_search)
        is Suggestion.Unsupported -> Triple("対象外: ${suggestion.siteName}", suggestion.reason, R.drawable.ic_error_circle)
    }

    if (suggestion is Suggestion.Unsupported) {
        // 失敗させず、対象外である旨を先に見せる(ui-ux.md)。タップ先が無いのでボタンにしない
        Card(
            colors = CardDefaults.cardColors(containerColor = c.errorContainer, contentColor = c.onErrorContainer),
            shape = MaterialTheme.shapes.large,
            modifier = Modifier.fillMaxWidth(),
        ) {
            SuggestionBody(title, detail, icon, iconBackground = c.error, iconTint = c.onError)
        }
        return
    }

    Card(
        onClick = onClick,
        colors = if (primary) {
            CardDefaults.cardColors(containerColor = c.primary, contentColor = c.onPrimary)
        } else {
            CardDefaults.cardColors(containerColor = c.surfaceContainerHigh, contentColor = c.onSurface)
        },
        shape = MaterialTheme.shapes.large,
        modifier = Modifier.fillMaxWidth(),
    ) {
        SuggestionBody(
            title, detail, icon,
            iconBackground = if (primary) c.onPrimary.copy(alpha = 0.18f) else c.primaryContainer,
            iconTint = if (primary) c.onPrimary else c.onPrimaryContainer,
        )
    }
}

@Composable
private fun SuggestionBody(title: String, detail: String, icon: Int, iconBackground: Color, iconTint: Color) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            modifier = Modifier.size(44.dp).background(iconBackground, MaterialTheme.shapes.small),
            contentAlignment = Alignment.Center,
        ) {
            Icon(painterResource(icon), contentDescription = null, tint = iconTint)
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(detail, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** よく行くページへの1タップ。長押しで削除。 */
@Composable
private fun BookmarkTile(
    bookmark: Bookmark,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = MaterialTheme.shapes.large,
        modifier = modifier
            .clip(MaterialTheme.shapes.large)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
    ) {
        Row(
            modifier = Modifier.height(72.dp).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SiteIcon(host = bookmark.host, label = bookmark.name, size = 40.dp)
            Column(modifier = Modifier.weight(1f)) {
                Text(bookmark.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    bookmark.host,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun AddBookmarkTile(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        color = Color.Transparent,
        shape = MaterialTheme.shapes.large,
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.large),
    ) {
        Row(
            modifier = Modifier.height(72.dp).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(Icons.Default.Add, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text("よく行くページを追加", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}

// --- Preview(ネットワークもファイルも触らないダミー状態で描く) ---

private const val PREVIEW_NOW = 1_787_000_000_000L

private val sampleBookmarks = DefaultBookmarks.seed(PREVIEW_NOW - 86_400_000L)

private val sampleHistory = listOf(
    HistoryEntry("1", "https://www.youtube.com/watch?v=abc", "YouTube", "決算解説 2026年8月", PREVIEW_NOW - 180_000, PREVIEW_NOW - 60_000, HistoryStatus.SUCCESS, null),
    HistoryEntry("2", "https://newspicks.com/movie-series/123", "newspicks.com", "【対談】AIと経営", PREVIEW_NOW - 7_200_000, PREVIEW_NOW - 7_000_000, HistoryStatus.SUCCESS, null),
    HistoryEntry("3", "https://x.com/foo/status/1", "X", null, PREVIEW_NOW - 90_000_000, PREVIEW_NOW - 89_000_000, HistoryStatus.FAILED, "ERROR: Unsupported URL"),
)

private val noop = { }

@Composable
private fun PreviewHost(state: HomeUiState) = VideoVaultTheme {
    Surface {
        HomeScreen(
            state = state,
            onInputChange = {}, onSubmit = noop, onClearInput = noop, onClipboardChipClick = noop,
            onSuggestionClick = {}, onCancelDownload = noop, onDismissMessage = noop,
            onBookmarkClick = {}, onAddBookmark = { _, _ -> true }, onUpdateBookmark = { _, _, _ -> true }, onRemoveBookmark = {},
            onOpenHistory = noop, onOpenFiles = noop,
            onHistoryRetry = {}, onHistoryOpen = {}, onHistoryCopy = {}, onHistoryDelete = {},
            onQualityChosen = { _, _ -> }, onDismissPendingDownload = noop,
            now = PREVIEW_NOW,
        )
    }
}

@Preview(name = "ホーム(空入力)", showBackground = true)
@Composable
private fun PreviewHome() = PreviewHost(
    HomeUiState(clipboardChipVisible = true, bookmarks = sampleBookmarks, history = sampleHistory),
)

@Preview(name = "ホーム(ダーク)", showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun PreviewHomeDark() = PreviewHost(
    HomeUiState(bookmarks = sampleBookmarks, history = sampleHistory),
)

@Preview(name = "初回(何もない)", showBackground = true)
@Composable
private fun PreviewFirstRun() = PreviewHost(HomeUiState())

@Preview(name = "動画サイトのURL", showBackground = true)
@Composable
private fun PreviewVideoUrl() {
    val url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    PreviewHost(
        HomeUiState(
            input = url,
            suggestions = listOf(Suggestion.Download(url, "YouTube"), Suggestion.OpenInBrowser(url)),
            bookmarks = sampleBookmarks,
        ),
    )
}

@Preview(name = "キーワード", showBackground = true)
@Composable
private fun PreviewKeyword() = PreviewHost(
    HomeUiState(input = "かれの", suggestions = listOf(Suggestion.WebSearch("かれの"))),
)

@Preview(name = "対象外サイト", showBackground = true)
@Composable
private fun PreviewUnsupported() {
    val url = "https://www.netflix.com/title/80100172"
    PreviewHost(
        HomeUiState(
            input = url,
            suggestions = listOf(
                Suggestion.Unsupported(url, "Netflix", "DRM(Widevine)で保護されているため対象外"),
                Suggestion.OpenInBrowser(url),
            ),
        ),
    )
}

@Preview(name = "ダウンロード中", showBackground = true)
@Composable
private fun PreviewRunning() = PreviewHost(
    HomeUiState(
        job = DownloadJob(
            url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            siteName = "YouTube",
            percent = 0.42f,
            line = "[download]  42.0% of 120.5MiB at 3.20MiB/s",
        ),
        bookmarks = sampleBookmarks,
        history = sampleHistory,
    ),
)
