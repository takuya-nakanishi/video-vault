// ログインのセッション。Cookie に入れるのは乱数だけで、ファイルにはその sha256 だけを置く
// (ファイルを読まれても、Cookie の値は作れない)。入れ直してもログインしたままにするために、ファイルに持つ。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 持つ数の上限。古いものから捨てる */
const MAX_SESSIONS = 50;

const digest = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export class SessionStore {
  #sessions = new Map();

  constructor(file, now = Date.now) {
    this.file = file;
    this.now = now;
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const s of Array.isArray(json?.sessions) ? json.sessions : []) {
        if (typeof s?.id === 'string' && typeof s?.email === 'string' && typeof s?.expiresAt === 'number' && s.expiresAt > now()) {
          this.#sessions.set(s.id, { email: s.email, expiresAt: s.expiresAt });
        }
      }
    } catch {
      /* 無い・壊れているときは、全員がログインし直す */
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const sessions = [...this.#sessions].map(([id, s]) => ({ id, ...s }));
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, sessions }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** 新しいセッションを作り、Cookie に入れる値を返す */
  create(email) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.#sessions.set(digest(token), { email, expiresAt: this.now() + SESSION_TTL_MS });
    while (this.#sessions.size > MAX_SESSIONS) this.#sessions.delete(this.#sessions.keys().next().value);
    this.#save();
    return token;
  }

  /** 生きているセッションなら { email }。無い・期限切れは null */
  get(token) {
    if (typeof token !== 'string' || !token) return null;
    const id = digest(token);
    const s = this.#sessions.get(id);
    if (!s) return null;
    if (s.expiresAt <= this.now()) {
      this.#sessions.delete(id);
      this.#save();
      return null;
    }
    return { email: s.email };
  }

  delete(token) {
    if (typeof token === 'string' && this.#sessions.delete(digest(token))) this.#save();
  }

  /** その利用者のセッションを全部消す(パスワードを変えた・利用者を消した) */
  deleteFor(email) {
    let changed = false;
    for (const [id, s] of this.#sessions) {
      if (s.email === email) {
        this.#sessions.delete(id);
        changed = true;
      }
    }
    if (changed) this.#save();
  }
}
