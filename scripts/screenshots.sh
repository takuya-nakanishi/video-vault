#!/usr/bin/env bash
# エミュレータから各画面のスクリーンショットを撮る(人に見せる用。合否判定は smoke-test.sh が担う)。
# 煙試験を通した直後に流すと、履歴・保存済みファイルに実データが入った状態で撮れる。
#
# 使い方: scripts/screenshots.sh [出力ディレクトリ]   (既定: build/screenshots)
set -uo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools"

OUT="${1:-build/screenshots}"
mkdir -p "$OUT"
PKG=com.saneiclover.videovault.debug
ACT="$PKG/com.saneiclover.videovault.MainActivity"

SERIAL=$(adb devices | awk '$2=="device"{print $1}' | grep '^emulator-' | head -1)
[[ -z "$SERIAL" ]] && { echo "エラー: エミュレータが見つからない" >&2; exit 1; }
export ANDROID_SERIAL="$SERIAL"

shot() { sleep "${2:-2}"; adb exec-out screencap -p > "$OUT/$1.png"; echo "  $1.png"; }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml 2>/dev/null; }
tap_node() {  # $1: 属性名(text|content-desc) $2: 値(完全一致)
  local c
  c=$(dump | python3 -c "
import sys,re
xml=sys.stdin.read()
m=re.search(r'$1=\"$2\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"',xml)
print(f'{(int(m.group(1))+int(m.group(3)))//2} {(int(m.group(2))+int(m.group(4)))//2}' if m else '')")
  [[ -n "$c" ]] && adb shell input tap $c
}
relaunch() { adb shell am force-stop $PKG; adb shell am start -n "$ACT" >/dev/null; sleep 3; }

for mode in no yes; do
  adb shell cmd uimode night $mode >/dev/null
  suffix=$([[ $mode == yes ]] && echo dark || echo light)
  echo "▶ $suffix"
  relaunch;                         shot "home-$suffix"
  tap_node content-desc "履歴";      shot "history-$suffix"
  adb shell input keyevent BACK; sleep 1
  tap_node content-desc "保存済みファイル"; shot "files-$suffix"
  adb shell input keyevent BACK; sleep 1
  adb shell am force-stop $PKG
  adb shell am start -a android.intent.action.SEND -t text/plain \
    -e android.intent.extra.TEXT "'https://youtu.be/jNQXAC9IVRw'" -n "$ACT" >/dev/null
  shot "suggestions-$suffix" 3
  relaunch
  tap_node text "YouTube";           shot "browser-$suffix" 6
done
adb shell cmd uimode night no >/dev/null

echo "▶ ランチャー"
adb shell am force-stop $PKG
adb shell input keyevent HOME; sleep 1
size=$(adb shell wm size | tr -d '\r' | awk '{print $NF}')
w=${size%x*}; h=${size#*x}
adb shell input swipe $((w/2)) $((h*9/10)) $((w/2)) $((h/5)) 300; sleep 2
adb shell input swipe $((w/2)) $((h*8/10)) $((w/2)) $((h/5)) 300; sleep 2
shot "launcher" 0
echo "出力: $OUT"
