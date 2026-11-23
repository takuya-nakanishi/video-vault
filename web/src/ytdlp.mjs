// yt-dlp を探して起動する。Android の data/DownloadRepository.kt の役割(PC では入っている yt-dlp を直接呼ぶ)。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFile, spawn } from 'node:child_process';
import { ACCESS_HEADER } from './vidyard.mjs';

const isWin = process.platform === 'win32';

function onPath(names, env = process.env) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* 次の候補へ */
      }
    }
  }
  return null;
}

function probe(command, prefixArgs, versionFlag = '--version') {
  return new Promise((resolve) => {
    execFile(command, [...prefixArgs, versionFlag], { timeout: 30_000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim().split(/\r?\n/)[0] || null);
    });
  });
}

/**
 * yt-dlp の呼び方を決める。見つからなければ null。
 *
 * 探す順: 環境変数 VIDEO_VAULT_YTDLP → PATH → `~/.local/bin/yt-dlp` → `python -m yt_dlp`。
 * `~/.local/bin` を別に見るのは、サービスや非対話のシェルの PATH に入っていないことがあるため
 * (2026-11-23 に、これで「入っていない」と読み違えた)。
 *
 * @returns {Promise<{command:string, prefixArgs:string[], version:string}|null>}
 */
export async function locateYtdlp(env = process.env, explicit = null) {
  const candidates = [];
  if (explicit) candidates.push([explicit, []]);
  const found = onPath(isWin ? ['yt-dlp.exe', 'yt-dlp.cmd'] : ['yt-dlp'], env);
  if (found) candidates.push([found, []]);
  if (!isWin) candidates.push([path.join(os.homedir(), '.local', 'bin', 'yt-dlp'), []]);
  for (const py of isWin ? ['python', 'py'] : ['python3', 'python']) candidates.push([py, ['-m', 'yt_dlp']]);
  for (const [command, prefixArgs] of candidates) {
    const version = await probe(command, prefixArgs);
    if (version) return { command, prefixArgs, version };
    // 明示された場所で動かないのに別の yt-dlp で黙って続けると、どれが走ったか分からなくなる
    if (explicit && command === explicit) return null;
  }
  return null;
}

/**
 * ffmpeg の実行ファイルの場所。見つからなければ null。
 *
 * yt-dlp は、映像と音声が別々に配られる動画(YouTube など)を ffmpeg で 1 本に結合する。ffmpeg を見つけられないと、
 * **結合しないまま終了コード 0 で終わり**、音の無い映像と音声が別々のファイルで残る(2026-11-23 に実際に踏んだ)。
 * Android は ffmpeg を同梱しているので起きない。PC では探して `--ffmpeg-location` で渡す。
 *
 * 探す順は yt-dlp と同じ: 環境変数 VIDEO_VAULT_FFMPEG → PATH → `~/.local/bin/ffmpeg`。
 */
export async function locateFfmpeg(env = process.env, explicit = null) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  else {
    const found = onPath(isWin ? ['ffmpeg.exe'] : ['ffmpeg'], env);
    if (found) candidates.push(found);
    if (!isWin) candidates.push(path.join(os.homedir(), '.local', 'bin', 'ffmpeg'));
  }
  for (const file of candidates) {
    if (await probe(file, [], '-version')) return file;
  }
  return null;
}

/** yt-dlp が「結合できなかった」と知らせる行か。この行が出たら、終了コードが 0 でも成功にしない */
export function isNotMergedWarning(line) {
  return /^WARNING:.*\bffmpeg\b.*won't be merged/i.test(line.trim());
}

/**
 * yt-dlp に渡す引数。URL は必ず `--` の後ろに置く(`-` で始まる入力をオプションとして読ませない)。
 *
 * Android と違うところ:
 * - `--force-ipv4` を付けない。あれは同梱 python の名前解決の回避策で、PC では要らない
 * - `--js-runtimes node:<このプロセスの node>` を付ける。yt-dlp は YouTube の処理に JavaScript の実行環境を要求し、
 *   既定で有効なのは Deno だけ。このアプリは Node で動いているので、Node は必ずある(Deno があればそちらが優先される)
 * - `--no-playlist` を付ける。リンク 1 つで 1 本だけ取る
 * - `--ffmpeg-location` を付ける(上の locateFfmpeg)
 * - `--encoding utf-8` を付ける。Windows の yt-dlp.exe は出力を cp932 で出し、日本語の題名が化けて履歴に残る
 *   (2026-11-23 に Windows の通しの試験で見つけた。環境変数 PYTHONUTF8 は、配布版の exe には効かなかった)
 */
export function buildArgs({ url, outDir, quality, cookieFile = null, vidyardToken = null, ffmpeg = null, nodePath = process.execPath }) {
  const args = [
    '--newline',
    '--color', 'never',
    '--encoding', 'utf-8',
    '--no-playlist',
    '--no-mtime',
    '-o', path.join(outDir, '%(title)s.%(ext)s'),
    '--js-runtimes', `node:${nodePath}`,
  ];
  // ffmpeg の入っているディレクトリを渡す(同じ場所の ffprobe も使える)
  if (ffmpeg) args.push('--ffmpeg-location', path.dirname(ffmpeg));
  if (quality?.formatSelector) args.push('-f', quality.formatSelector);
  if (cookieFile) args.push('--cookies', cookieFile);
  // 解錠したトークン。yt-dlp は全ての通信にこのヘッダを付け、Vidyard がそれを見て動画の URL を返す
  if (vidyardToken) args.push('--add-header', `${ACCESS_HEADER}:${vidyardToken}`);
  args.push('--', url);
  return args;
}

/**
 * yt-dlp を起動する。出力は 1 行ずつ `onLine` へ渡す。
 * 引数には Cookie のファイルの場所や Vidyard のトークンが入るので、**引数をログに出さない**。
 *
 * @returns {{ done: Promise<{code:number|null, signal:string|null}>, cancel: () => void }}
 */
export function runYtdlp({ command, prefixArgs = [], args, onLine = () => {} }) {
  const child = spawn(command, [...prefixArgs, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX ではプロセスグループを分け、中断のときに yt-dlp が起こした ffmpeg ごと止める
    detached: !isWin,
    windowsHide: true,
    // 出力を UTF-8 に固定する。Windows の既定(cp932)のままだと日本語のタイトルが化ける
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    readline.createInterface({ input: stream }).on('line', (line) => {
      if (line.trim()) onLine(line);
    });
  }
  const done = new Promise((resolve) => {
    child.on('error', (e) => {
      onLine(`ERROR: yt-dlp を起動できない: ${e.message}`);
      resolve({ code: null, signal: null });
    });
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  let killTimer = null;
  done.then(() => clearTimeout(killTimer));
  const cancel = () => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    if (isWin) {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      return;
    }
    const signalGroup = (sig) => {
      try {
        process.kill(-child.pid, sig);
      } catch {
        /* 既に終わっている */
      }
    };
    signalGroup('SIGTERM');
    killTimer = setTimeout(() => signalGroup('SIGKILL'), 3000);
  };
  return { done, cancel };
}
