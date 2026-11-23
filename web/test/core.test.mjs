// Cookie のファイル・Vidyard の解錠・yt-dlp の引数・順番待ち。外へは通信せず、yt-dlp も起動しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toNetscape, writeCookieFile, removeCookieFile } from '../src/cookieFile.mjs';
import { accessTokenFor, LockedError, CancelledBeforeStartError } from '../src/vidyard.mjs';
import { buildArgs } from '../src/ytdlp.mjs';
import { QUALITIES } from '../src/quality.mjs';
import { DownloadCenter, MAX_QUEUE } from '../src/downloadCenter.mjs';
import { HistoryStore, HistoryStatus } from '../src/history.mjs';
import { SiteCatalog } from '../src/siteCatalog.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vv-test-'));

test('Cookie を Netscape 形式にする(domain・path・期限・HttpOnly)', () => {
  const text = toNetscape([
    { name: 'sid', value: 'abc', domain: '.example.com', path: '/', expires: 1900000000.5, httpOnly: true, secure: true },
    { name: 'session', value: 'x=y', domain: 'sub.example.com', path: '/app', expires: -1, httpOnly: false, secure: false },
  ]);
  const lines = text.trim().split('\n');
  assert.equal(lines[0], '# Netscape HTTP Cookie File');
  assert.equal(lines[2], '#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1900000000\tsid\tabc');
  // セッション Cookie は遠い期限を補う(0 や -1 のままだと、期限切れとして捨てられうる)
  assert.equal(lines[3], 'sub.example.com\tFALSE\t/app\tFALSE\t2145916800\tsession\tx=y');
});

test('Cookie: タブ・改行の入った値と形の違うものは書かない(行を増やして別の Cookie を作らせない)', () => {
  const text = toNetscape([
    { name: 'evil', value: 'a\n.bank.example\tTRUE\t/\tTRUE\t2145916800\tsid\tstolen', domain: 'x.example', path: '/' },
    { name: 'tab\tname', value: 'v', domain: 'x.example', path: '/' },
    { name: '', value: 'v', domain: 'x.example', path: '/' },
    { name: 'n', value: 5, domain: 'x.example', path: '/' },
    null,
    { name: 'ok', value: 'v', domain: 'x.example', path: '/' },
  ]);
  const data = text.split('\n').filter((l) => l && !l.startsWith('# '));
  assert.deepEqual(data, ['x.example\tFALSE\t/\tFALSE\t2145916800\tok\tv']);
});

test('Cookie のファイル: 無ければ作らず、作ったら持ち主だけが読め、消すと入れ物ごと無くなる', async () => {
  const root = tmp();
  try {
    assert.equal(await writeCookieFile([], root), null);
    assert.equal(await writeCookieFile(null, root), null);
    assert.deepEqual(fs.readdirSync(root), []);
    const file = await writeCookieFile([{ name: 'sid', value: 'abc', domain: 'example.com', path: '/' }], root);
    assert.ok(fs.readFileSync(file, 'utf8').includes('\tsid\tabc'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    await removeCookieFile(file);
    assert.deepEqual(fs.readdirSync(root), []);
    await removeCookieFile(null); // 無いものを消しても落ちない
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** Vidyard の偽物。呼ばれた要求を記録し、決めた応答を返す */
function fakeVidyard({ type = 'secure', verify = { status: 200, body: { accessToken: 'TOKEN-123' } }, playerStatus = 200 }) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ?? null });
    const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (url.endsWith('/player/UUID.json')) return reply(playerStatus, { type });
    if (url.endsWith('/secure/verify-access-code')) return reply(verify.status, verify.body);
    return reply(404, {});
  };
  return { calls, opts: { fetchImpl, base: 'https://vidyard.test' } };
}

test('Vidyard: 保護されていなければ何もしない(パスワードも送らない)', async () => {
  const v = fakeVidyard({ type: 'pomo-player' });
  assert.equal(await accessTokenFor('UUID', 'pw', v.opts), null);
  assert.deepEqual(v.calls.map((c) => c.method), ['GET']);
});

test('Vidyard: 保護を確かめられないとき(通信の失敗・想定外の応答)は yt-dlp に任せる', async () => {
  assert.equal(await accessTokenFor('UUID', 'pw', { fetchImpl: async () => { throw new Error('offline'); }, base: 'https://vidyard.test' }), null);
  assert.equal(await accessTokenFor('UUID', 'pw', fakeVidyard({ playerStatus: 500 }).opts), null);
});

test('Vidyard: 保護されていてパスワードが無ければ、案内して止める', async () => {
  const v = fakeVidyard({});
  await assert.rejects(accessTokenFor('UUID', '', v.opts), (e) => e instanceof LockedError && /パスワード/.test(e.message));
  assert.deepEqual(v.calls.map((c) => c.method), ['GET']);
});

test('Vidyard: 正しいパスワードはトークンになり、送る中身はプレイヤーと同じ', async () => {
  const v = fakeVidyard({});
  assert.equal(await accessTokenFor('UUID', 'pw-正しい', v.opts), 'TOKEN-123');
  assert.deepEqual(JSON.parse(v.calls[1].body), { uuid: 'UUID', token: 'pw-正しい' });
});

test('Vidyard: 誤ったパスワードは止め、エラーの文にパスワードを入れない', async () => {
  const v = fakeVidyard({ verify: { status: 401, body: { error: 'Password is incorrect' } } });
  await assert.rejects(accessTokenFor('UUID', 'pw-まちがい', v.opts), (e) => {
    assert.ok(e instanceof LockedError);
    assert.match(e.message, /Password is incorrect/);
    assert.ok(!e.message.includes('pw-まちがい'));
    return true;
  });
});

test('Vidyard: 応答にトークンが無い・サーバの失敗は、解錠できたことにしない', async () => {
  await assert.rejects(accessTokenFor('UUID', 'pw', fakeVidyard({ verify: { status: 200, body: {} } }).opts), /トークンが無い/);
  await assert.rejects(accessTokenFor('UUID', 'pw', fakeVidyard({ verify: { status: 500, body: 'oops' } }).opts), (e) => !(e instanceof LockedError) && /HTTP 500/.test(e.message));
});

test('Vidyard: 中断が押されていたら、パスワードを送らない(使用回数を減らさない)', async () => {
  const v = fakeVidyard({});
  await assert.rejects(accessTokenFor('UUID', 'pw', { ...v.opts, isCancelled: () => true }), CancelledBeforeStartError);
  assert.deepEqual(v.calls.map((c) => c.method), ['GET']);
});

test('yt-dlp の引数: URL は必ず `--` の後ろの最後に置く', () => {
  const args = buildArgs({ url: 'https://example.com/v', outDir: '/out', quality: QUALITIES.ORIGINAL, nodePath: '/usr/bin/node' });
  assert.deepEqual(args.slice(-2), ['--', 'https://example.com/v']);
  assert.equal(args[args.indexOf('-o') + 1], path.join('/out', '%(title)s.%(ext)s'));
  assert.equal(args[args.indexOf('--js-runtimes') + 1], 'node:/usr/bin/node');
  for (const flag of ['--newline', '--no-playlist', '--no-mtime']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--encoding') + 1], 'utf-8');
  // 何も渡していないのに、画質・Cookie・ヘッダが付いていない
  for (const flag of ['-f', '--cookies', '--add-header', '--force-ipv4']) assert.ok(!args.includes(flag), flag);
});

test('yt-dlp の引数: 画質・Cookie・Vidyard のトークンを渡すと付く', () => {
  const args = buildArgs({ url: 'https://example.com/v', outDir: '/out', quality: QUALITIES.SD, cookieFile: '/tmp/c.txt', vidyardToken: 'TOK' });
  assert.equal(args[args.indexOf('-f') + 1], QUALITIES.SD.formatSelector);
  assert.equal(args[args.indexOf('--cookies') + 1], '/tmp/c.txt');
  assert.equal(args[args.indexOf('--add-header') + 1], 'X-Video-Access:TOK');
  assert.ok(args.indexOf('--add-header') < args.indexOf('--'));
});

/** 偽の yt-dlp。呼ばれた引数を記録し、試験が終わらせるまで走り続ける */
function fakeRunner() {
  const runs = [];
  const run = ({ args, onLine }) => {
    let finish;
    const done = new Promise((r) => (finish = r));
    const item = { args, onLine, cancelled: false, finish: (code = 0) => finish({ code, signal: null }) };
    runs.push(item);
    return { done, cancel: () => { item.cancelled = true; finish({ code: null, signal: 'SIGTERM' }); } };
  };
  return { runs, run };
}

function makeCenter(overrides = {}) {
  const dir = tmp();
  const runner = fakeRunner();
  const center = new DownloadCenter({
    catalog: SiteCatalog.load(),
    historyStore: new HistoryStore(path.join(dir, 'history.json')),
    outDir: path.join(dir, 'out'),
    cookiesProvider: async () => [],
    ytdlp: async () => ({ command: 'yt-dlp', prefixArgs: [] }),
    run: runner.run,
    tmpRoot: dir,
    ...overrides,
  });
  return { center, runner, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** 条件が成り立つまで待つ(固定の待ち時間に頼らない)。成り立たなければ、何を待っていたかを出して落とす */
async function until(what, cond, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`待っても成り立たない: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('順番待ち: 1 件ずつ、積んだ順に走る', async () => {
  const { center, runner, cleanup } = makeCenter();
  try {
    const a = center.enqueue({ url: 'https://example.com/a', quality: 'HD' });
    const b = center.enqueue({ url: 'https://example.com/b' });
    assert.ok(a.ok && b.ok);
    await until('1 件目の起動', () => runner.runs.length === 1);
    assert.equal(center.state().running.id, a.id);
    assert.deepEqual(center.state().queue.map((j) => j.id), [b.id]);
    assert.equal(runner.runs.length, 1, '2 件目が同時に走っている');

    runner.runs[0].onLine('[download] Destination: /out/一本目.mp4');
    runner.runs[0].onLine('[download]  50.0% of 10.00MiB');
    assert.equal(center.state().running.percent, 0.5);
    runner.runs[0].finish(0);
    await until('2 件目の起動', () => runner.runs.length === 2);
    assert.equal(runner.runs[1].args.at(-1), 'https://example.com/b');
    runner.runs[1].finish(0);
    await center.whenIdle();

    const hist = center.state().history;
    assert.deepEqual(hist.map((h) => h.status), [HistoryStatus.SUCCESS, HistoryStatus.SUCCESS]);
    const first = hist.find((h) => h.id === a.id);
    assert.equal(first.title, '一本目');
    assert.equal(first.quality, 'HD');
    assert.equal(first.error, null);
  } finally {
    cleanup();
  }
});

test('順番待ち: 読めない URL・対象外のサイト・同じ URL の二重・上限を断る', async () => {
  const { center, runner, cleanup } = makeCenter();
  try {
    for (const url of ['', 'かれの', '-o /tmp/x', '--exec=id', 'file:///etc/passwd', 'ftp://example.com/x']) {
      assert.equal(center.enqueue({ url }).ok, false, url);
    }
    const drm = center.enqueue({ url: 'https://www.netflix.com/title/80100172' });
    assert.equal(drm.ok, false);
    assert.match(drm.error, /Netflix.*DRM/);

    assert.ok(center.enqueue({ url: 'https://example.com/run' }).ok);
    await until('起動', () => runner.runs.length === 1);
    assert.equal(center.enqueue({ url: 'https://example.com/run' }).ok, false, '走っているものと同じ URL');
    for (let i = 0; i < MAX_QUEUE; i++) assert.ok(center.enqueue({ url: `https://example.com/q${i}` }).ok);
    assert.equal(center.enqueue({ url: 'https://example.com/q0' }).ok, false, '順番待ちと同じ URL');
    const over = center.enqueue({ url: 'https://example.com/over' });
    assert.equal(over.ok, false);
    assert.match(over.error, /上限/);
    assert.equal(runner.runs.length, 1, '断ったものが走っている');
  } finally {
    cleanup();
  }
});

test('中断: 走っているものは止めて「中断」、順番待ちは走らせずに外す', async () => {
  const { center, runner, cleanup } = makeCenter();
  try {
    const a = center.enqueue({ url: 'https://example.com/a' });
    const b = center.enqueue({ url: 'https://example.com/b' });
    const c = center.enqueue({ url: 'https://example.com/c' });
    await until('起動', () => runner.runs.length === 1);
    assert.equal(center.cancel(b.id), true);
    assert.equal(center.cancel('無い id'), false);
    assert.equal(center.cancel(a.id), true);
    assert.equal(runner.runs[0].cancelled, true);
    await until('3 件目の起動', () => runner.runs.length === 2);
    assert.equal(runner.runs[1].args.at(-1), 'https://example.com/c');
    runner.runs[1].finish(0);
    await center.whenIdle();
    const hist = center.state().history;
    assert.equal(hist.find((h) => h.id === a.id).status, HistoryStatus.CANCELLED);
    assert.equal(hist.find((h) => h.id === c.id).status, HistoryStatus.SUCCESS);
    assert.equal(hist.some((h) => h.id === b.id), false, '外した順番待ちが履歴に残っている');
  } finally {
    cleanup();
  }
});

test('失敗: 終了コードが 0 でなければ失敗にし、エラーの行を 1 行だけ履歴に持つ', async () => {
  const { center, runner, cleanup } = makeCenter();
  try {
    const a = center.enqueue({ url: 'https://example.com/a' });
    await until('起動', () => runner.runs.length === 1);
    runner.runs[0].onLine('[download] Destination: /out/途中まで.mp4');
    runner.runs[0].onLine('ERROR: unable to download video data: HTTP Error 403: Forbidden');
    runner.runs[0].finish(1);
    const b = center.enqueue({ url: 'https://example.com/b' });
    await until('2 件目の起動', () => runner.runs.length === 2);
    runner.runs[1].finish(2);
    await center.whenIdle();
    const hist = center.state().history;
    const ha = hist.find((h) => h.id === a.id);
    assert.equal(ha.status, HistoryStatus.FAILED);
    assert.equal(ha.error, 'unable to download video data: HTTP Error 403: Forbidden');
    const hb = hist.find((h) => h.id === b.id);
    assert.equal(hb.status, HistoryStatus.FAILED);
    assert.match(hb.error, /終了コード 2/);
  } finally {
    cleanup();
  }
});

test('yt-dlp が見つからなければ、起動せずに失敗にする', async () => {
  const { center, runner, cleanup } = makeCenter({ ytdlp: async () => null });
  try {
    const a = center.enqueue({ url: 'https://example.com/a' });
    await center.whenIdle();
    assert.equal(runner.runs.length, 0);
    const h = center.state().history.find((x) => x.id === a.id);
    assert.equal(h.status, HistoryStatus.FAILED);
    assert.match(h.error, /yt-dlp が見つからない/);
  } finally {
    cleanup();
  }
});

test('Cookie: yt-dlp にはファイルで渡し、終わったら成否にかかわらず消す。状態にも履歴にも値を出さない', async () => {
  const SECRET = 'cookie-secret-9f3a';
  const { center, runner, dir, cleanup } = makeCenter({
    cookiesProvider: async () => [{ name: 'sid', value: SECRET, domain: 'example.com', path: '/' }],
  });
  try {
    for (const code of [0, 1]) {
      center.enqueue({ url: `https://example.com/c${code}` });
      const n = runner.runs.length;
      await until('起動', () => runner.runs.length === n + 1);
      const run = runner.runs.at(-1);
      const file = run.args[run.args.indexOf('--cookies') + 1];
      assert.ok(fs.readFileSync(file, 'utf8').includes(SECRET), '走っている間は yt-dlp が読める');
      assert.ok(!JSON.stringify(center.state()).includes(SECRET));
      run.finish(code);
      await center.whenIdle();
      assert.equal(fs.existsSync(file), false, `終了コード ${code} のあとに Cookie のファイルが残っている`);
    }
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('vv-cookies-')), []);
    assert.ok(!fs.readFileSync(path.join(dir, 'history.json'), 'utf8').includes(SECRET));
  } finally {
    cleanup();
  }
});

test('Vidyard: パスワードは解錠にだけ使い、トークンはヘッダで渡す。状態にも履歴にも残さない', async () => {
  const PW = 'vidyard-pw-71c2';
  const seen = [];
  const { center, runner, dir, cleanup } = makeCenter({
    unlockVidyard: async (uuid, password) => { seen.push({ uuid, password }); return 'TOKEN-abc'; },
  });
  try {
    const a = center.enqueue({ url: 'https://share.vidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y', password: PW });
    assert.ok(a.ok);
    assert.ok(!JSON.stringify(center.state()).includes(PW));
    await until('起動', () => runner.runs.length === 1);
    assert.deepEqual(seen, [{ uuid: 'PaQzDAT1h8JqB8ivEu2j6Y', password: PW }]);
    const args = runner.runs[0].args;
    assert.equal(args[args.indexOf('--add-header') + 1], 'X-Video-Access:TOKEN-abc');
    assert.ok(!args.join(' ').includes(PW), 'パスワードが yt-dlp の引数に入っている');
    runner.runs[0].finish(0);
    await center.whenIdle();
    const text = JSON.stringify(center.state()) + fs.readFileSync(path.join(dir, 'history.json'), 'utf8');
    assert.ok(!text.includes(PW) && !text.includes('TOKEN-abc'));
  } finally {
    cleanup();
  }
});

test('Vidyard: パスワードが通らなければ yt-dlp を起動せず、案内の文を履歴に出す', async () => {
  const { center, runner, cleanup } = makeCenter({
    unlockVidyard: async () => { throw new (await import('../src/vidyard.mjs')).LockedError('パスワードが通らなかった(Vidyard: Password is incorrect)'); },
  });
  try {
    const a = center.enqueue({ url: 'https://share.vidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y', password: 'x' });
    await center.whenIdle();
    assert.equal(runner.runs.length, 0);
    const h = center.state().history.find((x) => x.id === a.id);
    assert.equal(h.status, HistoryStatus.FAILED);
    assert.match(h.error, /パスワードが通らなかった/);
  } finally {
    cleanup();
  }
});

test('中断: yt-dlp を起動する前(解錠の途中)に押されたら、起動しない', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  let entered = false;
  const { center, runner, cleanup } = makeCenter({
    unlockVidyard: async () => { entered = true; await gate; return 'TOKEN'; },
  });
  try {
    const a = center.enqueue({ url: 'https://share.vidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y', password: 'x' });
    await until('解錠に入る', () => entered);
    assert.equal(center.cancel(a.id), true);
    release();
    await center.whenIdle();
    assert.equal(runner.runs.length, 0, '中断したのに yt-dlp が走った');
    assert.equal(center.state().history.find((x) => x.id === a.id).status, HistoryStatus.CANCELLED);
  } finally {
    cleanup();
  }
});

test('yt-dlp の引数: ffmpeg の場所を渡すと、その入っているディレクトリが付く', () => {
  const args = buildArgs({ url: 'https://example.com/v', outDir: '/out', quality: QUALITIES.ORIGINAL, ffmpeg: path.join('/opt', 'tools', 'ffmpeg') });
  assert.equal(args[args.indexOf('--ffmpeg-location') + 1], path.join('/opt', 'tools'));
  assert.ok(args.indexOf('--ffmpeg-location') < args.indexOf('--'));
  assert.ok(!buildArgs({ url: 'https://example.com/v', outDir: '/out', quality: QUALITIES.ORIGINAL }).includes('--ffmpeg-location'));
});

test('結合できなかった(ffmpeg が無い)ときは、yt-dlp が終了コード 0 でも成功にしない', async () => {
  const { isNotMergedWarning } = await import('../src/ytdlp.mjs');
  const WARNING = "WARNING: You have requested merging of multiple formats but ffmpeg is not installed. The formats won't be merged";
  assert.equal(isNotMergedWarning(WARNING), true);
  assert.equal(isNotMergedWarning('WARNING: [youtube] Some formats may be missing'), false);
  assert.equal(isNotMergedWarning('[Merger] Merging formats into "/out/x.mp4"'), false);

  const { center, runner, cleanup } = makeCenter();
  try {
    const bad = center.enqueue({ url: 'https://example.com/unmerged' });
    await until('起動', () => runner.runs.length === 1);
    runner.runs[0].onLine(WARNING);
    runner.runs[0].onLine('[download] Destination: /out/題名.f395.mp4');
    runner.runs[0].finish(0);
    const good = center.enqueue({ url: 'https://example.com/merged' });
    await until('2 件目の起動', () => runner.runs.length === 2);
    runner.runs[1].onLine('[Merger] Merging formats into "/out/題名.mp4"');
    runner.runs[1].finish(0);
    await center.whenIdle();
    const hb = center.state().history.find((h) => h.id === bad.id);
    assert.equal(hb.status, HistoryStatus.FAILED);
    assert.match(hb.error, /ffmpeg が見つからず/);
    assert.equal(center.state().history.find((h) => h.id === good.id).status, HistoryStatus.SUCCESS);
  } finally {
    cleanup();
  }
});

test('ffmpeg の場所は、yt-dlp を探した結果と一緒に引数へ渡る', async () => {
  const { center, runner, cleanup } = makeCenter({ ytdlp: async () => ({ command: 'yt-dlp', prefixArgs: [], ffmpeg: path.join('/opt', 'tools', 'ffmpeg') }) });
  try {
    center.enqueue({ url: 'https://example.com/a' });
    await until('起動', () => runner.runs.length === 1);
    assert.equal(runner.runs[0].args[runner.runs[0].args.indexOf('--ffmpeg-location') + 1], path.join('/opt', 'tools'));
    runner.runs[0].finish(0);
    await center.whenIdle();
  } finally {
    cleanup();
  }
});
