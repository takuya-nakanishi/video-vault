package com.saneiclover.videovault.data

import android.util.AtomicFile
import android.util.Log
import java.io.File
import java.io.FileOutputStream

/**
 * アプリ内部ストレージに置く小さなJSONファイルの読み書き。
 * ブックマークと履歴はどちらも数百件までの配列なので、DBを足さずファイル1つで持つ
 * (依存を増やさない。判定表と同じ `org.json` 流儀)。
 *
 * 書き込みは [AtomicFile](一時ファイル→rename)で、途中で落ちても壊れたファイルを残さない。
 * **呼び出し側が書き込みを直列化すること**(VideoVaultViewModelは単一スレッドのdispatcherで呼ぶ)。
 * 並列に呼ぶと同じ一時ファイルを取り合って古い状態が勝ち得る(2026-08-21 Codexレビュー指摘)。
 */
internal object JsonFile {

    private const val TAG = "JsonFile"

    fun read(file: File): String? = runCatching {
        if (!file.exists()) null else AtomicFile(file).readFully().toString(Charsets.UTF_8)
    }.getOrElse {
        Log.e(TAG, "${file.name} を読めなかった。空として扱う", it)
        null
    }

    fun write(file: File, json: String) {
        file.parentFile?.mkdirs()
        val atomic = AtomicFile(file)
        var out: FileOutputStream? = null
        try {
            out = atomic.startWrite()
            out.write(json.toByteArray(Charsets.UTF_8))
            atomic.finishWrite(out)
        } catch (e: Exception) {
            Log.e(TAG, "${file.name} を書けなかった", e)
            out?.let(atomic::failWrite)
        }
    }
}
