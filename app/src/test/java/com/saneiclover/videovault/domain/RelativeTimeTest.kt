package com.saneiclover.videovault.domain

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

class RelativeTimeTest {

    private val zone = ZoneId.of("Asia/Tokyo")
    private fun at(y: Int, mo: Int, d: Int, h: Int, mi: Int): Long =
        LocalDateTime.of(y, mo, d, h, mi).atZone(zone).toInstant().toEpochMilli()

    private val now = at(2026, 8, 21, 15, 30)

    @Test
    fun `直近は相対表現`() {
        assertEquals("たった今", RelativeTime.short(now - 30_000, now, zone))
        assertEquals("5分前", RelativeTime.short(now - 5 * 60_000, now, zone))
        assertEquals("3時間前", RelativeTime.short(now - 3 * 3_600_000, now, zone))
    }

    @Test
    fun `同じ日の朝は時刻で見せる`() {
        assertEquals("今日 8:05", RelativeTime.short(at(2026, 8, 21, 8, 5), now, zone))
    }

    @Test
    fun `前日と同年と別年`() {
        assertEquals("昨日", RelativeTime.short(at(2026, 8, 20, 23, 0), now, zone))
        assertEquals("8月15日", RelativeTime.short(at(2026, 8, 15, 9, 0), now, zone))
        assertEquals("2025年12月31日", RelativeTime.short(at(2025, 12, 31, 9, 0), now, zone))
    }

    @Test
    fun `日付見出し`() {
        assertEquals("今日", RelativeTime.dayHeading(now - 1000, now, zone))
        assertEquals("昨日", RelativeTime.dayHeading(at(2026, 8, 20, 1, 0), now, zone))
        assertEquals("8月1日", RelativeTime.dayHeading(at(2026, 8, 1, 1, 0), now, zone))
    }
}
