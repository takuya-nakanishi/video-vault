#!/usr/bin/env python3
"""PC 版を Cloudflare Tunnel で外から届くようにする準備を、API で行う(再実行しても重複しない)。

  web/deploy/cloudflare-tunnel.py ytdlp.sanei-clover.com            作る・直す
  web/deploy/cloudflare-tunnel.py ytdlp.sanei-clover.com --remove   DNS のレコードとトンネルを消す

やること: トンネルを作る → 経路(ホスト名 → http://127.0.0.1:8787)→ CNAME(プロキシ ON)→ トンネルのトークンを
~/.config/video-vault/tunnel.env に書く(持ち主だけが読める。リポジトリには置かない)。
cloudflared の起動は web/deploy/install-service.sh --tunnel。

- 入口(Cloudflare)に認証は置かない。Works(perfect-crm の scripts/cloudflare-tunnel-setup.py)と同じ型。
  **守るのはアプリの Basic 認証**なので、先にそれを有効にする(このスクリプトは、有効でなければ止まる)
- Works のトンネル(sanei-clover-lan)には相乗りしない。あちらの cloudflared は Docker のネットワークの中にいて、
  この PC の 127.0.0.1:8787 に届かない。アプリの待ち受けを 127.0.0.1 から広げないために、専用のトンネルを持つ
- API のトークンは agent-base の .env から名前で読む(このリポジトリの隣の agent-base。値は出力しない)
"""
import argparse, json, os, pathlib, stat, sys, urllib.error, urllib.parse, urllib.request

API = 'https://api.cloudflare.com/client/v4'
TUNNEL_NAME = 'video-vault'
ORIGIN = 'http://127.0.0.1:8787'
CONFIG_DIR = pathlib.Path(os.environ.get('XDG_CONFIG_HOME') or pathlib.Path.home() / '.config') / 'video-vault'
TUNNEL_ENV = CONFIG_DIR / 'tunnel.env'
WEB_ENV = CONFIG_DIR / 'web.env'


def read_env(path):
    out = {}
    try:
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


def credentials(zone_name):
    """ゾーンのトークン・ゾーン ID・アカウント ID。agent-base の .env の名前の決まり(<組織>_CLOUDFLARE_<ゾーン>_…)で探す"""
    repo = pathlib.Path(__file__).resolve().parents[2]
    env = read_env(repo.parent / 'agent-base' / '.env')
    key = zone_name.upper().replace('.', '_').replace('-', '_')
    found = [k for k in env if k.endswith(f'_CLOUDFLARE_{key}_API_TOKEN')]
    if len(found) != 1:
        sys.exit(f'agent-base の .env に {zone_name} のトークンが見つからない(…_CLOUDFLARE_{key}_API_TOKEN)')
    prefix = found[0][: -len('_API_TOKEN')]
    org = found[0].split('_CLOUDFLARE_')[0]
    zone_id, account_id = env.get(f'{prefix}_ZONE_ID'), env.get(f'{org}_CLOUDFLARE_ACCOUNT_ID')
    if not zone_id or not account_id:
        sys.exit(f'agent-base の .env に {prefix}_ZONE_ID か {org}_CLOUDFLARE_ACCOUNT_ID が無い')
    return env[found[0]], zone_id, account_id


def api(token, path, body=None, method=None, params=None):
    url = API + path + ('?' + urllib.parse.urlencode(params) if params else '')
    req = urllib.request.Request(url, method=method or ('POST' if body is not None else 'GET'),
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.load(res)
    except urllib.error.HTTPError as e:
        # 応答の本文だけを出す。要求のヘッダ(トークン)は出さない
        sys.exit(f'Cloudflare が断った({method or "GET"} {path} → HTTP {e.code}): {e.read().decode("utf-8", "replace")[:300]}')
    if not data.get('success'):
        sys.exit(f'Cloudflare が断った({path}): {data.get("errors")}')
    return data['result']


def write_private(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    tmp = path.with_suffix('.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp, path)


p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument('host', help='外から届く名前(例 ytdlp.sanei-clover.com)')
p.add_argument('--remove', action='store_true', help='DNS のレコードとトンネルを消す(公開をやめる)')
args = p.parse_args()
host = args.host.strip().lower()
zone_name = '.'.join(host.split('.')[1:])
token, zone_id, account_id = credentials(zone_name)

tunnels = api(token, f'/accounts/{account_id}/cfd_tunnel', params={'name': TUNNEL_NAME, 'is_deleted': 'false'})
records = [r for r in api(token, f'/zones/{zone_id}/dns_records', params={'name': host})]

if args.remove:
    for r in records:
        api(token, f'/zones/{zone_id}/dns_records/{r["id"]}', method='DELETE')
        print(f'DNS のレコードを消した: {r["type"]} {host}')
    for t in tunnels:
        # つながっている cloudflared が残っていると消せないので、先に接続を切る
        api(token, f'/accounts/{account_id}/cfd_tunnel/{t["id"]}/connections', method='DELETE')
        api(token, f'/accounts/{account_id}/cfd_tunnel/{t["id"]}', method='DELETE')
        print(f'トンネルを消した: {t["name"]}')
    TUNNEL_ENV.unlink(missing_ok=True)
    print('公開をやめた。cloudflared のサービスは web/deploy/install-service.sh --remove-tunnel で外す')
    sys.exit(0)

# 守りはアプリの Basic 認証だけ。有効でないまま外へつなげない
web = read_env(WEB_ENV)
if web.get('VIDEO_VAULT_PUBLIC_HOST', '').lower() != host or not web.get('VIDEO_VAULT_BASIC_USER') or not web.get('VIDEO_VAULT_BASIC_PASSWORD'):
    sys.exit(f'{WEB_ENV} に、このホスト名(VIDEO_VAULT_PUBLIC_HOST={host})と Basic 認証が書かれていない。先に書いてアプリを入れ直す')

others = [r for r in records if r['type'] != 'CNAME']
if others:
    sys.exit(f'{host} に CNAME でないレコードがある({[r["type"] for r in others]})。消してよいかを人が確かめる')

tunnel = tunnels[0] if tunnels else api(token, f'/accounts/{account_id}/cfd_tunnel', {'name': TUNNEL_NAME, 'config_src': 'cloudflare'})
print(f'トンネル: {tunnel["name"]}({"既にある" if tunnels else "作った"})')

# このトンネルの経路は、このホスト名の 1 本だけにする(覚えの無い経路を残さない)
ingress = [{'hostname': host, 'service': ORIGIN}, {'service': 'http_status:404'}]
api(token, f'/accounts/{account_id}/cfd_tunnel/{tunnel["id"]}/configurations', {'config': {'ingress': ingress}}, method='PUT')
print(f'経路: {host} -> {ORIGIN}')

target = f'{tunnel["id"]}.cfargotunnel.com'
record = {'type': 'CNAME', 'name': host, 'content': target, 'ttl': 1, 'proxied': True}
if records:
    r = records[0]
    if r['content'] != target or not r['proxied']:
        api(token, f'/zones/{zone_id}/dns_records/{r["id"]}', record, method='PUT')
        print('CNAME を直した')
    else:
        print('CNAME は合っている')
else:
    api(token, f'/zones/{zone_id}/dns_records', record)
    print('CNAME を作った(プロキシ ON)')

tunnel_token = api(token, f'/accounts/{account_id}/cfd_tunnel/{tunnel["id"]}/token')
write_private(TUNNEL_ENV, f'TUNNEL_TOKEN={tunnel_token}\n')
mode = stat.S_IMODE(TUNNEL_ENV.stat().st_mode)
print(f'トンネルのトークンを書いた: {TUNNEL_ENV}(権限 {mode:o}。値は出力しない)')
