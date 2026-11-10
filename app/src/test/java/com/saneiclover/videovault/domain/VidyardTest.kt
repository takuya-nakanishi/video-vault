package com.saneiclover.videovault.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** URL の例は yt-dlp の Vidyard 抽出器のテスト(`yt_dlp/extractor/vidyard.py` の `_TESTS`)から取った。 */
class VidyardTest {

    @Test
    fun `会社ごとの共有ページとハブのwatchからuuidを取る`() {
        assertEquals("d4vqPjs7Q5EzVEis5QT3jd", Vidyard.playerUuidOf("https://salesforce.vidyard.com/watch/d4vqPjs7Q5EzVEis5QT3jd"))
        assertEquals("PaQzDAT1h8JqB8ivEu2j6Y", Vidyard.playerUuidOf("https://share.vidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y?"))
        // uuid にはハイフンが続くものもある
        assertEquals("oTDMPlUv--51Th455G5u7Q", Vidyard.playerUuidOf("https://vyexample03.hubs.vidyard.com/watch/oTDMPlUv--51Th455G5u7Q"))
    }

    @Test
    fun `古い共有ページのshareからuuidを取る`() {
        assertEquals("oTDMPlUv--51Th455G5u7Q", Vidyard.playerUuidOf("https://embed.vidyard.com/share/oTDMPlUv--51Th455G5u7Q"))
        assertEquals("diYeo6YR2yiGgL8odvS8Ri", Vidyard.playerUuidOf("http://share.vidyard.com/share/diYeo6YR2yiGgL8odvS8Ri"))
    }

    @Test
    fun `埋め込みのiframeとプレイヤーのJSONからuuidを取る`() {
        // 動画バッジは iframe の src をそのまま渡すので、クエリが付いた形も読めること
        assertEquals(
            "wL237MtNgZUHo6e8WPiJbF",
            Vidyard.playerUuidOf("https://play.vidyard.com/wL237MtNgZUHo6e8WPiJbF?disable_popouts=1&v=4.3.15&type=inline"),
        )
        assertEquals("iDqTwWGrd36vaLuaCY3nTs", Vidyard.playerUuidOf("https://play.vidyard.com/iDqTwWGrd36vaLuaCY3nTs.html"))
        assertEquals("7GAApnNNbcZZ46k6JqJQSh", Vidyard.playerUuidOf("https://play.vidyard.com/player/7GAApnNNbcZZ46k6JqJQSh.json?disable_analytics=0"))
        assertEquals("qhMAu5A76GZVrFzOPgSf9A", Vidyard.playerUuidOf("https://play.vidyard.com/qhMAu5A76GZVrFzOPgSf9A/type/standalone"))
    }

    @Test
    fun `大文字のホストと前後の空白を許す`() {
        assertEquals("PaQzDAT1h8JqB8ivEu2j6Y", Vidyard.playerUuidOf("  https://SHARE.Vidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y "))
    }

    @Test
    fun `Vidyardでない・形が違うURLはnull`() {
        assertNull(Vidyard.playerUuidOf("https://www.youtube.com/watch?v=jNQXAC9IVRw"))
        // ドメインの後方一致だけを見ると通ってしまう偽物
        assertNull(Vidyard.playerUuidOf("https://vidyard.com.example.net/watch/PaQzDAT1h8JqB8ivEu2j6Y"))
        assertNull(Vidyard.playerUuidOf("https://notvidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y"))
        // サブドメインの無い本体サイトや、動画でないページ
        assertNull(Vidyard.playerUuidOf("https://vidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y"))
        assertNull(Vidyard.playerUuidOf("https://salesforce.vidyard.com/"))
        // share/ は share・embed のホストだけ
        assertNull(Vidyard.playerUuidOf("https://salesforce.vidyard.com/share/PaQzDAT1h8JqB8ivEu2j6Y"))
        assertNull(Vidyard.playerUuidOf("ftp://play.vidyard.com/PaQzDAT1h8JqB8ivEu2j6Y"))
        assertNull(Vidyard.playerUuidOf("Vidyardの動画"))
    }
}
