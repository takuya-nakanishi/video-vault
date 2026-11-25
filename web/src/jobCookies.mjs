// 送り手(ブラウザの拡張機能など)が URL と一緒に渡す Cookie を、形を確かめて取り込む。
// 取り込んだ Cookie は、その 1 件の取得にだけ使う(downloadCenter.mjs)。

export const MAX_JOB_COOKIES = 300;
const MAX_VALUE_CHARS = 8192;
const DOMAIN = /^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * 無ければ null(= 送り手は Cookie を渡していない)。並びなら、形の合うものだけを返す(空の並びもあり得る)。
 * 並びでない・多すぎるときは投げる(送り手の誤りを黙って捨てない)。
 */
export function parseJobCookies(list) {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list)) throw new Error('cookies は並びで渡す');
  if (list.length > MAX_JOB_COOKIES) throw new Error(`cookies が多すぎる(${MAX_JOB_COOKIES} 件まで)`);
  return list
    .filter(
      (c) =>
        c &&
        typeof c.name === 'string' && c.name && c.name.length <= 256 &&
        typeof c.value === 'string' && c.value.length <= MAX_VALUE_CHARS &&
        typeof c.domain === 'string' && DOMAIN.test(c.domain.toLowerCase()) &&
        (c.path === undefined || (typeof c.path === 'string' && c.path.startsWith('/') && c.path.length <= 1024)),
    )
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain.toLowerCase(),
      path: c.path ?? '/',
      expires: typeof c.expires === 'number' && Number.isFinite(c.expires) ? c.expires : -1,
      httpOnly: c.httpOnly === true,
      secure: c.secure === true,
    }));
}
