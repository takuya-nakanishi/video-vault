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

const PUBLIC_HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** 秘密を置く場所(利用者の表・外から使うための設定)。リポジトリの外 */
export function privateConfigDir(env = process.env) {
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'video-vault');
}

/**
 * 外から使うための設定。公開用のホスト名と「Google でログイン」。
 * **公開用のホスト名があるときは、必ずログインを求める**(利用者が 1 人もいなければ起動しない。server.mjs)。
 */
function loadRemoteAccess(env) {
  const publicHost = String(env.VIDEO_VAULT_PUBLIC_HOST ?? '').trim().toLowerCase() || null;
  const googleClientId = env.VIDEO_VAULT_GOOGLE_CLIENT_ID || null;
  const googleClientSecret = env.VIDEO_VAULT_GOOGLE_CLIENT_SECRET || null;
  if (publicHost && !PUBLIC_HOST_PATTERN.test(publicHost)) {
    throw new Error('VIDEO_VAULT_PUBLIC_HOST はホスト名だけを書く(https:// やパスを付けない)');
  }
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error('VIDEO_VAULT_GOOGLE_CLIENT_ID と VIDEO_VAULT_GOOGLE_CLIENT_SECRET は両方を指定する');
  }
  // Google に登録する戻り先は https の公開用の名前。それが無ければ「Google でログイン」は成り立たない
  if (googleClientId && !publicHost) {
    throw new Error('「Google でログイン」を使うときは、VIDEO_VAULT_PUBLIC_HOST も指定する(戻り先になる)');
  }
  return {
    publicHost,
    googleClientId,
    googleClientSecret,
    usersFile: path.resolve(env.VIDEO_VAULT_USERS_FILE ?? path.join(privateConfigDir(env), 'users.json')),
    devicesFile: path.resolve(env.VIDEO_VAULT_DEVICES_FILE ?? path.join(privateConfigDir(env), 'devices.json')),
  };
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
