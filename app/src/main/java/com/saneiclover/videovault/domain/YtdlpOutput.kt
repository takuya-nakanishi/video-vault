package com.saneiclover.videovault.domain

/**
 * yt-dlpの進捗行から、履歴に残す動画タイトルを拾う。
 *
 * yt-dlpは保存先を次の形で出力する(どれが出るかは形式の選ばれ方で変わる):
 * - `[download] Destination: /path/Title.f137.mp4`(分割ダウンロードの各ファイル)
 * - `[Merger] Merging formats into "/path/Title.mp4"`(結合後。これが最終形)
 * - `[download] /path/Title.mp4 has already been downloaded`
 *
 * ファイル名=`%(title)s.%(ext)s` で保存しているので、ディレクトリと拡張子、
 * 分割形式の `.f137` のような接尾辞を落とせばタイトルになる。
 */
object YtdlpOutput {

    private val DESTINATION = Regex("""^\[download] Destination: (.+)$""")
    private val MERGER = Regex("""^\[Merger] Merging formats into "(.+)"$""")
    private val ALREADY = Regex("""^\[download] (.+) has already been downloaded$""")
    private val FORMAT_SUFFIX = Regex("""\.f\d+$""")

    fun titleFrom(line: String): String? {
        val text = line.trim()
        val path = MERGER.find(text)?.groupValues?.get(1)
            ?: DESTINATION.find(text)?.groupValues?.get(1)
            ?: ALREADY.find(text)?.groupValues?.get(1)
            ?: return null
        return titleFromPath(path)
    }

    fun titleFromPath(path: String): String? {
        val fileName = path.substringAfterLast('/')
        val withoutExt = fileName.substringBeforeLast('.', missingDelimiterValue = fileName)
        val title = withoutExt.replace(FORMAT_SUFFIX, "").trim()
        return title.takeIf { it.isNotEmpty() }
    }
}
