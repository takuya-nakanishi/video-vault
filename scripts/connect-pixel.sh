#!/usr/bin/env bash
# Tailscale経由でPixel 10 Proにadb接続する。
# 使い方:
#   scripts/connect-pixel.sh 35907           # ワイヤレスデバッグ画面のメインのポート
#   scripts/connect-pixel.sh --pair 33757 923616   # 初回ペアリング(ペア設定画面のポートと6桁コード)
#
# 背景(2026-08-18実測): SurfaceとPixelが別LANのときはTailscale IP(100.91.182.103)で届くが、
# 経路の実効MTUが小さく(1030〜1130Bの間)、TLSハンドシェイクの大パケットだけが黙って落ちて
# adb pair/connectがハングする。宛先限定でMTUを1000に絞ると通る。この設定はWSL再起動で消えるため、
# このスクリプトが毎回張り直す。
set -euo pipefail

PIXEL_TS_IP="100.91.182.103"   # tailnet上のpixel-10-pro-xl
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools"

# 宛先限定のMTUクランプ(冪等)。同一LAN接続には影響しない
sudo ip route replace "$PIXEL_TS_IP/32" dev eth0 mtu 1000

if [[ "${1:-}" == "--pair" ]]; then
  [[ $# -eq 3 ]] || { echo "使い方: $0 --pair ペア設定ポート 6桁コード" >&2; exit 1; }
  adb pair "$PIXEL_TS_IP:$2" "$3"
  echo "ペアリング完了。続けて: $0 メインポート"
  exit 0
fi

[[ $# -eq 1 ]] || { echo "使い方: $0 メインポート(ワイヤレスデバッグ画面のIP:ポートのポート部分)" >&2; exit 1; }
adb connect "$PIXEL_TS_IP:$1"
adb devices
