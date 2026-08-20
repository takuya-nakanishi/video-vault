# video-vault 引き継ぎ(2026-08-20時点)

**新しいセッションはこのファイルを最初に読む。** 現在地・次にやること・つまずきどころが揃っている。
役割分担の原則は「規約は各CLAUDE.md、手順は`dev-setup.md`、**いま何をすべきかはこのファイル**」。
状況が変わったらこのファイルを更新すること(古い引き継ぎは害になる)。

## 現在地: 動く。ただし人にしか確認できない検証が1つ残っている

エミュレータ上で**自動シナリオテスト14件すべて合格**。YouTubeからの実ダウンロードまで通っている。
実機(Pixel 10 Pro XL / Android 17)へのインストール・起動も確認済み。

| 領域 | 状態 |
|---|---|
| 単一入力欄(オムニボックス)の判定・候補提示 | 動作確認済み |
| 対象外サイト(DRM)の明示 | 動作確認済み |
| 内蔵ブラウザ(WebView)+ Cookie経由のDL導線 | 画面遷移まで確認。**会員制サイトでの実地検証は未了** |
| YouTubeからの実ダウンロード | **動作確認済み**(エミュレータで `Me at the zoo.webm` を取得) |
| 判定ロジックの単体テスト12件 | 合格 |
| **日本語IMEの挙動** | **未検証。エージェントには検証できない(下記)** |

## 次のアクション(優先順)

### 1. 【最優先・人間の操作が要る】日本語IMEの検証

入力欄に **「かれの」** と打ち、**未確定文字列が勝手に確定しないこと**・変換候補が正しく出ることを実機で見る。

- **なぜエージェントにできないか**: `adb shell input text` はIMEを経由せず直接文字を挿入するため、
  未確定状態そのものが再現しない。エミュレータの英語キーボードでも同様
- **なぜ重要か**: 商用版 `apps/personal-ai` の差別化の中核(日本語ネイティブ)を支える技術的前提。
  競合Recallはここが壊れていた。**破綻するならUIの技術選定(Compose `TextField`)から見直す**
- 破綻した場合の次手: `BasicTextField` か、`TextFieldValue` を使った独自の入力接続を検討

### 2. 実機へ最新ビルドを配る(ポート番号をもらうところから)

実機は現在**未接続**。ペアリング済みなので**6桁コードは不要**、ポート番号だけで繋がる。

1. 人間に依頼: Pixelで 設定 > システム > 開発者向けオプション > ワイヤレスデバッグ をON、
   **「IPアドレスとポート」のポート番号**を聞く(端末再起動やWi-Fi切替で変わる)
2. `scripts/connect-pixel.sh <ポート>` → `scripts/deploy-device.sh`

Tailscale経由(別LAN)でも繋がる。**Pixel側でTailscaleがONである必要がある**。

### 3. 共有シートの実機確認

YouTubeアプリ → 共有 → video-vault → 候補が並んだ状態で開くか。エミュレータにはYouTubeアプリが無く確認できない。

### 4. 会員制サイト(GFS)のDRM有無調査

**アプリを触る前にPC側のyt-dlpで検証する**。DRM(Widevine)なら対象外として
`app/src/main/assets/site_patterns.json` に `downloadable: false` で登録して終わり。
通る場合のみ、内蔵ブラウザのCookie導線で実地検証する。

### 5. 次版の機能(優先度はこの順)

- ForegroundServiceへの移行(いまは**画面を閉じると中断**され、1件ずつしか流せない)
- MediaStore経由で公共 `Download/` へ書き出す(いまはアプリ専用領域で他アプリから見えにくい)
- ダウンロード詳細画面・設定画面(再生・共有・再試行・保存先変更)

## 作業の始め方

```bash
cd ~/workspace/sc-products/apps/video-vault

# エミュレータ(自動テスト用。起動していなければ)
adb devices | grep emulator || \
  sg kvm -c "$ANDROID_HOME/emulator/emulator @medium_phone -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect" &

# 変更したら必ず: 実機へ配る前にエミュレータで通す
./scripts/smoke-test.sh                  # 全14シナリオ(数分かかる)
./scripts/smoke-test.sh --skip-download  # ネットワークを使わない範囲だけ(速い)

# 実機へ
./scripts/connect-pixel.sh <ポート> && ./scripts/deploy-device.sh
```

- **非対話シェルでは `~/.bashrc` が読まれない**。`JAVA_HOME` と `ANDROID_HOME` を明示的に渡すか、
  スクリプト経由で実行する(スクリプトは自分で設定している)
- 煙試験を長時間の前景で待たない。バックグラウンドで走らせてログを監視する
  (`nohup ./scripts/smoke-test.sh > /tmp/smoke.log 2>&1 &`)。**`cd` を忘れて空振りしやすい**

## 環境の事実(2026-08-20時点)

| 項目 | 値 |
|---|---|
| エミュレータAVD | `medium_phone`(API 36 / x86_64)。**同じAVDの二重起動は弾かれる** |
| 実機 | Pixel 10 Pro XL / Android 17 / arm64-v8a。Tailscale名 `pixel-10-pro-xl` = `100.91.182.103` |
| 開発機 | Surface(WSL2)。Tailscale名 `sc02-surface` = `100.126.119.49`。LAN IP `192.168.10.101` |
| kvmグループ | 未反映。**`sg kvm -c` で包む**(`wsl --shutdown` すれば恒久的に解消するがセッションが切れる) |
| 依存 | youtubedl-android **0.18.1**(QuickJS同梱)。AGP 8.7.3 / Kotlin 2.1.0 / Compose BOM 2024.12.01 |

## つまずきどころ(すべて実際に踏んだ)

詳細は `docs/dev-setup.md`「踏みやすい落とし穴」と `CLAUDE.md`「yt-dlp運用の要点」。要点だけ:

1. **YouTubeのDLが403で落ちたら、原因は3層のどれか**。エラー文に `JavaScript runtime` が
   含まれるかで切り分ける。`--js-runtimes` を自分で渡してはいけない(ライブラリの自動付与を壊す)
2. **煙試験の合格判定を緩めない**。`.ytdl`(69バイトのレジューム情報)を成果物と誤認して
   偽の合格を出したことがある
3. **実機のペアリングコードはダイアログを閉じると即失効**する。コードをもらったら即座に叩く
4. **別LANからのadbはMTUで固まる**。TCPは開通するのにTLSハンドシェイクだけ落ちる。
   `scripts/connect-pixel.sh` が宛先限定のMTUクランプを毎回張る(WSL再起動で消えるため)
5. **エミュレータのウィンドウ表示は実用外**(ネスト仮想化+ソフトウェア描画+WSLg転送で遅い)。
   人間の動作確認は実機で行うと決めてある

## 参照先

- 規約: `apps/video-vault/CLAUDE.md`(スタック・yt-dlp運用・動作確認)、モノレポルートの `CLAUDE.md`
- 仕様: `docs/requirements.md`(要件)、`docs/ui-ux.md`(UI/UX仕様と実装状況・仕様からの逸脱)
- 手順: `docs/dev-setup.md`(環境構築・エミュレータ/実機の動作確認・落とし穴)
- ステータス・期日の正: Notion PDR No.351 https://app.notion.com/p/3befc260f3c1804f9954d9769f385a94
  (2026-08-19に最新化済み。**MCPコネクタが未認証だと読み書きできない**)
- 設計決定の記録の正: llm-wiki側 `vault/raw/`
