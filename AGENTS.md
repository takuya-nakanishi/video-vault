# video-vault — 自分用動画ダウンロードアプリ(独立リポジトリ)

自分のインプット動画(YouTube・X・GFS等)をダウンロードし、fire取込パイプラインの入口となるAndroidアプリ。
Android アプリに加えて、**手元の PC で動かす PC 版(`web/`)**がある(下の「Web(PC 版)と Playwright」)。
**Play公開しない(サイドロード運用)**。私的利用限定・取得物の第三者共有不可。

商用アプリ personal-ai(Play配信。sc-products の `apps/personal-ai`)とは配布形態も機能境界も異なる二層構造(下の「位置づけと公開ルール」)。
**このアプリのDL系コードをpersonal-aiへ持ち込まない**。本アプリの役割は自分用の実用+知識化パイプラインの実験場。

> **作業を始める前に [`docs/handoff.md`](docs/handoff.md) を読む。**
> 現在地・次のアクション・環境の事実(接続先や既知のつまずき)がそこにある。
> このファイルは「変わらない規約」、handoffは「いまの状況」。状況が変わったらhandoffを更新する。

## 位置づけと公開ルール

- **2026-11-22 に sc-products(自分用アプリのモノレポ)の `apps/video-vault` から独立したリポジトリ**。
  それまでの履歴は `git subtree split` で引き継いである(古いコミットの件名の `video-vault:` はモノレポの書き方)
- 本リポジトリは **private 固定**。public 化しない。**ダウンロード系の機能は公開対象外**
  (YouTube/X 等の ToS・有料サイトの規約に抵触するため)。発信してよいのは、パイプラインの設計と汎用の部分だけで、
  発信するときはそこだけを別の場所へ書き起こす。取得物は私的利用に限り、第三者と共有しない
- **配布形態による二層構造**: このアプリは「自分用」の層(サイドロード。Play 非配信。機能の制限なし)。
  商用の層(Google Play 配信。ダウンロード系・有料会員コンテンツの取込は不可)の personal-ai は sc-products に残る。
  **両層のコードを混ぜない**。このリポジトリのコードを sc-products へ写さず、共有のライブラリにもしない。
  決定と理由は sc-products の `docs/配布形態の二層構造と機能境界.md`
- applicationId は `com.saneiclover.videovault`(sc-products の命名規則 `com.saneiclover.{app}` で決めたもの。
  変えるとデータを引き継げない別アプリになるので変えない)

## git運用

- ソロ開発のため `main` へ直接 push。作業ブランチ・PR は作らない
- コミットは `{領域}: {変更内容}`(例: `download: …`・`ui: …`・`docs: …`・`smoke: …`。リポジトリ全体は `repo: …`)
- 禁止は不可逆操作のみ: **force-push / 履歴改変(push 済みコミットの書き換え・reset --hard)/ リポジトリ外への破壊的操作 / `.env` 等の秘密情報の外部送出**
- push 競合時は `git pull --rebase` を1回だけ実行して再 push。それでも失敗したら中断して人間に報告
- 権限モードは `.claude/settings.json` で `bypassPermissions`(auto mode は理由の見えないまま無人セッションを止めるため)。上の禁止はこの規約で担保する

## 相互レビュー

- 主要な変更は、作業した側と別系統のモデルのエージェントにレビューさせ、指摘対応は修正コミットで行う。
  **誰に頼むかは本人が名指しで決める**(名指しが無ければ聞く)。依頼経路は agent-base の `cross-review` skill
- レビュー観点は `.agents/cross-review.json` の `focus`。`exclude` は無し(追跡下のファイルはすべて渡る。`.env`・keystore 等は gitignore 済み)
- 外部 LLM へ原文を送る操作である。送り先で学習に使わせない設定になっているときだけ渡す(`cross-review` skill)。秘密情報は送らない

## 応答の言語

**人へ返す文章はすべて日本語で書く。**セッション内の応答・コミットメッセージ・リポジトリ内のドキュメント・コードコメントが対象。
コード識別子・コマンド・ログ・エラーメッセージ・技術用語は原語のまま。外部ツールの出力は翻訳せず原文のまま貼る。

## セッション間の引き継ぎ

- いまの状況は [`docs/handoff.md`](docs/handoff.md)(現在地 / 次のアクション / 作業の始め方 / 環境の事実 / つまずきどころ / 参照先)。
  この AGENTS.md は「変わらない規約」。**役割を混ぜない。状況が変わったら handoff を更新する**
- **人にしかできない作業は、その理由とともに明記する**(例: 日本語 IME の検証は adb 経由の入力では再現しない)

## 動作確認の規律

- **実機へ配る前に、自動テストを通す**。検証は人の目視に依存させず、機械が判定できる形にする(uiautomator のビューツリーのテキスト。下の「動作確認」)
- **正常系だけでなく異常系も流す**。**合格判定は厳しくする**(緩い判定は嘘の合格を出す)。**テスト自体のバグを疑う**
- 人にしか確認できないもの(日本語 IME・共有シート・実回線)は明示的に切り分け、人へ渡す前に自動で確かめられる範囲を潰す

## 非推奨ツールを使わない

公式が非推奨と表示・宣言しているツール・API は使わず、公式の代替へ置き換える(詳細は全リポジトリ共通の規約 agent-base `host/global/AGENTS.md`)。

| 非推奨 | 公式の代替 | 確認日 |
|---|---|---|
| `sdkmanager`(Android SDK管理) | `android sdk`(Android CLI) | 2026-08-16 |
| `avdmanager`(AVD管理) | `android emulator`(同上。avdmanager自体に非推奨表示はないが実質的に置換) | 2026-08-16 |

## セキュリティ

- 認証情報はコード・ドキュメントへ直書きしない。有料サイトのログイン Cookie 等はリポジトリに入れない(端末ローカルのみ)
- keystore・`keystore.properties`・`local.properties` は gitignore 済み

## 作業の裁量と確認

[共通規約](../agent-base/host/global/AGENTS.md)の「作業の裁量と確認」節に従う(正本は本体の clone と同じ親ディレクトリの `agent-base/host/global/AGENTS.md`)。
このリポジトリ固有の禁止事項は上の「git運用」が優先する。

## Web(PC 版)と Playwright

**`web/` は、ゲットVIDEO の PC 版**(2026-11-23 本人の決定)。手元の PC で動かし、アプリが開くブラウザでログインして、yt-dlp で取得する。
Android と同じ流れ(内蔵ブラウザでログイン → Cookie を渡す → yt-dlp)を、PC の部品で組んだもの。
入れ方・使い方・Android との違い・つまずきどころは **`docs/web.md` が正**(ここは変わらない規約だけ)。

| 置き場 | 中身 |
|---|---|
| `android/` | Android アプリ(Gradle 一式。`android/scripts/` は煙試験・実機への配布など Android の道具) |
| `web/` | PC 版(Node。`src/` が本体、`public/` が画面、`test/` が単体、`e2e/` が通しの試験) |
| 根 | リポジトリ全体のもの(`AGENTS.md`・`docs/`・`llm-wiki/`・`scripts/wiki/`・`.agents/`・`.claude/`) |

- **Android アプリの要件はそのまま残す**(2026-11-23 本人)。PC 版は横に足した別の仕組みで、Android のコードを変えない
- **公開の MeTube(alexta69/metube)は使わない**。ログインの画面が無く、Vidyard のパスワードも扱えないため、自分で作ると決めた
- **PC 版は、Surface をサーバとして `https://ytdlp.sanei-clover.com` から本人が使う**(2026-11-24 本人の決定。それまでの「公開の URL に出さない」を、本人が改めた)。
  - 外へつなぐのは Cloudflare Tunnel。**Cloudflare の入口には認証を置かない**(Works の `works.sanei-clover.com` と同じ型)。
    **守るのはアプリの Basic 認証**(本人: 認証は一旦 Basic 認証で)。Basic 認証を外す・弱めるときは、先に入口の側の守りを本人と決める
  - **使うのは本人だけ**。利用者名とパスワードを他人に渡さない。上の「位置づけと公開ルール」(リポジトリは private・取得物は第三者と共有しない)は変わらない
  - **待ち受けるアドレスは `127.0.0.1` に固定**(`web/src/config.mjs` の `LISTEN_HOST`)。環境変数で変えられる作りにしない。外からの道はトンネルだけにする
    (ルーターの口を開けない・この PC の外向きのアドレスで待ち受けない)
  - 公開用の名前に http で来た要求は、認証を求める前に https へ回す(パスワードを暗号化されない区間で送らせない)
  - Works のトンネル(`sanei-clover-lan`)には相乗りしない。専用のトンネル `video-vault` を持つ(あちらの cloudflared は Docker の中にいて、この PC の `127.0.0.1` に届かない)
- **公開用のホスト名は、Basic 認証と揃っているときだけ設定できる**(片方では起動しない。`web/src/config.mjs`)。外へつなぐ道具も、
  アプリが Basic 認証を求めていることを確かめてからでないと動かない(`web/deploy/`)。この作りを緩めない
- トンネルのトークンと Basic 認証のパスワードは `~/.config/video-vault/`(持ち主だけが読める)に置く。リポジトリにも文書にも書かない
- **別のサイトから命令を送らせない**。ブラウザで開いた別のページは、この PC のサーバへ要求を送れる。サーバは Host・合言葉(起動のたびに作るトークン)・
  Origin の 3 つを確かめる(`web/src/server.mjs`)。口を足すときも、この 3 つを外さない
- **判定表(`site_patterns.json`)とバッジの JS(`video_badge.js`)は Android と同じファイルを読む**。写しを持たない。どちらかを変えたら `web` の試験も走らせる
- **認証情報を残さない**。Cookie は yt-dlp に渡す一時ファイルにだけ書き、終わったら消す。Vidyard のパスワードとトークンはメモリだけ。
  履歴・画面に返す状態・ログ・エラーの文に、Cookie・パスワード・トークンを入れない。yt-dlp の引数(Cookie のファイルの場所とトークンが入る)もログに出さない
- ログインの状態(ブラウザのプロファイル・Cookie の写し・Playwright の storageState)・trace・動画・スクリーンショットには Cookie や入力したパスワードが入る。**git に入れない**。
  ログインの状態は `.auth/` の下か、名前に `storageState` を含むファイルに置き、履歴は `.data/` に、試験の出力は `test-results/`・`playwright-report/` に出す
  (どれもどの階層でも `.gitignore` 済み。それ以外の場所は無視されない)。人に見せるときも、写り込んだ認証情報を伏せる
- 自動テストの合格判定は Web でも上の「動作確認の規律」に従う(機械が判定できる形・異常系も流す・判定は厳しく)。
  **試験は実在の外部サイトへ書き込まない**。ログインの流れは、この PC の中に立てる偽のサイト(`web/e2e/fakeSite.mjs`)を相手にする。
  待ち合わせは、条件が成り立つまでの待ち(期限つき)で行い、固定の sleep に頼らない
- 試験のためだけに規則を緩める切り替え(`allowLoopback`)は、環境変数や画面から入らないようにしてある。同じ種類の切り替えを足すときも、そうする
- 下の「スタック」「ビルド・実行」「コード構成」は Android アプリのこと

```bash
cd web
npm test                                 # 単体(外へ通信しない)
npm run e2e                              # 通し(実物の yt-dlp とブラウザ・偽のサイト)
VIDEO_VAULT_E2E_NETWORK=1 npm run e2e    # 実際の YouTube と公開の Vidyard からも取る
npm start                                # 起動(出てきた URL をブラウザで開く)
```

## スタック

- Kotlin + Jetpack Compose + youtubedl-android(yt-dlpラッパー、`io.github.junkfood02.youtubedl-android`)
- applicationId: `com.saneiclover.videovault`(debugは `.debug` サフィックス)
- minSdk 26 / target・compileSdk 35
- ABI: releaseは **arm64-v8aのみ**(自端末専用)。debugのみ **x86_64を追加**してある(エミュレータ用)。
  youtubedl-androidはpython・ffmpegのx86_64バイナリも同梱しており、
  **エミュレータでもyt-dlpは実際に起動する**(2026-08-17実測)。ただし出荷先は実機arm64なので、
  最終確認は実機で行う
- 依存バージョンは `android/gradle/libs.versions.toml` に集約。**Gradle・AGP・Kotlin・Composeは今は上げない**
  (4点セットで動かす。`docs/dev-setup.md`「バージョン方針」)
- **youtubedl-androidだけは例外的に上げる**。YouTube側の変化に追随する必要があり、
  古いままだとダウンロードが動かなくなる。現行 0.18.1(QuickJS同梱。後述)

## ビルド・実行

環境構築は実行・検証済み。手順とハマりどころは **`docs/dev-setup.md` が正**(このファイルは要点のみ)。

- **WSL2の中で完結する**。Windows側にはJDKもAndroid Studioも入れない
- CLIから直接ビルドできる。**Gradle のコマンドは `android/` で走らせる**。Android Studioで開く場合も `android/` を開く

```bash
cd android
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ANDROID_HOME=$HOME/android-sdk \
  ./gradlew testDebugUnitTest assembleDebug
android install --apks=app/build/outputs/apk/debug/app-debug.apk
```

- 非対話シェルでは `~/.bashrc` の環境変数が効かないため、上のように明示的に渡す
- SDK管理は `android sdk` / AVDは `android emulator`(`sdkmanager` は非推奨・削除済み)
- エミュレータ起動は `emulator` バイナリを直接呼ぶ(`android emulator start` はウィンドウ表示前提)
- 実機デバッグはワイヤレスデバッグ(`adb pair` → `adb connect`)。USB転送(usbipd-win)は不要
- releaseビルドの署名: 初回リリース時に `keytool -genkeypair -v -keystore videovault-release.jks -alias videovault -keyalg RSA -keysize 4096 -validity 10950` で生成。keystoreとパスワードは**gitに入れない**(gitignore済み)。実体は端末ローカル+Google Driveバックアップ。`keystore.properties` から読む方式で `android/app/build.gradle.kts` に後日組み込む

## コード構成

**UI層はダミーデータで描けること**を最優先に分けてある。Compose Previewはネットワークもファイルも
触れないため、後から直すと大工事になる(`docs/dev-setup.md`)。

```
domain/    Android非依存の純粋なKotlin。単体テストの対象
           InputClassifier(入力→候補の判定)/ SiteCatalog / Suggestion / DownloadedFile
           Bookmark(既定4件も)/ HistoryEntry+HistoryLog(履歴の台帳)/
           YtdlpOutput(yt-dlp出力からタイトル抽出)/ RelativeTime(「3時間前」「昨日」)/
           Vidyard(Vidyard の URL からプレイヤーの uuid を読む)
data/      Androidとyt-dlpに触る層
           SiteCatalogLoader(assets/site_patterns.json)/ DownloadRepository / CookieJar /
           VidyardUnlocker(Vidyard のパスワード保護を解錠し、トークンを yt-dlp へ渡す)
           DownloadCenter(実行状態と履歴の持ち主)/ DownloadService(ForegroundService)
           BookmarkStore・HistoryStore(files/*.json。JsonFileで原子的に書く)
ui/        Compose。画面は状態を持たず、状態は VideoVaultViewModel が1つで持つ
           home/HomeScreen(入力欄+ブックマーク+最近の履歴)/ browser/BrowserScreen(WebView+栞)/
           history/HistoryScreen / files/FilesScreen / components/(モノグラム・履歴行・シート・ダイアログ)/
           theme/(固有配色 Color.kt。動的カラーは使わない)
res/       drawable/ic_*.xml は自作の線アイコン(24dp・2dp線)。ic_launcher_* がアプリアイコン(ベクタのみ)
```

- **URLパターン表は `android/app/src/main/assets/site_patterns.json`**。サイトが増えてもコードは触らない。
  PC 版(`web/`)も、この表と `video_badge.js` を同じファイルから読む。変えたら `web` の試験も走らせる
- 判定・履歴・タイトル抽出・時刻表示のテストは `android/app/src/test/`。`android/` で `./gradlew testDebugUnitTest` を叩けば実機なしに回る
- 内蔵ブラウザは**ダウンロードを始めてもホームへ戻らない**。画質シート・進捗・結果を
  ブラウザ画面の上に重ねる。戻すとWebViewが破棄され、見ていた動画の再生が止まってページも読み直しになる
- **表示名は「ゲットVIDEO」**(`res/values/strings.xml`)。パッケージ名 `com.saneiclover.videovault` は
  物理名で、変えるとデータを引き継げない別アプリになるため変えない
- 色・アイコン・画面構造の決定は `docs/ui-ux.md`「デザインシステム」が正
- 状態は Flow ではなく Compose のスナップショット状態(`mutableStateOf`)で持つ。
  **入力欄の値を非同期に戻すと日本語IMEの未確定文字列が確定させられる**ため、同期更新にしている
- **ダウンロードの実行状態と履歴だけはViewModelが持たない**(次節)

## ダウンロードの実行

**ダウンロードはViewModelではなくForegroundServiceが走らせる。** ViewModelの `viewModelScope` で
走らせると、ホームに戻る・他のアプリを見る・内蔵ブラウザで動画を再生し続ける、のいずれでも
プロセスが落とされ得て、そのたびにダウンロードが死ぬ。

| 部品 | 役割 |
|---|---|
| `DownloadCenter`(object) | **実行状態と履歴の唯一の持ち主**。プロセスの寿命で生きる。ViewModelは `Listener` で受け取って映すだけ |
| `DownloadService` | 実行の器。通知を出し、`DownloadCenter.execute` を回し、終わったら自分を止める |
| `VideoVaultViewModel` | 画面の状態。破棄されてもダウンロードには影響しない |

- **履歴の所有者をDownloadCenterにしてあるのが要点**。アプリを閉じている間に終わった分も履歴に残り、
  `files/history.json` へ書かれる(ViewModelが生きている必要がない)
- サービス種別は `dataSync`(Manifest)。起動は前面のActivityからなのでバックグラウンド起動制限に掛からない。
  `START_NOT_STICKY`(URLを失った再起動には意味がない)。**タスクからスワイプで消されても止めない**
- 通知は2チャンネル。進行中(`IMPORTANCE_LOW`・中断ボタン付き)と結果(`IMPORTANCE_DEFAULT`)。
  Android 13以降は `POST_NOTIFICATIONS` の実行時許可が要る。**拒否されてもダウンロードは走る**(通知が出ないだけ)
- **Cookieは画質シートの間はヘッダ文字列のまま持ち、yt-dlp起動の直前にファイル化する**。
  Intentに載せるのは識別子だけで、URLもCookieもプロセス内に留める
- 同時実行は**1件のまま**(2件目は断る)。キューは未実装

## yt-dlp運用の要点(ここが動かないとアプリが無価値になる)

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

### 4層目: デュアルスタック回線でのDNS解決失敗

実回線(IPv6あり)で `[Errno 7] No address associated with hostname. Giving up after 10 retries` が出て
落ちることがある。抽出は通るのに**動画本体(CloudFront等)のセグメント取得だけ**が落ちるのが特徴
(NewsPicksのHLSで実際に踏んだ)。同梱pythonの `getaddrinfo` がAAAA解決で詰まる、youtubedl-androidの
定番の落とし穴。→ **`--force-ipv4` を常時付与**(`DownloadRepository`)。IPv4のみのエミュレータでは
元々起きないため、この失敗の再現は実機でしかできない。エラー文に `No address associated with hostname` が
あればこれ。全文は Logcat `VideoVaultDownload` に出す。

### Vidyard のパスワード保護(2026-11-10)

Vidyard(企業向けの動画配信)の**パスワード付きの動画は、yt-dlp だけでは取れない**。yt-dlp の Vidyard 抽出器が
パスワードを扱えないため(2026-11-10 の master でも同じ)。症状は
`An extractor error has occurred. (caused by KeyError('chapters'))`。保護された動画では
`play.vidyard.com/player/<uuid>.json` が `type: "secure"` を返し、動画の URL(`chapters`)が入っていない。

→ **アプリがプレイヤーと同じ手順で解錠し、トークンだけを yt-dlp へ渡す**(`data/VidyardUnlocker.kt`)。
手順はプレイヤーの JS を読んで確かめ、実物の動画で通した(PC の yt-dlp で 57 分・298MB を最後まで取得)。

1. `GET /player/<uuid>.json` で `type` を見る。`secure` でなければ何もしない
2. `POST /secure/verify-access-code` に `{"uuid", "token": パスワード}` → `accessToken`
   (誤りは 401 `{"error":"Password is incorrect"}`)
3. yt-dlp に `--add-header "X-Video-Access:<accessToken>"` を付ける。抽出器が `player/<uuid>.json` を取るときに
   このヘッダが乗り、動画の URL が入った応答が返る

- パスワードは**画質シートの欄**で受け取る(Vidyard の URL のときだけ出る。空欄でも始められる)。
  メモリにだけ置き、履歴にもファイルにも書かない。履歴からやり直すときは入れ直す
- 動画の URL は自分で読まない。画質の選び方・字幕・HLS は yt-dlp に任せたまま(サイト対応の追随を yt-dlp に任せる方針は崩さない)
- 内蔵ブラウザのプレイヤーで入れたパスワードは引き継げない。トークンはプレイヤーの iframe の中にしか無く、
  取り出すには通信の横取りが要る(採らない方針)。画質シートで入れ直す
- uuid の読み取り(`domain/Vidyard.kt`)は yt-dlp の `_VALID_URL` に揃えてある。URL の形を足すときは yt-dlp 側を見て揃える
- **yt-dlp が Vidyard のパスワード(`--video-password`)に対応したら**、この解錠を外して yt-dlp に任せる
- チャプターのメニューのような**プレイヤーの表示は取得に関係しない**。公開の動画は何もせずに取れる

## 動作確認

**実機へ配る前に、必ずエミュレータで煙試験を通す。** 人の目視に頼らず、
uiautomatorのビューツリー(テキスト)で判定するので、エージェントが単独で回せる。

```bash
android/scripts/smoke-test.sh                  # 全24シナリオ・83チェック(正常系・異常系・ブックマーク・履歴・永続化・実ダウンロード・動画バッジ・Vidyard)。パスワード付きの Vidyard の2シナリオは別(下)
android/scripts/webview-eval.py <serial> <url> <js>  # 内蔵ブラウザの中でJSを評価(debug限定。uiautomatorはWebView内を見られない)
android/scripts/smoke-test.sh --only-download  # 実ダウンロードとその履歴だけ(原因追跡の反復用)
android/scripts/smoke-test.sh --skip-download  # ネットワークを使わない範囲だけ
android/scripts/smoke-test.sh --only-vidyard   # Vidyard だけ。パスワード付きは VIDYARD_SECURE_URL・VIDYARD_SECURE_PASSWORD を渡したときだけ走る(値はリポジトリに書かない)
adb connect 100.91.182.103:38705  # 実機へadb接続(別LANは先にMTUクランプ。docs/dev-setup.md)
android/scripts/deploy-device.sh               # ビルド→実機インストール→起動
```

- 煙試験はエミュレータ限定(実機を誤って操作しない保険を入れてある)
- **合格判定は厳しくする**。「downloadsに何かファイルができたら成功」にしていたところ、
  69バイトの `.ytdl`(yt-dlpの内部レジューム情報)を成果物と誤認して**偽の合格**を出した。
  拡張子とサイズ(100KB超の動画ファイル)まで見ること
- エミュレータで確かめられないもの: **日本語IME**・共有シート・実回線での中断挙動。これらは実機で

## MVPスコープ(v0.1)

- URL入力(またはYouTube/Xアプリの共有シートから受取)→ yt-dlpでダウンロード → 公共の `Download/videos/` へ保存(`MANAGE_EXTERNAL_STORAGE` が要る。yt-dlpは実パスへ書くためMediaStore不可)
- 対象はYouTube・X(認証不要でyt-dlpが通る範囲)
- ログインが要るサイトは**内蔵ブラウザでログイン → Cookieを yt-dlp へ渡す**導線(`docs/ui-ux.md` 導線2)。
  動画の通信を横取りして解析する方式は採らない
- 内蔵ブラウザでは**ページ内の動画の枠の右下に弾むダウンロードバッジ**を出す(`assets/video_badge.js` を注入)。
  常設のフッターボタンは無い。**JSは `innerHTML` を使わない**(YouTube等のTrusted Typesで止まる)
- 実装済みの範囲と仕様からの逸脱は `docs/ui-ux.md`「実装状況」が正

## 配布方法

- 配布は**APK直インストールのみ**(ビルドして自分の端末へadbで入れる)。ストア・審査・アカウントは介在しない
- **最新の APK は Google ドライブの `マイドライブ/20-Apps/ゲットVIDEO` にも置く**(2026-11-10・人間の指定。
  フォルダ ID `1O4OYg71jRjlGLKGmZqoN-Vwn4-adeB2W`)。人が実機のドライブのアプリから開いて入れられる
  - 名前は `ゲットVIDEO-<versionName>-debug-<日付>-<コミット>.apk`。古い版は消さずに並べる(どの版を入れたか後から分かる)
  - PC からは「Google ドライブ パソコン版」の仮想ドライブへコピーすれば上がる(WSL では `/mnt/g/マイドライブ/20-Apps/ゲットVIDEO/`)
  - いまは debug 版(`com.saneiclover.videovault.debug`)。このPCの debug 鍵(`~/.android/debug.keystore`)で署名しているので、
    実機の debug 版に上書きできる。別のPCでビルドした APK は鍵が違い、上書きできない
  - **このフォルダを他人と共有しない**(2026-11-10 時点で共有なし。ダウンロード系のアプリは公開対象外。下の「位置づけと公開ルール」)
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
2. 公共の `Download/videos/` へは `MANAGE_EXTERNAL_STORAGE`(すべてのファイルへのアクセス)で直接パスに書く。未許可なら設定画面へ誘導する
3. ダウンロードは**1件ずつしか流せない**(2件目は断る。キューは未実装)
4. 設定画面が無い。再生・共有は未実装(再試行は履歴から、yt-dlp本体の更新は実装済み)
5. GFS(有料会員サイト)は技術調査未了(DRM有無・Cookie認証でのyt-dlp可否)。調査はPC側yt-dlpで先に実施し、通る場合のみ判定表へ追加
6. 文字起こし・分析はアプリに持たせない(PC/クラウド側の後段。fire側パイプラインと接続)
7. **内蔵ブラウザでパスキー(WebAuthn)は使えない**(Androidの仕様。第三者アプリのWebViewには許可されない)。
   パスキーのみのサイトは、認証アプリ(TOTP)やSMSの2要素認証を併設してもらう(`docs/ui-ux.md`)

## LLM Wiki(`llm-wiki/`。このリポジトリの拡張)

全リポジトリ共通の作り(3 つの層・ページの種類・ファイル名・frontmatter・リンク・書き方の決まり・書かないもの・原本の台帳・取り込まないもの・未解決の問い・道具)は
**`llm-wiki` skill**(agent-base。Wiki と原本を触る前に読む)。ここには、その skill に足すことと、skill が「リポジトリで決める」とした項目だけを書く。
食い違ったらここが優先する。操作は skill `ingest`・`query`・`lint`(本体は `.agents/skills/`。agent-base の雛形から写したもので、このリポジトリで拡張してよい。`.claude/skills/` はそこへのリンク)。
道具 `scripts/wiki/` は agent-base から配ったもので、ここでは直さない。このリポジトリの値(台帳の元の置き場・載せない原本など)は `llm-wiki/wiki.config.json`。
ほかに決める項目(原本の読み方・要約ページの章立て・取り込み待ちの置き場 など)は、`llm-wiki` skill「リポジトリで決めること」を見て、要るときに節を足す。

### 何を貯めるか

貯めるのは、**このアプリの判断と保守に効く知識**(2026-11-22 に sc-products の方針を引き継いで決めた)。

- **取得の技術の検証と落とし穴**: yt-dlp・youtubedl-android・Playwright・各サイト(YouTube・X・Vidyard・有料会員サイトなど)で確かめたこと、比べた案と捨てた理由
- **外部の規約と執行の実態**: サイドロード・Android の開発者確認など、このアプリの配り方に効くもの(調べた日を添える)
- **決定に至った経緯**: 検討の記録。決定そのものは `docs/` とこの AGENTS.md に書く

| 置き場 | 何の正か | Wiki との関係 |
|---|---|---|
| `docs/`(要件・UI/UX・環境構築) | 確定した決定と仕様 | **写さず、リンクする。**食い違ったら docs が正で、食い違いは `llm-wiki/backlog/QUESTIONS.md` に起票する |
| `docs/handoff.md` | いまの状況 | 写さない |
| `AGENTS.md` | 規約 | 写さない |
| `llm-wiki/backlog/` | 問いと作業 | Wiki の「未解決の問い」の正本 |
| sc-products | 二層構造と機能境界・商用アプリ(personal-ai)・競合と市場 | ここに置かない。商用の判断に効く形で書くものはあちら |
| fire | リポジトリをまたぐ知見(動画の取得の手順の一般論など)と個人の内容 | ここに置かない |
| Works | ステータス・期日(PDR) | 写さない |

### 原本

**テキストを `llm-wiki/raw/` に置く。台帳(manifest)は使わない。**

- 置くもの: 調べたことの記録、実機で見た画面の書き起こし、本人のメモ、Web の一次情報の抜き書き、このリポジトリのセッションの整理記録(`session-digest`)。`YYYY-MM-DD-内容.md` で置く。このリポジトリは private で、差分で読める
- 台帳を使わない理由: このリポジトリの原本を置く Google ドライブのフォルダを持っていない。ファイルの原本を取り込むことになったら、置き場を本人と決め、`llm-wiki/wiki.config.json` の `manifest` と台帳を足して、この節を直す

### 書かないもの(`llm-wiki` skill に足す)

- 署名の鍵(keystore)と `.env` の値、ログインの Cookie・パスワード(Vidyard のパスワードも)
- 画面写しなどに写り込んだ個人の連絡先。原本に置く前に `[伏せた]` にする
- **このアプリで取得した物(ダウンロードした動画・字幕・文字起こし)の中身**。取得物は私的利用に限り、第三者と共有しない(上の「位置づけと公開ルール」)

**Wiki の中身を外へ出してよい経路は、相互レビュー(`cross-review`。追跡下のファイルが、本人が名指ししたレビュー者の送り先へ渡る)だけ。**発信の記事などへ写すときは本人に確かめてから。

### コミット

Wiki を書き換えたら `node scripts/wiki/lint.mjs` をエラー 0 にしてからコミットする。
`main` へ直接 push する(上の「git運用」。始める前に `git pull --rebase`。add は書いたパスだけ)。件名は `wiki: <操作> <題>`(操作は ingest・query・lint・maintain)。問いや作業を起票・解決したら、その ID も末尾の括弧に入れる。
