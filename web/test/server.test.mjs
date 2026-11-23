// サーバの守り。別のサイト・別の PC から命令を送れないことを、実際に待ち受けさせて確かめる。
// ブラウザも yt-dlp も起動しない。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';

let app;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-server-'));
  app = createApp(
    {
      host: '127.0.0.1', port: 0, outDir: path.join(dir, 'out'), authDir: path.join(dir, 'auth'), dataDir: path.join(dir, 'data'),
      headless: true, browserChannel: '', ytdlpPath: null, allowLoopback: false,
    },
    // yt-dlp は起動させない(見つからない扱い)。積んだものは、起動せずに失敗で終わる
    { ytdlp: async () => null },
  );
  await app.start();
});

after(async () => {
  await app.center.whenIdle();
  await app.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Host などのヘッダを自由に付けて要求する(fetch は Host を変えられない) */
function request({ method = 'GET', pathname = '/', headers = {}, body = null, host = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port: app.port, method, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

const post = (pathname, json, headers = {}) =>
  request({
    method: 'POST',
    pathname,
    headers: { 'Content-Type': 'application/json', 'X-VV-Token': app.token, ...headers },
    body: JSON.stringify(json),
  });

test('画面は開け、合言葉が埋まっていて、枠への埋め込みを禁じている', async () => {
  const r = await request({});
  assert.equal(r.status, 200);
  assert.ok(r.text.includes(app.token), '合言葉が HTML に入っていない');
  assert.ok(!r.text.includes('__VV_TOKEN__'), '置き換え前の印が残っている');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  for (const p of ['/app.js', '/style.css']) assert.equal((await request({ pathname: p })).status, 200, p);
});

test('別の名前(Host)で届いた要求は、画面も API も断る', async () => {
  for (const host of ['evil.example', `evil.example:${app.port}`, '127.0.0.1:1', `127.0.0.1.evil.example:${app.port}`]) {
    const r = await request({ headers: { Host: host } });
    assert.equal(r.status, 403, host);
    assert.ok(!r.text.includes(app.token), `${host} に合言葉を返している`);
    const api = await request({ pathname: `/api/state?token=${app.token}`, headers: { Host: host } });
    assert.equal(api.status, 403, host);
  }
  assert.equal((await request({ headers: { Host: `localhost:${app.port}` } })).status, 200);
});

test('合言葉が無い・違う要求は断る', async () => {
  assert.equal((await request({ pathname: '/api/state' })).status, 401);
  assert.equal((await request({ pathname: '/api/state?token=wrong' })).status, 401);
  assert.equal((await request({ pathname: '/api/events' })).status, 401);
  const noToken = await request({ method: 'POST', pathname: '/api/download', headers: { 'Content-Type': 'application/json' }, body: '{"url":"https://example.com/a"}' });
  assert.equal(noToken.status, 401);
  // 命令(POST)は、URL に付けた合言葉では受けない。URL は履歴やログに残りやすい
  const queryToken = await request({ method: 'POST', pathname: `/api/download?token=${app.token}`, headers: { 'Content-Type': 'application/json' }, body: '{"url":"https://example.com/a"}' });
  assert.equal(queryToken.status, 401);
  assert.equal(app.center.state().queue.length + (app.center.state().running ? 1 : 0), 0, '断った要求が積まれている');
  assert.equal(app.center.state().history.length, 0);
});

test('合言葉が合っていても、別のサイトから(Origin)の要求と JSON でない本文は断る', async () => {
  assert.equal((await post('/api/download', { url: 'https://example.com/a' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/download', { url: 'https://example.com/a' }, { Origin: 'null' })).status, 403);
  assert.equal((await post('/api/download', { url: 'https://example.com/a' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/download', { url: 'https://example.com/a' }, { Origin: `http://127.0.0.1:${app.port}` })).status, 200);
  await app.center.whenIdle();
});

test('読めない URL と対象外のサイトは、積まずに理由を返す', async () => {
  for (const url of ['-o /tmp/x', '--exec=id', 'file:///etc/passwd', 'http://127.0.0.1:1/x', '']) {
    const r = await post('/api/download', { url });
    assert.equal(r.status, 400, url);
    assert.equal(JSON.parse(r.text).ok, false);
  }
  const drm = await post('/api/download', { url: 'https://www.netflix.com/title/80100172' });
  assert.equal(drm.status, 400);
  assert.match(JSON.parse(drm.text).error, /DRM/);
  assert.equal((await post('/api/browser/open', { url: 'file:///etc/passwd' })).status, 400);
  assert.equal(app.browser.isOpen(), false, '断った URL でブラウザが起きている');
});

test('形の違う本文・大きすぎる本文・無い道を断る', async () => {
  const raw = (body) => request({ method: 'POST', pathname: '/api/classify', headers: { 'Content-Type': 'application/json', 'X-VV-Token': app.token }, body });
  assert.equal((await raw('{ 壊れた')).status, 400);
  assert.equal((await raw('[1,2]')).status, 400);
  assert.equal((await raw(JSON.stringify({ input: 'x'.repeat(70 * 1024) }))).status, 413);
  assert.equal((await post('/api/nope', {})).status, 404);
  assert.equal((await request({ pathname: `/api/download?token=${app.token}` })).status, 405);
  // 静的なファイルは決めた 3 つだけ。上の階層やソースは出さない
  for (const p of ['/../package.json', '/app.js/../../src/server.mjs', '/src/server.mjs', '/.auth/cookies.storageState.json', '/%2e%2e/package.json']) {
    assert.equal((await request({ pathname: p })).status, 404, p);
  }
});

test('入力の判定を返し、Vidyard の URL のときだけパスワードの欄を出させる', async () => {
  const yt = JSON.parse((await post('/api/classify', { input: 'youtu.be/abc' })).text);
  assert.equal(yt.suggestions[0].kind, 'download');
  assert.equal(yt.needsPasswordField, false);
  const vy = JSON.parse((await post('/api/classify', { input: 'https://share.vidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y' })).text);
  assert.equal(vy.needsPasswordField, true);
});

test('状態には、Cookie の値ではなく件数だけが出る', async () => {
  const r = await request({ pathname: `/api/state?token=${app.token}` });
  assert.equal(r.status, 200);
  const state = JSON.parse(r.text);
  assert.deepEqual(state.browser, { open: false, cookieCount: 0 });
  assert.equal(state.bookmarks.length, 4);
});

test('ほかの PC からは届かない(この PC の外向きのアドレスでは待ち受けていない)', async (t) => {
  const external = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (!external) return t.skip('外向きの IPv4 アドレスが無く、確かめられない');
  await assert.rejects(request({ host: external.address, headers: { Host: `127.0.0.1:${app.port}` } }), /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/);
});

// ---------- 外から使うための設定(公開用のホスト名と Basic 認証)

test('公開用のホスト名は、Basic 認証と揃っているときだけ設定できる(片方では起動しない)', async () => {
  const { loadConfig } = await import('../src/config.mjs');
  const base = { VIDEO_VAULT_OUT: '/tmp/x' };
  const PW = 'x'.repeat(16);
  assert.deepEqual(
    (({ publicHost, basicUser, host }) => ({ publicHost, basicUser, host }))(loadConfig(base)),
    { publicHost: null, basicUser: null, host: '127.0.0.1' },
  );
  assert.throws(() => loadConfig({ ...base, VIDEO_VAULT_PUBLIC_HOST: 'v.example.test' }), /Basic 認証/);
  assert.throws(() => loadConfig({ ...base, VIDEO_VAULT_PUBLIC_HOST: 'v.example.test', VIDEO_VAULT_BASIC_USER: 'u' }), /両方/);
  assert.throws(() => loadConfig({ ...base, VIDEO_VAULT_BASIC_USER: 'u', VIDEO_VAULT_BASIC_PASSWORD: 'short' }), /16 文字以上/);
  assert.throws(() => loadConfig({ ...base, VIDEO_VAULT_BASIC_USER: 'a:b', VIDEO_VAULT_BASIC_PASSWORD: PW }), /「:」/);
  for (const bad of ['https://v.example.test', 'v.example.test/path', 'v.example.test:443', 'localhost', '*.example.test']) {
    assert.throws(() => loadConfig({ ...base, VIDEO_VAULT_PUBLIC_HOST: bad, VIDEO_VAULT_BASIC_USER: 'u', VIDEO_VAULT_BASIC_PASSWORD: PW }), /ホスト名だけ/, bad);
  }
  const ok = loadConfig({ ...base, VIDEO_VAULT_PUBLIC_HOST: 'V.Example.Test', VIDEO_VAULT_BASIC_USER: 'u', VIDEO_VAULT_BASIC_PASSWORD: PW });
  assert.equal(ok.publicHost, 'v.example.test');
  assert.equal(ok.host, '127.0.0.1', '公開用のホスト名を指定しても、待ち受けるアドレスは変わらない');
});

test('Basic 認証つき: 認証を通るまで何も返さず、通っても合言葉・Host・Origin の確かめは残る。まちがいが続いた相手は締め出す', async () => {
  const { BASIC_MAX_FAILURES, BASIC_LOCK_MS } = await import('../src/server.mjs');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-basic-'));
  const USER = 'owner';
  const PW = 'correct-battery-staple-42';
  let clock = 1_000_000;
  const pub = createApp(
    {
      host: '127.0.0.1', port: 0, outDir: path.join(d, 'out'), authDir: path.join(d, 'auth'), dataDir: path.join(d, 'data'),
      headless: true, browserChannel: '', ytdlpPath: null, allowLoopback: false,
      publicHost: 'v.example.test', basicUser: USER, basicPassword: PW,
    },
    { ytdlp: async () => null, now: () => clock },
  );
  await pub.start();
  const auth = (u, p) => ({ Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` });
  const req = ({ method = 'GET', pathname = '/', headers = {}, body = null }) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: pub.port, method, path: pathname, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      r.on('error', reject);
      if (body !== null) r.write(body);
      r.end();
    });
  const viaTunnel = (ip, extra = {}) => ({ Host: 'v.example.test', 'CF-Connecting-IP': ip, 'X-Forwarded-Proto': 'https', ...extra });
  try {
    // 認証なし・誤りでは、画面も API も 401。合言葉の入った HTML を返さない
    const none = await req({ headers: viaTunnel('198.51.100.1') });
    assert.equal(none.status, 401);
    assert.match(none.headers['www-authenticate'], /^Basic /);
    assert.ok(!none.text.includes(pub.token));
    assert.equal((await req({ pathname: `/api/state?token=${pub.token}`, headers: viaTunnel('198.51.100.1') })).status, 401);
    for (const [u, p] of [[USER, 'wrong'], ['wrong', PW], [USER, ''], ['', ''], [USER, `${PW}x`]]) {
      assert.equal((await req({ headers: viaTunnel('198.51.100.2', auth(u, p)) })).status, 401, `${u}:${p}`);
    }

    // http で来た要求は、認証を求めずに https へ回す(パスワードを暗号化されない区間で送らせない)
    for (const proto of ['http', undefined, 'HTTPS', 'https, http']) {
      const headers = { Host: 'v.example.test', 'CF-Connecting-IP': '198.51.100.7', ...auth(USER, PW) };
      if (proto !== undefined) headers['X-Forwarded-Proto'] = proto;
      const r = await req({ pathname: '/api/state?token=abc', headers });
      assert.equal(r.status, 308, String(proto));
      assert.equal(r.headers.location, 'https://v.example.test/api/state?token=abc');
      assert.equal(r.headers['www-authenticate'], undefined, 'http の要求に認証を求めている');
      assert.ok(!r.text.includes(pub.token));
    }
    assert.equal(none.headers['strict-transport-security'], 'max-age=31536000');
    // この PC の中の名前では、https を求めない(http でしか使えない)
    assert.equal((await req({ headers: { Host: `127.0.0.1:${pub.port}`, ...auth(USER, PW) } })).headers['strict-transport-security'], undefined);

    // 認証を通ると画面が出る。公開用のホスト名でも、この PC の中の名前でも同じ
    const ok = await req({ headers: viaTunnel('198.51.100.3', auth(USER, PW)) });
    assert.equal(ok.status, 200);
    assert.ok(ok.text.includes(pub.token));
    assert.equal((await req({ headers: { Host: `127.0.0.1:${pub.port}`, ...auth(USER, PW) } })).status, 200);
    assert.equal((await req({ headers: { Host: `127.0.0.1:${pub.port}` } })).status, 401, 'この PC の中からでも認証が要る');

    // 認証を通っても、知らない Host・合言葉なし・別のサイトからの命令は断る
    assert.equal((await req({ headers: { ...viaTunnel('198.51.100.3', auth(USER, PW)), Host: 'evil.example' } })).status, 403);
    const post = (headers) => req({ method: 'POST', pathname: '/api/classify', headers: { 'Content-Type': 'application/json', ...headers }, body: '{"input":"youtu.be/abc"}' });
    assert.equal((await post(viaTunnel('198.51.100.3', auth(USER, PW)))).status, 401, '合言葉なしの命令が通った');
    const good = viaTunnel('198.51.100.3', { ...auth(USER, PW), 'X-VV-Token': pub.token });
    assert.equal((await post({ ...good, Origin: 'https://v.example.test' })).status, 200);
    assert.equal((await post({ ...good, Origin: 'http://v.example.test' })).status, 403, 'https でない Origin を受けた');
    assert.equal((await post({ ...good, Origin: 'https://evil.example' })).status, 403);

    // まちがいが続いた相手は、正しいパスワードでも締め出す。ほかの相手は巻き込まない
    const attacker = '203.0.113.9';
    for (let i = 0; i < BASIC_MAX_FAILURES; i++) {
      assert.equal((await req({ headers: viaTunnel(attacker, auth(USER, `guess-${i}`)) })).status, 401);
    }
    const locked = await req({ headers: viaTunnel(attacker, auth(USER, PW)) });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers['retry-after']) > 0);
    assert.ok(!locked.text.includes(pub.token));
    assert.equal((await req({ headers: viaTunnel('198.51.100.3', auth(USER, PW)) })).status, 200, 'ほかの相手まで締め出された');
    // 時間が過ぎれば、また受け付ける
    clock += BASIC_LOCK_MS + 1;
    assert.equal((await req({ headers: viaTunnel(attacker, auth(USER, PW)) })).status, 200);
  } finally {
    await pub.stop();
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('Basic 認証を設定していなければ、公開用のホスト名では受け付けない', async () => {
  const r = await request({ headers: { Host: 'v.example.test' } });
  assert.equal(r.status, 403);
});
