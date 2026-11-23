#!/usr/bin/env bash
# PC 版を、この PC(Linux・WSL)で常駐させる。systemd の利用者ごとのサービスとして入れて起動する。
#
#   web/deploy/install-service.sh            入れて起動する(入っていれば入れ直す)
#   web/deploy/install-service.sh --remove   止めて外す
#
# - 待ち受けるのは 127.0.0.1 だけ(web/src/config.mjs)。このスクリプトは外へ出す設定を何もしない
# - 外から使うための設定(公開用のホスト名・Basic 認証)は ~/.config/video-vault/web.env に書く。
#   パスワードが入るので、リポジトリには置かない。無ければ、この PC の中からだけ使える
# - リポジトリの場所は、このスクリプトの場所から求める(場所を決め打ちしない)
set -euo pipefail

NAME=video-vault-web
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/$NAME.service"
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/video-vault/web.env"
WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" = "--remove" ]; then
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
