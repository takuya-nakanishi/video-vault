# video-vault 開発環境構築手順(2026-08-16・実行済み)

Android開発が初めての人向けに、**このマシン(Surface / WSL2)で実際に実行して検証した**手順。

## ✅ 完了状態

**アプリがエミュレータ上で動作するところまで確認済み。**

| 項目 | 状態 |
|---|---|
| JDK 21(OpenJDK 21.0.11) | 導入済み |
| Android SDK 一式 | 導入済み(`~/android-sdk`) |
| `./gradlew assembleDebug` | **成功**(2分16秒 / APK 42MB) |
| エミュレータ(AVD `medium_phone`・API 36) | **起動確認**(ヘッドレス・約80秒でboot完了) |
| アプリのインストールと起動 | **成功・クラッシュなし** |
| 日本語表示・テキスト入力・ボタン活性制御 | **すべて正常** |

2026-08-17に追加で確認したもの(いずれもエミュレータ上):

| 項目 | 状態 |
|---|---|
| 単一入力欄の判定(動画サイト/対象外サイト/キーワード) | **正常**(候補が入力に応じて並び替わる) |
| 内蔵ブラウザ(WebView)でのページ表示 | **正常**(Google検索が表示され下部にDLボタン) |
| yt-dlpの起動とエラー表示 | **正常**(存在しないIDでエラー原文を表示・クラッシュなし) |
| 判定ロジックの単体テスト12件 | **成功**(`./gradlew testDebugUnitTest`) |

2026-08-19: **実機接続に成功**(Pixel 10 Pro XL / Android 17 / 別LANからTailscale経由)。
アプリのインストール・起動・UI表示まで確認。ネイティブライブラリのELFロードも正常。
残る未検証は**日本語IMEの挙動(「かれの」の未確定文字列)のみ**(人間がGboardで打つ必要がある)。

## 使うツール(公式推奨のみ)

**`sdkmanager` は非推奨のため使わない。`android` CLI を使う。**

`sdkmanager` は実行時に自ら
`The SDK Manager CLI tool (sdkmanager) is deprecated. Use Android CLI instead.` と警告を出す。
本環境からは削除済み(`~/.android-deprecated-backup/` へ退避)。
全リポジトリ共通ルールは `~/.claude/CLAUDE.md` を参照。

| 用途 | 使うもの | 使わないもの |
|---|---|---|
| SDKパッケージ管理 | `android sdk install / list / update / remove` | ~~`sdkmanager`~~(非推奨・削除済み) |
| AVD作成・一覧・削除 | `android emulator create / list / remove` | `avdmanager`(非推奨表示はないが実質置換) |
| エミュレータ起動 | **`emulator` バイナリ + `-no-window`**(下記の理由により) | — |
| アプリのインストール | `android install --apks=...` | — |
| 画面キャプチャ | `android screen capture -o ...` | — |

`android` CLI のバージョンは 1.0.15985488。`cmdline-tools` に同梱されており、
初回実行時に本体を自動ダウンロードする。SDK管理だけでなく
`create` / `run` / `install` / `emulator` / `screen` / `layout` / `docs` を統合した、
エージェント運用を前提とした公式CLI。

## 結論: WSL2の中にすべて入れる。Windows側には何も入れない

### なぜこの構成か(実測に基づく)

このマシンの実測値:

- WSL 2.6.1.0 / WSLg 1.0.66 / 8 vCPU / 23GB RAM / 空き 938GB
- `.wslconfig` で **`networkingMode=mirrored` が有効**。WSLが実LAN IP `192.168.10.101/24` を直接持つ
- `/dev/kvm` が存在(ネスト仮想化が有効)

判断の理由:

1. **リポジトリもClaude CodeもWSL側にある。** Windows側へ動かすとファイル読み書きが `/mnt/c/` 越しになる
2. **Claude Codeが自分で `./gradlew` や `android` を叩けることが必要**
3. **`networkingMode=mirrored` が最大の難所を消している。** adbのデバイス自動発見はmDNS
   (マルチキャストDNS)に依存し、既定のNATモードではWSLへ届かない。mirroredなら実LAN IPを持つので
   スマホと同一サブネットにいる。usbipd-win(USB転送)が不要になる
4. **エミュレータも動いた。** Googleは「別のVMの中では動かせない」としているが、
   ネスト仮想化が有効で `/dev/kvm` があるため実際には動作した

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

Android Studioには JBR(JetBrains Runtime)が同梱されるのでIDEを動かすだけなら不要だが、
コマンドラインで `./gradlew` を叩くため必要。Android Gradle Pluginの最低要件はJDK 17。

### Phase 2: Android SDKを入れる

```bash
mkdir -p ~/android-sdk/cmdline-tools
cd /tmp
curl -O https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip
unzip commandlinetools-linux-15859902_latest.zip
mv cmdline-tools ~/android-sdk/cmdline-tools/latest
```

**`latest` の直下に `bin/` `lib/` が来る構造が必須。**

`~/.bashrc` に追記:

```bash
export ANDROID_HOME=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

**非推奨の `sdkmanager` を削除**してから、公式CLIでパッケージを入れる:

```bash
source ~/.bashrc
mkdir -p ~/.android-deprecated-backup
mv $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager ~/.android-deprecated-backup/

android sdk install platform-tools platforms/android-35 build-tools/35.0.0 emulator
android sdk list        # 導入済みパッケージの確認
```

`android sdk` はライセンス承諾を対話なしで処理するため、`sdkmanager --licenses` に相当する手順は不要。

### Phase 3: エミュレータに必要な共有ライブラリを入れる

WSL2の素のUbuntuには音声ライブラリが無く、**これが無いとエミュレータが起動直後に落ちる**
(`libpulse.so.0: cannot open shared object file`)。

```bash
sudo apt install -y libpulse0 libnss3 libxcursor1 libxcomposite1 libasound2t64
```

### Phase 4: KVMへのアクセス権を付ける

```bash
sudo usermod -aG kvm $USER
```

グループ反映には再ログインが必要だが、**`sg kvm -c "コマンド"` を使えば即座に反映**される
(WSLを再起動せずに済む)。

### Phase 5: AVDを作って起動する

```bash
android emulator create medium_phone     # プロファイル一覧は --list-profiles
android emulator list
```

作成時に適切なシステムイメージ(android-36 google_apis_playstore x86_64)が自動で選ばれ、
必要なら自動ダウンロードされる。

**起動はエミュレータ本体を直接呼ぶ:**

```bash
sg kvm -c "$ANDROID_HOME/emulator/emulator @medium_phone \
  -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect"
```

`android emulator start` を使わない理由: **ウィンドウ表示を前提としており、`-no-window` に相当する
オプションが無い**。非対話シェルには `DISPLAY` / `WAYLAND_DISPLAY` が渡らないため、
Qtの表示プラグイン初期化に失敗して起動できない(実測)。
`emulator` バイナリ自体は非推奨ではなく公式ツールなので、これはルール違反にあたらない。
GUI環境で作業する場合は `android emulator start medium_phone` が使える。

boot完了の確認:

```bash
adb wait-for-device
adb shell getprop sys.boot_completed   # 1 になれば完了(実測で約80秒)
```

### Phase 6: ビルドしてインストールする

```bash
cd ~/workspace/video-vault
echo "sdk.dir=$HOME/android-sdk" > local.properties
./gradlew assembleDebug
android install --apks=app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.saneiclover.videovault.debug/com.saneiclover.videovault.MainActivity
android screen capture -o /tmp/screen.png    # 画面確認
```

**AAB(Android App Bundle)は使わない。** Play Store専用形式で端末に直接入れられない。

### Phase 7(未了): 実機をWi-Fiで繋ぐ

要件は **Android 11(APIレベル30)以上**、端末とPCが同じWi-Fiにいること。
手順は下の「動作確認の手順(エミュレータ / 実機)」にまとめてある。

## UIを詰めるループ

### Compose Preview — 端末もエミュレータも要らない

`@Preview` を付けた関数はAndroid Studioのエディタ内で直接描画される。
Layoutlibを使ってIDE内にレンダリングするため、**WSL2の中で完結する**。
依存関係(`ui-tooling-preview` と `ui-tooling`)は既にプロジェクトに入っている。

**制限**: プレビュー内では**ネットワークもファイルもアクセスできない**。
ダウンロードアプリなので、**UI層はダミーデータを流し込める形に最初から分離しておく**こと。
後から直すと大工事になる。

### Live Edit — 実機でも動く

コードを保存すると実機の画面が即座に更新される。要件はAPIレベル30以上の実機またはエミュレータで、
ワイヤレスデバッグの要件と同じ。Settings > Editor > Live Edit で有効化。
初心者には **Manual on Save**(Ctrl+Sで適用)が分かりやすい。

**フルリビルドが要るもの**: 関数シグネチャの変更、関数の追加・削除、クラス階層の変更。

## 動作確認の手順(エミュレータ / 実機)

### 運用方針(2026-08-18決定)

**人間の動作確認は実機(Pixel 10 Pro)で行う。PC上での対話的エミュレーションはしない。**

- コーディングの大部分はエージェント(Claude/Antigravity)が担うため、人間がPC画面でアプリを
  操作する頻度は低い。作ってもらったアプリを実機で都度動かせば足りる
- これによりWindows側へのSDK導入(ネスト仮想化を避ける案)は**不要になった**。
  Windows側の空きメモリ8GBで足りるかの検証も不要
- WSL内のヘッドレスエミュレータは**エージェントの自動確認用として維持**する。
  遅さは無人運転では実害にならない
- ウィンドウ付きエミュレータは封印はしないが、ネスト仮想化+ソフトウェア描画+WSLg転送の
  三重の遅さがあり実用に向かない(2026-08-18実測)

ビルド→実機インストール→起動は `scripts/deploy-device.sh` に1コマンド化してある。

### どちらで何を確かめるか

| 確かめたいこと | エミュレータ | 実機(Pixel 10 Pro) |
|---|---|---|
| 画面の見た目・レイアウト崩れ | ○ | ○ |
| 入力に応じた候補の出し分け | ○ | ○ |
| 内蔵ブラウザ・画面遷移 | ○ | ○ |
| yt-dlpの起動とエラー表示 | ○(x86_64バイナリ同梱) | ○ |
| ForegroundServiceでの継続(`am kill` を撃っても生きるか) | ○(煙試験シナリオ19) | ○ |
| 通知が出ること・進捗が載ること | ○(`cmd statusbar expand-notifications` で判定) | ○ |
| **日本語IMEの未確定文字列** | **×** | **○(ここでしか判定できない)** |
| YouTube/Xアプリからの共有シート | ×(アプリが入っていない) | ○ |
| 実回線でのダウンロード・省電力による中断 | × | ○ |
| 通知の小アイコンの見た目・テーマ適用 | ×(潰れて見えないかは実機で) | ○ |
| **動画を再生したままダウンロードして再生が止まらないこと** | ×(エミュレータの再生が不安定) | **○** |

エミュレータにも日本語キーボードは追加できる(Play Store版イメージなのでGboardが入っている)が、
**IMEの挙動はGboardのバージョンと端末で変わる**ため、判定は実機で行う。

### エミュレータ

AVDは `medium_phone`(API 36 / x86_64)が1つ。**同じAVDの二重起動は弾かれる**ので、
起動前に `adb devices` で既に動いていないか見る。

#### インストールが `Failed to allocate ... because only 0 allocatable` で落ちたら

**エミュレータの `/data` が満杯**。`android install` は DeltaInstall の中間APKを
`/data/local/tmp/patched*.apk` に残し、**消さない**。このアプリのAPKは python・ffmpeg の
ネイティブバイナリを含んで120MBあるため、煙試験を何度か回すとすぐ数百MB積み上がる
(2026-08-25に500MB溜まって実際に落ちた)。

```bash
adb shell df /data                                              # 使用率を見る
adb shell "rm -f /data/local/tmp/patched*.apk /data/local/tmp/patch.seq"
```

`dalvik-cache` と `deployer.jar` は消さない(次回また置かれる)。
**エラーが出るまで気づけない**ので、煙試験が「インストール失敗」で落ちたらまずこれを疑う。

見ながら操作する(自分のターミナルから。WSLgでウィンドウが出る):

```bash
android emulator start medium_phone
```

エージェントに操作させる・画面が要らない(非対話シェルではこちらしか動かない):

```bash
sg kvm -c "$ANDROID_HOME/emulator/emulator @medium_phone \
  -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect" &
adb wait-for-device && adb shell getprop sys.boot_completed   # 1 になれば完了(約80秒)
```

止める:

```bash
android emulator stop medium_phone     # または adb -s emulator-5554 emu kill
```

入れて動かす・画面を見る:

```bash
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ANDROID_HOME=$HOME/android-sdk ./gradlew assembleDebug
android install --apks=app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.saneiclover.videovault.debug/com.saneiclover.videovault.MainActivity
android screen capture -o /tmp/screen.png       # -a を付けるとUI要素に枠とラベルが載る
adb shell input tap X Y                          # 座標はキャプチャから読む
adb shell input text 'youtu.be/abc123'           # 空白は %s、? は \? でエスケープ
adb logcat -d -t 200 | grep -iE "videovault|AndroidRuntime"
```

### 実機(Pixel 10 Pro)をワイヤレスで繋ぐ

USB転送(usbipd-win)は要らない。`.wslconfig` の `networkingMode=mirrored` により
WSLが実LAN IP(`192.168.10.101`)を直接持つため、端末と同じサブネットにいる。
**端末とPCが同じWi-Fiにいること**が唯一の前提。

端末側(初回のみ):

1. 設定 > デバイス情報 > **ビルド番号を7回タップ**
2. 設定 > システム > 開発者向けオプション > **ワイヤレスデバッグ**をON。
   「このネットワークで常に許可」にチェック
3. **「ペア設定コードによるデバイスのペア設定」**を開く → `IP:ポート` と6桁コードが出る

WSL側:

```bash
adb pair 192.168.10.xx:PORT_A      # 3.の画面のIP:ポート。6桁コードを入力。初回のみ
adb connect 192.168.10.xx:PORT_B   # ワイヤレスデバッグ画面のメインのIP:ポート
adb devices -l
```

**ペア設定用のポートと接続用のポートは別**。接続用ポートは端末の再起動やWi-Fi切替で変わるので、
そのたびに `adb connect` からやり直す(`adb pair` は初回だけ)。

### 2台繋がっているときは必ずデバイスを指定する

エミュレータと実機が同時に見えると、コマンドが「どちらか」に飛んで混乱する。

```bash
export ANDROID_SERIAL=192.168.10.xx:PORT_B      # adb系はこれで固定される
android install --device=$ANDROID_SERIAL --apks=app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.saneiclover.videovault.debug/com.saneiclover.videovault.MainActivity
```

`android` CLI は `ANDROID_SERIAL` を見ないので `--device` を明示する
(`install` も `screen capture` も同じオプションを持つ)。
迷うくらいなら**エミュレータを止めてから実機を繋ぐ**のが確実。

### 実機で最初に見ること(この順で)

1. **日本語IME**。入力欄に「かれの」と打ち、未確定のまま変換候補が出るか。
   勝手に確定するなら `TextField` の技術選定から見直す(`ui-ux.md`)
2. **共有シート**。YouTubeアプリで動画を開く → 共有 → video-vault → 候補が並んだ状態で開くか
3. **実ダウンロード**。公開動画を1本(私的利用限定・第三者共有不可)
4. **保存先の確認**。アプリ専用領域だが `adb shell` からは覗ける:
   ```bash
   adb shell ls -l /sdcard/Android/data/com.saneiclover.videovault.debug/files/downloads/
   adb pull /sdcard/Android/data/com.saneiclover.videovault.debug/files/downloads/ /tmp/
   ```
5. **画面を閉じたときの中断**。既知の制約(ForegroundService未実装)を実際に踏んで確認する

### 別LANから実機を使う(リモート開発時)

Surface(この開発機)にremote-controlで接続していて、**実機とSurfaceが同じWi-Fiにいない**場合。
素のワイヤレスデバッグは同一LAN前提だが、**両者ともTailscaleに登録済み**なので経路は作れる。

| 機器 | tailnet上の名前 | IP |
|---|---|---|
| Surface(この開発機) | `sc02-surface` | `100.126.119.49` |
| Pixel 10 Pro | `pixel-10-pro-xl` | `100.91.182.103` |

手順:

1. Pixel側で**Tailscaleアプリを開いて接続をON**にする(普段は切れている)
2. Pixel側でワイヤレスデバッグをON → ペア設定コードの画面を開く
3. WSLから、**画面に出るwlanのIPではなくPixelのTailscale IP**+画面のポートで叩く:

```bash
adb pair 100.91.182.103:PORT_A     # 6桁コード入力(初回のみ)
adb connect 100.91.182.103:PORT_B  # ワイヤレスデバッグ画面のメインのポート
```

別LANからは、叩く前に宛先限定のMTUクランプを張る(下記「ハマった点」1。WSLを再起動すると消えるので、そのたびに張り直す。同一LANには影響しない):

```bash
sudo ip route replace 100.91.182.103/32 dev eth0 mtu 1000
```

**ハマった点(2026-08-18実測)**:

1. **経路MTUが小さく、adb pair/connectが無言でハングする。** TCP接続自体は開通するのに
   TLSハンドシェイクの大パケット(実測で1030〜1130Bの間に境界)だけが黙って落ちる。
   Windows側から直接pingしても同じなのでWSLの問題ではなく、Tailscale経路自体の実効MTU。
   対処は宛先限定のMTUクランプ(スクリプトが自動で行う):
   `sudo ip route replace 100.91.182.103/32 dev eth0 mtu 1000`
   **この設定はWSL再起動で消える**ため、接続はスクリプト経由で行うこと
2. **ペアリングコードはダイアログを閉じると失効する**(`protocol fault` になる)。
   コードとポートを控えたら、**ペア設定のダイアログは開いたままにして**すぐ叩く
3. ペアリング用の待受がVPN側にも張られるかは端末依存という世間の報告があるが、
   Pixel 10 Proはワイヤレスデバッグ画面自体がTailscale IPを表示しており、VPN側でも待ち受けていた

それでも初回ペアリングが通らない場合の確実な迂回: **同一LANにいるときに一度だけペアリング**
しておけば(鍵交換は初回のみ)、以後の `adb connect` はTailscale越しで通る。

**adbなしの応急手段**: IME確認などアプリを触るだけなら、debug APKをprivateリポジトリの
GitHub Releaseに置き、Pixelのブラウザでダウンロード→サイドロードでも足りる
(`gh release create` を使う。ログ取得・自動操作はできない)。

### 繋がらないとき

- 端末とWSLが同じサブネットか(`ip -4 addr` の eth1 が `192.168.10.101`、端末も `192.168.10.x`)
- ワイヤレスデバッグの画面を**開いたままにする**(閉じるとポートが変わることがある)
- VPN(Tailscale等)が経路を奪っていないか。`adb connect` は端末のLAN IPへ直接出る必要がある
- それでも駄目なら `adb kill-server && adb start-server` からやり直す

## バージョン方針: 今は上げない

現行の `libs.versions.toml`(AGP 8.7.3 / Kotlin 2.1.0 / Compose BOM 2024.12.01)は
最新から見れば古いが、**実際にビルドが通ることを確認済み**。
Gradle・AGP・Kotlin・Compose Compilerには互換制約があり、**どれか1つだけ上げると壊れる**。
上げるときは4点セットで、AGPのリリースノートの互換表を見ながら行う。

参考(2026-08-16時点の最新): AGP 9.3.x(Gradle 9.5.0以上 + JDK 17を要求)、Kotlin 2.4.10、
Compose UI 1.12.0 / Material3 1.4.0、youtubedl-android 0.18.1(現行 0.17.2)。

## 踏みやすい落とし穴(実際に踏んだものを含む)

1. **`libpulse0` が無いとエミュレータが起動直後に落ちる** — WSL2の素のUbuntuには入っていない。実際に踏んだ
2. **`android emulator start` は非対話シェルで起動できない** — ウィンドウ表示前提。実際に踏んだ
3. **`useLegacyPackaging = true` を消さない** — youtubedl-androidのネイティブライブラリ展開に必要。
   消すと**ビルドは通るのに実行時だけ失敗する**
4. **エミュレータ(x86_64)でもyt-dlpは動く**(2026-08-17に訂正) — 当初「動かない」と書いていたが誤り。
   youtubedl-androidはpython・ffmpegのx86_64バイナリも同梱しており(APK内の `lib/x86_64/` で確認)、
   エミュレータ上でyt-dlpが起動してURL解析まで行い、エラー原文も返ってくる。
   ただし**出荷先は実機arm64**なので、実際の取得とffmpegのマージは実機で最終確認すること
5. **debug版とrelease版が別アプリとして共存する** — `applicationIdSuffix = ".debug"` のため
6. **バージョンを1つだけ上げる** — 4点セットで動かす
7. **ウィンドウ起動時に「Emulator Running in Nested Virtualization」の警告が出る** —
   WSL2自体がVMなので、その中のエミュレータは入れ子の仮想化になる。Googleは非推奨としているが、
   **本環境では実際に動く**(ネスト仮想化が有効で `/dev/kvm` がある)。免責の告知であって故障の予兆ではない。
   OKで進んでよい。実害は起動と描画が実機より遅いことだけ
8. **Pixel 10で「16 KBアライメントではありません」の警告ダイアログが出る**(2026-08-19実測) —
   youtubedl-androidのネイティブバイナリ(libpython/libffmpeg/libffprobe)が4KBアライメントのため、
   debuggableアプリに対する互換性チェックに引っかかる。**ただしPixel 10 Pro XL(Android 17)の
   実測ページサイズは4096(4KB)で、今日の実害はない**(ELFロード成功を確認済み)。
   将来端末が16KBページのカーネルに移行した時点で本当に動かなくなるので、
   youtubedl-androidのバージョンを上げる際は16KB対応(リリースノート)を必ず確認すること。
   `.zip.so`(データアーカイブ)が「不明なエラー」と出るのはチェッカーの誤検知
9. **yt-dlpはYouTube処理に外部JavaScriptランタイムを要求する**(2026-08-19実測) —
   無いと `No supported JavaScript runtime could be found` の警告とともに403 Forbiddenで落ちる。
   既定のDenoはAndroidに無い。**youtubedl-android 0.18.1が同梱するQuickJS(`libqjs.so`)が解**で、
   0.17.2には入っていない。ライブラリが `--js-runtimes quickjs:<パス>` を内部で付与するため、
   **自分で同名オプションを渡すと自動付与を壊して403に戻る**(実際に踏んだ)
10. **yt-dlpの安定版は数週間遅れる。nightlyを使う** — QuickJS導入後も403が残り、原因は
   yt-dlp安定版のバグだった(yt-dlp #17456。メンテナが「nightlyで修正済み」と回答)。
   `updateYoutubeDL(context, UpdateChannel._NIGHTLY)` で更新している。
   自分専用でPlay配信もしないため、鮮度を安定性より優先してよい
11. **煙試験の合格判定は緩いと嘘をつく**(実際に踏んだ) — 「downloadsに何かファイルができたら成功」に
   していたところ、69バイトの `.ytdl`(yt-dlpの内部レジューム情報)を成果物と誤認して**誤合格**した。
   `.part` だけ除外しても不足で、**拡張子とサイズ(100KB超の動画ファイル)まで見る**こと
12. **検索結果を信じすぎない** — sdkmanagerの代替を検索したところ、検索エンジンは2017年の
   旧`android`コマンド廃止の話を返し、現行の非推奨と正反対の結論を提示した。
   **一次資料(ツール自身の出力・公式ドキュメント)で確認すること**
