# video-vault — 自分用動画ダウンロードアプリ

自分のインプット動画(YouTube・X・GFS等)をダウンロードし、llm-wiki取込パイプラインの入口となるAndroidアプリ。
**Play公開しない(サイドロード運用)**。私的利用限定・取得物の第三者共有不可。

商用アプリ `apps/personal-ai`(Play配信)とは配布形態も機能境界も異なる二層構造(モノレポCLAUDE.md参照)。
**このアプリのDL系コードをpersonal-aiへ持ち込まない**。本アプリの役割は自分用の実用+知識化パイプラインの実験場。

> **作業を始める前に [`docs/handoff.md`](docs/handoff.md) を読む。**
> 現在地・次のアクション・環境の事実(接続先や既知のつまずき)がそこにある。
> このファイルは「変わらない規約」、handoffは「いまの状況」。状況が変わったらhandoffを更新する。

## スタック(2026-08-14確定)

- Kotlin + Jetpack Compose + youtubedl-android(yt-dlpラッパー、`io.github.junkfood02.youtubedl-android`)
- applicationId: `com.saneiclover.videovault`(debugは `.debug` サフィックス)
- minSdk 26 / target・compileSdk 35
- ABI: releaseは **arm64-v8aのみ**(自端末専用)。debugのみ **x86_64を追加**してある(エミュレータ用)。
  youtubedl-androidはpython・ffmpegのx86_64バイナリも同梱しており、
  **エミュレータでもyt-dlpは実際に起動する**(2026-08-17実測)。ただし出荷先は実機arm64なので、
  最終確認は実機で行う
- 依存バージョンは `gradle/libs.versions.toml` に集約。**Gradle・AGP・Kotlin・Composeは今は上げない**
  (4点セットで動かす。`docs/dev-setup.md`「バージョン方針」)
- **youtubedl-androidだけは例外的に上げる**。YouTube側の変化に追随する必要があり、
  古いままだとダウンロードが動かなくなる。現行 0.18.1(QuickJS同梱。後述)

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

## コード構成(2026-08-21)

**UI層はダミーデータで描けること**を最優先に分けてある。Compose Previewはネットワークもファイルも
触れないため、後から直すと大工事になる(`docs/dev-setup.md`)。

```
domain/    Android非依存の純粋なKotlin。単体テストの対象
           InputClassifier(入力→候補の判定)/ SiteCatalog / Suggestion / DownloadedFile
           Bookmark(既定4件も)/ HistoryEntry+HistoryLog(履歴の台帳)/
           YtdlpOutput(yt-dlp出力からタイトル抽出)/ RelativeTime(「3時間前」「昨日」)
data/      Androidとyt-dlpに触る層
           SiteCatalogLoader(assets/site_patterns.json)/ DownloadRepository / CookieJar
           BookmarkStore・HistoryStore(files/*.json。JsonFileで原子的に書く)
ui/        Compose。画面は状態を持たず、状態は VideoVaultViewModel が1つで持つ
           home/HomeScreen(入力欄+ブックマーク+最近の履歴)/ browser/BrowserScreen(WebView+栞)/
           history/HistoryScreen / files/FilesScreen / components/(モノグラム・履歴行・シート・ダイアログ)/
           theme/(固有配色 Color.kt。動的カラーは使わない)
res/       drawable/ic_*.xml は自作の線アイコン(24dp・2dp線)。ic_launcher_* がアプリアイコン(ベクタのみ)
```

- **URLパターン表は `app/src/main/assets/site_patterns.json`**。サイトが増えてもコードは触らない
- 判定・履歴・タイトル抽出・時刻表示のテストは `app/src/test/`。`./gradlew testDebugUnitTest` で実機なしに回る
- **表示名は「ゲットVIDEO」**(`res/values/strings.xml`)。パッケージ名 `com.saneiclover.videovault` は
  物理名で、変えるとデータを引き継げない別アプリになるため変えない
- 色・アイコン・画面構造の決定は `docs/ui-ux.md`「デザインシステム」が正
- 状態は Flow ではなく Compose のスナップショット状態(`mutableStateOf`)で持つ。
  **入力欄の値を非同期に戻すと日本語IMEの未確定文字列が確定させられる**ため、同期更新にしている

## yt-dlp運用の要点(2026-08-19確立・ここが動かないとアプリが無価値になる)

YouTubeダウンロードは**3つの原因が層をなして壊れる**。全部潰した状態が現在。順に理解しておくこと。

1. **同梱yt-dlpは数週間で陳腐化する**。症状は `Precondition check failed` / `Please sign in`。
   → 初回ダウンロード時に `YoutubeDL.updateYoutubeDL` で本体を更新する(実装済み)
2. **yt-dlpはYouTube処理に外部JavaScriptランタイムを要求する**(EJS。既定はDenoでAndroidに無い)。
   症状は `No supported JavaScript runtime could be found` + `403 Forbidden`。
   → **youtubedl-android 0.18.1 が同梱するQuickJS(`libqjs.so`)が解**。0.17.2には入っていない。
   **ライブラリが `--js-runtimes quickjs:<パス>` を内部で付与するので、自分で同名オプションを渡さないこと**
   (パス無しで渡すと自動付与を壊して403に戻る。実際に踏んだ)
3. **yt-dlpの安定版は修正が数週間遅れる**。2を直しても403が残った(yt-dlp #17456)。
   → 更新チャンネルは **nightly**(`UpdateChannel._NIGHTLY`)。自分専用でPlay配信もしないため、
   鮮度を安定性より優先してよい

**将来また403やダウンロード失敗が出たら、まずこの3層を上から確認する。**
エラー文言に `JavaScript runtime` が含まれるかどうかが、2と3の切り分けになる。

### 4層目: デュアルスタック回線でのDNS解決失敗(2026-08-21確立)

実回線(IPv6あり)で `[Errno 7] No address associated with hostname. Giving up after 10 retries` が出て
落ちることがある。抽出は通るのに**動画本体(CloudFront等)のセグメント取得だけ**が落ちるのが特徴
(NewsPicksのHLSで実際に踏んだ)。同梱pythonの `getaddrinfo` がAAAA解決で詰まる、youtubedl-androidの
定番の落とし穴。→ **`--force-ipv4` を常時付与**(`DownloadRepository`)。IPv4のみのエミュレータでは
元々起きないため、この失敗の再現は実機でしかできない。エラー文に `No address associated with hostname` が
あればこれ。全文は Logcat `VideoVaultDownload` に出す。

## 動作確認(2026-08-19確立)

**実機へ配る前に、必ずエミュレータで煙試験を通す。** 人の目視に頼らず、
uiautomatorのビューツリー(テキスト)で判定するので、エージェントが単独で回せる。

```bash
scripts/smoke-test.sh                  # 全19シナリオ・64チェック(正常系・異常系・ブックマーク・履歴・永続化・実ダウンロード・動画バッジ)
scripts/webview-eval.py <serial> <url> <js>  # 内蔵ブラウザの中でJSを評価(debug限定。uiautomatorはWebView内を見られない)
scripts/smoke-test.sh --only-download  # 実ダウンロードとその履歴だけ(原因追跡の反復用)
scripts/smoke-test.sh --skip-download  # ネットワークを使わない範囲だけ
scripts/screenshots.sh                 # 全画面のスクリーンショット(人に見せる用。判定はしない)
scripts/webview-inspect.sh             # 内蔵ブラウザの遷移ログとDevTools(実機で白画面が出たときに最初に見る)
scripts/connect-pixel.sh 38705         # 実機へadb接続(別LANはTailscale経由。MTU対処込み)
scripts/deploy-device.sh               # ビルド→実機インストール→起動
```

- 煙試験はエミュレータ限定(実機を誤って操作しない保険を入れてある)
- **合格判定は厳しくする**。「downloadsに何かファイルができたら成功」にしていたところ、
  69バイトの `.ytdl`(yt-dlpの内部レジューム情報)を成果物と誤認して**偽の合格**を出した。
  拡張子とサイズ(100KB超の動画ファイル)まで見ること
- エミュレータで確かめられないもの: **日本語IME**・共有シート・実回線での中断挙動。これらは実機で

## MVPスコープ(v0.1)

- URL入力(またはYouTube/Xアプリの共有シートから受取)→ yt-dlpでダウンロード → 公共の `Download/videos/` へ保存(2026-08-21・人間の指定。`MANAGE_EXTERNAL_STORAGE` が要る。yt-dlpは実パスへ書くためMediaStore不可)
- 対象はYouTube・X(認証不要でyt-dlpが通る範囲)
- ログインが要るサイトは**内蔵ブラウザでログイン → Cookieを yt-dlp へ渡す**導線(`docs/ui-ux.md` 導線2)。
  動画の通信を横取りして解析する方式は採らない
- 内蔵ブラウザでは**ページ内の動画の枠の右下に弾むダウンロードバッジ**を出す(`assets/video_badge.js` を注入。
  2026-08-21)。常設のフッターボタンは無い。**JSは `innerHTML` を使わない**(YouTube等のTrusted Typesで止まる)
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
2. ~~保存先がアプリ専用領域~~ → **公共の `Download/videos/` へ書き出す対応を実施済み**(2026-08-21)。`MANAGE_EXTERNAL_STORAGE`(すべてのファイルへのアクセス)で直接パスに書く。未許可なら設定画面へ誘導する
3. ダウンロード中に画面を閉じると中断される → ForegroundServiceへの移行を次版で。今は1件ずつしか流せない
4. 設定画面が無い。再生・共有は未実装(再試行は履歴から、yt-dlp本体の更新は実装済み)
5. GFS(有料会員サイト)は技術調査未了(DRM有無・Cookie認証でのyt-dlp可否)。調査はPC側yt-dlpで先に実施し、通る場合のみ判定表へ追加
6. 文字起こし・分析はアプリに持たせない(PC/クラウド側の後段。llm-wiki側パイプラインと接続)
7. **内蔵ブラウザでパスキー(WebAuthn)は使えない**(Androidの仕様。第三者アプリのWebViewには許可されない)。
   パスキーのみのサイトは、認証アプリ(TOTP)やSMSの2要素認証を併設してもらう(`docs/ui-ux.md`)
