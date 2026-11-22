#!/usr/bin/env python3
"""内蔵ブラウザ(WebView)の中でJSを評価する(debugビルド限定。DevTools=CDPを使う)。

uiautomatorはWebView内部のテキストを拾えないので、ページ内の状態(動画バッジの数など)は
これで見る。依存を足さないため生WebSocketでCDPの Runtime.evaluate を1回だけ投げる。

使い方: android/scripts/webview-eval.py <adbシリアル> <URLの部分一致> <JS式>
  例: android/scripts/webview-eval.py emulator-5554 youtube.com "document.querySelectorAll('.vv-badge').length"
終了コード: 0=評価できた / 1=アプリ未起動・該当ページ無し・接続失敗
"""
import base64, json, os, socket, struct, subprocess, sys, time, urllib.request
from urllib.parse import urlparse

if len(sys.argv) != 4:
    print(__doc__); sys.exit(2)
serial, needle, expr = sys.argv[1:4]
ADB = [os.path.expanduser("~/android-sdk/platform-tools/adb"), "-s", serial]
PKG = "com.saneiclover.videovault.debug"
PORT = 9230

def sh(*a):
    return subprocess.run(ADB + list(a), capture_output=True, text=True).stdout

pid = sh("shell", "pidof", PKG).split()
if not pid:
    print("app not running", file=sys.stderr); sys.exit(1)
sh("forward", "--remove", f"tcp:{PORT}")
sh("forward", f"tcp:{PORT}", f"localabstract:webview_devtools_remote_{pid[0]}")
pages = None
for _ in range(5):
    try:
        pages = json.load(urllib.request.urlopen(f"http://localhost:{PORT}/json", timeout=5)); break
    except Exception:
        time.sleep(1)
if pages is None:
    print("devtools not reachable", file=sys.stderr); sys.exit(1)
page = next((p for p in pages if needle in (p.get("url") or "")), None)
if not page:
    print("page not found; pages=" + json.dumps([p.get("url") for p in pages]), file=sys.stderr); sys.exit(1)

u = urlparse(page["webSocketDebuggerUrl"])
s = socket.create_connection((u.hostname, u.port or 80), timeout=20)
key = base64.b64encode(os.urandom(16)).decode()
s.sendall((f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n"
           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
s.recv(4096)
data = json.dumps({"id": 1, "method": "Runtime.evaluate",
                   "params": {"expression": expr, "userGesture": True, "returnByValue": True}}).encode()
n = len(data); mask = os.urandom(4)
hdr = bytes([0x81]) + (bytes([0x80 | 126]) + struct.pack(">H", n) if n >= 126 else bytes([0x80 | n])) + mask
s.sendall(hdr + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

def recvn(k):
    buf = b""
    while len(buf) < k:
        chunk = s.recv(k - len(buf))
        if not chunk: raise EOFError
        buf += chunk
    return buf

result = None
for _ in range(60):
    h = recvn(2); ln = h[1] & 0x7F
    if ln == 126: ln = struct.unpack(">H", recvn(2))[0]
    elif ln == 127: ln = struct.unpack(">Q", recvn(8))[0]
    msg = json.loads(recvn(ln))
    if msg.get("id") == 1:
        result = msg; break
s.close()
if not result:
    print("no reply", file=sys.stderr); sys.exit(1)
val = result.get("result", {}).get("result", {})
if "value" in val:
    v = val["value"]
    print(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
else:
    print(json.dumps(result.get("result", result), ensure_ascii=False))
