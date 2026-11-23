// ダウンロードの実行状態と履歴の持ち主。Android の data/DownloadCenter.kt の役割。
// Android は 1 件ずつで 2 件目を断るが、PC 版は順番待ちに積む(走らせるのは 1 件ずつのまま)。
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { HistoryStatus } from './history.mjs';
import { qualityFromName } from './quality.mjs';
import { normalizeUrl, hostOf } from './inputClassifier.mjs';
import { titleFrom, percentFrom, errorFrom } from './ytdlpOutput.mjs';
import { playerUuidOf, accessTokenFor, LockedError, CancelledBeforeStartError } from './vidyard.mjs';
import { writeCookieFile, removeCookieFile } from './cookieFile.mjs';
import { buildArgs, runYtdlp, isNotMergedWarning } from './ytdlp.mjs';

/** 順番待ちの上限。ページの JS からも積めるので、無制限にしない */
export const MAX_QUEUE = 20;

export class DownloadCenter extends EventEmitter {
  #queue = [];
  #running = null;
  #cancelRunning = null;
  /** パスワードはここ(メモリ)にだけ置く。ジョブにも履歴にも状態の JSON にも入れない */
  #passwords = new Map();
  #history;
  #idle = Promise.resolve();

  /**
   * @param {object} deps
   * @param {import('./siteCatalog.mjs').SiteCatalog} deps.catalog
   * @param {import('./history.mjs').HistoryStore} deps.historyStore
   * @param {string} deps.outDir
   * @param {() => Promise<object[]>} deps.cookiesProvider ログイン用のブラウザの Cookie
   * @param {() => Promise<{command:string,prefixArgs:string[],ffmpeg?:string|null}|null>} deps.ytdlp yt-dlp の呼び方と ffmpeg の場所
   * @param {typeof runYtdlp} [deps.run] 試験で差し替える
   * @param {typeof accessTokenFor} [deps.unlockVidyard] 試験で差し替える
   */
  constructor({ catalog, historyStore, outDir, cookiesProvider, ytdlp, run = runYtdlp, unlockVidyard = accessTokenFor, now = Date.now, tmpRoot, allowLoopback = false }) {
    super();
    this.catalog = catalog;
    this.historyStore = historyStore;
    this.outDir = outDir;
    this.cookiesProvider = cookiesProvider;
    this.ytdlp = ytdlp;
    this.run = run;
    this.unlockVidyard = unlockVidyard;
    this.now = now;
    this.tmpRoot = tmpRoot;
    this.allowLoopback = allowLoopback;
    this.#history = historyStore.load().settleStale(now());
    historyStore.save(this.#history);
  }

  get history() {
    return this.#history;
  }

  state() {
    return {
      running: this.#running ? { ...this.#running } : null,
      queue: this.#queue.map((j) => ({ ...j })),
      history: this.#history.entries,
    };
  }

  /** いま走っているものと順番待ちが全部終わるまで待つ(終了処理と試験で使う) */
  async whenIdle() {
    while (this.#running || this.#queue.length) await this.#idle;
  }

  /**
   * 順番待ちに積む。
   * @returns {{ok:true,id:string}|{ok:false,error:string}}
   */
  enqueue({ url: rawUrl, quality, password, source = 'input' }) {
    const url = normalizeUrl(rawUrl, { allowLoopback: this.allowLoopback });
    if (!url) return { ok: false, error: 'URL として読めない(http・https の URL だけを受け付ける)' };
    const rule = this.catalog.ruleFor(hostOf(url));
    if (rule && !rule.downloadable) return { ok: false, error: `${rule.name}: ${rule.reason ?? '対象外のサイト'}` };
    if (this.#running?.url === url || this.#queue.some((j) => j.url === url)) {
      return { ok: false, error: 'すでに順番待ちにある' };
    }
    if (this.#queue.length >= MAX_QUEUE) return { ok: false, error: `順番待ちが上限(${MAX_QUEUE} 件)に達している` };
    const job = {
      id: crypto.randomUUID(),
      url,
      siteName: this.catalog.nameForUrl(url),
      quality: qualityFromName(quality).name,
      source,
      queuedAt: this.now(),
      startedAt: null,
      percent: null,
      line: '',
      title: null,
    };
    if (typeof password === 'string' && password) this.#passwords.set(job.id, password);
    this.#queue.push(job);
    this.#changed();
    this.#pump();
    return { ok: true, id: job.id };
  }

  /** 順番待ちから外すか、走っているものを中断する */
  cancel(id) {
    const i = this.#queue.findIndex((j) => j.id === id);
    if (i >= 0) {
      this.#queue.splice(i, 1);
      this.#passwords.delete(id);
      this.#changed();
      return true;
    }
    if (this.#running?.id === id) {
      this.#running.cancelled = true;
      this.#cancelRunning?.();
      this.#changed();
      return true;
    }
    return false;
  }

  removeHistory(id) {
    this.#setHistory(this.#history.remove(id));
  }

  clearHistory() {
    // 走っているものの記録は残す(終わったときに書き戻されるので、消しても復活する)
    const running = this.#history.entries.filter((e) => e.status === HistoryStatus.RUNNING);
    this.#setHistory(this.#history.clear());
    for (const e of running) this.#setHistory(this.#history.upsert(e));
  }

  #setHistory(log) {
    this.#history = log;
    this.historyStore.save(log);
    this.#changed();
  }

  #changed() {
    this.emit('change');
  }

  #pump() {
    if (this.#running || !this.#queue.length) return;
    const job = this.#queue.shift();
    this.#running = job;
    this.#idle = this.#execute(job)
      .catch((e) => console.error(`ダウンロードの後始末で失敗: ${e.message}`))
      .finally(() => {
        this.#running = null;
        this.#cancelRunning = null;
        this.#passwords.delete(job.id);
        this.#changed();
        this.#pump();
      });
  }

  async #execute(job) {
    job.startedAt = this.now();
    const entry = {
      id: job.id,
      url: job.url,
      siteName: job.siteName,
      title: null,
      startedAt: job.startedAt,
      finishedAt: null,
      status: HistoryStatus.RUNNING,
      error: null,
      quality: job.quality,
    };
    this.#setHistory(this.#history.upsert(entry));

    let cookieFile = null;
    let lastError = null;
    let notMerged = false;
    let status;
    let error = null;
    const isCancelled = () => job.cancelled === true;
    // yt-dlp を起動する前の段(解錠・Cookie の用意)で押された中断は、段の切れ目で拾う。
    // 拾わないと、中断したのに解錠の後で取得が始まる(Android で 2026-11-10 に指摘された穴と同じ)
    const ensureNotCancelled = () => {
      if (isCancelled()) throw new CancelledBeforeStartError();
    };
    try {
      ensureNotCancelled();
      const tool = await this.ytdlp();
      if (!tool) throw new Error('yt-dlp が見つからない(入れるか、VIDEO_VAULT_YTDLP で場所を指定する)');

      let vidyardToken = null;
      const uuid = playerUuidOf(job.url);
      if (uuid) {
        job.line = 'Vidyardの保護を確認中…';
        this.#changed();
        vidyardToken = await this.unlockVidyard(uuid, this.#passwords.get(job.id) ?? null, { isCancelled });
      }
      ensureNotCancelled();

      cookieFile = await writeCookieFile(await this.cookiesProvider(), this.tmpRoot);
      ensureNotCancelled();

      const args = buildArgs({
        url: job.url,
        outDir: this.outDir,
        quality: qualityFromName(job.quality),
        cookieFile,
        vidyardToken,
        ffmpeg: tool.ffmpeg ?? null,
      });
      const proc = this.run({
        command: tool.command,
        prefixArgs: tool.prefixArgs,
        args,
        onLine: (line) => {
          const percent = percentFrom(line);
          if (percent !== null) job.percent = percent;
          const title = titleFrom(line);
          if (title) job.title = title;
          const err = errorFrom(line);
          if (err) lastError = err;
          if (isNotMergedWarning(line)) notMerged = true;
          job.line = line.slice(0, 300);
          this.#changed();
        },
      });
      this.#cancelRunning = proc.cancel;
      // 起動と中断が入れ違ったときのため、起動の直後にも見る
      if (isCancelled()) proc.cancel();
      const { code } = await proc.done;
      if (isCancelled()) status = HistoryStatus.CANCELLED;
      else if (code === 0 && notMerged) {
        // yt-dlp は終了コード 0 で終わるが、できたのは音の無い映像と音声の別々のファイル。成功にしない
        status = HistoryStatus.FAILED;
        error = 'ffmpeg が見つからず、映像と音声を 1 本に結合できなかった(ffmpeg を入れるか、VIDEO_VAULT_FFMPEG で場所を指定する)';
      } else if (code === 0) status = HistoryStatus.SUCCESS;
      else {
        status = HistoryStatus.FAILED;
        error = lastError ?? `yt-dlp が終了コード ${code ?? '不明'} で終わった`;
      }
    } catch (e) {
      if (e instanceof CancelledBeforeStartError || isCancelled()) status = HistoryStatus.CANCELLED;
      else {
        status = HistoryStatus.FAILED;
        // LockedError の文はそのまま見せる。それ以外も 1 行だけ持つ
        error = e instanceof LockedError ? e.message : String(e.message ?? e).split('\n')[0];
      }
    } finally {
      // Cookie は認証情報。成否にかかわらず残さない
      await removeCookieFile(cookieFile).catch(() => {});
    }
    this.#setHistory(
      this.#history.upsert({ ...entry, title: job.title, finishedAt: this.now(), status, error }),
    );
  }
}
