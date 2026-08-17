package com.saneiclover.videovault.domain

/**
 * 判定表の1行。[hosts] は後方一致で、サブドメインにも当たる(`youtube.com` は `m.youtube.com` に一致)。
 *
 * @param downloadable false ならDRM等で対象外。[reason] にその理由を持つ。
 */
data class SiteRule(
    val id: String,
    val name: String,
    val hosts: List<String>,
    val downloadable: Boolean,
    val reason: String? = null,
)

/**
 * URLパターン表。実体は `assets/site_patterns.json`(ui-ux.md: コードに直接書かず設定として分離する)。
 *
 * パースはAndroid依存のため [com.saneiclover.videovault.data.SiteCatalogLoader] が持つ。
 * この型自体は純粋なKotlinで、テストにもPreviewにもそのまま渡せる。
 */
class SiteCatalog(val rules: List<SiteRule>) {

    /** ホスト名に当たる規則。先に書かれた規則が勝つ。 */
    fun ruleFor(host: String): SiteRule? {
        val target = host.lowercase().removePrefix("www.")
        return rules.firstOrNull { rule ->
            rule.hosts.any { pattern ->
                val p = pattern.lowercase()
                target == p || target.endsWith(".$p")
            }
        }
    }

    companion object {
        /** 判定表を読めなかったときの退避。全URLが「ブラウザで開く」に落ちる。 */
        val EMPTY = SiteCatalog(emptyList())
    }
}
