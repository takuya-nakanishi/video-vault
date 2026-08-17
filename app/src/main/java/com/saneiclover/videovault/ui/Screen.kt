package com.saneiclover.videovault.ui

/**
 * 画面。ホームから2階層以内に全機能を収める方針(ui-ux.md)なので、
 * navigationライブラリは入れず状態1つで切り替える。
 */
sealed interface Screen {
    data object Home : Screen
    data class Browser(val url: String) : Screen
}
