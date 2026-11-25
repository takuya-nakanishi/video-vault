// 端末の鍵で受ける口(/api/v1/)。拡張機能などが、画面を通さずに URL と Cookie を送ってくる。
// 実際に待ち受けさせて確かめる。yt-dlp は起動しない(偽物に差し替える)。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DeviceStore, KEY_PATTERN } from '../src/auth/devices.mjs';
import { parseJobCookies, MAX_JOB_COOKIES } from '../src/jobCookies.mjs';
import { UserStore } from '../src/auth/users.mjs';
import { hashPassword } from '../src/auth/password.mjs';
import { createApp, DEVICE_MAX_FAILURES, DEVICE_LOCK_MS } from '../src/server.mjs';
import { HistoryStatus } from '../src/history.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vv-device-'));

// ---------- 端末の表

test('端末の鍵: 作ったときだけ見え、ファイルには残らない。作り直すと前の鍵は効かない。消すと効かない', () => {
  const dir = tmp();
  try {
    const store = new DeviceStore(path.join(dir, 'nested', 'devices.json'));
    const key = store.create('home-pc', 1000);
    assert.match(key, KEY_PATTERN);
    assert.deepEqual(store.verify(key), { name: 'home-pc' });
    assert.ok(!fs.readFileSync(store.file, 'utf8').includes(key.slice(4)), 'ファイルに鍵がそのまま入っている');
    if (process.platform !== 'win32') assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.deepEqual(store.list(), [{ name: 'home-pc', createdAt: 1000 }]);

    const other = store.create('office-pc');
    assert.deepEqual(store.verify(other), { name: 'office-pc' });
    const again = store.create('home-pc');
    assert.equal(store.verify(key), null, '作り直す前の鍵が効く');
    assert.deepEqual(store.verify(again), { name: 'home-pc' });
    assert.equal(store.list().length, 2);

    for (const bad of ['', null, 'vvd_short', `${again}x`, again.replace('vvd_', 'xxx_'), again.toUpperCase()]) {
      assert.equal(store.verify(bad), null, String(bad));
    }
    for (const badName of ['', 'a b', '日本語', 'x'.repeat(41), '../etc']) assert.throws(() => store.create(badName), /名前/, badName);
    assert.equal(store.remove('home-pc'), true);
    assert.equal(store.verify(again), null);
    assert.equal(store.remove('home-pc'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('端末の表: 壊れたファイルは「端末がいない」と読まずに止める', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'devices.json');
    fs.writeFileSync(file, '{ 壊れた');
    assert.throws(() => new DeviceStore(file).verify(`vvd_${'a'.repeat(43)}`), /端末の表を読めない/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- 送られてくる Cookie の形

test('送られてくる Cookie: 無ければ null、形の合うものだけを取り込み、並びでない・多すぎるものは断る', () => {
  assert.equal(parseJobCookies(undefined), null);
  assert.equal(parseJobCookies(null), null);
  assert.deepEqual(parseJobCookies([]), []);
  const got = parseJobCookies([
    { name: 'sid', value: 'abc', domain: '.Example.Test', path: '/', secure: true, httpOnly: true, expires: 1900000000 },
    { name: 'pref', value: '', domain: 'www.example.test' },
    { name: 'bad-domain', value: 'v', domain: 'http://example.test' },
    { name: 'bad-path', value: 'v', domain: 'example.test', path: 'relative' },
    { name: '', value: 'v', domain: 'example.test' },
    { name: 'long', value: 'x'.repeat(9000), domain: 'example.test' },
    { name: 'num', value: 5, domain: 'example.test' },
    null,
  ]);
  assert.deepEqual(got, [
    { name: 'sid', value: 'abc', domain: '.example.test', path: '/', expires: 1900000000, httpOnly: true, secure: true },
    { name: 'pref', value: '', domain: 'www.example.test', path: '/', expires: -1, httpOnly: false, secure: false },
  ]);
  assert.throws(() => parseJobCookies('sid=abc'), /並び/);
  assert.throws(() => parseJobCookies({}), /並び/);
  assert.throws(() => parseJobCookies(Array.from({ length: MAX_JOB_COOKIES + 1 }, () => ({ name: 'a', value: 'b', domain: 'example.test' }))), /多すぎる/);
});

// ---------- サーバ

const PUBLIC = 'v.example.test';
let dir;
let app;
let devices;
let key;
let clock;
let ipSeq = 0;
/** 偽の yt-dlp に渡った引数と、そのとき Cookie のファイルに書かれていた中身 */
const runs = [];

before(async () => {
  dir = tmp();
  clock = Date.now();
  const usersFile = path.join(dir, 'users.json');
  new UserStore(usersFile).upsert('owner@example.test', { passwordHash: await hashPassword('correct-battery-staple-42', { N: 1 << 14, r: 8, p: 1 }) });
  const devicesFile = path.join(dir, 'devices.json');
  devices = new DeviceStore(devicesFile);
  key = devices.create('test-pc');
  app = createApp(
    {
      host: '127.0.0.1', port: 0, outDir: path.join(dir, 'out'), authDir: path.join(dir, 'auth'), dataDir: path.join(dir, 'data'),
      headless: true, browserChannel: '', ytdlpPath: null, allowLoopback: false, usersFile, devicesFile, publicHost: PUBLIC,
    },
    {
      ytdlp: async () => ({ command: 'yt-dlp', prefixArgs: [] }),
      now: () => clock,
      center: {
        // ログイン用のブラウザ(Surface)の Cookie。送り手が Cookie を渡したら、こちらは使われないこと
        cookiesProvider: async () => [{ name: 'surface', value: 'surface-cookie', domain: 'example.test', path: '/' }],
        run: ({ args }) => {
          const i = args.indexOf('--cookies');
          runs.push({ args, cookies: i >= 0 ? fs.readFileSync(args[i + 1], 'utf8') : null });
          return { done: Promise.resolve({ code: 0, signal: null }), cancel: () => {} };
        },
      },
    },
  );
  await app.start();
});

after(async () => {
  await app.center.whenIdle();
  await app.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

function req({ method = 'GET', pathname = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: app.port, method, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body !== null) r.write(body);
    r.end();
  });
}
const outside = (extra = {}, ip = `198.51.100.${(ipSeq += 1)}`) => ({ Host: PUBLIC, 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': ip, ...extra });
/** 値が undefined のヘッダは「付けない」の意味。送る前に外す */
const present = (headers) => Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined));
const send = (json, headers = {}) =>
  req({
    method: 'POST',
    pathname: '/api/v1/downloads',
    headers: present(outside({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Origin: 'chrome-extension://abcdefghijklmnop', ...headers })),
    body: typeof json === 'string' ? json : JSON.stringify(json),
  });
const finished = (id) => app.center.state().history.find((h) => h.id === id && h.status !== HistoryStatus.RUNNING);

test('鍵が合えば、送った URL を順番待ちに入れ、送った Cookie だけを yt-dlp に渡す。Cookie はどこにも残らない', async () => {
  const SECRET = 'sent-cookie-secret-31f';
  const r = await send({
    url: 'https://example.com/watch/1',
    quality: 'SD',
    cookies: [{ name: 'sid', value: SECRET, domain: '.example.com', path: '/', secure: true, httpOnly: true, expires: -1 }],
  });
  assert.equal(r.status, 200, r.text);
  const { ok, id } = JSON.parse(r.text);
  assert.equal(ok, true);
  await app.center.whenIdle();
  const h = finished(id);
  assert.equal(h.status, HistoryStatus.SUCCESS);
  assert.equal(h.quality, 'SD');
  assert.equal(h.url, 'https://example.com/watch/1');
  const run = runs.at(-1);
  assert.equal(run.args.at(-1), 'https://example.com/watch/1');
  assert.ok(run.cookies.includes(`#HttpOnly_.example.com\tTRUE\t/\tTRUE\t2145916800\tsid\t${SECRET}`), run.cookies);
  assert.ok(!run.cookies.includes('surface-cookie'), '送り手が Cookie を渡したのに、Surface のブラウザの Cookie も渡っている');
  assert.ok(!fs.existsSync(run.args[run.args.indexOf('--cookies') + 1]), 'Cookie のファイルが残っている');
  // 状態・履歴・画面に返すものに、Cookie の値が出ない
  assert.ok(!JSON.stringify(app.center.state()).includes(SECRET));
  assert.ok(!fs.readFileSync(path.join(dir, 'data', 'history.json'), 'utf8').includes(SECRET));
  assert.equal(app.center.state().history.find((x) => x.id === id).source, undefined, '履歴に余分な項目が入っている');
});

test('Cookie を渡さなければ、Surface のブラウザの Cookie を使う。空の並びなら、Cookie なしで取る', async () => {
  const a = JSON.parse((await send({ url: 'https://example.com/watch/2' })).text);
  await app.center.whenIdle();
  assert.ok(finished(a.id));
  assert.ok(runs.at(-1).cookies.includes('surface-cookie'));
  const b = JSON.parse((await send({ url: 'https://example.com/watch/3', cookies: [] })).text);
  await app.center.whenIdle();
  assert.ok(finished(b.id));
  assert.equal(runs.at(-1).cookies, null, '空の並びなのに Cookie が渡っている');
});

test('鍵が無い・違う・消した鍵は断り、何も積まない。画面のログインの Cookie でも入れない', async () => {
  const before = app.center.state().history.length;
  for (const auth of [undefined, '', 'Bearer', `Bearer ${key}x`, `Basic ${key}`, `bearer ${key}`, `Bearer vvd_${'A'.repeat(43)}`]) {
    const r = await send({ url: 'https://example.com/watch/x' }, { Authorization: auth });
    assert.equal(r.status, 401, String(auth));
    assert.equal(r.headers['www-authenticate'], 'Bearer');
  }
  const gone = devices.create('temporary');
  assert.equal((await send({ url: 'https://example.com/watch/y' }, { Authorization: `Bearer ${gone}` })).status, 200);
  await app.center.whenIdle();
  devices.remove('temporary');
  assert.equal((await send({ url: 'https://example.com/watch/z' }, { Authorization: `Bearer ${gone}` })).status, 401, '消した鍵が効く');
  // 画面のログイン(Cookie)では、この口に入れない
  const login = await req({ method: 'POST', pathname: '/auth/login', headers: outside({ 'Content-Type': 'application/json', Origin: `https://${PUBLIC}` }), body: JSON.stringify({ email: 'owner@example.test', password: 'correct-battery-staple-42' }) });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await send({ url: 'https://example.com/watch/w' }, { Authorization: undefined, Cookie: cookie })).status, 401);
  await app.center.whenIdle();
  assert.equal(app.center.state().history.length, before + 1, '断った要求が積まれている');
});

test('鍵のまちがいが続いた相手は、正しい鍵でも 15 分のあいだ受け付けない。ほかの相手は巻き込まない', async () => {
  const attacker = '203.0.113.50';
  for (let i = 0; i < DEVICE_MAX_FAILURES; i++) {
    assert.equal((await send({ url: 'https://example.com/a' }, { ...outside({}, attacker), Authorization: `Bearer vvd_${String(i).padStart(43, 'x')}` })).status, 401);
  }
  const locked = await send({ url: 'https://example.com/a' }, outside({}, attacker));
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers['retry-after']) > 0);
  assert.equal((await req({ pathname: '/api/v1/ping', headers: outside({ Authorization: `Bearer ${key}` }) })).status, 200, 'ほかの相手まで締め出された');
  clock += DEVICE_LOCK_MS + 1;
  const ok = await send({ url: 'https://example.com/after-lock' }, outside({}, attacker));
  assert.equal(ok.status, 200);
  await app.center.whenIdle();
});

test('形の違う要求・読めない URL・対象外のサイトは、理由を返して積まない', async () => {
  const before = app.center.state().history.length;
  const cases = [
    [{ url: 'file:///etc/passwd' }, 400],
    [{ url: '-o /tmp/x' }, 400],
    [{ url: 'http://127.0.0.1:8787/' }, 400],
    [{ url: 'https://www.netflix.com/title/80100172' }, 400],
    [{ url: 'https://example.com/v', cookies: 'sid=abc' }, 400],
    [{}, 400],
    ['{ 壊れた', 400],
    ['[1,2]', 400],
  ];
  for (const [json, status] of cases) {
    const r = await send(json);
    assert.equal(r.status, status, JSON.stringify(json));
    assert.ok(JSON.parse(r.text).error, `理由が無い: ${JSON.stringify(json)}`);
  }
  assert.equal((await send({ url: 'https://example.com/v' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await req({ pathname: '/api/v1/downloads', headers: outside({ Authorization: `Bearer ${key}` }) })).status, 405);
  assert.equal((await req({ pathname: '/api/v1/nope', headers: outside({ Authorization: `Bearer ${key}` }) })).status, 404);
  // Cookie の分、上限は画面より大きい。それでも 512KB を超える本文は断る
  const big = await send({ url: 'https://example.com/v', cookies: [{ name: 'a', value: 'x'.repeat(600 * 1024), domain: 'example.com' }] });
  assert.equal(big.status, 413);
  await app.center.whenIdle();
  assert.equal(app.center.state().history.length, before, '断った要求が積まれている');
});

test('http で来た要求は、鍵を確かめる前に https へ回す(鍵を暗号化されない区間で送らせない)', async () => {
  const r = await req({ method: 'POST', pathname: '/api/v1/downloads', headers: { Host: PUBLIC, 'X-Forwarded-Proto': 'http', Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{"url":"https://example.com/http"}' });
  assert.equal(r.status, 308);
  assert.equal(r.headers.location, `https://${PUBLIC}/api/v1/downloads`);
  assert.equal(app.center.state().history.some((h) => h.url === 'https://example.com/http'), false);
});

test('つながるかの確かめ(ping)は、端末の名前だけを返す', async () => {
  const r = await req({ pathname: '/api/v1/ping', headers: outside({ Authorization: `Bearer ${key}` }) });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { ok: true, device: 'test-pc' });
  assert.equal((await req({ method: 'POST', pathname: '/api/v1/ping', headers: outside({ Authorization: `Bearer ${key}` }) })).status, 405);
});
