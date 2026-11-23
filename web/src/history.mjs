// ダウンロード履歴。Android の domain/HistoryEntry.kt(HistoryLog)と data/HistoryStore.kt と同じ規則。
// 「どのサイトから何を取ったか」を見返すための記録で、保存先のパスも Cookie もパスワードも持たない。
import fs from 'node:fs';
import path from 'node:path';

export const HistoryStatus = Object.freeze({
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

/** 履歴は無限に増える。自分用なので上限は大きめに、ただし無制限にはしない */
export const MAX_ENTRIES = 500;

const FIELDS = ['id', 'url', 'siteName', 'title', 'startedAt', 'finishedAt', 'status', 'error', 'quality'];

/** 履歴に書いてよい項目だけを残す(呼び出し側が余分な項目を渡しても、ファイルに出ない) */
function pick(entry) {
  const out = {};
  for (const k of FIELDS) out[k] = entry[k] ?? null;
  return out;
}

/** 不変の台帳。変更のたびに新しいインスタンスを返す。新しい順に並ぶ */
export class HistoryLog {
  constructor(entries = []) {
    this.entries = [...entries]
      .map(pick)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_ENTRIES);
  }

  upsert(entry) {
    return new HistoryLog([...this.entries.filter((e) => e.id !== entry.id), entry]);
  }

  remove(id) {
    return new HistoryLog(this.entries.filter((e) => e.id !== id));
  }

  clear() {
    return new HistoryLog();
  }

  /** 前回のプロセスが途中で死んだ RUNNING は二度と完了しないので、CANCELLED に倒す */
  settleStale(now) {
    return new HistoryLog(
      this.entries.map((e) =>
        e.status === HistoryStatus.RUNNING
          ? { ...e, status: HistoryStatus.CANCELLED, finishedAt: now, error: 'アプリの終了により中断' }
          : e,
      ),
    );
  }
}

/** 履歴のファイル。一時ファイルに書いてから置き換える(書いている途中で落ちても壊れない) */
export class HistoryStore {
  constructor(file) {
    this.file = file;
  }

  load() {
    try {
      const json = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const valid = (Array.isArray(json?.entries) ? json.entries : []).filter(
        (e) =>
          e &&
          typeof e.id === 'string' &&
          typeof e.url === 'string' &&
          typeof e.startedAt === 'number' &&
          Object.hasOwn(HistoryStatus, e.status),
      );
      return new HistoryLog(valid);
    } catch {
      return new HistoryLog();
    }
  }

  save(log) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: log.entries }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
