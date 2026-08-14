# video-vault — 自分用動画ダウンロードアプリ

自分のインプット動画(YouTube・X・GFS等)をダウンロードし、llm-wiki取込パイプラインの入口となるAndroidアプリ。
**Play公開しない(サイドロード運用)**。私的利用限定・取得物の第三者共有不可。

商用アプリ `apps/personal-ai`(Play配信)とは配布形態も機能境界も異なる二層構造(モノレポCLAUDE.md参照)。
**このアプリのDL系コードをpersonal-aiへ持ち込まない**。本アプリの役割は自分用の実用+知識化パイプラインの実験場。

## スタック(2026-08-14確定)

- Kotlin + Jetpack Compose + youtubedl-android(yt-dlpラッパー、`io.github.junkfood02.youtubedl-android`)
- applicationId: `com.saneiclover.videovault`(debugは `.debug` サフィックス)
- minSdk 26 / target・compileSdk 35 / arm64-v8aのみ(自端末専用)
- 依存バージョンは `gradle/libs.versions.toml` に集約。初回syncで最新安定版へ更新してよい

## ビルド・実行

- Android Studioで `apps/video-vault/` を開く(モノレポルートではなくこのディレクトリ。独立ビルド)
- 初回syncは未検証(scaffold時点でWSLにSDKなし)。バージョン不整合が出たら `libs.versions.toml` を調整
- 実機デバッグ: Windows側Android Studio + USB接続(WSL/Surface環境はPDR No.347参照)
- releaseビルドの署名: 初回リリース時に `keytool -genkeypair -v -keystore videovault-release.jks -alias videovault -keyalg RSA -keysize 4096 -validity 10950` で生成。keystoreとパスワードは**gitに入れない**(gitignore済み)。実体は端末ローカル+Google Driveバックアップ。`keystore.properties` から読む方式で `app/build.gradle.kts` に後日組み込む

## MVPスコープ(v0.1)

- URL入力(またはYouTube/Xアプリの共有シートから受取)→ yt-dlpでダウンロード → アプリ専用外部ストレージ `files/downloads/` へ保存
- 対象はYouTube・X(認証不要でyt-dlpが通る範囲)

## 既知の制約・次ステップ

1. 保存先がアプリ専用領域(`Android/data/`配下)のため他アプリから見えにくい → MediaStore経由で公共`Download/`へ書き出す対応を次版で(サイドロードなので`MANAGE_EXTERNAL_STORAGE`権限も選択肢)
2. ダウンロード中に画面を閉じると中断される → ForegroundServiceへの移行を次版で
3. yt-dlp本体の自動更新(`YoutubeDL.updateYoutubeDL`)は未実装
4. GFS(有料会員サイト)は技術調査未了(DRM有無・Cookie認証でのyt-dlp可否)。調査はPC側yt-dlpで先に実施し、通る場合のみアプリへCookie渡し機構を追加
5. 文字起こし・分析はアプリに持たせない(PC/クラウド側の後段。llm-wiki側パイプラインと接続)
