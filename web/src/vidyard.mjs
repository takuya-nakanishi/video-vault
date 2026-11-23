// Vidyard のパスワード保護を、プレイヤーと同じ手順で解く。
// Android の domain/Vidyard.kt と data/VidyardUnlocker.kt を同じ規則で移したもの(手順の根拠は AGENTS.md「Vidyard のパスワード保護」)。
//
// パスワードとトークンは認証情報。ログにも履歴にも書かない(ここで作るエラーの文にも入れない)。

const WATCH_HOST = /^[A-Za-z0-9_-]+(\.hubs)?\.vidyard\.com$/;
const WATCH_PATH = /^\/watch\/([A-Za-z0-9_-]+)/;
const SHARE_HOSTS = new Set(['share.vidyard.com', 'embed.vidyard.com']);
const SHARE_PATH = /^\/share\/([A-Za-z0-9_-]+)/;
const PLAYER_HOST = 'play.vidyard.com';
const PLAYER_PATH = /^\/(?:player\/)?([A-Za-z0-9_-]+)/;

/** トークンを載せるヘッダの名前。プレイヤーの JS と同じ */
export const ACCESS_HEADER = 'X-Video-Access';
const BASE = 'https://play.vidyard.com';
const TIMEOUT_MS = 20_000;

/** 保護された動画で、パスワードが無い・通らないときの失敗。文はそのまま履歴に出る */
export class LockedError extends Error {
  name = 'LockedError';
}

/** yt-dlp を起動する前の段で中断が押された */
export class CancelledBeforeStartError extends Error {
  name = 'CancelledBeforeStartError';
  constructor() {
    super('中断');
  }
}

/**
 * Vidyard の動画の URL ならプレイヤーの uuid を、そうでなければ null を返す。
 * URL の形は yt-dlp の Vidyard 抽出器(`_VALID_URL`)に揃えてある。
 */
export function playerUuidOf(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const p = u.pathname;
  // yt-dlp と同じ順に当てる(play.vidyard.com/watch/<uuid> は watch の形として読む)
  let m;
  if (WATCH_HOST.test(host) && (m = WATCH_PATH.exec(p))) return m[1];
  if (SHARE_HOSTS.has(host) && (m = SHARE_PATH.exec(p))) return m[1];
  if (host === PLAYER_HOST && (m = PLAYER_PATH.exec(p))) return m[1];
  return null;
}

async function fetchJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* JSON でない応答は null のまま扱う */
  }
  return { status: res.status, ok: res.ok, json };
}

/**
 * yt-dlp に付けるヘッダの値(accessToken)を返す。保護されていなければ null(何も付けずに yt-dlp へ)。
 *
 * 保護の有無を確かめられなかったとき(通信の失敗・想定外の応答)も null を返し、判断を yt-dlp に任せる。
 * ここで止めると、Vidyard 側の小さな変更で、保護されていない動画まで取れなくなる。
 *
 * @param {object} [opts]
 * @param {() => boolean} [opts.isCancelled] 中断が押されたか。パスワードを送る直前に見る。Vidyard はパスワードに
 *   使用回数の上限を付けられるので、中断したのに解錠して 1 回分を使ってしまうことを避ける
 */
export async function accessTokenFor(uuid, password, opts = {}) {
  const { isCancelled = () => false, fetchImpl = fetch, base = BASE } = opts;
  let type = null;
  try {
    const r = await fetchJson(fetchImpl, `${base}/player/${uuid}.json`);
    if (r.status === 200 && typeof r.json?.type === 'string' && r.json.type) type = r.json.type;
  } catch {
    return null;
  }
  if (type !== 'secure') return null;
  if (!password) {
    throw new LockedError('パスワードで保護された動画。パスワードを入れてからダウンロードし直す');
  }
  if (isCancelled()) throw new CancelledBeforeStartError();

  const r = await fetchJson(fetchImpl, `${base}/secure/verify-access-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid, token: password }),
  });
  if (r.ok) {
    const token = typeof r.json?.accessToken === 'string' ? r.json.accessToken : '';
    if (!token) throw new Error(`Vidyardの解錠の応答にトークンが無い(HTTP ${r.status})`);
    return token;
  }
  const reason = typeof r.json?.error === 'string' && r.json.error ? r.json.error : `HTTP ${r.status}`;
  if (r.status === 401 || r.status === 403) {
    throw new LockedError(`パスワードが通らなかった(Vidyard: ${reason})`);
  }
  throw new Error(`Vidyardのパスワードを確かめられなかった(Vidyard: ${reason})`);
}
