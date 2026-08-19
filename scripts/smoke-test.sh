#!/usr/bin/env bash
# エミュレータ上で正常系・異常系のシナリオを自動で流す煙試験。
# 実機へ配る前にこれを通す。UIの検証はスクリーンショットではなく
# uiautomatorのビューツリー(テキスト)で行うので、人の目が要らない。
#
# 使い方: scripts/smoke-test.sh [--skip-download]
#   --skip-download を付けると実ダウンロード(ネットワーク・時間がかかる)を飛ばす
set -uo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"

PKG=com.saneiclover.videovault.debug
ACT="$PKG/com.saneiclover.videovault.MainActivity"
DL_DIR="/sdcard/Android/data/$PKG/files/downloads"
# 19秒の定番動画(YouTube最古"Me at the zoo")。公開が永続的で短く、煙試験に向く。
# yt-dlp公式テスト動画 BaW_jenozKc は Video unavailable になるため使わない
TEST_VIDEO="https://youtu.be/jNQXAC9IVRw"
SKIP_DOWNLOAD=${1:-}
ONLY_DOWNLOAD=""
[[ "$SKIP_DOWNLOAD" == "--only-download" ]] && ONLY_DOWNLOAD=1

PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
ng()   { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
step() { echo; echo "▶ $1"; }

# エミュレータ限定。実機を壊さないための保険
SERIAL=$(adb devices | awk '$2=="device"{print $1}' | grep '^emulator-' | head -1)
if [[ -z "$SERIAL" ]]; then
  echo "エラー: エミュレータが見つからない。先に起動する:" >&2
  echo '  sg kvm -c "$ANDROID_HOME/emulator/emulator @medium_phone -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect" &' >&2
  exit 1
fi
export ANDROID_SERIAL="$SERIAL"
echo "対象: $SERIAL"

# --- UIツリーの取得と検索 ---
dump() {   # 画面のテキストを全部拾う
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml 2>/dev/null
}
has_text() { dump | grep -qF "$1"; }
# テキストを含むノードの中心座標をタップする
tap_text() {
  local target="$1"
  local coords
  coords=$(dump | python3 -c "
import sys, re
xml = sys.stdin.read()
target = '''$target'''
best = None
for m in re.finditer(r'text=\"([^\"]*)\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', xml):
    if target in m.group(1):
        x1,y1,x2,y2 = map(int, m.groups()[1:])
        best = ((x1+x2)//2, (y1+y2)//2)
        break
print(f'{best[0]} {best[1]}' if best else '')
")
  [[ -n "$coords" ]] && adb shell input tap $coords && return 0
  return 1
}
relaunch() { adb shell am force-stop $PKG; adb shell am start -n "$ACT" >/dev/null; sleep 3; }
share_url() {
  adb shell am force-stop $PKG
  adb shell am start -a android.intent.action.SEND -t text/plain -e android.intent.extra.TEXT "'$1'" -n "$ACT" >/dev/null
  sleep 3
}

step "準備: ビルドとインストール"
./gradlew assembleDebug -q 2>&1 | tail -2
android install --device="$SERIAL" --apks=app/build/outputs/apk/debug/app-debug.apk >/dev/null 2>&1 \
  && ok "インストール成功" || { ng "インストール失敗"; exit 1; }
adb shell rm -rf "$DL_DIR" 2>/dev/null

if [[ -z "$ONLY_DOWNLOAD" ]]; then
step "シナリオ1[正常系]: 起動してホーム画面が出る"
relaunch
has_text "video-vault"        && ok "タイトル表示" || ng "タイトルが出ない"
has_text "URLか検索したい言葉" && ok "入力欄表示"   || ng "入力欄が出ない"

step "シナリオ2[正常系]: 動画サイトのURLでダウンロードが第一候補になる"
share_url "$TEST_VIDEO"
has_text "ダウンロード"   && ok "ダウンロード候補あり"   || ng "ダウンロード候補が出ない"
has_text "ブラウザで開く" && ok "ブラウザ候補あり"       || ng "ブラウザ候補が出ない"

step "シナリオ3[異常系]: DRMサイトは対象外として弾く"
share_url "https://www.netflix.com/title/80100172"
has_text "対象外"          && ok "対象外の表示あり" || ng "対象外が表示されない"
has_text "DRM"             && ok "理由の表示あり"   || ng "理由が表示されない"
if dump | grep -qE 'text="ダウンロード"'; then ng "対象外なのにDLボタンが出ている"; else ok "DLボタンは出ない"; fi

step "シナリオ4[正常系]: キーワードは検索になる"
share_url "kessan happyou"
has_text "Googleで検索" && ok "検索候補あり" || ng "検索候補が出ない"

step "シナリオ5[正常系]: 検索から内蔵ブラウザが開く"
if tap_text "Googleで検索"; then
  sleep 6
  has_text "このページをダウンロード" && ok "ブラウザ画面が開いた" || ng "ブラウザ画面が出ない"
  has_text "google.com"              && ok "検索結果を読み込んだ" || ng "URLが表示されない"
else
  ng "検索候補をタップできない"
fi

step "シナリオ6[異常系]: 存在しない動画IDはエラーを表示しクラッシュしない"
share_url "https://youtu.be/aaaaaaaaaaa"
if tap_text "ダウンロード"; then
  for i in $(seq 1 24); do sleep 5; has_text "失敗" && break; done
  has_text "失敗" && ok "エラーを表示した" || ng "エラーが表示されない(タイムアウト)"
  adb shell pidof $PKG >/dev/null && ok "プロセス生存(クラッシュなし)" || ng "クラッシュした"
else
  ng "ダウンロードボタンをタップできない"
fi

fi  # ONLY_DOWNLOAD

if [[ "$SKIP_DOWNLOAD" == "--skip-download" ]]; then
  echo; echo "シナリオ7[実ダウンロード]は --skip-download のため省略"
else
  step "シナリオ7[正常系・本命]: 実際にYouTubeからダウンロードできる"
  share_url "$TEST_VIDEO"
  if tap_text "ダウンロード"; then
    echo "  (yt-dlp更新とダウンロードで最大5分待つ)"
    got=""
    for i in $(seq 1 60); do
      sleep 5
      # .ytdl(yt-dlpの内部レジューム情報)や.part(未完了)を成果物と誤認しない
      found=$(adb shell "find $DL_DIR -type f -size +100k \\( -name '*.mp4' -o -name '*.webm' -o -name '*.mkv' -o -name '*.m4a' \\) 2>/dev/null" | tr -d '\r')
      if [[ -n "$found" ]]; then got="$found"; break; fi
      has_text "失敗" && break
    done
    if [[ -n "$got" ]]; then
      ok "動画本体を取得した: $(adb shell ls -la \"$got\" | tr -d '\r')"
    else
      ng "取得できなかった"
      echo "  --- 画面のエラー全文 ---"
      dump | grep -oE 'text="[^"]*(失敗|ERROR|WARNING)[^"]*"' | head -5
    fi
  else
    ng "ダウンロードボタンをタップできない"
  fi
fi

echo; echo "================================"
echo "結果: 成功 $PASS / 失敗 $FAIL"
echo "================================"
[[ $FAIL -eq 0 ]]
