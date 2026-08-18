#!/usr/bin/env bash
# ビルド→接続中のデバイスへインストール→起動 を1コマンドで行う。
# 使い方:
#   scripts/deploy-device.sh                # デバイスが1台だけ繋がっているとき
#   scripts/deploy-device.sh 192.168.10.xx:PORT   # 複数台繋がっているときはシリアルを指定
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"

SERIAL="${1:-}"
DEVICE_OPT=()
if [[ -n "$SERIAL" ]]; then
  export ANDROID_SERIAL="$SERIAL"        # adb用
  DEVICE_OPT=(--device="$SERIAL")        # android CLIはANDROID_SERIALを見ないため明示
fi

COUNT=$(adb devices | awk 'NR>1 && $2=="device"' | wc -l)
if [[ "$COUNT" -eq 0 ]]; then
  echo "エラー: デバイスが繋がっていない。adb connect IP:PORT を先に実行する" >&2
  echo "(ペアリング済みなら、スマホのワイヤレスデバッグ画面のIP:ポートに対して)" >&2
  exit 1
fi
if [[ "$COUNT" -gt 1 && -z "$SERIAL" ]]; then
  echo "エラー: デバイスが複数繋がっている。シリアルを引数で指定する" >&2
  adb devices >&2
  exit 1
fi

./gradlew assembleDebug
android install "${DEVICE_OPT[@]}" --apks=app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.saneiclover.videovault.debug/com.saneiclover.videovault.MainActivity
echo "起動した。"
