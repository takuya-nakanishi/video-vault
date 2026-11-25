// 送る係(background.js)と設定の画面(options.js)が共に使う部品。

export const DEFAULTS = Object.freeze({ server: 'https://ytdlp.sanei-clover.com', key: '', quality: 'ORIGINAL' });
export async function settings() {
  const saved = await chrome.storage.local.get(['server', 'key', 'quality']);
  return { ...DEFAULTS, ...saved };
}

/** 送り先として受ける URL。https か、この PC の中(127.0.0.1・localhost)の http だけ */
export function validServer(raw) {
  try {
    const u = new URL(String(raw).trim());
    const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null;
    return u.origin;
  } catch {
    return null;
  }
}
