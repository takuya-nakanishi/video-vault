# video-vault 開発環境構築手順(2026-08-16)

Android開発が初めての人向けに、**このマシン(Surface / WSL2)の実測値に基づいて**手順を確定したもの。

## 結論: WSL2の中にすべて入れる。Windows側には何も入れない

Android Studio・Android SDK(Software Development Kit、ソフトウェア開発キット)・
JDK(Java Development Kit、Java開発キット)を**すべてWSL2(Ubuntu)側**に入れ、
Android StudioはWSLg経由でGUIを表示する。実機はUSBではなく**Wi-Fi(ワイヤレスデバッグ)**で繋ぐ。
エミュレータは使わない。

### なぜこの構成か(実測に基づく)

このマシンの実測値:

- WSL 2.6.1.0 / WSLg 1.0.66 / 8 vCPU / 23GB RAM / 空き 938GB
- `.wslconfig` で **`networkingMode=mirrored` が既に有効**。WSLが実LAN IP `192.168.10.101/24` を直接持っている
- `/dev/kvm` が存在(ネスト仮想化が有効)

判断の理由:

1. **リポジトリもClaude CodeもWSL側にある。** ここを動かすと、Claude Codeのファイル読み書きが
   `/mnt/c/` 越しになる。Microsoftが公式に非推奨とする構成で、Gradleビルドもgit操作も遅くなる
2. **Claude Codeが自分で `./gradlew` や `adb` を叩けることが必要。** SDKがWindows側にしかないと
   `.exe` ラッパー経由になり壊れやすい
3. **`networkingMode=mirrored` が最大の難所を消している。** WSL2でAndroid開発する際の定番の詰まりどころは
   「実機がWSLから見えない」ことだった。adbのデバイス自動発見はmDNS(マルチキャストDNS)に依存しており、
   既定のNATモードではマルチキャストがWSLへ届かない。mirroredモードなら**WSLが実LAN IPを持つので
   スマホと同一サブネットにいる**。usbipd-win(USB転送)が不要になる

### 却下した構成

- **Windows側にAndroid Studioとリポジトリ**: Claude Codeの全ファイルI/Oが `/mnt/c/`(DrvFs)越しになり最も遅い
- **Windows側にAndroid Studio、リポジトリはWSL側**: `\\wsl.localhost\` 越しのアクセスになり、
  大量の小ファイルを扱うGradleビルドとファイル監視が著しく遅い。
  **Composeでコードを書きながらUIを詰める方針と正面から衝突する**(反復速度が命なので)
- **usbipd-winによるUSB接続**: 接続のたびにWindows側の管理者PowerShellで `attach` を打ち直す必要があり、
  Claude Codeから完結できない。Android端末での不安定さも複数報告されている(接続不安定・ブルースクリーン)。
  **Wi-Fiが使えない場面の予備手段**として覚えておけばよい
- **エミュレータ**: Googleは「別のVMの中でVM高速化されたエミュレータを動かすことはできない」と明記。
  加えて `abiFilters = arm64-v8a` の設定では**x86_64エミュレータで yt-dlp が動かない**
  (UIは表示されるがダウンロードだけ失敗するので原因に気づきにくい)

## 手順

### Phase 1: JDKを入れる

```bash
sudo apt update
sudo apt install -y openjdk-21-jdk unzip zip
```

`~/.bashrc` に追記:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
```

Android Studioには JBR(JetBrains Runtime)というJavaが同梱されているので**IDEを動かすだけなら不要**だが、
Claude Codeがコマンドラインで `./gradlew` を叩くため、シェルから使えるJDKが要る。
Android Gradle Pluginの最低要件はJDK 17なので、`openjdk-17-jdk` でも動く。

### Phase 2: Android SDKをコマンドラインで入れる

```bash
mkdir -p ~/android-sdk/cmdline-tools
cd /tmp
curl -O https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip
unzip commandlinetools-linux-15859902_latest.zip
mv cmdline-tools ~/android-sdk/cmdline-tools/latest
```

**`latest` ディレクトリの直下に `bin/` `lib/` が来る構造が必須**(ここを間違えると `sdkmanager` が動かない)。

`~/.bashrc` に追記:

```bash
export ANDROID_HOME=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

反映してパッケージを入れる:

```bash
source ~/.bashrc
sdkmanager --licenses    # すべて y で承諾。これをやらないとビルドが通らない
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

現行プロジェクトが `compileSdk = 35` なので android-35 を入れる。

### Phase 3: Android Studioを入れる

現行安定版は **Android Studio Quail 3(2026.1.3)Patch 1**。

1. https://developer.android.com/studio から **Linux版の `.tar.gz`** をダウンロード
2. 展開して起動:

```bash
sudo tar -xzf android-studio-*-linux.tar.gz -C /opt
/opt/android-studio/bin/studio.sh
```

WSLgがGUIウィンドウを出す。

3. 初回セットアップで **SDK Location を `/home/takuya/android-sdk`** に指定する
   (Phase 2で作ったものを共有させる。別にすると二重管理になる)
4. Settings > Build, Execution, Deployment > Build Tools > Gradle で
   **Gradle JDK を `JAVA_HOME` と同じもの**に揃える
5. 画面にシャドウの残像などの描画の乱れが出たら、Help > Edit Custom VM Options に追記:

```
-Dawt.toolkit.name=WLToolkit
-Dsun.awt.wl.Shadow=false
```

(JetBrains RuntimeのWayland対応に切り替える。既知事象への公式回避策)

### Phase 4: 実機をWi-Fiで繋ぐ

要件は **Android 11(APIレベル30)以上**、端末とPCが同じWi-Fiにいること。

1. 端末: 設定 > デバイス情報 > **ビルド番号を7回タップ**(開発者向けオプションが出る)
2. 設定 > システム > 開発者向けオプション > **ワイヤレスデバッグ**をON。
   「このネットワークで常に許可」にチェックを入れると次回から自動接続される
3. 「ペア設定コードによるデバイスのペア設定」を開く → IPアドレス:ポート と 6桁のコードが出る
4. WSLで(ペアリングは初回のみ):

```bash
adb pair 192.168.10.xx:PORT_A     # 画面に出ている6桁コードを入力
adb connect 192.168.10.xx:PORT_B  # ワイヤレスデバッグ画面のメインのIP:ポート
adb devices                        # device と出れば成功
```

ポートを忘れたら `adb mdns services` で探せる。

### Phase 5: ビルドして実機に入れる

```bash
cd /home/takuya/workspace/sc-products/apps/video-vault
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**AAB(Android App Bundle)は使わない。** あれはPlay Store専用の形式で端末に直接入れられない。
`bundleRelease` ではなく `assembleDebug` を叩く。

## UIを詰めるループ

### Compose Preview — 端末もエミュレータも要らない

`@Preview` を付けた関数は**Android Studioのエディタ内で直接描画される**。
Layoutlib(Androidフレームワークを移植したもの)でIDE内にレンダリングするため、
**WSL2の中で完結し、実機もKVMも関係しない**。Figmaを使わずComposeでUIを確定させる方針では、ここが主戦場になる。

依存関係(`ui-tooling-preview` と `ui-tooling`)は**既にプロジェクトに入っている**。追加作業なし。

3つのモードがある。静的プレビュー(書くと右に即描画)、インタラクティブモード(プレビュー上でタップ・入力・
アニメーションを試せる)、Run Preview(プレビューを1画面として実機へ流し込む)。

**制限**: プレビュー内では**ネットワークもファイルもアクセスできない**。
video-vaultはダウンロードアプリなので、**UI層はダミーデータを流し込める形に分離しておく**こと
(画面の状態をパラメータで受け取る設計にする)。これは後から直すと大工事になるので最初からそうする。

### Live Edit — 実機でも動く

コードを保存すると**実機の画面が即座に更新される**。エミュレータ限定ではない。
要件はAPIレベル30以上の実機またはエミュレータで、ワイヤレスデバッグの要件と同じなので追加負担はない。

Settings > Editor > Live Edit で有効化。初心者には **Manual on Save**(Ctrl+Sで適用)が分かりやすい。

**反映されるもの**: コンポーザブル関数の本体、Modifierの変更、色・余白・文字列などの値、アニメーション調整。

**フルリビルドが要るもの**: 関数シグネチャの変更、関数の追加・削除、クラス階層の変更。
これらをやったらRunボタンを押し直す。

## バージョン方針: 今は上げない

現行の `gradle/libs.versions.toml`(AGP 8.7.3 / Kotlin 2.1.0 / Compose BOM 2024.12.01)は
最新から見ると古いが、**Android Studio Quail 3 でそのままビルドできる**。
Googleの互換ポリシーは「各Android Studioは過去3年以内にリリースされたAGPをサポートする」。

**まず動かすことを優先し、バージョンアップは後回しにする。** 理由は、Gradle・AGP・Kotlin・Compose Compilerの
4つに互換制約があり、**どれか1つだけ上げるとビルドが壊れる**ため。上げるときは4点セットで、
AGPのリリースノートの互換表を見ながら行う。

参考(2026-08-16時点の最新): AGP 9.3.x(Gradle 9.5.0以上 + JDK 17を要求)、Kotlin 2.4.10、
Compose UI 1.12.0 / Material3 1.4.0。youtubedl-android は 0.18.1(現行 0.17.2)。

## 踏みやすい落とし穴

1. **`sdkmanager --licenses` を忘れる** — ライセンス未承諾だとビルドが通らない。最初にやる
2. **`useLegacyPackaging = true` を消す** — youtubedl-androidが同梱するPython/yt-dlpのネイティブライブラリを
   実行時に取り出すために必要。消すと**ビルドは通るのに実行時だけ失敗する**
3. **エミュレータで動かない** — `abiFilters = arm64-v8a` のため、x86_64エミュレータでは yt-dlp のバイナリが無い。
   UIは動くのでダウンロードだけ失敗し、原因に気づきにくい
4. **debug版とrelease版が別アプリとして共存する** — `applicationIdSuffix = ".debug"` が付いているため。
   「更新したのに反映されない」と感じたら、2つ入っている可能性を疑う
5. **バージョンを1つだけ上げる** — 上記のとおり4点セットで動かす
6. **Android StudioをWindows側に入れる** — 上記のとおり構成が歪む

## 参考: 現時点の未確認事項

- Compose BOM の2026年8月時点の最新バージョン番号(個別ライブラリの安定版は確認できたがBOMの日付版が未確定)。
  Android Studio の Gradle sync 時の更新提案で確認する
- youtubedl-android 0.17.2 → 0.18.1 の変更内容と非互換の有無。GitHubのReleasesで差分を見てから上げる
