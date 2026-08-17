@file:OptIn(ExperimentalMaterial3Api::class)

package com.saneiclover.videovault.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.saneiclover.videovault.domain.DownloadedFile
import com.saneiclover.videovault.domain.InputClassifier
import com.saneiclover.videovault.domain.Suggestion
import com.saneiclover.videovault.ui.theme.VideoVaultTheme

/**
 * ホーム画面。**単一の入力欄がすべての入口**(ui-ux.md)。FABは置かない。
 *
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
    onDeleteDownload: (DownloadedFile) -> Unit,
    onDismissMessage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("video-vault", style = MaterialTheme.typography.headlineMedium)

        OutlinedTextField(
            value = state.input,
            onValueChange = onInputChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("URLか検索したい言葉") },
            singleLine = true,
            // 日本語IMEの未確定文字列を巻き込まないよう、変換確定の妨げになる設定は入れない
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { onSubmit() }),
            trailingIcon = {
                if (state.input.isNotEmpty()) {
                    TextButton(onClick = onClearInput) { Text("消去") }
                }
            },
        )

        if (state.clipboardChipVisible) {
            AssistChip(
                onClick = onClipboardChipClick,
                label = { Text("クリップボードの内容を使う") },
            )
        }

        state.message?.let { message ->
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.secondaryContainer,
                shape = MaterialTheme.shapes.medium,
            ) {
                Row(
                    modifier = Modifier.padding(start = 16.dp, top = 4.dp, end = 4.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(message, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    TextButton(onClick = onDismissMessage) { Text("閉じる") }
                }
            }
        }

        state.job?.let { job -> RunningJob(job = job, onCancel = onCancelDownload) }

        state.suggestions.forEachIndexed { index, suggestion ->
            SuggestionRow(
                suggestion = suggestion,
                primary = index == 0,
                onClick = { onSuggestionClick(suggestion) },
            )
        }

        DownloadList(
            downloads = state.downloads,
            onDelete = onDeleteDownload,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun RunningJob(job: DownloadJob, onCancel: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.medium,
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("ダウンロード中", style = MaterialTheme.typography.titleSmall)
            Text(job.url, style = MaterialTheme.typography.bodySmall, maxLines = 1)
            if (job.percent != null) {
                LinearProgressIndicator(progress = { job.percent }, modifier = Modifier.fillMaxWidth())
            } else {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            Text(job.line, style = MaterialTheme.typography.bodySmall, maxLines = 2)
            TextButton(onClick = onCancel) { Text("中断") }
        }
    }
}

@Composable
private fun SuggestionRow(suggestion: Suggestion, primary: Boolean, onClick: () -> Unit) {
    val (title, detail) = when (suggestion) {
        is Suggestion.Download -> "ダウンロード" to "${suggestion.siteName} — ${suggestion.url}"
        is Suggestion.OpenInBrowser ->
            "ブラウザで開く" to (InputClassifier.hostOf(suggestion.url) ?: suggestion.url)
        is Suggestion.WebSearch -> "Googleで検索" to suggestion.query
        is Suggestion.Unsupported -> "対象外: ${suggestion.siteName}" to suggestion.reason
    }

    if (suggestion is Suggestion.Unsupported) {
        // 失敗させず、対象外である旨を先に見せる(ui-ux.md)。タップ先が無いのでボタンにしない
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.errorContainer,
            shape = MaterialTheme.shapes.medium,
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(detail, style = MaterialTheme.typography.bodySmall)
            }
        }
        return
    }

    val content: @Composable () -> Unit = {
        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(detail, style = MaterialTheme.typography.bodySmall, maxLines = 1)
        }
    }
    if (primary) {
        Button(onClick = onClick, modifier = Modifier.fillMaxWidth()) { content() }
    } else {
        OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) { content() }
    }
}

@Composable
private fun DownloadList(
    downloads: List<DownloadedFile>,
    onDelete: (DownloadedFile) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            "ダウンロード済み(${downloads.size})",
            style = MaterialTheme.typography.titleSmall,
        )
        if (downloads.isEmpty()) {
            Text(
                "まだ何もない。上の入力欄にURLを貼るか、YouTubeやXの共有メニューからこのアプリへ送る。",
                style = MaterialTheme.typography.bodySmall,
            )
            return@Column
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(downloads, key = { it.path }) { file ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(file.name, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                        Text(formatSize(file.sizeBytes), style = MaterialTheme.typography.bodySmall)
                    }
                    TextButton(onClick = { onDelete(file) }) { Text("削除") }
                }
            }
        }
    }
}

private fun formatSize(bytes: Long): String = when {
    bytes >= 1_000_000_000 -> "%.1f GB".format(bytes / 1_000_000_000.0)
    bytes >= 1_000_000 -> "%.1f MB".format(bytes / 1_000_000.0)
    bytes >= 1_000 -> "%.0f KB".format(bytes / 1_000.0)
    else -> "$bytes B"
}

// --- Preview(ネットワークもファイルも触らないダミー状態で描く) ---

private val sampleDownloads = listOf(
    DownloadedFile("決算解説 2026年8月.mp4", "/dummy/1.mp4", 412_000_000, 0),
    DownloadedFile("市況まとめ.webm", "/dummy/2.webm", 38_400_000, 0),
)

@Preview(name = "空(クリップボードあり)", showBackground = true)
@Composable
private fun PreviewEmpty() = VideoVaultTheme {
    HomeScreen(
        state = HomeUiState(clipboardChipVisible = true, downloads = sampleDownloads),
        onInputChange = {}, onSubmit = {}, onClearInput = {}, onClipboardChipClick = {},
        onSuggestionClick = {}, onCancelDownload = {}, onDeleteDownload = {}, onDismissMessage = {},
    )
}

@Preview(name = "動画サイトのURL", showBackground = true)
@Composable
private fun PreviewVideoUrl() = VideoVaultTheme {
    val url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    HomeScreen(
        state = HomeUiState(
            input = url,
            suggestions = listOf(Suggestion.Download(url, "YouTube"), Suggestion.OpenInBrowser(url)),
            downloads = sampleDownloads,
        ),
        onInputChange = {}, onSubmit = {}, onClearInput = {}, onClipboardChipClick = {},
        onSuggestionClick = {}, onCancelDownload = {}, onDeleteDownload = {}, onDismissMessage = {},
    )
}

@Preview(name = "キーワード", showBackground = true)
@Composable
private fun PreviewKeyword() = VideoVaultTheme {
    HomeScreen(
        state = HomeUiState(
            input = "かれの",
            suggestions = listOf(Suggestion.WebSearch("かれの")),
        ),
        onInputChange = {}, onSubmit = {}, onClearInput = {}, onClipboardChipClick = {},
        onSuggestionClick = {}, onCancelDownload = {}, onDeleteDownload = {}, onDismissMessage = {},
    )
}

@Preview(name = "対象外サイト", showBackground = true)
@Composable
private fun PreviewUnsupported() = VideoVaultTheme {
    val url = "https://www.netflix.com/title/80100172"
    HomeScreen(
        state = HomeUiState(
            input = url,
            suggestions = listOf(
                Suggestion.Unsupported(url, "Netflix", "DRM(Widevine)で保護されているため対象外"),
                Suggestion.OpenInBrowser(url),
            ),
        ),
        onInputChange = {}, onSubmit = {}, onClearInput = {}, onClipboardChipClick = {},
        onSuggestionClick = {}, onCancelDownload = {}, onDeleteDownload = {}, onDismissMessage = {},
    )
}

@Preview(name = "ダウンロード中", showBackground = true)
@Composable
private fun PreviewRunning() = VideoVaultTheme {
    HomeScreen(
        state = HomeUiState(
            job = DownloadJob(
                url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                percent = 0.42f,
                line = "[download]  42.0% of 120.5MiB at 3.20MiB/s",
            ),
            downloads = sampleDownloads,
        ),
        onInputChange = {}, onSubmit = {}, onClearInput = {}, onClipboardChipClick = {},
        onSuggestionClick = {}, onCancelDownload = {}, onDeleteDownload = {}, onDismissMessage = {},
    )
}
