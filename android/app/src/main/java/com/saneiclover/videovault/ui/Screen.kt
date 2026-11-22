package com.saneiclover.videovault.ui

/**
 * 画面。ホームから1階層で全機能に届く(ui-ux.md)。
 * navigationライブラリは入れず状態1つで切り替える。タブもドロワーも置かない。
 */
sealed interface Screen {
    /** 入力欄・ブックマーク・最近の履歴 */
    data object Home : Screen

    /** 内蔵ブラウザ。ログインが要るサイトのCookie導線と、ブックマークの飛び先 */
    data class Browser(val url: String) : Screen

    /** ダウンロード履歴の全件 */
    data object History : Screen

    /** 端末に保存済みのファイル一覧(削除) */
    data object Files : Screen
}
