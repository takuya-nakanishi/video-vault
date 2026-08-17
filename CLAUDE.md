# video-vault — 自分用動画ダウンロードアプリ

自分のインプット動画(YouTube・X・GFS等)をダウンロードし、llm-wiki取込パイプラインの入口となるAndroidアプリ。
**Play公開しない(サイドロード運用)**。私的利用限定・取得物の第三者共有不可。

商用アプリ `apps/personal-ai`(Play配信)とは配布形態も機能境界も異なる二層構造(モノレポCLAUDE.md参照)。
**このアプリのDL系コードをpersonal-aiへ持ち込まない**。本アプリの役割は自分用の実用+知識化パイプラインの実験場。

## スタック(2026-08-14確定)

- Kotlin + Jetpack Compose + youtubedl-android(yt-dlpラッパー、`io.github.junkfood02.youtubedl-android`)
- applicationId: `com.saneiclover.videovault`(debugは `.debug` サフィックス)
- minSdk 26 / target・compileSdk 35
- ABI: releaseは **arm64-v8aのみ**(自端末専用)。debugのみ **x86_64を追加**してある(エミュレータ用)。
  youtubedl-androidはpython・ffmpegのx86_64バイナリも同梱しており、
  **エミュレータでもyt-dlpは実際に起動する**(2026-08-17実測)。ただし出荷先は実機arm64なので、
  最終確認は実機で行う
- 依存バージョンは `gradle/libs.versions.toml` に集約。**今は上げない**。
  Gradle・AGP・Kotlin・Compose Compilerは4点セットで動かす(`docs/dev-setup.md`「バージョン方針」)

## ビルド・実行

環境構築は実行・検証済み。手順とハマりどころは **`docs/dev-setup.md` が正**(このファイルは要点のみ)。

- **WSL2の中で完結する**。Windows側にはJDKもAndroid Studioも入れない
- CLIから直接ビルドできる。Android Studioで開く場合も `apps/video-vault/`(モノレポルートではない。独立ビルド)

```bash
cd apps/video-vault
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ANDROID_HOME=$HOME/android-sdk \
  ./gradlew testDebugUnitTest assembleDebug
android install --apks=app/build/outputs/apk/debug/app-debug.apk
```

- 非対話シェルでは `~/.bashrc` の環境変数が効かないため、上のように明示的に渡す
- SDK管理は `android sdk` / AVDは `android emulator`(`sdkmanager` は非推奨・削除済み)
- エミュレータ起動は `emulator` バイナリを直接呼ぶ(`android emulator start` はウィンドウ表示前提)
- 実機デバッグはワイヤレスデバッグ(`adb pair` → `adb connect`)。USB転送(usbipd-win)は不要
- releaseビルドの署名: 初回リリース時に `keytool -genkeypair -v -keystore videovault-release.jks -alias videovault -keyalg RSA -keysize 4096 -validity 10950` で生成。keystoreとパスワードは**gitに入れない**(gitignore済み)。実体は端末ローカル+Google Driveバックアップ。`keystore.properties` から読む方式で `app/build.gradle.kts` に後日組み込む

## コード構成(2026-08-17)

**UI層はダミーデータで描けること**を最優先に分けてある。Compose Previewはネットワークもファイルも
触れないため、後から直すと大工事になる(`docs/dev-setup.md`)。

```
domain/    Android非依存の純粋なKotlin。単体テストの対象
           InputClassifier(入力→候補の判定)/ SiteCatalog / Suggestion / DownloadedFile
data/      Androidとyt-dlpに触る層
           SiteCatalogLoader(assets/site_patterns.json)/ DownloadRepository / CookieJar
ui/        Compose。画面は状態を持たず、状態は VideoVaultViewModel が1つで持つ
           home/HomeScreen(単一入力欄)/ browser/BrowserScreen(WebView)/ theme/
```

- **URLパターン表は `app/src/main/assets/site_patterns.json`**。サイトが増えてもコードは触らない
- 判定ロジックのテストは `app/src/test/`。`./gradlew testDebugUnitTest` で実機なしに回る
- 状態は Flow ではなく Compose のスナップショット状態(`mutableStateOf`)で持つ。
  **入力欄の値を非同期に戻すと日本語IMEの未確定文字列が確定させられる**ため、同期更新にしている

## MVPスコープ(v0.1)

- URL入力(またはYouTube/Xアプリの共有シートから受取)→ yt-dlpでダウンロード → アプリ専用外部ストレージ `files/downloads/` へ保存
- 対象はYouTube・X(認証不要でyt-dlpが通る範囲)
- ログインが要るサイトは**内蔵ブラウザでログイン → Cookieを yt-dlp へ渡す**導線(`docs/ui-ux.md` 導線2)。
  動画の通信を横取りして解析する方式は採らない
- 実装済みの範囲と仕様からの逸脱は `docs/ui-ux.md`「実装状況」が正

## 配布方法(2026-08-14明確化)

- 配布は**APK直インストールのみ**(ビルドして自分の端末へadbで入れる)。ストア・審査・アカウントは介在しない
- **Playのどのトラックにも載せない**(内部テスト含む)。法人Play開発者アカウントにDL系アプリが載ると
  「関連アカウントごと終了」の執行リスクを商用配信基盤に持ち込むため
- 個人Play開発者アカウントを防火壁にする案も不採用(Googleは支払い・身元・端末で紐づく関連アカウントをまとめて終了させる)

## サイドロードの前提(2026-08-14調査)

Android Developer Verificationにより、認定Android端末へのインストールには開発者の身元登録が必要になる
(2025-10早期アクセス → 2026-03全開発者開放 → **2026-09-30にブラジル・インドネシア・シンガポール・タイで発効** → 2027以降グローバル)。
Googleは「開発者が誰かを確認するだけで、アプリの内容は審査しない」と明記。日本は第一波に含まれず、
自分を検証済み開発者として登録すれば当面の運用は継続できる。グローバル展開時に手順を再確認すること。

## 既知の制約・次ステップ

1. **日本語IMEの挙動が未検証**(エミュレータの英語キーボードでは確かめられない)。
   実機を繋いだら最初に「かれの」を入力し、未確定文字列が勝手に確定しないことを見る。
   ここが破綻するならUIの技術選定そのものを見直す(`docs/ui-ux.md`)
2. 保存先がアプリ専用領域(`Android/data/`配下)のため他アプリから見えにくい → MediaStore経由で公共`Download/`へ書き出す対応を次版で(サイドロードなので`MANAGE_EXTERNAL_STORAGE`権限も選択肢)
3. ダウンロード中に画面を閉じると中断される → ForegroundServiceへの移行を次版で。今は1件ずつしか流せない
4. ダウンロード詳細画面・設定画面が無い。再生・共有・再試行・yt-dlp本体の更新(`YoutubeDL.updateYoutubeDL`)はいずれも未実装
5. GFS(有料会員サイト)は技術調査未了(DRM有無・Cookie認証でのyt-dlp可否)。調査はPC側yt-dlpで先に実施し、通る場合のみ判定表へ追加
6. 文字起こし・分析はアプリに持たせない(PC/クラウド側の後段。llm-wiki側パイプラインと接続)
