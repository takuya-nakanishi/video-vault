// ログイン。自前のログイン(メールアドレスとパスワード)と「Google でログイン」を、実際に待ち受けさせて確かめる。
// 相手の Google は、この PC の中に立てる偽物(test/fakeIdp.mjs)。外へは通信しない。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../src/auth/password.mjs';
import { UserStore, normalizeEmail } from '../src/auth/users.mjs';
import { SessionStore, SESSION_TTL_MS } from '../src/auth/sessions.mjs';
import { OidcClient, OidcError } from '../src/auth/oidc.mjs';
import { LOGIN_MAX_FAILURES, LOGIN_LOCK_MS, ACCOUNT_FREE_FAILURES, ACCOUNT_WAIT_MIN_MS } from '../src/auth/http.mjs';
import { createApp } from '../src/server.mjs';
import { loadConfig } from '../src/config.mjs';
import { startFakeIdp } from './fakeIdp.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vv-auth-'));
/** 試験用の軽いハッシュ(照合が受ける下限の強さ)。本番の強さは既定のまま */
const LIGHT = { N: 1 << 14, r: 8, p: 1 };

// ---------- パスワード

test('パスワード: ハッシュにして持ち、合うものだけを通す。短いものは決めさせない', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.match(hash, /^scrypt\$131072\$8\$1\$/, '本番の強さ(N=2^17)で作られていない');
  assert.ok(!hash.includes('correct horse'), 'ハッシュに元のパスワードが入っている');
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('correct horse batterx', hash), false);
  assert.equal(await verifyPassword('', hash), false);
  assert.notEqual(await hashPassword('correct horse battery', LIGHT), await hashPassword('correct horse battery', LIGHT), '同じパスワードが同じハッシュになる(塩が効いていない)');
  await assert.rejects(hashPassword('x'.repeat(MIN_PASSWORD_LENGTH - 1)), /12 文字以上/);
});

test('パスワード: 書き換えられた保存値(弱い設定・形の違い)は、合っていないものとして扱う', async () => {
  const hash = await hashPassword('correct horse battery', LIGHT);
  const parts = hash.split('$');
  const weak = ['scrypt', '1024', '8', '1', parts[4], parts[5]].join('$');
  for (const bad of [weak, 'plain$correct horse battery', '', null, hash.replace('scrypt', 'md5'), parts.slice(0, 5).join('$')]) {
    assert.equal(await verifyPassword('correct horse battery', bad), false, String(bad).slice(0, 30));
  }
});

// ---------- 利用者の表

test('利用者の表: メールアドレスは小文字にそろえ、形の違うものは入れない。ファイルは持ち主だけが読める', () => {
  const dir = tmp();
  try {
    const store = new UserStore(path.join(dir, 'nested', 'users.json'));
    assert.deepEqual(store.list(), []);
    store.upsert('Owner@Example.Test', { passwordHash: 'h1' });
    assert.equal(store.find('owner@example.test').passwordHash, 'h1');
    assert.equal(store.find(' OWNER@example.test ').email, 'owner@example.test');
    store.upsert('owner@example.test', { googleSub: 'sub-1' });
    assert.deepEqual(store.list(), [{ email: 'owner@example.test', passwordHash: 'h1', googleSub: 'sub-1' }], '書き換えで別の項目が消えた・行が増えた');
    assert.equal(store.findByGoogleSub('sub-1').email, 'owner@example.test');
    assert.equal(store.findByGoogleSub(''), null);
    assert.equal(store.findByGoogleSub(null), null);
    for (const bad of ['', 'no-at', 'a@b', 'a b@example.test', 'a@exa mple.test', '<x>@example.test', 'a@example.test\n']) {
      assert.equal(normalizeEmail(bad) === null || bad.trim() !== bad, true, bad);
      if (normalizeEmail(bad) === null) assert.throws(() => store.upsert(bad, {}), /形が違う/, bad);
    }
    if (process.platform !== 'win32') assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.equal(store.remove('owner@example.test'), true);
    assert.equal(store.remove('owner@example.test'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('利用者の表: 壊れたファイルを「利用者がいない」と読まない(ログインが要らない状態に見せない)', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'users.json');
    fs.writeFileSync(file, '{ 壊れた');
    assert.throws(() => new UserStore(file).list(), /利用者の表を読めない/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- セッション

test('セッション: Cookie の値はファイルに残さず、期限・消去・入れ直しをまたいだ持ち越しが効く', () => {
  const dir = tmp();
  try {
    let clock = 1_000_000;
    const file = path.join(dir, 'sessions.json');
    const store = new SessionStore(file, () => clock);
    const a = store.create('a@example.test');
    const b = store.create('b@example.test');
    assert.notEqual(a, b);
    assert.deepEqual(store.get(a), { email: 'a@example.test' });
    assert.equal(store.get('知らない値'), null);
    assert.equal(store.get(''), null);
    assert.equal(store.get(undefined), null);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes(a) && !text.includes(b), 'ファイルに Cookie の値がそのまま入っている');
    // 入れ直しても続く
    assert.deepEqual(new SessionStore(file, () => clock).get(a), { email: 'a@example.test' });
    store.deleteFor('a@example.test');
    assert.equal(store.get(a), null);
    assert.deepEqual(store.get(b), { email: 'b@example.test' }, 'ほかの人のセッションまで消えた');
    clock += SESSION_TTL_MS;
    assert.equal(store.get(b), null, '期限が切れても通る');
    assert.equal(new SessionStore(file, () => clock).get(b), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- Google でログイン(ID トークンの確かめ)

const CLIENT = { clientId: 'client-abc', clientSecret: 'secret-xyz' };

test('ID トークン: 正しいものは通し、署名・方式・発行者・宛先・期限・nonce のどれかが違えば断る', async () => {
  const idp = await startFakeIdp(CLIENT);
  try {
    const oidc = new OidcClient({ ...CLIENT, redirectUri: 'https://v.example.test/auth/google/callback', issuer: idp.issuer, allowHttp: true });
    const nowSec = Math.floor(Date.now() / 1000);
    const base = { iss: idp.issuer, aud: CLIENT.clientId, iat: nowSec, exp: nowSec + 300, nonce: 'n-1', sub: 'sub-1', email: 'a@example.test', email_verified: true };
    assert.equal((await oidc.verifyIdToken(idp.sign(base), 'n-1')).sub, 'sub-1');

    const other = await startFakeIdp(CLIENT); // 別の鍵を持つ相手
    const cases = {
      '別の鍵の署名': other.sign(base),
      '署名なしを名乗る': idp.sign(base, { alg: 'none' }),
      '共通鍵の方式を名乗る': idp.sign(base, { alg: 'HS256' }),
      '知らない鍵の名前': idp.sign(base, { kid: 'unknown' }),
      '発行者が違う': idp.sign({ ...base, iss: 'https://evil.example' }),
      '宛先が違う': idp.sign({ ...base, aud: 'someone-else' }),
      '宛先が複数で azp が無い': idp.sign({ ...base, aud: [CLIENT.clientId, 'someone-else'] }),
      '期限切れ': idp.sign({ ...base, exp: nowSec - 600 }),
      '時刻が先すぎる': idp.sign({ ...base, iat: nowSec + 600 }),
      'nonce が違う': idp.sign({ ...base, nonce: 'n-2' }),
      'nonce が無い': idp.sign({ ...base, nonce: undefined }),
      '利用者の ID が無い': idp.sign({ ...base, sub: '' }),
      '形が違う': 'not.a.jwt.token',
    };
    await other.stop();
    for (const [name, token] of Object.entries(cases)) {
      await assert.rejects(oidc.verifyIdToken(token, 'n-1'), OidcError, name);
    }
    // 中身を書き換えると、署名が合わなくなる
    const [h, , s] = idp.sign(base).split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...base, sub: 'attacker' })).toString('base64url')}.${s}`;
    await assert.rejects(oidc.verifyIdToken(forged, 'n-1'), /署名が合わない/);
  } finally {
    await idp.stop();
  }
});

test('相手の名乗る発行者が設定と違えば、つながない。https でない口も受けない', async () => {
  const idp = await startFakeIdp(CLIENT);
  try {
    const wrongIssuer = new OidcClient({ ...CLIENT, redirectUri: 'https://v.example.test/cb', issuer: `${idp.issuer}/other`, allowHttp: true });
    await assert.rejects(wrongIssuer.discovery(), OidcError);
    // 試験用の切り替えが無ければ、http の相手は受けない
    const strict = new OidcClient({ ...CLIENT, redirectUri: 'https://v.example.test/cb', issuer: idp.issuer });
    await assert.rejects(strict.discovery(), /https でない/);
  } finally {
    await idp.stop();
  }
});

// ---------- 設定

test('設定: Google の ID とシークレットは対で、公開用のホスト名が要る。待ち受けるアドレスは変わらない', () => {
  const base = { VIDEO_VAULT_OUT: '/tmp/x' };
  assert.deepEqual((({ publicHost, googleClientId, host }) => ({ publicHost, googleClientId, host }))(loadConfig(base)), { publicHost: null, googleClientId: null, host: '127.0.0.1' });
  assert.throws(() => loadConfig({ ...base, VIDEO_VAULT_PUBLIC_HOST: 'v.example.test', VIDEO_VAULT_GOOGLE_CLIENT_ID: 'id' }), /両方/);
  assert.throws(() => loadConfig({ ...base, VIDEO_VAULT_GOOGLE_CLIENT_ID: 'id', VIDEO_VAULT_GOOGLE_CLIENT_SECRET: 's' }), /VIDEO_VAULT_PUBLIC_HOST/);
  for (const bad of ['https://v.example.test', 'v.example.test/path', 'v.example.test:443', 'localhost', '*.example.test']) {
    assert.throws(() => loadConfig({ ...base, VIDEO_VAULT_PUBLIC_HOST: bad }), /ホスト名だけ/, bad);
  }
  const ok = loadConfig({ ...base, VIDEO_VAULT_PUBLIC_HOST: 'V.Example.Test', VIDEO_VAULT_GOOGLE_CLIENT_ID: 'id', VIDEO_VAULT_GOOGLE_CLIENT_SECRET: 's' });
  assert.equal(ok.publicHost, 'v.example.test');
  assert.equal(ok.host, '127.0.0.1');
});

// ---------- サーバ(ログインの流れ)

const PUBLIC = 'v.example.test';
const OWNER = 'owner@example.test';
const OWNER_PW = 'correct-battery-staple-42';
const OTHER = 'second@example.test';
const OTHER_PW = 'another-long-password-77';
let dir;
let app;
let idp;
let users;
let clock;
let ipSeq = 0;

function appConfig(d, extra = {}) {
  return {
    host: '127.0.0.1', port: 0, outDir: path.join(d, 'out'), authDir: path.join(d, 'auth'), dataDir: path.join(d, 'data'),
    headless: true, browserChannel: '', ytdlpPath: null, allowLoopback: false, usersFile: path.join(d, 'users.json'), ...extra,
  };
}

before(async () => {
  dir = tmp();
  clock = Date.now();
  idp = await startFakeIdp(CLIENT);
  users = new UserStore(path.join(dir, 'users.json'));
  users.upsert(OWNER, { passwordHash: await hashPassword(OWNER_PW, LIGHT) });
  users.upsert(OTHER, { passwordHash: await hashPassword(OTHER_PW, LIGHT) });
  app = createApp(appConfig(dir, { publicHost: PUBLIC }), {
    ytdlp: async () => null,
    now: () => clock,
    oidc: new OidcClient({ ...CLIENT, redirectUri: `https://${PUBLIC}/auth/google/callback`, issuer: idp.issuer, allowHttp: true }),
  });
  await app.start();
});

after(async () => {
  await app.center.whenIdle();
  await app.stop();
  await idp.stop();
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
/** トンネル越しに来た要求のヘッダ。相手(IP)は、指定が無ければ毎回変える */
const outside = (extra = {}, ip = `198.51.100.${(ipSeq += 1)}`) => ({ Host: PUBLIC, 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': ip, ...extra });
/** 値が undefined のヘッダは「付けない」の意味。送る前に外す */
const present = (headers) => Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined));
const login = (email, password, headers = outside()) =>
  req({ method: 'POST', pathname: '/auth/login', headers: present({ 'Content-Type': 'application/json', Origin: `https://${PUBLIC}`, ...headers }), body: JSON.stringify({ email, password }) });
/** 応答の Set-Cookie から、次の要求に付ける Cookie を作る(消す指定のものは除く) */
const cookieFrom = (res) => (res.headers['set-cookie'] ?? []).filter((c) => !/Max-Age=0/.test(c)).map((c) => c.split(';')[0]).join('; ');

test('ログインの前は、画面も API も合言葉も返さない。開いているのはログインの画面だけ', async () => {
  const top = await req({ headers: outside() });
  assert.equal(top.status, 302);
  assert.equal(top.headers.location, '/login');
  assert.ok(!top.text.includes(app.token));
  for (const p of [`/api/state?token=${app.token}`, `/api/events?token=${app.token}`, '/app.js', '/nope']) {
    const r = await req({ pathname: p, headers: outside() });
    assert.equal(r.status, 401, p);
    assert.ok(!r.text.includes(app.token), p);
  }
  const post = await req({ method: 'POST', pathname: '/api/download', headers: outside({ 'Content-Type': 'application/json', 'X-VV-Token': app.token, Origin: `https://${PUBLIC}` }), body: '{"url":"https://example.com/a"}' });
  assert.equal(post.status, 401, '合言葉を知っていても、ログインなしでは命令できない');
  assert.equal(app.center.state().history.length, 0);

  const page = await req({ pathname: '/login', headers: outside() });
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes(app.token), 'ログインの画面に合言葉が入っている');
  for (const p of ['/login.js', '/style.css']) assert.equal((await req({ pathname: p, headers: outside() })).status, 200, p);
  assert.deepEqual(JSON.parse((await req({ pathname: '/auth/config', headers: outside() })).text), { google: true });
});

test('パスワードのログイン: 違うパスワード・いない人は同じ文で断り、別のサイトからの要求は受けない', async () => {
  const wrong = await login(OWNER, 'wrong-password-000000');
  const nobody = await login('nobody@example.test', OWNER_PW);
  assert.equal(wrong.status, 401);
  assert.equal(nobody.status, 401);
  assert.equal(wrong.text, nobody.text, 'いる人といない人で応答が違う');
  assert.equal(wrong.headers['set-cookie'], undefined);
  for (const bad of [{ email: OWNER }, { password: OWNER_PW }, { email: 5, password: OWNER_PW }, { email: OWNER, password: ['x'] }, {}]) {
    const r = await req({ method: 'POST', pathname: '/auth/login', headers: outside({ 'Content-Type': 'application/json', Origin: `https://${PUBLIC}` }), body: JSON.stringify(bad) });
    assert.equal(r.status, 401, JSON.stringify(bad));
  }
  assert.equal((await login(OWNER, OWNER_PW, outside({ Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await login(OWNER, OWNER_PW, outside({ Origin: undefined }))).status, 403, 'Origin の無い要求でログインできた');
  assert.equal((await login(OWNER, OWNER_PW, outside({ 'Content-Type': 'text/plain' }))).status, 415);
});

test('パスワードのログイン: 通るとセッションの Cookie が付き、画面と API が使える。命令には合言葉も要る', async () => {
  const ok = await login(` ${OWNER.toUpperCase()} `, OWNER_PW);
  assert.equal(ok.status, 200);
  const set = ok.headers['set-cookie'][0];
  assert.match(set, /^__Host-vv_session=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  assert.ok(!ok.text.includes(set.split(';')[0].split('=')[1]), '応答の本文に Cookie の値が入っている');
  const cookie = cookieFrom(ok);

  const page = await req({ headers: outside({ Cookie: cookie }) });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(app.token));
  assert.ok(page.text.includes(`data-user="${OWNER}"`), '誰で入っているかが画面に出ていない');
  assert.equal((await req({ pathname: `/api/state?token=${app.token}`, headers: outside({ Cookie: cookie }) })).status, 200);
  // ログインしていても、合言葉・Origin の確かめは残る
  const post = (headers) => req({ method: 'POST', pathname: '/api/classify', headers: outside({ 'Content-Type': 'application/json', Cookie: cookie, ...headers }), body: '{"input":"youtu.be/abc"}' });
  assert.equal((await post({})).status, 401, '合言葉なしの命令が通った');
  assert.equal((await post({ 'X-VV-Token': app.token, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ 'X-VV-Token': app.token, Origin: `https://${PUBLIC}` })).status, 200);
  // ログイン済みでログインの画面を開いたら、画面へ戻す
  assert.equal((await req({ pathname: '/login', headers: outside({ Cookie: cookie }) })).headers.location, '/');
  // でたらめな Cookie・別の名前の Cookie では入れない
  assert.equal((await req({ headers: outside({ Cookie: '__Host-vv_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }) })).status, 302);
  assert.equal((await req({ headers: outside({ Cookie: cookie.replace('__Host-vv_session', 'vv_session') }) })).status, 302, '公開用の名前で、Secure でない名前の Cookie が通った');

  // ログアウトすると、その Cookie はもう使えない
  assert.equal((await req({ method: 'POST', pathname: '/auth/logout', headers: outside({ Cookie: cookie, Origin: 'https://evil.example' }) })).status, 403);
  const out = await req({ method: 'POST', pathname: '/auth/logout', headers: outside({ Cookie: cookie, Origin: `https://${PUBLIC}` }) });
  assert.equal(out.status, 200);
  assert.match(out.headers['set-cookie'][0], /^__Host-vv_session=; .*Max-Age=0/);
  assert.equal((await req({ headers: outside({ Cookie: cookie }) })).status, 302, 'ログアウトしたあとの Cookie が通った');
});

test('この PC の中(http)からもログインが要り、Cookie は Secure なしの名前で付く', async () => {
  const local = { Host: `127.0.0.1:${app.port}` };
  assert.equal((await req({ headers: local })).status, 302);
  const ok = await req({ method: 'POST', pathname: '/auth/login', headers: { ...local, 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${app.port}` }, body: JSON.stringify({ email: OWNER, password: OWNER_PW }) });
  assert.equal(ok.status, 200);
  assert.match(ok.headers['set-cookie'][0], /^vv_session=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
  assert.equal((await req({ headers: { ...local, Cookie: cookieFrom(ok) } })).status, 200);
});

test('まちがいが続いた相手(IP)は、正しいパスワードでも 15 分のあいだ受け付けない。ほかの相手は巻き込まない', async () => {
  const attacker = '203.0.113.9';
  // アカウントごとの待ちに掛からないよう、いない人を当てさせる
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
    assert.equal((await login(`guess${i}@example.test`, 'wrong-password-000000', outside({}, attacker))).status, 401);
  }
  const locked = await login(OWNER, OWNER_PW, outside({}, attacker));
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers['retry-after']) > 0);
  assert.equal(locked.headers['set-cookie'], undefined);
  assert.equal((await login(OWNER, OWNER_PW)).status, 200, 'ほかの相手まで締め出された');
  clock += LOGIN_LOCK_MS + 1;
  assert.equal((await login(OWNER, OWNER_PW, outside({}, attacker))).status, 200, '時間が過ぎても受け付けない');
});

test('同じアカウントへのまちがいが続いたら、相手を変えても待たせる。ほかのアカウントは巻き込まず、時間が過ぎれば受ける', async () => {
  // 相手(IP)は毎回変える。IP ごとの締め出しには掛からない
  for (let i = 0; i < ACCOUNT_FREE_FAILURES; i++) assert.equal((await login(OTHER, 'wrong-password-000000')).status, 401, `${i + 1} 回目`);
  const waiting = await login(OTHER, OTHER_PW);
  assert.equal(waiting.status, 429, '待たせている間に、正しいパスワードが通った');
  assert.ok(Number(waiting.headers['retry-after']) <= ACCOUNT_WAIT_MIN_MS / 1000);
  assert.equal((await login(OWNER, OWNER_PW)).status, 200, 'ほかのアカウントまで待たされた');
  clock += ACCOUNT_WAIT_MIN_MS + 1;
  assert.equal((await login(OTHER, OTHER_PW)).status, 200, '時間が過ぎても受け付けない');
});

test('表から消した利用者は、セッションが残っていても通さない', async () => {
  users.upsert('temp@example.test', { passwordHash: await hashPassword('temporary-password-11', LIGHT) });
  const ok = await login('temp@example.test', 'temporary-password-11');
  const cookie = cookieFrom(ok);
  assert.equal((await req({ headers: outside({ Cookie: cookie }) })).status, 200);
  users.remove('temp@example.test');
  assert.equal((await req({ headers: outside({ Cookie: cookie }) })).status, 302);
});

/** 「Google でログイン」を押してから、偽の Google の許可の画面に着くまで */
async function startGoogle() {
  const r = await req({ pathname: '/auth/google', headers: outside() });
  assert.equal(r.status, 302);
  assert.match(r.headers['set-cookie'][0], /^__Host-vv_oidc=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
  return { authUrl: r.headers.location, cookie: cookieFrom(r) };
}
const callback = (query, cookie) => req({ pathname: `/auth/google/callback?${new URLSearchParams(query)}`, headers: outside(cookie ? { Cookie: cookie } : {}) });

test('Google でログイン: 表にいる人は入れ、Google の変わらない ID を結ぶ。次からは、アドレスが変わっても同じ人として入れる', async () => {
  const { authUrl, cookie } = await startGoogle();
  assert.ok(authUrl.startsWith(`${idp.issuer}/authorize?`));
  const { code, state, params } = idp.approve(authUrl, { sub: 'google-sub-owner', email: OWNER, email_verified: true });
  assert.equal(params.redirect_uri, `https://${PUBLIC}/auth/google/callback`);
  assert.equal(params.client_id, CLIENT.clientId);
  assert.equal(params.response_type, 'code');
  assert.equal(params.code_challenge_method, 'S256');
  assert.ok(params.code_challenge.length >= 43 && params.nonce.length >= 32 && state.length >= 32);
  assert.ok(!authUrl.includes(CLIENT.clientSecret), '許可の画面の URL にシークレットが入っている');

  const back = await callback({ code, state }, cookie);
  assert.equal(back.status, 302);
  assert.equal(back.headers.location, '/');
  const session = cookieFrom(back);
  assert.match(session, /^__Host-vv_session=/);
  assert.ok(back.headers['set-cookie'].some((c) => /^__Host-vv_oidc=; .*Max-Age=0/.test(c)), '途中の状態の Cookie を消していない');
  assert.ok((await req({ headers: outside({ Cookie: session }) })).text.includes(`data-user="${OWNER}"`));
  assert.equal(users.find(OWNER).googleSub, 'google-sub-owner');
  assert.equal(idp.seen.pkceFailures, 0, 'PKCE の検証子が、許可のときの challenge と対になっていない');

  // 同じコードは 2 度使えない(戻りの URL を後から拾われても入れない)
  assert.equal((await callback({ code, state }, cookie)).headers.location, '/login?error=google_failed');

  // 2 回目: Google 側でアドレスが変わっていても、ID で同じ人として入れる
  const again = await startGoogle();
  const a2 = idp.approve(again.authUrl, { sub: 'google-sub-owner', email: 'renamed@example.test', email_verified: true });
  const back2 = await callback({ code: a2.code, state: a2.state }, again.cookie);
  assert.equal(back2.headers.location, '/');
  assert.ok((await req({ headers: outside({ Cookie: cookieFrom(back2) }) })).text.includes(`data-user="${OWNER}"`));
});

test('Google でログイン: 表にいない人・確かめられていないアドレス・別の Google アカウントは入れない', async () => {
  const cases = {
    '表にいないアドレス': { sub: 'google-sub-stranger', email: 'stranger@example.test', email_verified: true },
    '確かめられていないアドレス': { sub: 'google-sub-unverified', email: OTHER, email_verified: false },
    'アドレスが無い': { sub: 'google-sub-noemail' },
    // OWNER には、もう別の ID が結んである。同じアドレスを名乗る別のアカウントは通さない
    '結んである人と同じアドレスを名乗る別の ID': { sub: 'google-sub-impostor', email: OWNER, email_verified: true },
  };
  for (const [name, who] of Object.entries(cases)) {
    const { authUrl, cookie } = await startGoogle();
    const { code, state } = idp.approve(authUrl, who);
    const back = await callback({ code, state }, cookie);
    assert.equal(back.headers.location, '/login?error=google_not_registered', name);
    assert.ok(!(back.headers['set-cookie'] ?? []).some((c) => /vv_session=[^;]/.test(c)), `${name}: セッションが付いた`);
  }
  assert.equal(users.find(OWNER).googleSub, 'google-sub-owner', '結んである ID が書き換わった');
  assert.equal(users.find(OTHER).googleSub, null, '確かめられていないアドレスで結ばれた');
});

test('Google でログイン: 始めたブラウザでない・state が違う・壊れた ID トークンは、確かめの前か途中で断る', async () => {
  const who = { sub: 'google-sub-owner', email: OWNER, email_verified: true };
  const failed = async (name, back) => {
    assert.equal(back.headers.location, '/login?error=google_failed', name);
    assert.ok(!(back.headers['set-cookie'] ?? []).some((c) => /vv_session=[^;]/.test(c)), `${name}: セッションが付いた`);
  };
  const tokensBefore = idp.seen.tokenRequests;
  {
    // 他人が用意した戻りの URL を踏まされた(途中の状態の Cookie が無い・別のもの)
    const { authUrl, cookie } = await startGoogle();
    const { code, state } = idp.approve(authUrl, who);
    await failed('Cookie なし', await callback({ code, state }));
    await failed('別の要求の Cookie', await callback({ code, state }, (await startGoogle()).cookie));
    await failed('state が違う', await callback({ code, state: `${state}x` }, cookie));
    await failed('署名を書き換えた Cookie', await callback({ code, state }, cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))));
    await failed('Google が断った', await callback({ error: 'access_denied', state }, cookie));
    await failed('コードが無い', await callback({ state }, cookie));
  }
  assert.equal(idp.seen.tokenRequests, tokensBefore, '確かめる前に断るはずの要求で、相手へ問い合わせている');
  {
    // 途中の状態は 10 分だけ持つ
    const { authUrl, cookie } = await startGoogle();
    const { code, state } = idp.approve(authUrl, who);
    clock += 10 * 60 * 1000 + 1;
    await failed('時間切れ', await callback({ code, state }, cookie));
  }
  for (const [name, options] of Object.entries({
    '別の鍵で署名': { wrongKey: true },
    '署名なしを名乗る': { alg: 'none' },
    '宛先が違う': { claims: { aud: 'someone-else' } },
    '発行者が違う': { claims: { iss: 'https://evil.example' } },
    'nonce が違う': { claims: { nonce: 'replayed' } },
    '期限切れ': { claims: { exp: Math.floor(Date.now() / 1000) - 600 } },
  })) {
    const { authUrl, cookie } = await startGoogle();
    const { code, state } = idp.approve(authUrl, who, options);
    await failed(name, await callback({ code, state }, cookie));
  }
});

test('公開用のホスト名があるのに利用者がいなければ起動しない。表を後から空にされても、ログインなしでは開かない', async () => {
  const d = tmp();
  try {
    assert.throws(() => createApp(appConfig(d, { publicHost: PUBLIC }), { ytdlp: async () => null }), /先に利用者を足す/);
    // 動いている間に表を空にされた
    const before = users.list();
    fs.writeFileSync(users.file, JSON.stringify({ version: 1, users: [] }));
    try {
      const r = await req({ headers: outside() });
      assert.equal(r.status, 302, '表が空になったら、ログインなしで開いた');
      assert.equal((await req({ pathname: `/api/state?token=${app.token}`, headers: outside() })).status, 401);
    } finally {
      fs.writeFileSync(users.file, JSON.stringify({ version: 1, users: before }));
    }
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('利用者がいない設定(この PC の中だけで使う)では、ログインを求めない。Google の口も無い', async () => {
  const d = tmp();
  const local = createApp(appConfig(d), { ytdlp: async () => null });
  await local.start();
  try {
    const get = (pathname) =>
      new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: local.port, path: pathname }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        }).on('error', reject);
      });
    assert.equal(await get('/'), 200);
    assert.equal(await get('/auth/google'), 404);
    assert.equal(await get('/login'), 404);
  } finally {
    await local.stop();
    fs.rmSync(d, { recursive: true, force: true });
  }
});
