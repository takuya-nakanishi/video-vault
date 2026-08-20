@file:OptIn(ExperimentalMaterial3Api::class)

package com.saneiclover.videovault.ui.history

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.saneiclover.videovault.R
import com.saneiclover.videovault.domain.HistoryEntry
import com.saneiclover.videovault.domain.RelativeTime
import com.saneiclover.videovault.ui.components.ConfirmDialog
import com.saneiclover.videovault.ui.components.EmptyState
import com.saneiclover.videovault.ui.components.HistoryActionSheet
import com.saneiclover.videovault.ui.components.HistoryRow

/**
 * ダウンロード履歴の全件。日ごとに見出しを挟む。
 * 行をタップすると「もう一度 / ブラウザで開く / URLをコピー / 削除」のシートが出る。
 */
@Composable
fun HistoryScreen(
    history: List<HistoryEntry>,
    onBack: () -> Unit,
    onRetry: (HistoryEntry) -> Unit,
    onOpen: (HistoryEntry) -> Unit,
    onCopy: (HistoryEntry) -> Unit,
    onDelete: (HistoryEntry) -> Unit,
    onClearAll: () -> Unit,
    modifier: Modifier = Modifier,
    now: Long = System.currentTimeMillis(),
) {
    var selected by remember { mutableStateOf<HistoryEntry?>(null) }
    var confirmClear by remember { mutableStateOf(false) }

    BackHandler(onBack = onBack)

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("履歴") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "ホームへ戻る")
                    }
                },
                actions = {
                    if (history.isNotEmpty()) {
                        IconButton(onClick = { confirmClear = true }) {
                            Icon(Icons.Default.Delete, contentDescription = "履歴をすべて消去")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
    ) { padding ->
        if (history.isEmpty()) {
            EmptyState(
                icon = R.drawable.ic_history,
                title = "履歴はまだない",
                body = "ダウンロードすると、どのサイトから何を取ったかがここに残る。",
                modifier = Modifier.padding(padding),
            )
            return@Scaffold
        }

        val groups = history.groupBy { RelativeTime.dayKey(it.startedAt) }
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 32.dp),
        ) {
            groups.forEach { (day, entries) ->
                item(key = "day-$day") {
                    Text(
                        RelativeTime.dayHeading(entries.first().startedAt, now),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 4.dp),
                    )
                }
                items(entries, key = { it.id }) { entry ->
                    HistoryRow(entry = entry, now = now, onClick = { selected = entry })
                }
            }
        }
    }

    selected?.let { entry ->
        HistoryActionSheet(
            entry = entry,
            onRetry = { selected = null; onRetry(entry) },
            onOpen = { selected = null; onOpen(entry) },
            onCopy = { selected = null; onCopy(entry) },
            onDelete = { selected = null; onDelete(entry) },
            onDismiss = { selected = null },
        )
    }
    if (confirmClear) {
        ConfirmDialog(
            title = "履歴をすべて消去",
            text = "${history.size}件の履歴を消す。保存済みのファイルは消えない。",
            confirmLabel = "消去",
            onConfirm = { confirmClear = false; onClearAll() },
            onDismiss = { confirmClear = false },
        )
    }
}
