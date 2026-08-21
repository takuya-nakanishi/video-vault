@file:OptIn(ExperimentalMaterial3Api::class)

package com.saneiclover.videovault.ui.components

import android.graphics.Bitmap
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.RadioButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saneiclover.videovault.R
import com.saneiclover.videovault.data.FaviconStore
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.HistoryStatus
import com.saneiclover.videovault.domain.InputClassifier
import com.saneiclover.videovault.domain.Quality
import com.saneiclover.videovault.domain.RelativeTime
import com.saneiclover.videovault.ui.home.PendingDownload
import kotlin.math.abs

/** ファビコンの取得元。MainActivityが提供する。Preview等で未提供ならモノグラムに退避する */
val LocalFaviconStore = staticCompositionLocalOf<FaviconStore?> { null }

/**
 * サイトのアイコン。ファビコンが取れればそれ、取れなければ頭文字のモノグラム
 * (2026-08-21・人間の依頼で「YouTubeやXのアイコンが出ていない」→ ファビコン表示に)。
 */
@Composable
fun SiteIcon(host: String, label: String, modifier: Modifier = Modifier, size: Dp = 44.dp) {
    val store = LocalFaviconStore.current
    val bitmap by produceState<Bitmap?>(initialValue = store?.cached(host), host, store) {
        if (value == null && store != null && host.isNotBlank()) value = store.load(host)
    }
    val bmp = bitmap
    if (bmp == null) {
        SiteMonogram(label, modifier, size)
        return
    }
    Box(
        modifier = modifier
            .size(size)
            .clip(MaterialTheme.shapes.small)
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            bitmap = bmp.asImageBitmap(),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.size(size * 0.7f),
        )
    }
}

/**
 * 画面をまたいで使う部品。サイトを示すモノグラム、履歴の行、操作シート、ダイアログ。
 * ここも状態を持たず、Previewにダミーを流せる形を守る。
 */

/**
 * サイトの頭文字を角丸四角に載せたモノグラム。ファビコンを取りに行かない
 * (ネットワークに依存させず、オフラインでも一覧が崩れないようにする)。
 * 色は名前から決めるので、同じサイトはいつも同じ色になる。
 */
@Composable
fun SiteMonogram(label: String, modifier: Modifier = Modifier, size: Dp = 44.dp) {
    val palette = monogramPalette()
    val (container, content) = palette[abs(label.hashCode()) % palette.size]
    val initial = label.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    Box(
        modifier = modifier
            .size(size)
            .background(container, MaterialTheme.shapes.small),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initial,
            color = content,
            fontSize = (size.value * 0.45f).sp,
            fontWeight = FontWeight.Bold,
            lineHeight = (size.value * 0.5f).sp,
        )
    }
}

@Composable
private fun monogramPalette(): List<Pair<Color, Color>> {
    val c = MaterialTheme.colorScheme
    return listOf(
        c.primaryContainer to c.onPrimaryContainer,
        c.tertiaryContainer to c.onTertiaryContainer,
        c.secondaryContainer to c.onSecondaryContainer,
        c.primary to c.onPrimary,
        c.tertiary to c.onTertiary,
        c.inverseSurface to c.inverseOnSurface,
    )
}

/** セクション見出し。右側に「すべて見る」「追加」のような小さな操作を置ける。 */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Row(
        modifier = modifier.fillMaxWidth().height(40.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        action?.invoke()
    }
}

@Composable
fun StatusIcon(status: HistoryStatus, modifier: Modifier = Modifier) {
    val c = MaterialTheme.colorScheme
    val (res, tint, desc) = when (status) {
        HistoryStatus.SUCCESS -> Triple(R.drawable.ic_check_circle, c.primary, "成功")
        HistoryStatus.FAILED -> Triple(R.drawable.ic_error_circle, c.error, "失敗")
        HistoryStatus.CANCELLED -> Triple(R.drawable.ic_pause_circle, c.outline, "中断")
        HistoryStatus.RUNNING -> Triple(R.drawable.ic_download, c.primary, "実行中")
    }
    Icon(painterResource(res), contentDescription = desc, tint = tint, modifier = modifier.size(22.dp))
}

fun statusLabel(status: HistoryStatus): String = when (status) {
    HistoryStatus.SUCCESS -> "成功"
    HistoryStatus.FAILED -> "失敗"
    HistoryStatus.CANCELLED -> "中断"
    HistoryStatus.RUNNING -> "実行中"
}

/** 履歴1件の行。主見出しはタイトル、副見出しは「サイト · いつ」。失敗はその旨を色で示す。 */
@Composable
fun HistoryRow(
    entry: HistoryEntry,
    now: Long,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val subtitle = buildString {
        append(entry.siteName)
        entry.quality?.let { q -> Quality.entries.firstOrNull { it.name == q } }
            ?.takeIf { it != Quality.ORIGINAL }
            ?.let { append(" · ").append(it.label) }
        append(" · ")
        append(RelativeTime.short(entry.startedAt, now))
        if (entry.status != HistoryStatus.SUCCESS) {
            append(" · ")
            append(statusLabel(entry.status))
        }
    }
    ListItem(
        modifier = modifier.clickable(onClick = onClick),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        leadingContent = { SiteIcon(host = entry.host, label = entry.siteName) },
        headlineContent = {
            Text(entry.headline, maxLines = 2, overflow = TextOverflow.Ellipsis)
        },
        supportingContent = {
            Text(
                subtitle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = if (entry.status == HistoryStatus.FAILED) MaterialTheme.colorScheme.error
                else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        trailingContent = { StatusIcon(entry.status) },
    )
}

/** 履歴をタップしたときの操作。下から出るシートに、やりたいことを動詞で並べる。 */
@Composable
fun HistoryActionSheet(
    entry: HistoryEntry,
    onRetry: () -> Unit,
    onOpen: () -> Unit,
    onCopy: () -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(modifier = Modifier.padding(bottom = 24.dp)) {
            Row(
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                SiteIcon(host = entry.host, label = entry.siteName, size = 48.dp)
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        entry.headline,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        entry.url,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            entry.error?.let { error ->
                Text(
                    error,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                )
            }
            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            SheetAction(R.drawable.ic_replay, "もう一度ダウンロード", onRetry)
            SheetAction(R.drawable.ic_open_in_browser, "ブラウザで開く", onOpen)
            SheetAction(R.drawable.ic_copy, "URLをコピー", onCopy)
            SheetAction(R.drawable.ic_error_circle, "この履歴を削除", onDelete, destructive = true)
        }
    }
}

@Composable
private fun SheetAction(
    @DrawableRes icon: Int,
    label: String,
    onClick: () -> Unit,
    destructive: Boolean = false,
) {
    val tint = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        leadingContent = { Icon(painterResource(icon), contentDescription = null, tint = tint) },
        headlineContent = { Text(label, color = tint) },
    )
}

/**
 * 画質を選んでからダウンロードするシート(2026-08-21・人間の依頼)。
 * 3択を縦に並べ、行のタップで即開始。前回の選択に印を付けて1タップで済むようにする。
 */
@Composable
fun QualitySheet(
    pending: PendingDownload,
    current: Quality,
    onChoose: (Quality) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(modifier = Modifier.padding(bottom = 24.dp)) {
            Row(
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                SiteIcon(
                    host = InputClassifier.hostOf(pending.url)?.removePrefix("www.") ?: pending.url,
                    label = pending.siteName,
                    size = 48.dp,
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text("画質を選んでダウンロード", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${pending.siteName} · ${pending.url.removePrefix("https://").removePrefix("http://")}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            Quality.entries.forEach { q ->
                ListItem(
                    modifier = Modifier.clickable { onChoose(q) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    leadingContent = { RadioButton(selected = q == current, onClick = { onChoose(q) }) },
                    headlineContent = { Text(q.label) },
                    supportingContent = { Text(q.detail) },
                )
            }
            Text(
                "フレームレートと音声はサイトの元のまま。上限に合う画質が無いサイトでは最高画質になる",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
            )
        }
    }
}

/** ブックマークを手で追加するダイアログ。 */
@Composable
fun BookmarkDialog(
    onConfirm: (name: String, url: String) -> Unit,
    onDismiss: () -> Unit,
    initialName: String = "",
    initialUrl: String = "",
) {
    var name by rememberSaveable { mutableStateOf(initialName) }
    var url by rememberSaveable { mutableStateOf(initialUrl) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("ブックマークを追加") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("名前") },
                    placeholder = { Text("空なら サイト名を使う") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("URL") },
                    placeholder = { Text("example.com") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            // ホームの「追加」と同じ文言にしない(自動試験がテキストでボタンを特定するため)
            FilledTonalButton(onClick = { onConfirm(name, url) }, enabled = url.isNotBlank()) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("やめる") } },
    )
}

/** 取り消せない操作の前の確認。 */
@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirmLabel, color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("やめる") } },
    )
}

/** 一覧が空のときの案内。責めずに、次に何をすればよいかだけ言う。 */
@Composable
fun EmptyState(@DrawableRes icon: Int, title: String, body: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(56.dp)
                .background(MaterialTheme.colorScheme.surfaceContainerHigh, MaterialTheme.shapes.medium),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painterResource(icon),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(28.dp),
            )
        }
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(
            body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

/** 完了・失敗などの結果を告げる帯。閉じるまで残る(煙試験はこのテキストを読む)。 */
@Composable
fun MessageBanner(message: String, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val isError = message.startsWith("失敗")
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer,
        contentColor = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSecondaryContainer,
        shape = MaterialTheme.shapes.medium,
    ) {
        Row(
            modifier = Modifier.padding(start = 16.dp, top = 4.dp, end = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                message,
                modifier = Modifier.weight(1f).padding(vertical = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 6,
                overflow = TextOverflow.Ellipsis,
            )
            IconButton(onClick = onDismiss) {
                Icon(Icons.Default.Close, contentDescription = "閉じる")
            }
        }
    }
}

fun formatSize(bytes: Long): String = when {
    bytes >= 1_000_000_000 -> "%.1f GB".format(bytes / 1_000_000_000.0)
    bytes >= 1_000_000 -> "%.1f MB".format(bytes / 1_000_000.0)
    bytes >= 1_000 -> "%.0f KB".format(bytes / 1_000.0)
    else -> "$bytes B"
}
