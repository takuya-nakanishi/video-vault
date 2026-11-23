// 実際のサイトから取れるかの試験。外へ通信するので、頼んだときだけ走る:
//   VIDEO_VAULT_E2E_NETWORK=1 npm run e2e
//
// 相手は、Android の煙試験(android/scripts/smoke-test.sh)と同じ公開の動画。読むだけで、どのサイトにも書き込まない。
// パスワード付きの Vidyard は、VIDYARD_SECURE_URL と VIDYARD_SECURE_PASSWORD を渡したときだけ走る(値はリポジトリに書かない)。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { HistoryStatus } from '../src/history.mjs';

const ENABLED = process.env.VIDEO_VAULT_E2E_NETWORK === '1';
const SKIP = ENABLED ? false : 'VIDEO_VAULT_E2E_NETWORK=1 のときだけ走る(外へ通信する)';
const TEST_VIDEO = 'https://youtu.be/jNQXAC9IVRw';
const VIDYARD_PUBLIC = 'https://share.vidyard.com/watch/wL237MtNgZUHo6e8WPiJbF';
const SECURE_URL = process.env.VIDYARD_SECURE_URL;
const SECURE_PASSWORD = process.env.VIDYARD_SECURE_PASSWORD;
const TIMEOUT_MS = 300_000;
/** 動画として数える最小の大きさ。小さな内部ファイルを成果物と数えない(Android の煙試験と同じ基準) */
const MIN_BYTES = 100 * 1024;
const VIDEO_EXT = /\.(mp4|webm|mkv)$/;

let app;
let dir;
let outDir;

async function until(what, cond, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`待っても成り立たない: ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function download(body) {
  const res = await fetch(`http://127.0.0.1:${app.port}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VV-Token': app.token },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  return until(`${body.url} の取得が終わる`, () =>
    app.center.state().history.find((h) => h.id === json.id && h.status !== HistoryStatus.RUNNING),
  );
}

/** 出来上がった動画のファイル(.part と、動画でない拡張子を除く) */
const videos = () =>
  fs.readdirSync(outDir).filter((n) => VIDEO_EXT.test(n)).map((n) => ({ name: n, size: fs.statSync(path.join(outDir, n)).size }));

before(async () => {
  if (!ENABLED) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-net-'));
  outDir = path.join(dir, 'out');
  app = createApp({
    host: '127.0.0.1', port: 0, outDir, authDir: path.join(dir, '.auth'), dataDir: path.join(dir, 'data'),
    headless: true, browserChannel: '', ytdlpPath: process.env.VIDEO_VAULT_YTDLP || null, allowLoopback: false,
  });
  await app.start();
});

after(async () => {
  await app?.stop();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('YouTube の公開の動画を取れる(100KB を超える動画のファイルができ、題名が履歴に残る)', { skip: SKIP }, async () => {
  const h = await download({ url: TEST_VIDEO, quality: 'SD' });
  assert.equal(h.status, HistoryStatus.SUCCESS, h.error ?? '');
  assert.equal(h.siteName, 'YouTube');
  assert.ok(h.title && h.title.length > 0, '題名が取れていない');
  const files = videos();
  assert.equal(files.length, 1, `動画のファイルが 1 本でない: ${JSON.stringify(files)}`);
  assert.ok(files[0].size > MIN_BYTES, `小さすぎる: ${files[0].size} バイト`);
  assert.ok(files[0].name.startsWith(h.title), `ファイル名と題名が合わない: ${files[0].name} / ${h.title}`);
  assert.ok(!fs.readdirSync(outDir).some((n) => n.endsWith('.part')), '取りかけのファイルが残っている');
});

test('実在しない YouTube の動画は、失敗として記録し、ファイルを増やさない', { skip: SKIP }, async () => {
  const beforeFiles = fs.readdirSync(outDir).sort();
  const h = await download({ url: 'https://youtu.be/aaaaaaaaaaa' });
  assert.equal(h.status, HistoryStatus.FAILED);
  assert.ok(h.error && h.error.length > 0, 'エラーの文が無い');
  assert.deepEqual(fs.readdirSync(outDir).sort(), beforeFiles);
});

test('公開の Vidyard の動画は、パスワード無しでそのまま取れる', { skip: SKIP }, async () => {
  const beforeCount = videos().length;
  const h = await download({ url: VIDYARD_PUBLIC, quality: 'SD' });
  assert.equal(h.status, HistoryStatus.SUCCESS, h.error ?? '');
  assert.equal(h.siteName, 'Vidyard');
  const files = videos();
  assert.equal(files.length, beforeCount + 1);
  assert.ok(files.every((f) => f.size > MIN_BYTES), JSON.stringify(files));
});

const SECURE_SKIP = SKIP || (SECURE_URL && SECURE_PASSWORD ? false : 'VIDYARD_SECURE_URL と VIDYARD_SECURE_PASSWORD を渡したときだけ走る');

test('パスワード付きの Vidyard は、パスワードが無いと案内して止まり、ファイルを作らない', { skip: SECURE_SKIP }, async () => {
  const beforeFiles = fs.readdirSync(outDir).sort();
  const h = await download({ url: SECURE_URL });
  assert.equal(h.status, HistoryStatus.FAILED);
  assert.match(h.error, /パスワードで保護された動画/);
  assert.deepEqual(fs.readdirSync(outDir).sort(), beforeFiles);
});

test('パスワード付きの Vidyard は、誤ったパスワードでは止まる', { skip: SECURE_SKIP }, async () => {
  const h = await download({ url: SECURE_URL, password: `${SECURE_PASSWORD}-wrong` });
  assert.equal(h.status, HistoryStatus.FAILED);
  assert.match(h.error, /パスワードが通らなかった/);
});

test('パスワード付きの Vidyard は、正しいパスワードで解錠して取得が進む(5MB を超えたところで中断する)', { skip: SECURE_SKIP }, async () => {
  const res = await fetch(`http://127.0.0.1:${app.port}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VV-Token': app.token },
    body: JSON.stringify({ url: SECURE_URL, password: SECURE_PASSWORD, quality: 'SD' }),
  });
  const { id } = await res.json();
  // 長い動画を丸ごとは取らない。本体が 5MB を超えた(=解錠が通って動画の本体が届いている)ところで止める
  const partBytes = () => Math.max(0, ...fs.readdirSync(outDir).map((n) => fs.statSync(path.join(outDir, n)).size));
  const sizeBefore = partBytes();
  await until('本体が 5MB を超える', () => {
    const done = app.center.state().history.find((h) => h.id === id && h.status !== HistoryStatus.RUNNING);
    if (done) throw new Error(`5MB に届く前に終わった: ${done.status} ${done.error ?? ''}`);
    return partBytes() > Math.max(sizeBefore, 5 * 1024 * 1024);
  });
  app.center.cancel(id);
  const h = await until('中断で終わる', () => app.center.state().history.find((x) => x.id === id && x.status !== HistoryStatus.RUNNING));
  assert.equal(h.status, HistoryStatus.CANCELLED);
  const text = JSON.stringify(app.center.state()) + fs.readFileSync(path.join(dir, 'data', 'history.json'), 'utf8');
  assert.ok(!text.includes(SECURE_PASSWORD), 'パスワードが状態か履歴に出ている');
});
