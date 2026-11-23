// 通しの試験。実物の yt-dlp と実物のブラウザで、Android と同じ流れ
// (アプリが開くブラウザでログイン → バッジ → Cookie を渡して取得)を、偽のサイトを相手に最後まで流す。
//
// 判定は機械がする。「ファイルが何かできた」では合格にせず、保存されたファイルが配った中身と 1 バイトも違わないことまで見る
// (Android の煙試験で、69 バイトの内部ファイルを成果物と誤認して偽の合格を出した教訓)。
// 待ち合わせは、条件が成り立つまでの待ち(期限つき)で行い、固定の sleep に頼らない。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { HistoryStatus } from '../src/history.mjs';
import { startFakeSite, PASSWORD, TITLES } from './fakeSite.mjs';

const STEP_TIMEOUT_MS = 90_000;

let site;
let app;
let dir;
let outDir;
let tmpRoot;
/** 会員向けの動画が保存されたファイル名(後の試験が使う) */
let memberFile;

async function until(what, cond, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`待っても成り立たない: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function api(pathname, body) {
  const res = await fetch(`http://127.0.0.1:${app.port}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VV-Token': app.token },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json() };
}

const stateText = async () => (await fetch(`http://127.0.0.1:${app.port}/api/state?token=${app.token}`)).text();
const history = () => app.center.state().history;
const finished = (id) => history().find((h) => h.id === id && h.status !== HistoryStatus.RUNNING);
const outFiles = () => fs.readdirSync(outDir).sort();
/**
 * 保存されたファイル。名前は、履歴に残った題名(yt-dlp が付けたもの)から求める。
 * yt-dlp はページの中の動画に「ページの題名 (1)」と番号を付ける(2026.10.26 で確認)。番号の付け方は yt-dlp の都合なので
 * 許すが、ページの題名で始まること・ファイルがちょうどその名前であること・中身は、厳しく見る。
 */
function savedFileOf(h, pageTitle) {
  assert.ok(h.title === pageTitle || h.title === `${pageTitle} (1)`, `題名が違う: ${h.title}`);
  return `${h.title}.mp4`;
}
const leftoverCookieDirs = () => fs.readdirSync(tmpRoot).filter((n) => n.startsWith('vv-cookies-'));
/** アプリが持つファイル(履歴・Cookie の写しを除く)に、ログインの印が出ていないこと */
const historyFileText = () => fs.readFileSync(path.join(dir, 'data', 'history.json'), 'utf8');

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-e2e-'));
  outDir = path.join(dir, 'out');
  tmpRoot = path.join(dir, 'tmp');
  fs.mkdirSync(tmpRoot);
  site = await startFakeSite();
  app = createApp(
    {
      host: '127.0.0.1',
      port: 0,
      outDir,
      authDir: path.join(dir, '.auth'),
      dataDir: path.join(dir, 'data'),
      headless: true,
      browserChannel: process.env.VIDEO_VAULT_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : ''),
      ytdlpPath: process.env.VIDEO_VAULT_YTDLP || null,
      // 偽のサイトは 127.0.0.1 にある。ふだんは受け付けない URL なので、試験だけが明示して許す
      allowLoopback: true,
    },
    { center: { tmpRoot } },
  );
  await app.start();
});

after(async () => {
  await app?.stop();
  await site?.stop();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('前提: yt-dlp が見つかっている(無ければ、飛ばさずに不合格にする)', async () => {
  const version = await until('yt-dlp の版が状態に出る', async () => JSON.parse(await stateText()).env.ytdlpVersion, 40_000);
  assert.match(version, /^\d{4}\.\d{2}\.\d{2}/);
});

test('ログインしていないと、会員向けの動画は取れない(失敗として記録し、ファイルを作らない)', async () => {
  const r = await api('/api/download', { url: `${site.origin}/watch` });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const h = await until('1 件目が終わる', () => finished(r.json.id));
  assert.equal(h.status, HistoryStatus.FAILED);
  assert.match(h.error, /403/);
  assert.deepEqual(outFiles(), [], '失敗したのにファイルができている');
  assert.ok(site.hits.some((x) => x.path === '/watch' && !x.loggedIn), '偽のサイトに要求が届いていない(別の理由で失敗している)');
  assert.deepEqual(leftoverCookieDirs(), []);
});

test('アプリが開くブラウザで、誤ったパスワードではログインできず、正しいパスワードでログインできる', async () => {
  const r = await api('/api/browser/open', { url: `${site.origin}/login` });
  assert.deepEqual(r.json, { ok: true });
  const page = await until('ログインの画面が開く', () => app.browser.context?.pages().find((p) => p.url().endsWith('/login')));
  await page.waitForSelector('input[name="pass"]');

  await page.fill('input[name="pass"]', 'wrong-password');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#error');
  assert.ok(!(await app.browser.cookies()).some((c) => c.name === 'sid'), '誤ったパスワードでログインの印が付いた');

  await page.goto(`${site.origin}/login`);
  await page.fill('input[name="pass"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${site.origin}/watch`);
  const sid = (await app.browser.cookies()).find((c) => c.name === 'sid');
  assert.equal(sid?.value, site.secret);
  assert.equal(sid.expires, -1, '試験の前提: 期限の無い Cookie であること');

  // 画面に見せる状態には、件数だけが出る
  const text = await stateText();
  assert.ok(JSON.parse(text).browser.cookieCount >= 1);
  assert.equal(JSON.parse(text).browser.open, true);
  assert.ok(!text.includes(site.secret), '状態の JSON に Cookie の値が出ている');
});

test('動画の枠のバッジを押すと取得が始まり、保存されたファイルは配った中身と一致する', async () => {
  const page = app.browser.context.pages().find((p) => p.url() === `${site.origin}/watch`);
  const badge = page.locator('.vv-badge');
  await badge.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await badge.count(), 1, '動画は 1 本なのに、バッジの数が違う');
  const before = history().length;
  // バッジは上下に弾み続けるので、位置が止まるのを待たずに押す
  await badge.click({ force: true });

  const h = await until('バッジからの取得が終わる', () => history().length > before && finished(history()[0].id));
  assert.equal(h.url, `${site.origin}/watch`);
  assert.equal(h.status, HistoryStatus.SUCCESS, h.error ?? '');
  memberFile = savedFileOf(h, TITLES.member);

  assert.deepEqual(outFiles(), [memberFile], '保存先に、取った 1 本だけがあること');
  const saved = fs.readFileSync(path.join(outDir, memberFile));
  assert.equal(saved.length, site.media.member.length, '大きさが違う');
  assert.ok(saved.equals(site.media.member), '中身が配ったものと違う');
  assert.ok(site.hits.some((x) => x.path === '/media/clip.mp4' && x.method === 'GET' && x.loggedIn), 'Cookie 付きの要求が届いていない');

  // Cookie は使い終わったら残さない。値はどこにも書かない
  assert.deepEqual(leftoverCookieDirs(), [], 'Cookie のファイルが残っている');
  assert.ok(!historyFileText().includes(site.secret), '履歴のファイルに Cookie の値が出ている');
  assert.ok(!(await stateText()).includes(site.secret));
});

test('ブラウザの窓を閉じたあとも、取っておいた写しでログインした取得ができる', async () => {
  await app.browser.close();
  assert.equal(app.browser.isOpen(), false);
  const snapshot = path.join(dir, '.auth', 'cookies.storageState.json');
  assert.ok(fs.existsSync(snapshot), 'Cookie の写しが無い');
  if (process.platform !== 'win32') assert.equal(fs.statSync(snapshot).mode & 0o777, 0o600, '写しをほかの利用者が読める');

  fs.rmSync(path.join(outDir, memberFile));
  assert.deepEqual(outFiles(), []);
  const hitsBefore = site.hits.length;
  const r = await api('/api/download', { url: `${site.origin}/watch` });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const h = await until('写しでの取得が終わる', () => finished(r.json.id));
  assert.equal(h.status, HistoryStatus.SUCCESS, h.error ?? '');
  assert.equal(savedFileOf(h, TITLES.member), memberFile);
  assert.deepEqual(outFiles(), [memberFile]);
  assert.ok(fs.readFileSync(path.join(outDir, memberFile)).equals(site.media.member));
  assert.ok(site.hits.slice(hitsBefore).some((x) => x.path === '/media/clip.mp4' && x.method === 'GET' && x.loggedIn));
  assert.equal(app.browser.isOpen(), false, '取得のためにブラウザが起きた');
  assert.deepEqual(leftoverCookieDirs(), []);
});

test('ブラウザを開き直しても、ログインしたままになっている(期限の無い Cookie を写しから戻す)', async () => {
  assert.equal(app.browser.isOpen(), false);
  await api('/api/browser/open', { url: `${site.origin}/watch` });
  const page = await until('会員向けのページが開く', () => app.browser.context?.pages().find((p) => p.url() === `${site.origin}/watch`));
  // ログインが外れていると、偽のサイトは「会員限定」の題名で 403 を返す
  await until('会員向けの題名が出る', async () => (await page.title()) === TITLES.member, 30_000);
  assert.equal((await app.browser.cookies()).find((c) => c.name === 'sid')?.value, site.secret);
});

test('2 件渡すと順番に走り、走っているものを中断すると取得が止まって次が走る', async () => {
  const slow = await api('/api/download', { url: `${site.origin}/open/watch`, quality: 'SD' });
  const fast = await api('/api/download', { url: `${site.origin}/open/watch2` });
  assert.equal(slow.status, 200);
  assert.equal(fast.status, 200);
  assert.equal((await api('/api/download', { url: `${site.origin}/open/watch2` })).status, 400, '同じ URL を二重に積めた');

  // 1 件目の取得が実際に進み始めてから中断する(起動前の中断は単体テストで見ている)
  await until('1 件目の進捗が出る', () => {
    const s = app.center.state();
    return s.running?.id === slow.json.id && s.running.percent !== null && s.running.percent > 0;
  });
  assert.deepEqual(app.center.state().queue.map((j) => j.id), [fast.json.id], '2 件目が順番待ちにいない');
  assert.equal(finished(fast.json.id), undefined, '2 件目が 1 件目と同時に走った');
  assert.deepEqual((await api('/api/cancel', { id: slow.json.id })).json, { ok: true });

  const hs = await until('1 件目が終わる', () => finished(slow.json.id));
  assert.equal(hs.status, HistoryStatus.CANCELLED);
  assert.equal(hs.quality, 'SD');
  await until('偽のサイトから見て、取得の接続が切れる(yt-dlp が止まった)', () => site.state.slowAborted >= 1, 15_000);

  const hf = await until('2 件目が終わる', () => finished(fast.json.id));
  assert.equal(hf.status, HistoryStatus.SUCCESS, hf.error ?? '');
  const fastFile = savedFileOf(hf, TITLES.fast);
  assert.ok(fs.readFileSync(path.join(outDir, fastFile)).equals(site.media.fast));
  // 中断したものは、出来上がりのファイルとして残らない。残ってよいのは、続きから取るための .part だけ
  const others = outFiles().filter((n) => n !== memberFile && n !== fastFile);
  for (const name of others) {
    assert.ok(name.startsWith(TITLES.slow) && name.endsWith('.part'), `覚えの無いファイル: ${name}`);
    assert.ok(fs.statSync(path.join(outDir, name)).size < site.media.slow.length, '中断したのに最後まで取れている');
  }
});

test('ページの JS がアプリの口を直接呼んでも、埋め込みの枠からは積めず、行き先は http の URL に限られ、連続では積めない', async () => {
  const before = history().length;
  await api('/api/browser/open', { url: `${site.origin}/abuse` });
  const page = await until('枠のあるページが開く', () => app.browser.context?.pages().find((p) => p.url().endsWith('/abuse')));
  await until('枠の JS が口を呼び終える', async () => (await page.frames().find((f) => f.url().endsWith('/abuse-frame'))?.title().catch(() => '')) === 'frame-called');
  const s = app.center.state();
  assert.equal(s.running, null, '埋め込みの枠からの呼び出しで取得が始まった');
  assert.equal(s.queue.length, 0);
  assert.equal(history().length, before);

  await page.goto(`${site.origin}/abuse-top`);
  await until('ページの JS が口を呼び終える', async () => (await page.title()) === 'top-called');
  const h = await until('積まれた 1 件が終わる', () => history().length > before && finished(history()[0].id));
  await app.center.whenIdle();
  assert.equal(history().length, before + 1, '直後の 2 回目の呼び出しも積まれている');
  // http でない行き先は捨てて、いま開いているページの URL に落とす(ページの言い分ではなくブラウザから取る)
  assert.equal(h.url, `${site.origin}/abuse-top`);
  assert.equal(h.status, HistoryStatus.FAILED, '動画の無いページなのに成功している');
  assert.ok(!outFiles().some((n) => n.includes('passwd')));
});

test('終わったあと、Cookie の値は履歴にも状態にも無く、一時ファイルも残っていない', async () => {
  await app.center.whenIdle();
  assert.deepEqual(leftoverCookieDirs(), []);
  assert.ok(!historyFileText().includes(site.secret));
  assert.ok(!(await stateText()).includes(site.secret));
  // 写し(.auth の下)にだけ値がある。これは git に入らない場所
  assert.ok(fs.readFileSync(path.join(dir, '.auth', 'cookies.storageState.json'), 'utf8').includes(site.secret));
});
