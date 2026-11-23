// 入力欄の判定。Android の domain/InputClassifier.kt と同じ表。
//
// | 入力内容 | 第一候補 | 第二候補 |
// |---|---|---|
// | 動画サイトの URL | ダウンロード | ブラウザで開く |
// | その他の URL | ブラウザで開く | ダウンロードを試す(PC 版だけ) |
// | キーワード | Google で検索 | — |

/** ASCII のホスト名だけを URL とみなす。日本語はここで弾かれ、キーワード扱いになる */
const HOST_PATTERN =
  /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

const DEFAULT_UNSUPPORTED_REASON = '対象外のサイト';

/** URL に書かれたままのホスト(userinfo とポートを除く)。URL の解析で punycode に変わる前の姿を見る */
function rawHostOf(urlWithScheme) {
  const authority = urlWithScheme.slice(urlWithScheme.indexOf('://') + 3).split(/[/?#]/)[0];
  const afterUser = authority.slice(authority.lastIndexOf('@') + 1);
  return afterUser.replace(/:\d*$/, '');
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** 試験が自分の中に立てた偽のサイトを指すときだけ通す名前。ほかの IP アドレスは、これを許しても通さない */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * URL として解釈できるなら正規化して返す。できなければ null(=キーワード)。
 * スキームの無い `youtube.com/watch?v=x` も拾うため、https を補ってから検証する。http/https 以外は扱わない。
 *
 * IP アドレスと `localhost` は URL とみなさない。入力欄の判定のための規則だが、ページの JS がバッジの口から
 * この PC や家の中の機器(`http://192.168.…`)を取りに行かせることも、これで断れる(名前で指されたものまでは断れない)。
 *
 * @param {object} [opts]
 * @param {boolean} [opts.allowLoopback] 通しの試験だけが使う。環境変数からも画面からも切り替えられない
 */
export function normalizeUrl(input, { allowLoopback = false } = {}) {
  const text = String(input ?? '').trim();
  if (!text || /\s/.test(text)) return null;
  let withScheme;
  if (/^https?:\/\//i.test(text)) withScheme = text;
  else if (text.includes('://')) return null;
  else withScheme = `https://${text}`;
  const rawHost = rawHostOf(withScheme);
  if (!HOST_PATTERN.test(rawHost) && !(allowLoopback && LOOPBACK_HOSTS.has(rawHost.toLowerCase()))) return null;
  if (!hostOf(withScheme)) return null;
  return withScheme;
}

/** Google 検索の URL */
export function searchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * 入力から行動の候補を並べる。配列の順がそのまま画面の優先順。
 * @param {import('./siteCatalog.mjs').SiteCatalog} catalog
 */
export function classify(catalog, rawInput) {
  const text = String(rawInput ?? '').trim();
  if (!text) return [];
  const url = normalizeUrl(text);
  if (!url) return [{ kind: 'webSearch', query: text, url: searchUrl(text) }];
  const rule = catalog.ruleFor(hostOf(url));
  if (!rule) {
    // PC 版だけの候補。yt-dlp は判定表に無いサイトも多く扱えるので、リンクだけで試せるようにする
    return [{ kind: 'openInBrowser', url }, { kind: 'tryDownload', url, siteName: catalog.nameForUrl(url) }];
  }
  if (!rule.downloadable) {
    return [
      { kind: 'unsupported', url, siteName: rule.name, reason: rule.reason ?? DEFAULT_UNSUPPORTED_REASON },
      { kind: 'openInBrowser', url },
    ];
  }
  return [{ kind: 'download', url, siteName: rule.name }, { kind: 'openInBrowser', url }];
}
