package com.saneiclover.videovault.domain

/** ダウンロード1回の結末。 */
enum class HistoryStatus {
    /** 実行中。アプリが途中で終了した場合は次回起動時に [CANCELLED] へ倒す */
    RUNNING,
    SUCCESS,
    FAILED,
    CANCELLED,
}

/**
 * ダウンロード履歴の1件。**どのサイトから何を取ったか**を後から見返すための記録で、
 * 保存先のファイルパスは持たない(requirements.md: 保管場所の記録は不要)。
 * 同じURLを再ダウンロードする導線にもなる。
 */
data class HistoryEntry(
    val id: String,
    val url: String,
    /** 判定表にあるサイト名。無ければホスト名 */
    val siteName: String,
    /** yt-dlpの出力から拾った動画タイトル。失敗時などは null */
    val title: String?,
    val startedAt: Long,
    val finishedAt: Long?,
    val status: HistoryStatus,
    /** 失敗時のエラー文(1行目相当) */
    val error: String?,
) {
    /** 一覧の主見出し。タイトルが取れていなければURLのホスト以降を見せる */
    val headline: String
        get() = title?.takeIf { it.isNotBlank() } ?: url.removePrefix("https://").removePrefix("http://")

    val host: String
        get() = InputClassifier.hostOf(url)?.removePrefix("www.") ?: url
}

/**
 * 履歴の台帳。不変で、変更のたびに新しいインスタンスを返す(Composeのスナップショット状態と相性がよい)。
 * 新しい順に並ぶ。
 */
class HistoryLog(entries: List<HistoryEntry> = emptyList()) {

    val entries: List<HistoryEntry> = entries.sortedByDescending { it.startedAt }.take(MAX_ENTRIES)

    fun upsert(entry: HistoryEntry): HistoryLog =
        HistoryLog(entries.filterNot { it.id == entry.id } + entry)

    fun remove(id: String): HistoryLog = HistoryLog(entries.filterNot { it.id == id })

    fun clear(): HistoryLog = HistoryLog()

    /**
     * 起動時の整合。前回のプロセスが途中で死んだ [HistoryStatus.RUNNING] は二度と完了しないので
     * [HistoryStatus.CANCELLED] に倒す(「実行中」が履歴に残り続けるのを防ぐ)。
     */
    fun settleStale(now: Long): HistoryLog = HistoryLog(
        entries.map {
            if (it.status == HistoryStatus.RUNNING) {
                it.copy(status = HistoryStatus.CANCELLED, finishedAt = now, error = "アプリの終了により中断")
            } else {
                it
            }
        },
    )

    companion object {
        /** 履歴は無限に増える。自分用なので上限は大きめに、ただし無制限にはしない */
        const val MAX_ENTRIES = 500
    }
}
