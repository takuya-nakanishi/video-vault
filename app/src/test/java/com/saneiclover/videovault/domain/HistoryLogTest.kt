package com.saneiclover.videovault.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HistoryLogTest {

    private fun entry(id: String, startedAt: Long, status: HistoryStatus = HistoryStatus.SUCCESS) =
        HistoryEntry(
            id = id,
            url = "https://youtu.be/$id",
            siteName = "YouTube",
            title = null,
            startedAt = startedAt,
            finishedAt = startedAt + 1,
            status = status,
            error = null,
        )

    @Test
    fun `新しい順に並ぶ`() {
        val log = HistoryLog(listOf(entry("a", 1), entry("c", 3), entry("b", 2)))
        assertEquals(listOf("c", "b", "a"), log.entries.map { it.id })
    }

    @Test
    fun `同じidのupsertは置き換えになる`() {
        val log = HistoryLog(listOf(entry("a", 1, HistoryStatus.RUNNING)))
            .upsert(entry("a", 1, HistoryStatus.SUCCESS))
        assertEquals(1, log.entries.size)
        assertEquals(HistoryStatus.SUCCESS, log.entries.single().status)
    }

    @Test
    fun `前回プロセスの実行中は起動時に中断へ倒す`() {
        val log = HistoryLog(listOf(entry("a", 1, HistoryStatus.RUNNING), entry("b", 2)))
            .settleStale(now = 100)
        val a = log.entries.single { it.id == "a" }
        assertEquals(HistoryStatus.CANCELLED, a.status)
        assertEquals(100L, a.finishedAt)
        assertEquals(HistoryStatus.SUCCESS, log.entries.single { it.id == "b" }.status)
    }

    @Test
    fun `上限を超えた古い履歴は落ちる`() {
        val many = (0 until HistoryLog.MAX_ENTRIES + 10).map { entry("e$it", it.toLong()) }
        val log = HistoryLog(many)
        assertEquals(HistoryLog.MAX_ENTRIES, log.entries.size)
        // 残るのは新しい側
        assertNull(log.entries.find { it.id == "e0" })
        assertEquals("e${HistoryLog.MAX_ENTRIES + 9}", log.entries.first().id)
    }

    @Test
    fun `見出しはタイトル優先でURLに退避する`() {
        val withTitle = entry("a", 1).copy(title = "Me at the zoo")
        assertEquals("Me at the zoo", withTitle.headline)
        assertEquals("youtu.be/a", entry("a", 1).headline)
        assertEquals("youtu.be", entry("a", 1).host)
    }
}
