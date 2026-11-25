// 端末の鍵。画面を通さずに URL を送ってくる道具(ブラウザの拡張機能など)を確かめる。
// 鍵は作ったときに 1 度だけ見せ、ファイルには sha256 だけを置く(ファイルを読まれても鍵は作れない)。
// ファイルは ~/.config/video-vault/devices.json(持ち主だけが読める。リポジトリには置かない)。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const KEY_PATTERN = /^vvd_[A-Za-z0-9_-]{43}$/;
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;
const digest = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

export class DeviceStore {
  constructor(file) {
    this.file = file;
  }

  #read() {
    try {
      const json = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return (Array.isArray(json?.devices) ? json.devices : []).filter(
        (d) => d && typeof d.name === 'string' && typeof d.hash === 'string' && /^[0-9a-f]{64}$/.test(d.hash),
      );
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw new Error(`端末の表を読めない(${this.file}): ${e.message}`);
    }
  }

  #write(devices) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, devices }, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  list() {
    return this.#read().map(({ name, createdAt }) => ({ name, createdAt }));
  }

  /** 新しい鍵を作って返す。同じ名前があれば作り直す(前の鍵は効かなくなる) */
  create(name, now = Date.now()) {
    if (!NAME_PATTERN.test(String(name))) throw new Error('端末の名前は英数字と . _ - で 40 文字まで');
    const key = `vvd_${crypto.randomBytes(32).toString('base64url')}`;
    const rest = this.#read().filter((d) => d.name !== name);
    this.#write([...rest, { name, hash: digest(key), createdAt: now }]);
    return key;
  }

  /** 鍵が合えば { name }、合わなければ null */
  verify(key) {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return null;
    const h = Buffer.from(digest(key), 'hex');
    // 全部と比べる(見つかった所で打ち切らない)
    let found = null;
    for (const d of this.#read()) {
      if (crypto.timingSafeEqual(h, Buffer.from(d.hash, 'hex'))) found = { name: d.name };
    }
    return found;
  }

  remove(name) {
    const all = this.#read();
    const rest = all.filter((d) => d.name !== name);
    if (rest.length === all.length) return false;
    this.#write(rest);
    return true;
  }
}
