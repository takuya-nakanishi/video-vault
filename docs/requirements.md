# video-vault 要件(たたき台 2026-08-12)

自分のインプットになる動画(YouTube・X・GFS等)を随時ダウンロードし、
Gemini等に分析させてllm-wikiへ取り込む導線の入口となるAndroidアプリ。

## 目的

1. 広告・オフライン制約なしで自分のインプット動画を視聴できる状態を作る
2. ダウンロード→文字起こし/分析→llm-wiki ingestのパイプラインの入口になる
3. Androidアプリ開発の経験値・発信ネタを得る(公開するのはパイプライン設計と汎用部分のみ。CLAUDE.md公開ルール参照)

## 対象サイト(優先度は未決)

| サイト | 取得手段の見込み | 備考 |
|---|---|---|
| YouTube | yt-dlp(実績: llm-wikiの字幕取得で使用中) | 私的利用限定 |
| X | yt-dlp対応済み | 同上 |
| GFS(株式投資専門サイト) | 要調査。会員Cookie渡しでyt-dlpが通るか、DRMの有無次第 | 有料会員コンテンツ。私的利用限定・共有不可 |

## 技術選定(Claude推奨・確定前)

- **結論**: Kotlin + Jetpack Compose + youtubedl-android(yt-dlpのAndroidラッパー)
- **根拠**: ①yt-dlpが対象3サイト中2つで実績あり、サイト対応の追随をyt-dlp本体に任せられる ②同構成の先行実装Seal(GPL-3.0)が存在し設計の参照になる(コード流用はGPL感染のため不可、設計参照のみ) ③KotlinネイティブはFlutter等と比べyt-dlpバインディング・バックグラウンドDL・ストレージ周りの情報が最も厚い
- **反証条件**: iOS版も欲しくなったらFlutterを再検討(ただしiOSはサイドロード制約で自分用DLアプリの配布自体が難路)。yt-dlpがGFSに対応不能ならGFSのみ別手段(PC側スクリプト)へ分離

## パイプライン構想(将来)

```
video-vault(Android)
  └ DL → 端末 or Drive保存
       └ 文字起こし(Whisper or Gemini)→ 分析
            └ llm-wiki raw/files/ へ(transcript型・origin: external)
```

- llm-wiki側の境界(外部LLM送信ルールとの整合・逐語転記禁止の準用)は形が見えた段階で議論し、決定をllm-wiki rawへ記録する

## 未決事項(壁打ちで決める)

1. スタック確定(上記推奨の採否)
2. 保存先: 端末ローカルのみか、Google Drive連携まで最初から作るか
3. 最初のターゲットサイト(YouTube先行か、GFS先行か)
4. 文字起こし・分析をアプリ内でやるか、PC/クラウド側の後段に分けるか
5. GFSの技術調査(DRM有無・Cookie認証でのyt-dlp可否)
