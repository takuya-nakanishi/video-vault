package com.saneiclover.videovault

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sharedUrl = if (intent?.action == Intent.ACTION_SEND) {
            intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
        } else {
            ""
        }
        setContent {
            MaterialTheme {
                DownloadScreen(initialUrl = sharedUrl)
            }
        }
    }
}

@Composable
fun DownloadScreen(initialUrl: String) {
    var url by remember { mutableStateOf(initialUrl) }
    var status by remember { mutableStateOf("待機中") }
    var progress by remember { mutableStateOf<Float?>(null) }
    var running by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("video-vault", style = MaterialTheme.typography.headlineMedium)
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("動画URL") },
            modifier = Modifier.fillMaxWidth()
        )
        Button(
            onClick = {
                running = true
                scope.launch {
                    status = "準備中(初回はpython環境の展開に数十秒かかる)…"
                    runCatching {
                        withContext(Dispatchers.IO) {
                            YoutubeDL.getInstance().init(context.applicationContext)
                            // MVPはアプリ専用外部ストレージへ保存。公共Downloadsへの移動はMediaStore対応後
                            val outDir = File(context.getExternalFilesDir(null), "downloads")
                                .apply { mkdirs() }
                            val request = YoutubeDLRequest(url.trim()).apply {
                                addOption("-o", "${outDir.absolutePath}/%(title)s.%(ext)s")
                                addOption("--no-mtime")
                            }
                            YoutubeDL.getInstance().execute(request) { pct, _, line ->
                                progress = if (pct >= 0) pct / 100f else null
                                status = line
                            }
                        }
                    }.onSuccess {
                        status = "完了: Android/data/com.saneiclover.videovault.debug/files/downloads/"
                    }.onFailure {
                        status = "失敗: ${it.message}"
                    }
                    progress = null
                    running = false
                }
            },
            enabled = url.isNotBlank() && !running,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(if (running) "実行中…" else "ダウンロード")
        }
        progress?.let {
            LinearProgressIndicator(progress = { it }, modifier = Modifier.fillMaxWidth())
        }
        Text(status, style = MaterialTheme.typography.bodyMedium)
    }
}
