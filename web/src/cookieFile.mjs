// ブラウザの Cookie を、yt-dlp の `--cookies` が読む Netscape 形式のファイルにする。
// Android の data/CookieJar.kt と同じ役割。PC ではブラウザから domain・path・期限つきで取れるので、補うのは
// セッション Cookie の期限だけ。
//
// **書き出したファイルは認証情報そのもの**。一時ディレクトリに持ち主だけが読める形で置き、使い終わったら必ず消す。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** 期限切れ扱いを避けるための固定値(2038-01-01)。セッション Cookie の寿命はサイト側が決める */
const FAR_FUTURE_EPOCH_SECONDS = 2145916800;

const hasControl = (s) => /[\t\r\n]/.test(s);

/**
 * @param {{name:string,value:string,domain:string,path:string,expires?:number,httpOnly?:boolean,secure?:boolean}[]} cookies
 *   Playwright の `context.cookies()` の形
 */
export function toNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File', ''];
  for (const c of cookies) {
    if (!c || typeof c.name !== 'string' || typeof c.value !== 'string' || typeof c.domain !== 'string') continue;
    const cookiePath = typeof c.path === 'string' && c.path ? c.path : '/';
    // タブと改行は形式の区切り。入った Cookie を書くと、後ろの行が別の Cookie として読まれる
    if (!c.name || !c.domain || [c.name, c.value, c.domain, cookiePath].some(hasControl)) continue;
    const expires = typeof c.expires === 'number' && c.expires > 0 ? Math.floor(c.expires) : FAR_FUTURE_EPOCH_SECONDS;
    lines.push(
      [
        (c.httpOnly ? '#HttpOnly_' : '') + c.domain,
        c.domain.startsWith('.') ? 'TRUE' : 'FALSE',
        cookiePath,
        c.secure ? 'TRUE' : 'FALSE',
        String(expires),
        c.name,
        c.value,
      ].join('\t'),
    );
  }
  return lines.join('\n') + '\n';
}

/** Cookie が 1 件も無ければ null。あれば、専用の一時ディレクトリの中にファイルを作ってそのパスを返す */
export async function writeCookieFile(cookies, tmpRoot = os.tmpdir()) {
  const text = toNetscape(cookies ?? []);
  if (text.split('\n').filter((l) => l && !l.startsWith('# ')).length === 0) return null;
  const dir = await fs.mkdtemp(path.join(tmpRoot, 'vv-cookies-'));
  const file = path.join(dir, 'cookies.txt');
  await fs.writeFile(file, text, { mode: 0o600 });
  return file;
}

/** `writeCookieFile` が作ったファイルを、入れ物のディレクトリごと消す。成否にかかわらず呼ぶ */
export async function removeCookieFile(file) {
  if (!file) return;
  await fs.rm(path.dirname(file), { recursive: true, force: true });
}
