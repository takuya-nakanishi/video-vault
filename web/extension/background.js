// 送る係。ツールバーのボタンか右クリックのメニューで、いま見ているページ(かリンク)の URL と、
// その URL に送られるこのブラウザの Cookie(ログイン)を、Surface のゲットVIDEO へ送る。
//
// - Cookie を読むのは、ボタンかメニューを押したときの 1 回だけ。読むのは、送る URL に付く分だけ
// - 送り先と端末の鍵は、設定の画面(options.html)で入れる。鍵はこのブラウザの中にだけ置く
// - パスワードや Cookie の値を、通知にもログにも出さない

import { settings, validServer } from './shared.js';

const ICON = 'icon-128.png';

function notify(message, ok) {
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#1F8A4C' : '#C93A2B' });
  chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
  chrome.notifications.create({ type: 'basic', iconUrl: ICON, title: 'ゲットVIDEO', message }).catch?.(() => {});
}

/**
 * URL を送る。結果を返す(試験もこれを呼ぶ)。
 * @returns {Promise<{ok:boolean, error?:string, id?:string}>}
 */
export async function send(targetUrl) {
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return { ok: false, error: '送れるのは http・https のページだけ' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return { ok: false, error: '送れるのは http・https のページだけ' };
  const s = await settings();
  const server = validServer(s.server);
  if (!server || !s.key) {
    chrome.runtime.openOptionsPage();
    return { ok: false, error: '送り先と端末の鍵を、設定の画面で入れる' };
  }
  // 送る URL に付く Cookie だけ(ほかのサイトのログインは送らない)
  const cookies = (await chrome.cookies.getAll({ url: target.href })).map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    expires: c.session ? -1 : c.expirationDate,
  }));
  let res;
  try {
    res = await fetch(`${server}/api/v1/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.key}` },
      body: JSON.stringify({ url: target.href, quality: s.quality, cookies }),
      credentials: 'omit',
    });
  } catch {
    return { ok: false, error: 'ゲットVIDEO に届かなかった(Surface が止まっているか、送り先がまちがっている)' };
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) return { ok: false, error: '端末の鍵が違う(設定の画面で入れ直す)' };
  if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `ゲットVIDEO が断った(HTTP ${res.status})` };
  return { ok: true, id: body.id, cookieCount: cookies.length };
}

async function sendAndTell(url) {
  const r = await send(url);
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    /* 送れなかった URL */
  }
  notify(r.ok ? `順番待ちに入れた: ${host}` : r.error, r.ok);
  return r;
}

// 試験が呼べるようにする(ふだんは使わない)
globalThis.vvSend = send;
globalThis.vvSettings = settings;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'send-page', title: 'このページをゲットVIDEO に送る', contexts: ['page', 'video', 'audio', 'frame'] });
    chrome.contextMenus.create({ id: 'send-link', title: 'このリンク先をゲットVIDEO に送る', contexts: ['link'] });
  });
  settings().then((s) => {
    if (!s.key) chrome.runtime.openOptionsPage();
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void sendAndTell(info.menuItemId === 'send-link' ? info.linkUrl : (info.pageUrl ?? tab?.url));
});

chrome.action.onClicked.addListener((tab) => {
  void sendAndTell(tab?.url);
});
