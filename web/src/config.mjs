// 設定。値は環境変数で上書きできる(待ち受けるアドレスだけは変えられない)。
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const WEB_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(WEB_ROOT, '..');
/** 判定表とバッジの JS は Android アプリと同じファイルを読む(正本を 1 つにする) */
export const ASSETS_DIR = path.join(REPO_ROOT, 'android', 'app', 'src', 'main', 'assets');

/**
 * 待ち受けるのはこの PC の中だけ。ダウンロード系の機能を公開の URL に出さない(AGENTS.md)ので、
 * 環境変数でも変えられないようにしてある。
 */
export const LISTEN_HOST = '127.0.0.1';

export function isWsl(env = process.env, platform = process.platform, release = os.release()) {
  return platform === 'linux' && (Boolean(env.WSL_DISTRO_NAME) || /microsoft/i.test(release));
}

/** WSL から Windows のダウンロードフォルダを求める(移してあっても追える)。求められなければ null */
function windowsDownloadsFromWsl() {
  try {
    const ps = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
    const win = execFileSync(
      ps,
      ['-NoProfile', '-Command', "(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path"],
      { cwd: '/mnt/c', encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).replace(/\r/g, '').trim();
    if (!win) return null;
    return execFileSync('wslpath', [win], { encoding: 'utf8', timeout: 5_000 }).trim() || null;
  } catch {
    return null;
  }
}

/** 保存先の既定。Android の `Download/videos/` に合わせ、ダウンロードフォルダの videos に置く */
export function defaultOutDir(env = process.env) {
  const downloads = (isWsl(env) && windowsDownloadsFromWsl()) || path.join(os.homedir(), 'Downloads');
  return path.join(downloads, 'videos');
}

/** Basic 認証のパスワードの最小の長さ。外から総当たりされる前提で、短いものでは起動させない */
export const MIN_BASIC_PASSWORD_LENGTH = 16;
const PUBLIC_HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * 外から使うための設定。**公開用のホスト名は、Basic 認証と揃っているときだけ受け付ける**(片方だけでは起動しない)。
 * 認証なしで外へ出る設定の誤りを、起動の時点で止める。
 */
function loadRemoteAccess(env) {
  const publicHost = String(env.VIDEO_VAULT_PUBLIC_HOST ?? '').trim().toLowerCase() || null;
  const basicUser = env.VIDEO_VAULT_BASIC_USER || null;
  const basicPassword = env.VIDEO_VAULT_BASIC_PASSWORD || null;
  if (publicHost && !PUBLIC_HOST_PATTERN.test(publicHost)) {
    throw new Error('VIDEO_VAULT_PUBLIC_HOST はホスト名だけを書く(https:// やパスを付けない)');
  }
  if (Boolean(basicUser) !== Boolean(basicPassword)) {
    throw new Error('VIDEO_VAULT_BASIC_USER と VIDEO_VAULT_BASIC_PASSWORD は両方を指定する');
  }
  if (basicUser && (basicUser.includes(':') || /[\x00-\x1f]/.test(basicUser + basicPassword))) {
    throw new Error('Basic 認証の利用者名に「:」は使えない。制御文字も使えない');
  }
  if (basicPassword && basicPassword.length < MIN_BASIC_PASSWORD_LENGTH) {
    throw new Error(`VIDEO_VAULT_BASIC_PASSWORD は ${MIN_BASIC_PASSWORD_LENGTH} 文字以上にする`);
  }
  if (publicHost && !basicUser) {
    throw new Error('VIDEO_VAULT_PUBLIC_HOST を指定するときは、Basic 認証(VIDEO_VAULT_BASIC_USER・VIDEO_VAULT_BASIC_PASSWORD)も指定する');
  }
  return { publicHost, basicUser, basicPassword };
}

export function loadConfig(env = process.env) {
  const port = Number(env.VIDEO_VAULT_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`VIDEO_VAULT_PORT が正しくない: ${env.VIDEO_VAULT_PORT}`);
  }
  return {
    host: LISTEN_HOST,
    port,
    outDir: env.VIDEO_VAULT_OUT ? path.resolve(env.VIDEO_VAULT_OUT) : defaultOutDir(env),
    // ログインの状態。Cookie が入るので git に入れない(`.auth/` はどの階層でも gitignore 済み)
    authDir: path.resolve(env.VIDEO_VAULT_AUTH_DIR ?? path.join(WEB_ROOT, '.auth')),
    // 履歴。何を取ったかの記録なので git に入れない(`.data/` も gitignore 済み)
    dataDir: path.resolve(env.VIDEO_VAULT_DATA_DIR ?? path.join(WEB_ROOT, '.data')),
    headless: env.VIDEO_VAULT_HEADLESS === '1',
    // Windows では入っている Edge を使う(Playwright のブラウザを別に入れなくて済む)。空なら Playwright の Chromium
    browserChannel: env.VIDEO_VAULT_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : ''),
    ytdlpPath: env.VIDEO_VAULT_YTDLP || null,
    ffmpegPath: env.VIDEO_VAULT_FFMPEG || null,
    // 127.0.0.1 の URL を受け付けるか。通しの試験が自分で true にする。環境変数では変えられない
    allowLoopback: false,
    ...loadRemoteAccess(env),
  };
}
