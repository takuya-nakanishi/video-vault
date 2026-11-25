// ログインの口。自前のログイン(メールアドレスとパスワード)と「Google でログイン」を受け、セッションの Cookie を置く。
//
// - 入れるのは、利用者の表(users.mjs)にいる人だけ。Google で確かめられても、表にいなければ入れない
// - まちがいが続いた相手(IP)は 15 分のあいだ受け付けない。同じアカウントへのまちがいが続いたら、次を受けるまで待たせる
//   (1 分から倍にして 1 時間まで。アカウントを閉じてはしまわない。閉じると、他人が本人を締め出せる)
// - パスワード・Cookie の値・Google から来たトークンを、ログにもエラーの文にも出さない
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyPassword, burnTime } from './password.mjs';
import { normalizeEmail } from './users.mjs';
import { SESSION_TTL_MS } from './sessions.mjs';

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
export const ACCOUNT_FREE_FAILURES = 5;
export const ACCOUNT_WAIT_MIN_MS = 60 * 1000;
export const ACCOUNT_WAIT_MAX_MS = 60 * 60 * 1000;
/** Google へ行って戻るまでの持ち時間 */
const OIDC_STATE_TTL_MS = 10 * 60 * 1000;
/** パスワードの照合は重い(メモリを 128MB ほど使う)。同時に走らせる数を限る */
const MAX_CONCURRENT_VERIFY = 2;
const MAX_REMEMBERED = 5000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function parseCookies(req) {
  const out = new Map();
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

/**
 * @param {object} deps
 * @param {import('./users.mjs').UserStore} deps.users
 * @param {import('./sessions.mjs').SessionStore} deps.sessions
 * @param {import('./oidc.mjs').OidcClient|null} deps.oidc 無ければ「Google でログイン」を出さない
 * @param {boolean} deps.always 利用者が 1 人もいなくてもログインを求める(公開用のホスト名があるとき。表を消されても開かない)
 */
export function createAuth({ users, sessions, oidc, always, now, send, readJson, allowedOrigins, publicDir }) {
  // Google へ行って戻るあいだの状態に署名する鍵。起動のたびに作る(入れ直しをまたいだログインの途中は、やり直しになる)
  const stateKey = crypto.randomBytes(32);
  const hmac = (text) => crypto.createHmac('sha256', stateKey).update(text).digest();
  /** IP → { count, until } */
  const ipFailures = new Map();
  /** メールアドレス → { count, until } */
  const accountFailures = new Map();
  let verifying = 0;

  const sessionCookie = (secure) => (secure ? '__Host-vv_session' : 'vv_session');
  const oidcCookie = (secure) => (secure ? '__Host-vv_oidc' : 'vv_oidc');
  // 公開用の名前(https)では Secure を付け、__Host- でこのホストだけに限る。この PC の中(http)では付けられない
  const cookie = (name, value, maxAgeSeconds, secure) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
  const whoOf = (req) => String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '');
  const redirect = (res, to, extra = {}) => send(res, 302, { to }, undefined, { ...extra, Location: to });
  const remember = (map, key, value) => {
    if (map.size > MAX_REMEMBERED) map.clear(); // 覚えすぎない
    map.set(key, value);
  };

  function sessionOf(req, secure) {
    const token = parseCookies(req).get(sessionCookie(secure));
    const s = sessions.get(token);
    if (!s) return null;
    // 表から消した利用者は、セッションが残っていても通さない
    if (!users.find(s.email)) {
      sessions.delete(token);
      return null;
    }
    return { email: s.email, token };
  }

  function startSession(res, email, secure) {
    return cookie(sessionCookie(secure), sessions.create(email), Math.floor(SESSION_TTL_MS / 1000), secure);
  }

  function serveFile(res, file, type) {
    return send(res, 200, fs.readFileSync(path.join(publicDir, file), 'utf8'), type);
  }

  async function passwordLogin(req, res, secure) {
    if (!allowedOrigins().has(req.headers.origin)) return send(res, 403, { error: '別のサイトからは受け付けない' });
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return send(res, 415, { error: 'JSON だけを受け付ける' });
    }
    const body = await readJson(req);
    const who = whoOf(req);
    const tooMany = (until) =>
      send(res, 429, { error: 'まちがいが続いたので、しばらく受け付けない' }, undefined, {
        'Retry-After': String(Math.max(1, Math.ceil((until - now()) / 1000))),
      });
    const ipLock = ipFailures.get(who);
    if (ipLock && ipLock.until > now()) return tooMany(ipLock.until);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' && body.password.length <= 1024 ? body.password : '';
    const wait = email ? accountFailures.get(email) : null;
    // 待たせている間は、パスワードを照らさない
    if (wait && wait.until > now()) return tooMany(wait.until);
    if (verifying >= MAX_CONCURRENT_VERIFY) return send(res, 429, { error: '混んでいる。少し待ってからやり直す' }, undefined, { 'Retry-After': '2' });

    const user = email ? users.find(email) : null;
    let ok = false;
    verifying += 1;
    try {
      if (user?.passwordHash && password) ok = await verifyPassword(password, user.passwordHash);
      // 利用者がいない・パスワードを持たないときも、同じだけ時間を掛ける(いる・いないを時間から読ませない)
      else await burnTime(password);
    } finally {
      verifying -= 1;
    }

    if (!ok) {
      const prev = ipLock && ipLock.until <= now() && ipLock.count >= LOGIN_MAX_FAILURES ? 0 : (ipLock?.count ?? 0);
      remember(ipFailures, who, { count: prev + 1, until: prev + 1 >= LOGIN_MAX_FAILURES ? now() + LOGIN_LOCK_MS : 0 });
      if (email) {
        const count = (wait?.count ?? 0) + 1;
        const over = count - ACCOUNT_FREE_FAILURES;
        const until = over >= 0 ? now() + Math.min(ACCOUNT_WAIT_MAX_MS, ACCOUNT_WAIT_MIN_MS * 2 ** Math.min(over, 10)) : 0;
        remember(accountFailures, email, { count, until });
      }
      // どちらが違うかは言わない
      return send(res, 401, { error: 'メールアドレスかパスワードが違う' });
    }
    ipFailures.delete(who);
    accountFailures.delete(email);
    return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': startSession(res, user.email, secure) });
  }

  async function googleStart(res, secure) {
    const state = b64url(crypto.randomBytes(32));
    const issuedAt = String(now());
    const signed = `${state}.${issuedAt}.${b64url(hmac(`${state}.${issuedAt}`))}`;
    let to;
    try {
      // PKCE の検証子と nonce は、state から鍵で導く(Cookie に秘密を置かない)
      to = await oidc.authorizationUrl({ state, nonce: b64url(hmac(`nonce:${state}`)), codeVerifier: b64url(hmac(`pkce:${state}`)) });
    } catch (e) {
      console.error(`Google でログイン: 始められない: ${e.message}`);
      return redirect(res, '/login?error=google_failed');
    }
    return redirect(res, to, { 'Set-Cookie': cookie(oidcCookie(secure), signed, OIDC_STATE_TTL_MS / 1000, secure) });
  }

  async function googleCallback(req, res, url, secure) {
    const clear = cookie(oidcCookie(secure), '', 0, secure);
    const fail = (code) => redirect(res, `/login?error=${code}`, { 'Set-Cookie': clear });
    const [state, issuedAt, sig] = String(parseCookies(req).get(oidcCookie(secure)) ?? '').split('.');
    // この要求を始めたブラウザであること。他人が用意した戻りの URL を踏まされても、state が合わない
    const fresh = state && issuedAt && sig && now() - Number(issuedAt) <= OIDC_STATE_TTL_MS && Number(issuedAt) <= now();
    const signedOk = fresh && crypto.timingSafeEqual(hmac(`${state}.${issuedAt}`), Buffer.concat([Buffer.from(sig, 'base64url'), Buffer.alloc(32)]).subarray(0, 32));
    const given = url.searchParams.get('state') ?? '';
    if (!signedOk || given.length !== state.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(state))) {
      return fail('google_failed');
    }
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error') || !code) return fail('google_failed');
    let claims;
    try {
      claims = await oidc.redeem({ code, codeVerifier: b64url(hmac(`pkce:${state}`)), nonce: b64url(hmac(`nonce:${state}`)) });
    } catch (e) {
      console.error(`Google でログイン: 確かめられない: ${e.message}`);
      return fail('google_failed');
    }
    // 利用者との結び付けは Google の変わらない ID(sub)。初めてのときだけ、Google が確かめたアドレスで表を探して結ぶ
    let user = users.findByGoogleSub(claims.sub);
    if (!user && claims.email_verified === true) {
      const candidate = users.find(claims.email);
      if (candidate && !candidate.googleSub) user = users.upsert(candidate.email, { googleSub: claims.sub });
    }
    if (!user) return fail('google_not_registered');
    return redirect(res, '/', { 'Set-Cookie': [clear, startSession(res, user.email, secure)] });
  }

  return {
    enabled: () => always || users.list().length > 0,
    sessionOf,

    /**
     * ログインの前でも受ける口。扱ったら true。
     * @param {boolean} secure 公開用の名前(https)で来た要求か
     */
    async route(req, res, url, secure) {
      const p = url.pathname;
      if (req.method === 'GET') {
        if (p === '/login') {
          if (sessionOf(req, secure)) return redirect(res, '/'), true;
          return serveFile(res, 'login.html', 'text/html; charset=utf-8'), true;
        }
        if (p === '/login.js') return serveFile(res, 'login.js', 'text/javascript; charset=utf-8'), true;
        if (p === '/style.css') return serveFile(res, 'style.css', 'text/css; charset=utf-8'), true;
        if (p === '/auth/config') return send(res, 200, { google: oidc !== null }), true;
        if (p === '/auth/google') return oidc ? (await googleStart(res, secure), true) : (send(res, 404, { error: '無い' }), true);
        if (p === '/auth/google/callback') return oidc ? (await googleCallback(req, res, url, secure), true) : (send(res, 404, { error: '無い' }), true);
        return false;
      }
      if (req.method === 'POST' && p === '/auth/login') return await passwordLogin(req, res, secure), true;
      if (req.method === 'POST' && p === '/auth/logout') {
        if (!allowedOrigins().has(req.headers.origin)) return send(res, 403, { error: '別のサイトからは受け付けない' }), true;
        sessions.delete(parseCookies(req).get(sessionCookie(secure)));
        return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': cookie(sessionCookie(secure), '', 0, secure) }), true;
      }
      return false;
    },
  };
}
