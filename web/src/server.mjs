// 画面と API を出す小さなサーバ。この PC の中(127.0.0.1)でだけ待ち受ける。
//
// ブラウザで開いた別のサイトから、この PC のサーバへ勝手に命令を送られないよう、3 つを確かめる:
// 1. Host ヘッダが 127.0.0.1 か localhost(別の名前をこの PC へ向ける DNS の付け替えを断る)
// 2. 起動のたびに作る合言葉(トークン)。画面の HTML にだけ埋めてあり、別のサイトの JS からは読めない
// 3. Origin ヘッダが付いていれば、このサーバ自身であること
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LISTEN_HOST, WEB_ROOT, ASSETS_DIR } from './config.mjs';
import { SiteCatalog } from './siteCatalog.mjs';
import { classify } from './inputClassifier.mjs';
import { QUALITIES, DEFAULT_QUALITY } from './quality.mjs';
import { HistoryStore } from './history.mjs';
import { DownloadCenter } from './downloadCenter.mjs';
import { LoginBrowser } from './loginBrowser.mjs';
import { locateYtdlp, locateFfmpeg } from './ytdlp.mjs';
import { playerUuidOf } from './vidyard.mjs';

const PUBLIC_DIR = path.join(WEB_ROOT, 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const MAX_BODY_BYTES = 64 * 1024;

/** よく行くページ。Android の DefaultBookmarks と同じ 4 件(YouTube だけ PC 向けの URL) */
const BOOKMARKS = [
  { id: 'seed-newspicks', name: 'NewsPicks', url: 'https://newspicks.com/' },
  { id: 'seed-tiktok', name: 'TikTok', url: 'https://www.tiktok.com/' },
  { id: 'seed-youtube', name: 'YouTube', url: 'https://www.youtube.com/' },
  { id: 'seed-x', name: 'X', url: 'https://x.com/' },
];

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** 長さの違いを時間から読ませないよう、ハッシュにしてから比べる */
function secretEqual(a, b) {
  const h = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

/** 同じ相手が Basic 認証をこの回数まちがえたら、しばらく受け付けない */
export const BASIC_MAX_FAILURES = 5;
export const BASIC_LOCK_MS = 15 * 60 * 1000;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return; // 残りは読み捨てる(貯めない)
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // ここで接続を切ると、相手には 413 ではなく切断として見える。断りの応答を返してから閉じる
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error('本文が大きすぎる'), { status: 413 }));
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch {
        reject(Object.assign(new Error('JSON として読めない'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * アプリを組み立てる。`start()` で待ち受けを始める。
 * @param {ReturnType<import('./config.mjs').loadConfig>} config
 * @param {object} [overrides] 試験で差し替える部品
 */
export function createApp(config, overrides = {}) {
  const token = crypto.randomBytes(24).toString('base64url');
  const catalog = overrides.catalog ?? SiteCatalog.load();
  let badgeScript = '';
  try {
    badgeScript = fs.readFileSync(path.join(ASSETS_DIR, 'video_badge.js'), 'utf8');
  } catch (e) {
    console.error(`video_badge.js を読めない。動画のバッジは出ない: ${e.message}`);
  }

  let ytdlpPromise = null;
  /** yt-dlp の呼び方と ffmpeg の場所。起動のあと 1 度だけ探す */
  const locateTools = async () => {
    const [tool, ffmpeg] = await Promise.all([
      locateYtdlp(process.env, config.ytdlpPath),
      locateFfmpeg(process.env, config.ffmpegPath ?? null),
    ]);
    return tool ? { ...tool, ffmpeg } : null;
  };
  const ytdlp = overrides.ytdlp ?? (() => (ytdlpPromise ??= locateTools()));

  let center = null;
  const browser = new LoginBrowser({
    authDir: config.authDir,
    headless: config.headless,
    channel: config.browserChannel,
    badgeScript,
    allowLoopback: config.allowLoopback === true,
    // バッジを押したら、その場で順番待ちに積む(PC では画質の選択を挟まない。画質は既定)
    onBadge: ({ targetUrl }) => {
      const r = center.enqueue({ url: targetUrl, quality: DEFAULT_QUALITY.name, source: 'badge' });
      if (!r.ok) console.error(`バッジからのダウンロードを積めない: ${r.error}`);
    },
  });
  fs.mkdirSync(config.outDir, { recursive: true });
  center = new DownloadCenter({
    catalog,
    historyStore: new HistoryStore(path.join(config.dataDir, 'history.json')),
    outDir: config.outDir,
    cookiesProvider: () => browser.cookies(),
    ytdlp,
    allowLoopback: config.allowLoopback === true,
    ...(overrides.center ?? {}),
  });

  let port = config.port;
  const clients = new Set();
  let ytdlpVersion = null;
  let ffmpegFound = null;
  let cookieCount = 0;

  async function publicState() {
    // Cookie は件数だけ見せる。値は画面にも API にも出さない
    cookieCount = (await browser.cookies().catch(() => [])).length;
    return {
      ...center.state(),
      browser: { open: browser.isOpen(), cookieCount },
      env: { outDir: config.outDir, ytdlpVersion, ffmpegFound, qualities: Object.values(QUALITIES), defaultQuality: DEFAULT_QUALITY.name },
      bookmarks: BOOKMARKS,
    };
  }

  let pushTimer = null;
  function push() {
    if (pushTimer || !clients.size) return;
    pushTimer = setTimeout(async () => {
      pushTimer = null;
      const data = `data: ${JSON.stringify(await publicState())}\n\n`;
      for (const res of clients) res.write(data);
    }, 150);
  }
  center.on('change', push);
  browser.on('change', push);

  function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
    const text = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, {
      ...extra,
      'Content-Type': type,
      // no-transform: 途中(Cloudflare)に、ページを書き換えさせない。入口は解析用のスクリプトを HTML へ差し込もうとする
      // (2026-11-24 に外から開いて見つけた。CSP が止めていたが、差し込み自体をさせない)
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    });
    res.end(text);
  }

  // 公開用のホスト名は、設定にあるときだけ足す(https でだけ使う。待ち受けるアドレスは 127.0.0.1 のまま)
  const publicHost = config.publicHost ?? null;
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...(publicHost ? [publicHost] : [])]);
  const allowedOrigins = () =>
    new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(publicHost ? [`https://${publicHost}`] : [])]);

  const now = overrides.now ?? Date.now;
  const basic = config.basicUser ? { user: config.basicUser, password: config.basicPassword } : null;
  /** Basic 認証をまちがえた相手 → { count, until } */
  const failures = new Map();

  /**
   * Basic 認証。通れば null、通らなければ返した応答の状態コード。
   * 相手は、トンネル(Cloudflare)が付ける CF-Connecting-IP で見分ける。このサーバは 127.0.0.1 でしか待ち受けないので、
   * つなげるのはこの PC の中のプロセスだけで、そのヘッダを外の人が直接は偽れない。
   */
  function rejectByBasic(req, res) {
    if (!basic) return null;
    const who = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '');
    const f = failures.get(who);
    if (f && f.until > now()) {
      send(res, 429, { error: 'まちがいが続いたので、しばらく受け付けない' }, undefined, {
        'Retry-After': String(Math.ceil((f.until - now()) / 1000)),
      });
      return 429;
    }
    let ok = false;
    const m = /^Basic ([A-Za-z0-9+/=]+)$/.exec(String(req.headers.authorization ?? ''));
    if (m) {
      const text = Buffer.from(m[1], 'base64').toString('utf8');
      const i = text.indexOf(':');
      // 利用者名とパスワードの両方を必ず比べる(片方で打ち切ると、どちらが違うかを時間から読める)
      const userOk = secretEqual(i < 0 ? '' : text.slice(0, i), basic.user);
      const passOk = secretEqual(i < 0 ? '' : text.slice(i + 1), basic.password);
      ok = i >= 0 && userOk && passOk;
    }
    if (ok) {
      failures.delete(who);
      return null;
    }
    if (failures.size > 5000) failures.clear(); // 覚えすぎない
    const count = (f && f.until <= now() && f.count >= BASIC_MAX_FAILURES ? 0 : (f?.count ?? 0)) + 1;
    failures.set(who, { count, until: count >= BASIC_MAX_FAILURES ? now() + BASIC_LOCK_MS : 0 });
    send(res, 401, { error: '認証が要る' }, undefined, { 'WWW-Authenticate': 'Basic realm="video-vault", charset="UTF-8"' });
    return 401;
  }

  async function handle(req, res) {
    if (!allowedHosts().has(String(req.headers.host ?? '').toLowerCase())) {
      return send(res, 403, { error: 'この名前では受け付けない' });
    }
    // 公開用の名前に http で来た要求は、認証を求める前に https へ回す。ここで認証を求めると、ブラウザがパスワードを
    // 暗号化されない区間(ブラウザと Cloudflare のあいだ)で送ってしまう(2026-11-24 に外から確かめて見つけた)。
    // トンネルは、外の人が使った方式を X-Forwarded-Proto で伝える。https と書かれていなければ、https でないとみなす
    const viaPublicHost = publicHost !== null && String(req.headers.host ?? '').toLowerCase() === publicHost;
    if (viaPublicHost && req.headers['x-forwarded-proto'] !== 'https') {
      return send(res, 308, { error: 'https で開く' }, undefined, { Location: `https://${publicHost}${req.url}` });
    }
    // 次からは、ブラウザが自分で https を使う
    if (viaPublicHost) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    // 画面も API も、Basic 認証を通ってからでないと何も返さない(合言葉の入った HTML も返さない)
    if (rejectByBasic(req, res) !== null) return;
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && Object.hasOwn(STATIC, url.pathname)) {
      const [file, type] = STATIC[url.pathname];
      let body = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
      if (file === 'index.html') body = body.replaceAll('__VV_TOKEN__', token);
      return send(res, 200, body, type);
    }
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: '無い' });

    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins().has(origin)) {
      return send(res, 403, { error: '別のサイトからは受け付けない' });
    }
    // EventSource はヘッダを付けられないので、読むだけの口はクエリでも受ける
    const given = req.headers['x-vv-token'] ?? (req.method === 'GET' ? url.searchParams.get('token') : null);
    if (!given || !safeEqual(given, token)) return send(res, 401, { error: '合言葉が違う' });

    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, await publicState());
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.write(`data: ${JSON.stringify(await publicState())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'この方法では受け付けない' });
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return send(res, 415, { error: 'JSON だけを受け付ける' });
    }
    const body = await readJson(req);
    const str = (v) => (typeof v === 'string' ? v : '');

    switch (url.pathname) {
      case '/api/classify':
        return send(res, 200, {
          suggestions: classify(catalog, str(body.input)),
          // Vidyard の URL のときだけ、画面がパスワードの欄を出す(Android の画質シートと同じ)
          needsPasswordField: playerUuidOf(str(body.input).trim()) !== null,
        });
      case '/api/download': {
        const r = center.enqueue({ url: str(body.url), quality: str(body.quality), password: str(body.password), source: 'input' });
        return send(res, r.ok ? 200 : 400, r);
      }
      case '/api/cancel':
        return send(res, 200, { ok: center.cancel(str(body.id)) });
      case '/api/history/delete':
        center.removeHistory(str(body.id));
        return send(res, 200, { ok: true });
      case '/api/history/clear':
        center.clearHistory();
        return send(res, 200, { ok: true });
      case '/api/browser/open':
        try {
          await browser.open(str(body.url));
          return send(res, 200, { ok: true });
        } catch (e) {
          return send(res, 400, { ok: false, error: String(e.message).split('\n')[0] });
        }
      default:
        return send(res, 404, { error: '無い' });
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) {
        // 大きすぎる本文は、応答のあとで接続を閉じる(残りを送り続けられても受けない)
        if (e.status === 413) res.setHeader('Connection', 'close');
        send(res, e.status ?? 500, { error: e.status ? e.message : 'サーバの中で失敗した' });
      } else res.end();
      if (!e.status) console.error(`要求の処理で失敗: ${e.message}`);
    });
  });

  return {
    token,
    center,
    browser,
    catalog,
    get port() {
      return port;
    },
    get url() {
      return `http://${LISTEN_HOST}:${port}/`;
    },
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        // 待ち受けるアドレスは 127.0.0.1 に固定(config.mjs)。ほかの PC からは届かない
        server.listen(config.port, LISTEN_HOST, resolve);
      });
      port = server.address().port;
      void ytdlp().then((t) => {
        ytdlpVersion = t?.version ?? null;
        ffmpegFound = t ? Boolean(t.ffmpeg) : null;
        push();
      });
      return this;
    },
    async stop() {
      for (const res of clients) res.end();
      clients.clear();
      clearTimeout(pushTimer);
      await browser.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
