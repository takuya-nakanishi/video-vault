// ログインの画面を、実物のブラウザで通す。画面の JS(login.js・app.js)と Cookie が、ブラウザの中で実際に働くことを見る。
// 相手はこの PC の中のアプリだけ。外へは通信しない。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../src/server.mjs';
import { UserStore } from '../src/auth/users.mjs';
import { hashPassword } from '../src/auth/password.mjs';

const EMAIL = 'owner@example.test';
const PASSWORD = 'correct-battery-staple-42';
let dir;
let app;
let browser;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-login-'));
  const usersFile = path.join(dir, 'users.json');
  new UserStore(usersFile).upsert(EMAIL, { passwordHash: await hashPassword(PASSWORD) });
  app = createApp(
    {
      host: '127.0.0.1', port: 0, outDir: path.join(dir, 'out'), authDir: path.join(dir, '.auth'), dataDir: path.join(dir, 'data'),
      headless: true, browserChannel: '', ytdlpPath: null, allowLoopback: false, usersFile,
    },
    { ytdlp: async () => null },
  );
  await app.start();
  browser = await chromium.launch({ channel: process.env.VIDEO_VAULT_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
});

after(async () => {
  await browser?.close();
  await app?.stop();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('画面を開くとログインの画面へ送られ、誤ったパスワードでは入れず、正しいパスワードで入れて、ログアウトで戻る', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // 断られた要求(401)は、ブラウザが自分で記録する。画面の JS の誤りではない
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  await page.goto(app.url);
  await page.waitForURL(`${app.url}login`);
  assert.equal(await page.locator('#google').isHidden(), true, 'Google の設定が無いのに、Google のボタンが出ている');

  await page.fill('#email', EMAIL);
  await page.fill('#password', 'wrong-password-000000');
  await page.click('#submit');
  await page.locator('#notice.error').waitFor();
  assert.equal(await page.locator('#notice').textContent(), 'メールアドレスかパスワードが違う');
  assert.equal(await page.inputValue('#password'), '', '断られたあとも、パスワードが欄に残っている');
  assert.equal(new URL(page.url()).pathname, '/login');
  assert.deepEqual(await context.cookies(), [], 'ログインできていないのに Cookie が付いた');

  await page.fill('#password', PASSWORD);
  await page.click('#submit');
  await page.waitForURL(app.url);
  // 状態の通知(SSE)が、ログインの Cookie で届く
  await page.locator('#bookmarks button').first().waitFor();
  assert.equal(await page.locator('#account-user').textContent(), EMAIL);
  const cookies = await context.cookies();
  assert.deepEqual(cookies.map((c) => [c.name, c.httpOnly, c.sameSite]), [['vv_session', true, 'Lax']]);
  assert.equal(await page.evaluate(() => document.cookie), '', 'ページの JS からセッションの Cookie が読める');

  // 入力の判定(合言葉の要る命令)が、ログインしたまま使える
  await page.fill('#input', 'youtu.be/abc');
  await page.locator('#suggestions button').first().waitFor();
  assert.equal(await page.locator('#suggestions button').first().textContent(), 'YouTube からダウンロード');

  await page.click('#logout');
  await page.waitForURL(`${app.url}login`);
  assert.deepEqual(await context.cookies(), [], 'ログアウトしても Cookie が残っている');
  await page.goto(app.url);
  await page.waitForURL(`${app.url}login`);
  assert.deepEqual(errors, [], '画面のエラー');
  await context.close();
});

test('ログインの画面は、スマホの幅でも横にはみ出さない', async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 700 } });
  const page = await context.newPage();
  await page.goto(`${app.url}login`);
  await page.locator('#submit').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: process.env.VV_SHOT_DIR ? path.join(process.env.VV_SHOT_DIR, 'login-phone.png') : path.join(dir, 'login-phone.png') });
  await context.close();
});
