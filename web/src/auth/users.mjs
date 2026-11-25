// 利用者の表。入れる人を決める唯一の場所で、ここに無い人は Google で確かめられても入れない。
// ファイルは ~/.config/video-vault/users.json(持ち主だけが読める。リポジトリには置かない)。
// パスワードはハッシュだけを持つ。Google で入る人は、初めて入ったときに Google の変わらない ID(sub)を結ぶ。
import fs from 'node:fs';
import path from 'node:path';

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** メールアドレスを小文字にそろえる。形が違えば null */
export function normalizeEmail(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s.length <= 254 && EMAIL.test(s) ? s : null;
}

export class UserStore {
  constructor(file) {
    this.file = file;
  }

  /** 毎回ファイルから読む(道具で足した利用者を、入れ直さずに効かせる。件数は少ない) */
  #read() {
    try {
      const json = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return (Array.isArray(json?.users) ? json.users : [])
        .map((u) => ({
          email: normalizeEmail(u?.email),
          passwordHash: typeof u?.passwordHash === 'string' && u.passwordHash ? u.passwordHash : null,
          googleSub: typeof u?.googleSub === 'string' && u.googleSub ? u.googleSub : null,
        }))
        .filter((u) => u.email);
    } catch (e) {
      // 無いのは「利用者がまだいない」。壊れているのは別で、黙って空として読むと、ログインが要らない状態に見える
      if (e.code === 'ENOENT') return [];
      throw new Error(`利用者の表を読めない(${this.file}): ${e.message}`);
    }
  }

  #write(users) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, users }, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  list() {
    return this.#read();
  }

  find(email) {
    const e = normalizeEmail(email);
    return e ? (this.#read().find((u) => u.email === e) ?? null) : null;
  }

  findByGoogleSub(sub) {
    return typeof sub === 'string' && sub ? (this.#read().find((u) => u.googleSub === sub) ?? null) : null;
  }

  /** 足すか、あれば書き換える。変える項目だけを渡す */
  upsert(email, fields) {
    const e = normalizeEmail(email);
    if (!e) throw new Error('メールアドレスの形が違う');
    const users = this.#read();
    const i = users.findIndex((u) => u.email === e);
    const next = { email: e, passwordHash: null, googleSub: null, ...(i >= 0 ? users[i] : {}), ...fields };
    if (i >= 0) users[i] = next;
    else users.push(next);
    this.#write(users);
    return next;
  }

  remove(email) {
    const e = normalizeEmail(email);
    const users = this.#read();
    const rest = users.filter((u) => u.email !== e);
    if (rest.length === users.length) return false;
    this.#write(rest);
    return true;
  }
}
