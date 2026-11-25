// パスワードのハッシュ。scrypt(Node に入っているもの)で持ち、元のパスワードはどこにも残さない。
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
// OWASP の scrypt の目安(N=2^17, r=8, p=1)に合わせる。メモリを 128MB ほど使う
const PARAMS = { N: 1 << 17, r: 8, p: 1 };
const KEY_BYTES = 32;
const maxmem = (N, r) => 128 * N * r + 1024 * 1024;

/** 外から総当たりされる前提の長さ。短いパスワードは決めさせない */
export const MIN_PASSWORD_LENGTH = 12;

/** @param {{N:number,r:number,p:number}} [params] 試験だけが軽い設定を渡す。本番は既定のまま */
export async function hashPassword(password, params = PARAMS) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`パスワードは ${MIN_PASSWORD_LENGTH} 文字以上にする`);
  }
  const salt = crypto.randomBytes(16);
  const { N, r, p } = params;
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { N, r, p, maxmem: maxmem(N, r) });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** 合っていれば true。形の違う・強さの足りない保存値は、合っていないものとして扱う */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [scheme, n, r, p, saltB64, keyB64] = stored.split('$');
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  // 保存値を書き換えて弱い設定で通させない・巨大な設定でメモリを食わせない
  if (!Number.isInteger(N) || N < 1 << 14 || N > 1 << 20 || R !== 8 || P !== 1) return false;
  const expected = Buffer.from(keyB64, 'base64');
  if (expected.length !== KEY_BYTES) return false;
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), KEY_BYTES, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return crypto.timingSafeEqual(key, expected);
}

/** 利用者がいないときにも同じだけ時間を掛けるための、中身の無いハッシュ(いる・いないを時間から読ませない) */
let dummy = null;
export async function burnTime(password) {
  dummy ??= await hashPassword(crypto.randomBytes(18).toString('base64'));
  await verifyPassword(typeof password === 'string' ? password : '', dummy);
}
