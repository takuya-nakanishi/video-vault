// 画面。状態はサーバが持ち、ここは受け取って映すだけ(Android の画面と DownloadCenter の関係と同じ)。
// 文字はすべて textContent で入れる(履歴のタイトルやエラーの文は外から来た文字列)。
'use strict';

const token = document.querySelector('meta[name="vv-token"]').content;
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VV-Token': token },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

function notify(text, isError = false) {
  const n = $('notice');
  n.textContent = text;
  n.classList.toggle('error', isError);
}

const STATUS_LABEL = { SUCCESS: '完了', FAILED: '失敗', CANCELLED: '中断', RUNNING: '実行中' };
const SOURCE_LABEL = { badge: 'バッジから', input: '' };

function relativeTime(ms) {
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return 'たった今';
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`;
  if (sec < 172800) return '昨日';
  return new Date(ms).toLocaleDateString('ja-JP');
}

const headline = (j) => j.title || j.url.replace(/^https?:\/\//, '');

async function download(url) {
  const r = await api('/api/download', { url, quality: $('quality').value, password: $('password').value });
  if (r.ok) {
    $('input').value = '';
    $('password').value = '';
    $('password-row').hidden = true;
    $('suggestions').replaceChildren();
    notify('順番待ちに入れた');
  } else notify(r.error ?? '始められなかった', true);
}

async function openInBrowser(url) {
  notify('ブラウザを開いている…');
  const r = await api('/api/browser/open', { url });
  notify(r.ok ? 'ブラウザで開いた。ログインしたあと、動画の枠のバッジを押すと取得が始まる' : (r.error ?? '開けなかった'), !r.ok);
}

let classifySeq = 0;
async function refreshSuggestions() {
  const seq = ++classifySeq;
  const input = $('input').value;
  const r = await api('/api/classify', { input });
  if (seq !== classifySeq) return; // 後から打った入力の結果を、先の結果で上書きしない
  $('password-row').hidden = !r.needsPasswordField;
  const nodes = (r.suggestions ?? []).map((s, i) => {
    const primary = i === 0 ? 'primary' : '';
    switch (s.kind) {
      case 'download':
        return el('button', { type: 'button', className: primary, textContent: `${s.siteName} からダウンロード`, onclick: () => download(s.url) });
      case 'tryDownload':
        return el('button', { type: 'button', className: primary, textContent: 'ダウンロードを試す', onclick: () => download(s.url) });
      case 'openInBrowser':
        return el('button', { type: 'button', className: primary, textContent: 'ブラウザで開く', onclick: () => openInBrowser(s.url) });
      case 'webSearch':
        return el('button', { type: 'button', className: primary, textContent: 'Google で検索', onclick: () => openInBrowser(s.url) });
      case 'unsupported':
        return el('span', { className: 'unsupported', textContent: `${s.siteName}: ${s.reason}` });
      default:
        return '';
    }
  });
  $('suggestions').replaceChildren(...nodes);
}

function jobRow(j, kind) {
  const actions = el('div', { className: 'job-actions' });
  if (kind === 'running' || kind === 'queued') {
    actions.append(el('button', { type: 'button', className: 'quiet', textContent: kind === 'running' ? '中断' : '外す', onclick: () => api('/api/cancel', { id: j.id }) }));
  } else {
    if (j.status !== 'SUCCESS') {
      actions.append(el('button', { type: 'button', className: 'quiet', textContent: 'やり直す', onclick: async () => {
        const r = await api('/api/download', { url: j.url, quality: j.quality ?? '' });
        notify(r.ok ? '順番待ちに入れた' : (r.error ?? '始められなかった'), !r.ok);
      } }));
    }
    actions.append(el('button', { type: 'button', className: 'quiet', textContent: '消す', onclick: () => api('/api/history/delete', { id: j.id }) }));
  }
  const meta = [j.siteName];
  if (kind === 'queued') meta.push('順番待ち');
  if (SOURCE_LABEL[j.source]) meta.push(SOURCE_LABEL[j.source]);
  if (kind === 'running') meta.push(j.cancelled ? '中断している…' : (j.percent != null ? `${Math.round(j.percent * 100)}%` : '準備中'));
  if (kind === 'history') meta.push(relativeTime(j.finishedAt ?? j.startedAt));
  const row = el('li', { className: 'job' }, [
    el('div', { className: 'job-title', textContent: headline(j) }),
    actions,
    el('div', { className: 'job-meta' }, [
      ...(kind === 'history' ? [el('span', { className: `status-${j.status}`, textContent: `${STATUS_LABEL[j.status] ?? j.status} ・ ` })] : []),
      meta.filter(Boolean).join(' ・ '),
    ]),
  ]);
  if (kind === 'running') {
    const bar = el('div', { className: `bar${j.percent == null ? ' busy' : ''}` }, [el('i')]);
    if (j.percent != null) bar.firstChild.style.width = `${Math.round(j.percent * 100)}%`;
    row.append(bar);
  }
  if (kind === 'history' && j.error) row.append(el('div', { className: 'job-error', textContent: j.error }));
  return row;
}

let bookmarksDrawn = false;
function render(state) {
  const env = state.env;
  $('env').textContent = `保存先: ${env.outDir} ・ yt-dlp: ${env.ytdlpVersion ?? '見つからない'}` +
    (env.ffmpegFound === false ? ' ・ ffmpeg: 見つからない(映像と音声が別々に配られる動画は取れない)' : '');
  if (!$('quality').options.length) {
    for (const q of env.qualities) $('quality').append(el('option', { value: q.name, textContent: `${q.label}(${q.detail})` }));
    $('quality').value = env.defaultQuality;
  }
  if (!bookmarksDrawn) {
    bookmarksDrawn = true;
    $('bookmarks').replaceChildren(...state.bookmarks.map((b) =>
      el('button', { type: 'button', textContent: b.name, title: b.url, onclick: () => openInBrowser(b.url) })));
  }
  $('browser-status').textContent =
    `${state.browser.open ? '開いている' : '閉じている'} ・ ログインの Cookie: ${state.browser.cookieCount} 件` +
    '(値はこの PC の中にだけ置く)。よく行くページを開いてログインする。';

  const jobs = [];
  if (state.running) jobs.push(jobRow(state.running, 'running'));
  for (const j of state.queue) jobs.push(jobRow(j, 'queued'));
  $('jobs').replaceChildren(...(jobs.length ? jobs : [el('li', { className: 'empty', textContent: '実行中のものは無い' })]));

  const done = state.history.filter((h) => h.status !== 'RUNNING').map((h) => jobRow(h, 'history'));
  $('history').replaceChildren(...(done.length ? done : [el('li', { className: 'empty', textContent: 'まだ何も取っていない' })]));
  $('clear-history').hidden = !done.length;
}

let typing = null;
$('input').addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(refreshSuggestions, 120);
});
$('input').addEventListener('keydown', (e) => {
  // 日本語の変換を確定する Enter では動かさない
  if (e.key !== 'Enter' || e.isComposing) return;
  clearTimeout(typing);
  refreshSuggestions().then(() => $('suggestions').querySelector('button')?.click());
});
$('clear-history').addEventListener('click', () => api('/api/history/clear'));

// ログインしているときだけ、誰で入っているかとログアウトを出す
const account = $('account');
if (account.dataset.user) {
  $('account-user').textContent = account.dataset.user;
  account.hidden = false;
  $('logout').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
    location.replace('/login');
  });
}

const events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
events.onmessage = (e) => render(JSON.parse(e.data));
events.onerror = async () => {
  // ログインが切れたときは、ログインの画面へ戻す
  const res = await fetch('/auth/config').catch(() => null);
  const me = res?.ok ? await fetch(`/api/state?token=${encodeURIComponent(token)}`).catch(() => null) : null;
  if (me?.status === 401) return location.replace('/login');
  notify('サーバとつながっていない。少し待ってから、このページを読み込み直す', true);
};
