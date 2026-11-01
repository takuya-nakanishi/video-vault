@file:OptIn(ExperimentalMaterial3Api::class)

package com.saneiclover.videovault.ui.files

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saneiclover.videovault.R
import com.saneiclover.videovault.domain.DownloadedFile
import com.saneiclover.videovault.domain.RelativeTime
import com.saneiclover.videovault.ui.components.ConfirmDialog
import com.saneiclover.videovault.ui.components.EmptyState
import com.saneiclover.videovault.ui.components.formatSize

/**
 * 端末に保存済みのファイル。容量の整理(削除)が目的の画面。
 * 再生・共有は次版(AGENTS.md「既知の制約」)。
 */
@Composable
fun FilesScreen(
    downloads: List<DownloadedFile>,
    onBack: () -> Unit,
    onDelete: (DownloadedFile) -> Unit,
    modifier: Modifier = Modifier,
    now: Long = System.currentTimeMillis(),
) {
    var toDelete by remember { mutableStateOf<DownloadedFile?>(null) }
    BackHandler(onBack = onBack)

    val total = downloads.sumOf { it.sizeBytes }
    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = {
                    Text(if (downloads.isEmpty()) "保存済みファイル" else "保存済みファイル · ${formatSize(total)}")
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "ホームへ戻る")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
    ) { padding ->
        if (downloads.isEmpty()) {
            EmptyState(
                icon = R.drawable.ic_folder,
                title = "保存済みのファイルはない",
                body = "ダウンロードした動画はここに並ぶ。端末の容量を空けたいときに消す。",
                modifier = Modifier.padding(padding),
            )
            return@Scaffold
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 32.dp),
        ) {
            items(downloads, key = { it.path }) { file ->
                ListItem(
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    leadingContent = {
                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .background(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.shapes.small),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                painterResource(R.drawable.ic_play),
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                        }
                    },
                    headlineContent = { Text(file.name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    supportingContent = {
                        Text("${formatSize(file.sizeBytes)} · ${RelativeTime.short(file.lastModified, now)}")
                    },
                    trailingContent = {
                        IconButton(onClick = { toDelete = file }) {
                            Icon(Icons.Default.Delete, contentDescription = "削除")
                        }
                    },
                )
            }
        }
    }

    toDelete?.let { file ->
        ConfirmDialog(
            title = "ファイルを削除",
            text = "「${file.name}」(${formatSize(file.sizeBytes)})を端末から消す。元に戻せない。",
            confirmLabel = "削除",
            onConfirm = { toDelete = null; onDelete(file) },
            onDismiss = { toDelete = null },
        )
    }
}
