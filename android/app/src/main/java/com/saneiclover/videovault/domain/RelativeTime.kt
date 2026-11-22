package com.saneiclover.videovault.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 履歴に添える時刻の表現。「いつ取ったか」が一目で分かる粒度にし、細かい秒は出さない。
 * Android非依存(java.time)なので単体テストで固定できる。
 */
object RelativeTime {

    private val SAME_YEAR = DateTimeFormatter.ofPattern("M月d日")
    private val OTHER_YEAR = DateTimeFormatter.ofPattern("yyyy年M月d日")
    private val CLOCK = DateTimeFormatter.ofPattern("H:mm")

    /** 一覧の行に添える短い表現。 */
    fun short(epochMs: Long, now: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        val diff = now - epochMs
        if (diff < 60_000L) return "たった今"
        if (diff < 3_600_000L) return "${diff / 60_000L}分前"
        if (diff < 6 * 3_600_000L) return "${diff / 3_600_000L}時間前"
        val date = toDate(epochMs, zone)
        val today = toDate(now, zone)
        return when {
            date == today -> "今日 " + CLOCK.format(Instant.ofEpochMilli(epochMs).atZone(zone))
            date == today.minusDays(1) -> "昨日"
            date.year == today.year -> SAME_YEAR.format(date)
            else -> OTHER_YEAR.format(date)
        }
    }

    /** 履歴画面の日付見出し。 */
    fun dayHeading(epochMs: Long, now: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        val date = toDate(epochMs, zone)
        val today = toDate(now, zone)
        return when {
            date == today -> "今日"
            date == today.minusDays(1) -> "昨日"
            date.year == today.year -> SAME_YEAR.format(date)
            else -> OTHER_YEAR.format(date)
        }
    }

    /** 同じ日かどうかの判定キー(日付見出しのグループ化に使う)。 */
    fun dayKey(epochMs: Long, zone: ZoneId = ZoneId.systemDefault()): LocalDate = toDate(epochMs, zone)

    private fun toDate(epochMs: Long, zone: ZoneId): LocalDate =
        Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate()
}
