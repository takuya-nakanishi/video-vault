package com.saneiclover.videovault.data

import android.util.Log
import java.io.File

/**
 * アプリ内部ストレージに置く小さなJSONファイルの読み書き。
 * ブックマークと履歴はどちらも数百件までの配列なので、DBを足さずファイル1つで持つ
 * (依存を増やさない。判定表と同じ `org.json` 流儀)。
 *
 * 書き込みは一時ファイル経由で置き換え、途中で落ちても壊れたファイルを残さない。
 */
internal object JsonFile {

    private const val TAG = "JsonFile"

    fun read(file: File): String? = runCatching {
        if (!file.exists()) null else file.readText()
    }.getOrElse {
        Log.e(TAG, "${file.name} を読めなかった。空として扱う", it)
        null
    }

    fun write(file: File, json: String) {
        runCatching {
            file.parentFile?.mkdirs()
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(json)
            if (!tmp.renameTo(file)) {
                // renameが効かないファイルシステム向けの退避
                file.writeText(json)
                tmp.delete()
            }
        }.onFailure { Log.e(TAG, "${file.name} を書けなかった", it) }
    }
}
