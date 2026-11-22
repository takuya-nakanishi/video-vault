package com.saneiclover.videovault.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * ゲットVIDEOの固有配色(2026-08-21決定)。
 *
 * 端末の壁紙に追従する動的カラーはやめ、アプリのアイコンと画面で同じ色を使う。
 * 基調は**エレクトリック・バイオレット**(primary)。「取る」操作の強調にだけ
 * **コーラル**(tertiary)を使い、それ以外は彩度を抑えた紫がかったニュートラルで静かにまとめる。
 * 役割名は Material 3 のカラーロールに合わせてあるので、コンポーネント側は色名を直接持たない。
 */
internal object Brand {
    val Violet = Color(0xFF4F3DE8)
    val VioletDeep = Color(0xFF3A1FC9)
    val VioletBright = Color(0xFF6A5CFF)
    val Coral = Color(0xFFE24A3A)
}

internal val LightColors = lightColorScheme(
    primary = Color(0xFF4F3DE8),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE4DEFF),
    onPrimaryContainer = Color(0xFF16006E),
    inversePrimary = Color(0xFFC7BFFF),

    secondary = Color(0xFF5E5C73),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE4DFFA),
    onSecondaryContainer = Color(0xFF1B1A2E),

    tertiary = Color(0xFFB0352B),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFFDAD5),
    onTertiaryContainer = Color(0xFF410002),

    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),

    background = Color(0xFFFCF8FF),
    onBackground = Color(0xFF1C1B22),
    surface = Color(0xFFFCF8FF),
    onSurface = Color(0xFF1C1B22),
    surfaceVariant = Color(0xFFE5E0F0),
    onSurfaceVariant = Color(0xFF47454F),
    surfaceTint = Color(0xFF4F3DE8),
    inverseSurface = Color(0xFF313038),
    inverseOnSurface = Color(0xFFF3EFF9),
    outline = Color(0xFF787580),
    outlineVariant = Color(0xFFC9C4D4),
    scrim = Color(0xFF000000),

    surfaceBright = Color(0xFFFCF8FF),
    surfaceDim = Color(0xFFDCD8E3),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF6F2FC),
    surfaceContainer = Color(0xFFF0ECF7),
    surfaceContainerHigh = Color(0xFFEAE6F1),
    surfaceContainerHighest = Color(0xFFE4E1EB),
)

internal val DarkColors = darkColorScheme(
    primary = Color(0xFFC7BFFF),
    onPrimary = Color(0xFF2A0EB0),
    primaryContainer = Color(0xFF3E24D1),
    onPrimaryContainer = Color(0xFFE4DEFF),
    inversePrimary = Color(0xFF4F3DE8),

    secondary = Color(0xFFC8C3DE),
    onSecondary = Color(0xFF302E43),
    secondaryContainer = Color(0xFF47455A),
    onSecondaryContainer = Color(0xFFE4DFFA),

    tertiary = Color(0xFFFFB4A9),
    onTertiary = Color(0xFF690006),
    tertiaryContainer = Color(0xFF8E2219),
    onTertiaryContainer = Color(0xFFFFDAD5),

    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),

    background = Color(0xFF131120),
    onBackground = Color(0xFFE5E1EE),
    surface = Color(0xFF131120),
    onSurface = Color(0xFFE5E1EE),
    surfaceVariant = Color(0xFF47454F),
    onSurfaceVariant = Color(0xFFC9C4D4),
    surfaceTint = Color(0xFFC7BFFF),
    inverseSurface = Color(0xFFE5E1EE),
    inverseOnSurface = Color(0xFF313038),
    outline = Color(0xFF928F9D),
    outlineVariant = Color(0xFF47454F),
    scrim = Color(0xFF000000),

    surfaceBright = Color(0xFF3A3746),
    surfaceDim = Color(0xFF131120),
    surfaceContainerLowest = Color(0xFF0E0C1A),
    surfaceContainerLow = Color(0xFF1B1928),
    surfaceContainer = Color(0xFF201D2D),
    surfaceContainerHigh = Color(0xFF2A2837),
    surfaceContainerHighest = Color(0xFF353242),
)
