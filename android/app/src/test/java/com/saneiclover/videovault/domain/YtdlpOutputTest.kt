package com.saneiclover.videovault.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class YtdlpOutputTest {

    @Test
    fun `Destination行からタイトルを拾う`() {
        assertEquals(
            "Me at the zoo",
            YtdlpOutput.titleFrom("[download] Destination: /storage/emulated/0/Android/data/x/files/downloads/Me at the zoo.webm"),
        )
    }

    @Test
    fun `分割形式の接尾辞は落とす`() {
        assertEquals(
            "決算解説 2026年8月",
            YtdlpOutput.titleFrom("[download] Destination: /d/決算解説 2026年8月.f137.mp4"),
        )
    }

    @Test
    fun `Merger行からタイトルを拾う`() {
        assertEquals(
            "市況まとめ",
            YtdlpOutput.titleFrom("""[Merger] Merging formats into "/d/市況まとめ.mp4""""),
        )
    }

    @Test
    fun `取得済み行からもタイトルを拾う`() {
        assertEquals(
            "Me at the zoo",
            YtdlpOutput.titleFrom("[download] /d/Me at the zoo.webm has already been downloaded"),
        )
    }

    @Test
    fun `進捗行は対象外`() {
        assertNull(YtdlpOutput.titleFrom("[download]  42.0% of 120.5MiB at 3.20MiB/s ETA 00:21"))
        assertNull(YtdlpOutput.titleFrom("[youtube] jNQXAC9IVRw: Downloading webpage"))
        assertNull(YtdlpOutput.titleFrom(""))
    }

    @Test
    fun `タイトル中のドットは拡張子だけを落とす`() {
        assertEquals("ver 1.2 release", YtdlpOutput.titleFromPath("/d/ver 1.2 release.mp4"))
    }
}
