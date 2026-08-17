package com.saneiclover.videovault.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ui-ux.md の判定表がそのままテストになっている。
 * 判定はUIを起動せずに確かめられる純粋なロジックなので、実機もエミュレータも要らない。
 */
class InputClassifierTest {

    private val catalog = SiteCatalog(
        listOf(
            SiteRule("youtube", "YouTube", listOf("youtube.com", "youtu.be"), downloadable = true),
            SiteRule("x", "X", listOf("x.com", "twitter.com"), downloadable = true),
            SiteRule(
                "netflix", "Netflix", listOf("netflix.com"),
                downloadable = false, reason = "DRM(Widevine)で保護されているため対象外",
            ),
        )
    )
    private val classifier = InputClassifier(catalog)

    @Test
    fun `空入力は候補を出さない`() {
        assertEquals(emptyList<Suggestion>(), classifier.classify(""))
        assertEquals(emptyList<Suggestion>(), classifier.classify("   "))
    }

    @Test
    fun `動画サイトのURLはダウンロードが第一候補`() {
        val result = classifier.classify("https://www.youtube.com/watch?v=abc123")
        assertEquals(
            Suggestion.Download("https://www.youtube.com/watch?v=abc123", "YouTube"),
            result[0],
        )
        assertTrue(result[1] is Suggestion.OpenInBrowser)
    }

    @Test
    fun `サブドメインと短縮ドメインも判定表に当たる`() {
        assertTrue(classifier.classify("https://m.youtube.com/watch?v=abc")[0] is Suggestion.Download)
        assertTrue(classifier.classify("https://youtu.be/abc")[0] is Suggestion.Download)
    }

    @Test
    fun `スキームの無いURLはhttpsを補う`() {
        val result = classifier.classify("youtube.com/watch?v=abc")
        assertEquals(
            Suggestion.Download("https://youtube.com/watch?v=abc", "YouTube"),
            result[0],
        )
    }

    @Test
    fun `判定表に無いURLはブラウザで開くだけ`() {
        val result = classifier.classify("https://example.com/article")
        assertEquals(listOf(Suggestion.OpenInBrowser("https://example.com/article")), result)
    }

    @Test
    fun `DRMのサイトは対象外として弾き、失敗させない`() {
        val result = classifier.classify("https://www.netflix.com/title/80100172")
        val first = result[0]
        assertTrue(first is Suggestion.Unsupported)
        assertEquals("Netflix", (first as Suggestion.Unsupported).siteName)
    }

    @Test
    fun `日本語のキーワードは検索になる`() {
        assertEquals(listOf(Suggestion.WebSearch("かれの")), classifier.classify("かれの"))
    }

    @Test
    fun `空白を含む入力は検索になる`() {
        assertEquals(listOf(Suggestion.WebSearch("決算 解説")), classifier.classify("決算 解説"))
    }

    @Test
    fun `httpとhttps以外のスキームはURLとして扱わない`() {
        assertNull(InputClassifier.normalizeUrl("ftp://example.com/x"))
        assertTrue(classifier.classify("ftp://example.com/x")[0] is Suggestion.WebSearch)
    }

    @Test
    fun `拡張子付きの日本語はURLと誤判定しない`() {
        assertNull(InputClassifier.normalizeUrl("決算資料.pdf"))
    }

    @Test
    fun `検索URLは日本語をエンコードする`() {
        val url = InputClassifier.searchUrl("かれの 決算")
        assertTrue(url.startsWith("https://www.google.com/search?q="))
        assertTrue(url.none { it.code > 127 })
    }

    @Test
    fun `判定表が空でもURLはブラウザで開ける`() {
        val fallback = InputClassifier(SiteCatalog.EMPTY)
        assertEquals(
            listOf(Suggestion.OpenInBrowser("https://www.youtube.com/watch?v=abc")),
            fallback.classify("https://www.youtube.com/watch?v=abc"),
        )
    }
}
