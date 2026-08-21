package com.saneiclover.videovault.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QualityTest {

    @Test
    fun `オリジナルはyt-dlpの既定に任せる`() {
        assertNull(Quality.ORIGINAL.formatSelector)
    }

    @Test
    fun `HDとSDは高さの上限を持ち最良へ退避する`() {
        assertTrue(Quality.HD.formatSelector!!.contains("height<=1080"))
        assertTrue(Quality.SD.formatSelector!!.contains("height<=480"))
        // 上限を満たす形式が無いサイトで失敗しないよう、最後は無条件の最良で終わる
        assertTrue(Quality.HD.formatSelector!!.endsWith("/bv*+ba/b"))
        assertTrue(Quality.SD.formatSelector!!.endsWith("/bv*+ba/b"))
    }

    @Test
    fun `保存した名前から復元できる、壊れていれば既定`() {
        assertEquals(Quality.SD, Quality.fromName("SD"))
        assertEquals(Quality.DEFAULT, Quality.fromName(null))
        assertEquals(Quality.DEFAULT, Quality.fromName("4K"))
    }
}
