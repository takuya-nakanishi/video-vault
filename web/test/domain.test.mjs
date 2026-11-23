// 判定・タイトルの読み取り・Vidyard の uuid・画質・履歴。Android の単体テスト(app/src/test)と同じ場合分けを移したもの。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SiteCatalog } from '../src/siteCatalog.mjs';
import { classify, normalizeUrl, searchUrl } from '../src/inputClassifier.mjs';
import { titleFrom, titleFromPath, percentFrom, errorFrom } from '../src/ytdlpOutput.mjs';
import { playerUuidOf } from '../src/vidyard.mjs';
import { QUALITIES, qualityFromName } from '../src/quality.mjs';
import { HistoryLog, HistoryStore, HistoryStatus, MAX_ENTRIES } from '../src/history.mjs';

const catalog = SiteCatalog.load();

test('判定表は Android と同じファイルから読めている', () => {
  // 読めないと空の表に落ち、下の試験が別の理由で通ったり落ちたりする。先に確かめる
  assert.ok(catalog.rules.length >= 10, `規則が ${catalog.rules.length} 件しか無い`);
  assert.equal(catalog.ruleFor('m.youtube.com')?.id, 'youtube');
});

test('空入力は候補を出さない', () => {
  assert.deepEqual(classify(catalog, ''), []);
  assert.deepEqual(classify(catalog, '   '), []);
});

test('動画サイトの URL はダウンロードが第一候補', () => {
  assert.deepEqual(classify(catalog, 'https://www.youtube.com/watch?v=abc123'), [
    { kind: 'download', url: 'https://www.youtube.com/watch?v=abc123', siteName: 'YouTube' },
    { kind: 'openInBrowser', url: 'https://www.youtube.com/watch?v=abc123' },
  ]);
});

test('サブドメインと短縮ドメインも判定表に当たる', () => {
  assert.equal(classify(catalog, 'https://m.youtube.com/watch?v=abc')[0].kind, 'download');
  assert.equal(classify(catalog, 'https://youtu.be/abc')[0].kind, 'download');
});

test('似た名前の別のドメインは判定表に当たらない', () => {
  assert.equal(classify(catalog, 'https://notyoutube.com/watch?v=abc')[0].kind, 'openInBrowser');
  assert.equal(classify(catalog, 'https://youtube.com.example.net/watch')[0].kind, 'openInBrowser');
});

test('スキームの無い URL は https を補う', () => {
  assert.equal(classify(catalog, 'youtube.com/watch?v=abc')[0].url, 'https://youtube.com/watch?v=abc');
});

test('判定表に無い URL はブラウザで開くのが第一候補で、PC 版はダウンロードも試せる', () => {
  assert.deepEqual(classify(catalog, 'https://example.com/article'), [
    { kind: 'openInBrowser', url: 'https://example.com/article' },
    { kind: 'tryDownload', url: 'https://example.com/article', siteName: 'example.com' },
  ]);
});

test('DRM のサイトは対象外として弾き、ダウンロードの候補を出さない', () => {
  const result = classify(catalog, 'https://www.netflix.com/title/80100172');
  assert.equal(result[0].kind, 'unsupported');
  assert.equal(result[0].siteName, 'Netflix');
  assert.match(result[0].reason, /DRM/);
  assert.ok(!result.some((s) => s.kind === 'download' || s.kind === 'tryDownload'));
});

test('日本語のキーワードと空白を含む入力は検索になる', () => {
  assert.equal(classify(catalog, 'かれの')[0].kind, 'webSearch');
  assert.equal(classify(catalog, 'かれの')[0].query, 'かれの');
  assert.equal(classify(catalog, '決算 解説')[0].kind, 'webSearch');
});

test('http と https 以外のスキームは URL として扱わない', () => {
  for (const input of ['ftp://example.com/x', 'file:///etc/passwd', 'javascript://example.com/%0Aalert(1)', 'chrome://settings']) {
    assert.equal(normalizeUrl(input), null, input);
    assert.equal(classify(catalog, input)[0].kind, 'webSearch', input);
  }
});

test('オプションに見える入力・拡張子付きの日本語・日本語のドメインを URL と誤判定しない', () => {
  assert.equal(normalizeUrl('-o'), null);
  assert.equal(normalizeUrl('--exec=calc.exe'), null);
  assert.equal(normalizeUrl('決算資料.pdf'), null);
  // URL の解析で punycode に変わっても、書かれたままの姿で判定する
  assert.equal(normalizeUrl('https://日本語.jp/'), null);
});

test('検索の URL は日本語をエンコードする', () => {
  const url = searchUrl('決算 解説');
  assert.ok(url.startsWith('https://www.google.com/search?q='));
  assert.ok([...url].every((ch) => ch.codePointAt(0) <= 127));
});

test('判定表が空でも URL はブラウザで開ける', () => {
  assert.equal(classify(SiteCatalog.EMPTY, 'https://www.youtube.com/watch?v=abc')[0].kind, 'openInBrowser');
});

test('yt-dlp の出力からタイトルを拾う', () => {
  assert.equal(titleFrom('[download] Destination: /storage/emulated/0/downloads/Me at the zoo.webm'), 'Me at the zoo');
  assert.equal(titleFrom('[download] Destination: /d/決算解説 2026年8月.f137.mp4'), '決算解説 2026年8月');
  assert.equal(titleFrom('[Merger] Merging formats into "/d/市況まとめ.mp4"'), '市況まとめ');
  assert.equal(titleFrom('[download] /d/Me at the zoo.webm has already been downloaded'), 'Me at the zoo');
  assert.equal(titleFromPath('/d/ver 1.2 release.mp4'), 'ver 1.2 release');
});

test('Windows の区切り(\\)の保存先からもタイトルを拾う', () => {
  assert.equal(titleFrom('[download] Destination: C:\\Users\\x\\Downloads\\videos\\市況まとめ.f399.mp4'), '市況まとめ');
});

test('進捗の行はタイトルにしない', () => {
  assert.equal(titleFrom('[download]  42.0% of 120.5MiB at 3.20MiB/s ETA 00:21'), null);
  assert.equal(titleFrom('[youtube] jNQXAC9IVRw: Downloading webpage'), null);
  assert.equal(titleFrom(''), null);
});

test('進捗とエラーの行を読む', () => {
  assert.equal(percentFrom('[download]  42.0% of 120.5MiB at 3.20MiB/s ETA 00:21'), 0.42);
  assert.equal(percentFrom('[download] 100% of 1.00MiB in 00:00'), 1);
  assert.equal(percentFrom('[download] Destination: /d/50% off.mp4'), null);
  assert.equal(errorFrom('ERROR: [generic] Unable to download webpage: HTTP Error 403: Forbidden'), '[generic] Unable to download webpage: HTTP Error 403: Forbidden');
  assert.equal(errorFrom('WARNING: something'), null);
});

test('Vidyard の URL から uuid を取る', () => {
  const cases = {
    'https://salesforce.vidyard.com/watch/d4vqPjs7Q5EzVEis5QT3jd': 'd4vqPjs7Q5EzVEis5QT3jd',
    'https://share.vidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y?': 'PaQzDAT1h8JqB8ivEu2j6Y',
    'https://vyexample03.hubs.vidyard.com/watch/oTDMPlUv--51Th455G5u7Q': 'oTDMPlUv--51Th455G5u7Q',
    'https://embed.vidyard.com/share/oTDMPlUv--51Th455G5u7Q': 'oTDMPlUv--51Th455G5u7Q',
    'http://share.vidyard.com/share/diYeo6YR2yiGgL8odvS8Ri': 'diYeo6YR2yiGgL8odvS8Ri',
    'https://play.vidyard.com/wL237MtNgZUHo6e8WPiJbF?disable_popouts=1&v=4.3.15&type=inline': 'wL237MtNgZUHo6e8WPiJbF',
    'https://play.vidyard.com/iDqTwWGrd36vaLuaCY3nTs.html': 'iDqTwWGrd36vaLuaCY3nTs',
    'https://play.vidyard.com/player/7GAApnNNbcZZ46k6JqJQSh.json?disable_analytics=0': '7GAApnNNbcZZ46k6JqJQSh',
    'https://play.vidyard.com/qhMAu5A76GZVrFzOPgSf9A/type/standalone': 'qhMAu5A76GZVrFzOPgSf9A',
    '  https://SHARE.Vidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y ': 'PaQzDAT1h8JqB8ivEu2j6Y',
  };
  for (const [url, uuid] of Object.entries(cases)) assert.equal(playerUuidOf(url), uuid, url);
});

test('Vidyard でない・形が違う URL は null', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://vidyard.com.example.net/watch/PaQzDAT1h8JqB8ivEu2j6Y',
    'https://notvidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y',
    'https://vidyard.com/watch/PaQzDAT1h8JqB8ivEu2j6Y',
    'https://salesforce.vidyard.com/',
    'https://salesforce.vidyard.com/share/PaQzDAT1h8JqB8ivEu2j6Y',
    'ftp://play.vidyard.com/PaQzDAT1h8JqB8ivEu2j6Y',
    'Vidyardの動画',
  ]) assert.equal(playerUuidOf(url), null, url);
});

test('画質: 知らない名前は既定(オリジナル)に落ち、上限つきは最良への退避を持つ', () => {
  assert.equal(qualityFromName('HD'), QUALITIES.HD);
  assert.equal(qualityFromName('nope'), QUALITIES.ORIGINAL);
  assert.equal(qualityFromName('constructor'), QUALITIES.ORIGINAL);
  assert.equal(QUALITIES.ORIGINAL.formatSelector, null);
  for (const q of [QUALITIES.HD, QUALITIES.SD]) assert.ok(q.formatSelector.endsWith('/bv*+ba/b'));
});

const entry = (id, startedAt, status = HistoryStatus.SUCCESS) => ({
  id, url: `https://example.com/${id}`, siteName: 'example.com', title: null, startedAt, finishedAt: null, status, error: null, quality: 'ORIGINAL',
});

test('履歴: 新しい順に並び、同じ id は置き換え、上限で切る', () => {
  let log = new HistoryLog([entry('a', 1), entry('b', 3), entry('c', 2)]);
  assert.deepEqual(log.entries.map((e) => e.id), ['b', 'c', 'a']);
  log = log.upsert({ ...entry('a', 1), title: '後から付いた題' });
  assert.equal(log.entries.length, 3);
  assert.equal(log.entries.find((e) => e.id === 'a').title, '後から付いた題');
  assert.deepEqual(log.remove('b').entries.map((e) => e.id), ['c', 'a']);
  const many = new HistoryLog(Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => entry(`n${i}`, i)));
  assert.equal(many.entries.length, MAX_ENTRIES);
  assert.equal(many.entries[0].id, `n${MAX_ENTRIES + 19}`);
});

test('履歴: 途中で落ちた「実行中」は、起動のときに「中断」へ倒す', () => {
  const log = new HistoryLog([entry('run', 2, HistoryStatus.RUNNING), entry('ok', 1)]).settleStale(99);
  const run = log.entries.find((e) => e.id === 'run');
  assert.equal(run.status, HistoryStatus.CANCELLED);
  assert.equal(run.finishedAt, 99);
  assert.equal(log.entries.find((e) => e.id === 'ok').status, HistoryStatus.SUCCESS);
});

test('履歴: 余分な項目(パスワードや Cookie)を渡しても、ファイルに出ない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-history-'));
  try {
    const store = new HistoryStore(path.join(dir, 'nested', 'history.json'));
    store.save(new HistoryLog([{ ...entry('a', 1), password: 'ひみつ-pw', cookies: 'sid=ひみつ-cookie' }]));
    const text = fs.readFileSync(store.file, 'utf8');
    assert.ok(!text.includes('ひみつ'), text);
    assert.deepEqual(store.load().entries.map((e) => e.id), ['a']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('履歴: 壊れたファイルと形の違う行は、空・除外として読む(起動を止めない)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-history-'));
  try {
    const file = path.join(dir, 'history.json');
    fs.writeFileSync(file, '{ 壊れた');
    assert.deepEqual(new HistoryStore(file).load().entries, []);
    fs.writeFileSync(file, JSON.stringify({ entries: [entry('ok', 1), { id: 5 }, null, { ...entry('bad', 2), status: 'なぞ' }] }));
    assert.deepEqual(new HistoryStore(file).load().entries.map((e) => e.id), ['ok']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('IP アドレスと localhost は URL とみなさない。試験用の切り替えでも、自分自身しか通さない', () => {
  for (const input of ['http://127.0.0.1:8787/', 'http://localhost/x', 'http://192.168.0.1/', 'http://[::1]/', 'http://10.0.0.5:8080/v']) {
    assert.equal(normalizeUrl(input), null, input);
  }
  assert.equal(normalizeUrl('http://127.0.0.1:8787/watch', { allowLoopback: true }), 'http://127.0.0.1:8787/watch');
  assert.equal(normalizeUrl('http://localhost:3000/', { allowLoopback: true }), 'http://localhost:3000/');
  for (const input of ['http://192.168.0.1/', 'http://[::1]/', 'http://10.0.0.5:8080/v', 'http://127.0.0.2/']) {
    assert.equal(normalizeUrl(input, { allowLoopback: true }), null, input);
  }
});

test('既定の設定では、自分自身の URL を受け付ける切り替えが切れていて、環境変数では入らない', async () => {
  const { loadConfig } = await import('../src/config.mjs');
  const base = { VIDEO_VAULT_OUT: '/tmp/x' };
  assert.equal(loadConfig(base).allowLoopback, false);
  assert.equal(loadConfig({ ...base, VIDEO_VAULT_ALLOW_LOOPBACK: '1', allowLoopback: 'true' }).allowLoopback, false);
  assert.equal(loadConfig({ ...base, VIDEO_VAULT_HOST: '0.0.0.0' }).host, '127.0.0.1');
});
