// 拡張機能の通しの試験。実物の Chromium に拡張機能(web/extension)を読み込ませ、
// 偽のログイン付きサイトでログイン → 拡張機能から送る → サーバが実物の yt-dlp で取る、までを流す。
// 相手はすべてこの PC の中(127.0.0.1)。外へは通信しない。
//
// ツールバーのボタンは試験から押せないので、ボタンが呼ぶのと同じ関数(globalThis.vvSend)を、拡張機能の中で呼ぶ。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../src/server.mjs';
import { HistoryStatus } from '../src/history.mjs';
import { DeviceStore } from '../src/auth/devices.mjs';
import { startFakeSite, PASSWORD, TITLES } from './fakeSite.mjs';

const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const STEP_TIMEOUT_MS = 90_000;

let site;
let app;
let dir;
let outDir;
let key;
let context;
let worker;

async function until(what, cond, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`待っても成り立たない: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** 完全版の Chromium の場所。指定 → この版の Playwright のもの → 手元にある Playwright の Chromium の新しいもの */
function findFullChromium() {
  if (process.env.VIDEO_VAULT_E2E_CHROMIUM) return process.env.VIDEO_VAULT_E2E_CHROMIUM;
  try {
    const own = chromium.executablePath();
    if (fs.existsSync(own) && !own.includes('headless_shell')) return own;
  } catch {
    /* 次へ */
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
    : path.join(os.homedir(), '.cache', 'ms-playwright'));
  const names = fs.existsSync(cache) ? fs.readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)) : [];
  names.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const n of names) {
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
      const p = path.join(cache, n, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const finished = (id) => app.center.state().history.find((h) => h.id === id && h.status !== HistoryStatus.RUNNING);
const vvSend = (url) => worker.evaluate((u) => globalThis.vvSend(u), url);
const setSettings = (s) => worker.evaluate((v) => chrome.storage.local.set(v), s);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-ext-'));
  outDir = path.join(dir, 'out');
  site = await startFakeSite();
  const devicesFile = path.join(dir, 'devices.json');
  key = new DeviceStore(devicesFile).create('e2e-browser');
  app = createApp({
    host: '127.0.0.1', port: 0, outDir, authDir: path.join(dir, '.auth'), dataDir: path.join(dir, 'data'),
    headless: true, browserChannel: '', ytdlpPath: process.env.VIDEO_VAULT_YTDLP || null,
    // 偽のサイトは 127.0.0.1 にある。ふだんは受け付けない URL なので、試験だけが明示して許す
    allowLoopback: true,
    usersFile: path.join(dir, 'users.json'), devicesFile,
  });
  await app.start();

  // 拡張機能は、完全版の Chromium の持続するコンテキストでだけ読み込める。既定の headless が使う軽い版
  // (chromium_headless_shell)は拡張機能を読まない(2026-11-25 に確かめた)。Chrome・Edge の正式版も、
  // 起動の引数で拡張機能を読ませる口を閉じている。そのため Playwright の完全版の Chromium を探して使う
  const executablePath = findFullChromium();
  assert.ok(executablePath, '完全版の Chromium が見つからない(npx playwright install chromium で入れるか、VIDEO_VAULT_E2E_CHROMIUM で場所を指定する)');
  context = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
    headless: true,
    executablePath,
    args: ['--headless=new', `--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
  await until('拡張機能の送る係が読み込まれる', () => worker.evaluate(() => typeof globalThis.vvSend === 'function'), 30_000);
});

after(async () => {
  await context?.close();
  await app?.stop();
  await site?.stop();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('入れた直後は、送り先の既定が ytdlp.sanei-clover.com で、鍵が空。鍵が無いまま押すと、送らずに設定の画面を開く', async () => {
  const s = await worker.evaluate(() => globalThis.vvSettings());
  assert.deepEqual(s, { server: 'https://ytdlp.sanei-clover.com', key: '', quality: 'ORIGINAL' });
  // 入れた直後にも、鍵が無ければ設定の画面が開く。それを閉じてから、送ったときに開くことを見る
  await until('入れた直後に設定の画面が開く', () => context.pages().find((p) => p.url().endsWith('/options.html')), 10_000);
  for (const p of context.pages().filter((x) => x.url().endsWith('/options.html'))) await p.close();
  const r = await vvSend(`${site.origin}/open/watch2`);
  assert.equal(r.ok, false);
  assert.match(r.error, /設定の画面/);
  await until('送ったときに設定の画面が開く', () => context.pages().find((p) => p.url().endsWith('/options.html')), 10_000);
  assert.equal(app.center.state().history.length, 0, '鍵が無いのに送られた');
});

test('設定の画面で、送り先と鍵を保存し、つながるかを確かめられる。https でない送り先は受けない', async () => {
  const page = context.pages().find((p) => p.url().endsWith('/options.html'));
  await page.fill('#server', 'http://evil.example');
  await page.fill('#key', key);
  await page.click('#save');
  await page.locator('#status.error').waitFor();
  assert.match(await page.locator('#status').textContent(), /https/);

  await page.fill('#server', `http://127.0.0.1:${app.port}/`);
  await page.fill('#key', 'vvd_wrong-key-0000000000000000000000000000000');
  await page.click('#save');
  await until('鍵の誤りが出る', async () => /鍵が違う/.test(await page.locator('#status').textContent()), 10_000);

  await page.fill('#key', key);
  await page.selectOption('#quality', 'SD');
  await page.click('#save');
  await until('つながった印が出る', async () => /つながった/.test(await page.locator('#status').textContent()), 10_000);
  assert.match(await page.locator('#status').textContent(), /e2e-browser/);
  assert.equal(await page.inputValue('#server'), `http://127.0.0.1:${app.port}`, '送り先の末尾の / をそろえていない');
  await page.close();
});

test('ログインしていないページを送ると、送れるが、取得は失敗として記録される(会員向けの動画は 403)', async () => {
  const r = await vvSend(`${site.origin}/watch`);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.cookieCount, 0);
  const h = await until('取得が終わる', () => finished(r.id));
  assert.equal(h.status, HistoryStatus.FAILED);
  assert.match(h.error, /403/);
});

test('このブラウザでログインしてから送ると、ログインの Cookie が渡り、取れたファイルは配った中身と一致する', async () => {
  const page = await context.newPage();
  await page.goto(`${site.origin}/login`);
  await page.fill('input[name="pass"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${site.origin}/watch`);

  const r = await vvSend(page.url());
  assert.equal(r.ok, true, r.error);
  assert.equal(r.cookieCount, 1, 'ログインの Cookie が送られていない');
  const h = await until('取得が終わる', () => finished(r.id));
  assert.equal(h.status, HistoryStatus.SUCCESS, h.error ?? '');
  assert.equal(h.quality, 'SD', '設定の画面で選んだ画質になっていない');
  const name = `${h.title}.mp4`;
  assert.ok(h.title === TITLES.member || h.title === `${TITLES.member} (1)`, h.title);
  assert.ok(fs.readFileSync(path.join(outDir, name)).equals(site.media.member), '中身が配ったものと違う');
  assert.ok(site.hits.some((x) => x.path === '/media/clip.mp4' && x.method === 'GET' && x.loggedIn), 'Cookie 付きの要求が届いていない');
  // Cookie の値は、状態にも履歴にも出ない
  assert.ok(!JSON.stringify(app.center.state()).includes(site.secret));
  assert.ok(!fs.readFileSync(path.join(dir, 'data', 'history.json'), 'utf8').includes(site.secret));
  await page.close();
});

test('送る Cookie は、送る URL に付く分だけ(ほかのサイトのログインは送らない)', async () => {
  // このサイトにログインし直し、ページを開いたまま送る(期限の無い Cookie は、ページを全部閉じると消えることがある)
  const page = await context.newPage();
  await page.goto(`${site.origin}/login`);
  await page.fill('input[name="pass"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${site.origin}/watch`);
  // 別のサイトの Cookie を、このブラウザに持たせておく
  await context.addCookies([{ name: 'other_site', value: 'must-not-be-sent', domain: 'other.example', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const seen = [];
  const original = app.center.enqueue.bind(app.center);
  app.center.enqueue = (job) => {
    seen.push(job.cookies);
    return original(job);
  };
  try {
    const r = await vvSend(`${site.origin}/open/watch2`);
    assert.equal(r.ok, true, r.error);
    await until('取得が終わる', () => finished(r.id));
  } finally {
    app.center.enqueue = original;
  }
  const names = seen[0].map((c) => c.name);
  assert.ok(names.includes('sid'), 'このサイトのログインが送られていない');
  assert.ok(!names.includes('other_site'), 'ほかのサイトの Cookie まで送られた');
  await page.close();
});

test('http・https でないページと、鍵の誤りは、送らずに理由を返す', async () => {
  for (const bad of ['chrome://settings', 'file:///etc/passwd', 'about:blank', 'not a url']) {
    const r = await vvSend(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /http・https/, bad);
  }
  await setSettings({ key: 'vvd_wrong-key-0000000000000000000000000000000' });
  const r = await vvSend(`${site.origin}/open/watch2`);
  assert.equal(r.ok, false);
  assert.match(r.error, /鍵が違う/);
  await setSettings({ key });
});

test('サーバが断った理由(対象外のサイト)を、そのまま返す', async () => {
  const r = await vvSend('https://www.netflix.com/title/80100172');
  assert.equal(r.ok, false);
  assert.match(r.error, /DRM/);
});
