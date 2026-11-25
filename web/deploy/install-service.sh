#!/usr/bin/env bash
# PC 版を、この PC(Linux・WSL)で常駐させる。systemd の利用者ごとのサービスとして入れて起動する。
#
#   web/deploy/install-service.sh                  アプリを入れて起動する(入っていれば入れ直す)
#   web/deploy/install-service.sh --remove         アプリを止めて外す
#   web/deploy/install-service.sh --tunnel         外へつなぐ cloudflared を入れて起動する(先に cloudflare-tunnel.py を走らせる)
#   web/deploy/install-service.sh --remove-tunnel  cloudflared を止めて外す(外から届かなくなる)
#
# - 待ち受けるのは 127.0.0.1 だけ(web/src/config.mjs)。このスクリプトは外へ出す設定を何もしない
# - 外から使うための設定(公開用のホスト名・Google のログイン)は ~/.config/video-vault/web.env に、
#   利用者の表は ~/.config/video-vault/users.json に置く(秘密が入るので、リポジトリには置かない)
# - リポジトリの場所は、このスクリプトの場所から求める(場所を決め打ちしない)
set -euo pipefail

NAME=video-vault-web
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/$NAME.service"
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/video-vault/web.env"
WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TUNNEL=video-vault-tunnel
TUNNEL_UNIT="$UNIT_DIR/$TUNNEL.service"
TUNNEL_ENV="${XDG_CONFIG_HOME:-$HOME/.config}/video-vault/tunnel.env"

if [ "${1:-}" = "--remove-tunnel" ]; then
  systemctl --user disable --now "$TUNNEL.service" 2>/dev/null || true
  rm -f "$TUNNEL_UNIT"
  systemctl --user daemon-reload
  echo "外した: $TUNNEL(外からは届かなくなった。DNS とトンネルを消すのは cloudflare-tunnel.py --remove)"
  exit 0
fi

if [ "${1:-}" = "--tunnel" ]; then
  # ~/.local/bin は、サービスや非対話のシェルの PATH に入っていないことがある。PATH の次にそこを見る
  CLOUDFLARED="$(command -v cloudflared || true)"
  [ -n "$CLOUDFLARED" ] || CLOUDFLARED="$HOME/.local/bin/cloudflared"
  [ -x "$CLOUDFLARED" ] || { echo "cloudflared が見つからない" >&2; exit 1; }
  [ -s "$TUNNEL_ENV" ] || { echo "$TUNNEL_ENV が無い。先に web/deploy/cloudflare-tunnel.py <ホスト名> を走らせる" >&2; exit 1; }
  # アプリが動いていて、ログインなしでは何も返さないことを確かめてから、外へつなぐ
  PAGE="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -m 5 http://127.0.0.1:8787/ || true)"
  API="$(curl -s -o /dev/null -w '%{http_code}' -m 5 'http://127.0.0.1:8787/api/state?token=x' || true)"
  case "$PAGE" in "302 "*/login) ;; *) echo "アプリがログインを求めていない(画面の応答 $PAGE)。外へつながない" >&2; exit 1 ;; esac
  [ "$API" = 401 ] || { echo "アプリがログインを求めていない(API の応答 $API)。外へつながない" >&2; exit 1; }
  mkdir -p "$UNIT_DIR"
  cat > "$TUNNEL_UNIT" <<UNIT_EOF
[Unit]
Description=ゲットVIDEO PC 版を外へつなぐ Cloudflare Tunnel
After=$NAME.service
Requires=$NAME.service

[Service]
# トンネルのトークン(TUNNEL_TOKEN)。リポジトリには置かない
EnvironmentFile=$TUNNEL_ENV
ExecStart=$CLOUDFLARED tunnel --no-autoupdate run
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT_EOF
  systemctl --user daemon-reload
  systemctl --user enable "$TUNNEL.service" >/dev/null 2>&1
  systemctl --user restart "$TUNNEL.service"
  echo "入れて起動した: $TUNNEL"
  exit 0
fi

if [ "${1:-}" = "--remove" ]; then
  # アプリを外すなら、外へつなぐ口も一緒に止める(アプリの無い所へ外からつながせない)
  systemctl --user disable --now "$TUNNEL.service" 2>/dev/null || true
  rm -f "$TUNNEL_UNIT"
  systemctl --user disable --now "$NAME.service" 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  echo "外した: $NAME(設定 $ENV_FILE とログインの状態 $WEB_DIR/.auth は残してある)"
  exit 0
fi

NODE="$(command -v node)" || { echo "node が見つからない" >&2; exit 1; }
[ -d "$WEB_DIR/node_modules/playwright" ] || { echo "依存が入っていない。先に (cd $WEB_DIR && npm install) を実行する" >&2; exit 1; }

mkdir -p "$UNIT_DIR" "$(dirname "$ENV_FILE")"
chmod 700 "$(dirname "$ENV_FILE")"
cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=ゲットVIDEO PC 版(video-vault/web)

[Service]
WorkingDirectory=$WEB_DIR
ExecStart=$NODE src/main.mjs
# 外から使うための設定。無くてもよい(先頭の - は「無ければ読まない」)
EnvironmentFile=-$ENV_FILE
# ログイン用のブラウザの窓を出す先(WSLg)。画面の無い環境では窓は出ない
Environment=DISPLAY=:0 WAYLAND_DISPLAY=wayland-0
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT_EOF

systemctl --user daemon-reload
systemctl --user enable "$NAME.service" >/dev/null 2>&1
systemctl --user restart "$NAME.service"
echo "入れて起動した: $NAME"
echo "状態を見る: systemctl --user status $NAME / ログを見る: journalctl --user -u $NAME -n 50"
