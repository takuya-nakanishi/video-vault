#!/usr/bin/env bash
# 内蔵ブラウザ(WebView)の中で何が起きているかを、端末を触らずに見る。
#   1) Logcat: 遷移・エラー・JSコンソール(タグ VideoVaultBrowser。debug/release問わず出る)
#   2) DevTools: debugビルドは WebView.setWebContentsDebuggingEnabled が有効なので、
#      adb forward 経由で開いているページのURL・タイトル・コンソールを取れる
#
# 使い方: scripts/webview-inspect.sh [シリアル]
#   シリアル省略時は実機(emulator- 以外)を自動で選ぶ。ページのJSを評価したい場合は
#   表示される webSocketDebuggerUrl に対して Chrome DevTools Protocol で Runtime.evaluate を投げる
set -uo pipefail
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools"

PKG=com.saneiclover.videovault.debug
SERIAL="${1:-$(adb devices | awk '$2=="device"{print $1}' | grep -v '^emulator-' | head -1)}"
[[ -z "$SERIAL" ]] && { echo "デバイスが見つからない" >&2; exit 1; }
export ANDROID_SERIAL="$SERIAL"
echo "対象: $SERIAL"

echo; echo "▶ Logcat(VideoVaultBrowser の直近)"
adb logcat -d -s VideoVaultBrowser:V | tail -40

PID=$(adb shell pidof $PKG | tr -d '\r')
if [[ -z "$PID" ]]; then echo; echo "アプリが起動していない(DevToolsは起動中のみ)"; exit 0; fi
SOCKET="webview_devtools_remote_$PID"
if ! adb shell cat /proc/net/unix | grep -q "$SOCKET"; then
  echo; echo "DevToolsソケット($SOCKET)が無い。debugビルドか、ブラウザ画面を一度開いたか確認する"; exit 0
fi
adb forward tcp:9222 "localabstract:$SOCKET" >/dev/null
echo; echo "▶ DevTools: 開いているページ(http://localhost:9222/json)"
curl -s http://localhost:9222/json | python3 -c "
import sys, json
for p in json.load(sys.stdin):
    print('-', p.get('type'), '|', p.get('title'), '|', p.get('url'))
    print('  ws:', p.get('webSocketDebuggerUrl'))
"
