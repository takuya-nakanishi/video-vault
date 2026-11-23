// アプリが開くブラウザ。Android の内蔵ブラウザ(ui/browser/BrowserScreen.kt)の役割。
//
// - ログインの状態はプロファイル(`.auth/profile/`)に残る。次に開いたときもログインしたまま
// - ページの動画の枠にダウンロードのバッジを出す。JS は Android と同じファイル(assets/video_badge.js)
// - Cookie は yt-dlp へ渡すためにここから読む。窓を閉じたあとも渡せるよう、開いている間に写しを取っておく
//   (セッション Cookie はプロファイルに残らないため)。写しは `.auth/` の下で、名前に storageState を含む
//
// 動画の通信を横取りして解析する方式は採らない(Android と同じ方針)。
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { normalizeUrl } from './inputClassifier.mjs';

const SNAPSHOT_INTERVAL_MS = 5000;
/** バッジの連打と、ページの JS からの連続呼び出しを抑える間隔。video_badge.js の二重発火の抑えと同じ値 */
const BADGE_MIN_INTERVAL_MS = 800;
const MAX_PAYLOAD_CHARS = 8192;

/** ページへ入れる JS。橋渡しの口(window.VideoVault)を Android と同じ名前で用意してから、バッジの JS を走らせる */
export function buildInitScript(badgeScript) {
  return `(() => {
  // Android は一番上のページにだけ入れている。埋め込みの iframe(広告など)には入れない
  if (window.top !== window) return;
  window.VideoVault = {
    onVideoDownload: (json) => { try { window.__vvNative('download', String(json)); } catch (e) {} },
    onVideoCount: () => {},
    // PC のブラウザはパスキーを使えるので、Android のような案内は要らない
    onPasskeyAttempt: () => {},
  };
  const run = () => { try {
${badgeScript}
  } catch (e) { console.warn('ゲットVIDEO: バッジを出せない', e); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();`;
}

export class LoginBrowser extends EventEmitter {
  #context = null;
  #launching = null;
  #timer = null;
  #lastBadgeAt = 0;

  /**
   * @param {object} opts
   * @param {string} opts.authDir
   * @param {boolean} opts.headless
   * @param {string} opts.channel 'msedge'・'chrome' など。空なら Playwright の Chromium
   * @param {string} opts.badgeScript assets/video_badge.js の中身
   * @param {(hit:{pageUrl:string,targetUrl:string,title:string}) => void} opts.onBadge
   */
  constructor({ authDir, headless = false, channel = '', badgeScript = '', onBadge = () => {}, now = Date.now, allowLoopback = false }) {
    super();
    this.profileDir = path.join(authDir, 'profile');
    this.snapshotFile = path.join(authDir, 'cookies.storageState.json');
    this.headless = headless;
    this.channel = channel;
    this.badgeScript = badgeScript;
    this.onBadge = onBadge;
    this.now = now;
    this.urlOpts = { allowLoopback };
  }

  isOpen() {
    return this.#context !== null;
  }

  /** 試験がページを操作するための口 */
  get context() {
    return this.#context;
  }

  async #ensure() {
    if (this.#context) return this.#context;
    this.#launching ??= this.#launch().finally(() => {
      this.#launching = null;
    });
    return this.#launching;
  }

  async #launch() {
    fs.mkdirSync(this.profileDir, { recursive: true, mode: 0o700 });
    // playwright はここで読む。ブラウザを使わない試験が、起動のたびに読み込まなくて済む
    const { chromium } = await import('playwright');
    const context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless,
      channel: this.channel || undefined,
      viewport: null,
      // 自分のアカウントへ自分でログインするための窓。「自動テスト ソフトウェアによって制御されています」の帯と、
      // それを理由にログインを断るサイト(Google など)を避ける。**通るかは実物のログインでしか確かめられない**
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    });
    await this.#restoreSessionCookies(context);
    await context.exposeBinding('__vvNative', (source, kind, payload) => this.#onNative(source, kind, payload));
    if (this.badgeScript.trim()) await context.addInitScript({ content: buildInitScript(this.badgeScript) });
    context.on('page', (page) => this.#watch(page));
    for (const page of context.pages()) this.#watch(page);
    context.on('close', () => {
      clearInterval(this.#timer);
      this.#timer = null;
      this.#context = null;
      this.emit('change');
    });
    this.#timer = setInterval(() => void this.#snapshot(), SNAPSHOT_INTERVAL_MS);
    this.#timer.unref?.();
    this.#context = context;
    this.emit('change');
    return context;
  }

  #readSnapshot() {
    try {
      const json = JSON.parse(fs.readFileSync(this.snapshotFile, 'utf8'));
      return Array.isArray(json?.cookies) ? json.cookies : [];
    } catch {
      return [];
    }
  }

  /**
   * 期限の無い Cookie(セッション Cookie)を、前回の写しから戻す。
   *
   * ブラウザのプロファイルは期限の無い Cookie を残さない。戻さないと、窓を閉じて開き直すたびにログインが外れ、
   * 直後の写しがログイン前の状態で上書きされる(2026-11-23 に通しの試験で見つけた)。
   * 期限のある Cookie はプロファイルに残っているので触らない(古い写しで新しい値を上書きしない)。
   */
  async #restoreSessionCookies(context) {
    const session = this.#readSnapshot().filter(
      (c) => c && typeof c.name === 'string' && typeof c.value === 'string' && !(typeof c.expires === 'number' && c.expires > 0),
    );
    for (const c of session) {
      // 1 件ずつ入れる。形の合わない 1 件のために、残りを捨てない
      await context
        .addCookies([{ name: c.name, value: c.value, domain: c.domain, path: c.path, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }])
        .catch(() => {});
    }
  }

  #watch(page) {
    // ログインの直後(画面の移り変わり)に写しを取る。5 秒おきの写しを待たずに窓を閉じられても失わない
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) void this.#snapshot();
    });
  }

  /**
   * ページの JS からの呼び出し。**どのページからでも呼べる**ので、できることは「いまのページの動画を順番待ちに積む」だけにし、
   * この PC の情報は何も返さない。
   */
  async #onNative(source, kind, payload) {
    if (kind !== 'download') return;
    // 埋め込みの iframe からの呼び出しは受けない(橋渡しの口を入れていないが、関数そのものは見える)
    if (source.frame !== source.page.mainFrame()) return;
    const now = this.now();
    if (now - this.#lastBadgeAt < BADGE_MIN_INTERVAL_MS) return;
    this.#lastBadgeAt = now;
    let data = {};
    try {
      if (typeof payload === 'string' && payload.length <= MAX_PAYLOAD_CHARS) data = JSON.parse(payload) ?? {};
    } catch {
      /* 読めない中身は、ページの URL だけで続ける */
    }
    // ページの URL は、ページの言い分ではなくブラウザから取る
    const pageUrl = source.page.url();
    const targetUrl =
      normalizeUrl(typeof data.targetUrl === 'string' ? data.targetUrl : '', this.urlOpts) ?? normalizeUrl(pageUrl, this.urlOpts);
    if (!targetUrl) return;
    await this.#snapshot();
    this.onBadge({ pageUrl, targetUrl, title: typeof data.title === 'string' ? data.title.slice(0, 200) : '' });
  }

  async #snapshot() {
    const context = this.#context;
    if (!context) return null;
    let cookies;
    try {
      cookies = await context.cookies();
    } catch {
      return null; // 閉じる途中
    }
    try {
      fs.mkdirSync(path.dirname(this.snapshotFile), { recursive: true, mode: 0o700 });
      const tmp = `${this.snapshotFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: this.now(), cookies }), { mode: 0o600 });
      fs.renameSync(tmp, this.snapshotFile);
    } catch (e) {
      console.error(`Cookie の写しを書けない: ${e.message}`);
    }
    return cookies;
  }

  /** yt-dlp へ渡す Cookie。開いていればブラウザから、閉じていれば写しから読む。期限の切れたものは除く */
  async cookies() {
    let cookies = await this.#snapshot();
    cookies ??= this.#readSnapshot();
    const nowSec = this.now() / 1000;
    return cookies.filter((c) => !(typeof c.expires === 'number' && c.expires > 0 && c.expires < nowSec));
  }

  /** ブラウザの窓を開いて(無ければ起こして)URL へ行く */
  async open(rawUrl) {
    const url = normalizeUrl(rawUrl, this.urlOpts);
    if (!url) throw new Error('URL として読めない');
    const context = await this.#ensure();
    const blank = context.pages().find((p) => p.url() === 'about:blank');
    const page = blank ?? (await context.newPage());
    await page.bringToFront().catch(() => {});
    // 読み込みの完了は待たない(重いページで応答が止まる)。行けなかったときだけ知らせる
    page.goto(url, { waitUntil: 'commit' }).catch((e) => {
      console.error(`ページを開けない(${new URL(url).host}): ${String(e.message).split('\n')[0]}`);
    });
    return page;
  }

  async close() {
    const context = this.#context;
    if (!context) return;
    await this.#snapshot();
    await context.close().catch(() => {});
  }
}
