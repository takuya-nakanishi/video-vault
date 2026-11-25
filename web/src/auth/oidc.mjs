// OpenID Connect で「Google でログイン」をする。認可コード + PKCE(S256)。外の部品は使わず、Node の crypto で確かめる。
// 相手は Google に決め打ち(発行者を設定で変えられるのは、試験が偽の相手を立てるときだけ)。
//
// 確かめること(OpenID Connect Core 1.0 §3.1.3.7): ID トークンの署名(相手の公開鍵。RS256 だけ)・発行者・宛先(クライアント ID)・
// 期限・nonce。利用者の決め方は呼び出し側(auth/http.mjs)。
import crypto from 'node:crypto';

export const GOOGLE_ISSUER = 'https://accounts.google.com';
const CACHE_MS = 60 * 60 * 1000;
/** 時計のずれを見逃す幅 */
const SKEW_SECONDS = 120;
const TIMEOUT_MS = 15_000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const pkceChallenge = (verifier) => b64url(crypto.createHash('sha256').update(verifier).digest());

export class OidcError extends Error {
  name = 'OidcError';
}

export class OidcClient {
  #discovery = null;
  #jwks = null;

  /**
   * @param {object} o
   * @param {string} o.clientId
   * @param {string} o.clientSecret
   * @param {string} o.redirectUri 相手に登録した戻り先と 1 文字も違わないこと
   * @param {string} [o.issuer] 試験だけが変える
   * @param {boolean} [o.allowHttp] 試験だけが使う(この PC の中に立てた偽の相手は http)
   */
  constructor({ clientId, clientSecret, redirectUri, issuer = GOOGLE_ISSUER, allowHttp = false, fetchImpl = fetch, now = Date.now }) {
    Object.assign(this, { clientId, clientSecret, redirectUri, issuer, allowHttp, fetchImpl, now });
  }

  async #json(url, init) {
    let res;
    try {
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new OidcError(`相手に届かない: ${e.message}`);
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* JSON でない応答 */
    }
    // 応答の本文は出さない(トークンが入りうる)
    if (!res.ok || json === null || typeof json !== 'object') throw new OidcError(`相手が断った(HTTP ${res.status})`);
    return json;
  }

  #checkUrl(u) {
    const ok = typeof u === 'string' && (u.startsWith('https://') || (this.allowHttp && u.startsWith('http://127.0.0.1:')));
    if (!ok) throw new OidcError('相手の口の URL が https でない');
    return u;
  }

  async discovery() {
    if (this.#discovery && this.#discovery.until > this.now()) return this.#discovery.doc;
    const doc = await this.#json(`${this.issuer}/.well-known/openid-configuration`);
    if (doc.issuer !== this.issuer) throw new OidcError('相手の名乗る発行者が違う');
    for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) this.#checkUrl(doc[k]);
    this.#discovery = { doc, until: this.now() + CACHE_MS };
    return doc;
  }

  async #keys(refresh = false) {
    if (!refresh && this.#jwks && this.#jwks.until > this.now()) return this.#jwks.keys;
    const { jwks_uri } = await this.discovery();
    const json = await this.#json(jwks_uri);
    const keys = Array.isArray(json.keys) ? json.keys : [];
    this.#jwks = { keys, until: this.now() + CACHE_MS };
    return keys;
  }

  /** 相手の許可の画面の URL */
  async authorizationUrl({ state, nonce, codeVerifier }) {
    const { authorization_endpoint } = await this.discovery();
    const u = new URL(authorization_endpoint);
    for (const [k, v] of Object.entries({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'openid email',
      state,
      nonce,
      code_challenge: pkceChallenge(codeVerifier),
      code_challenge_method: 'S256',
    })) u.searchParams.set(k, v);
    return u.toString();
  }

  /** 戻ってきたコードを ID トークンに替えて確かめ、中身(claims)を返す */
  async redeem({ code, codeVerifier, nonce }) {
    const { token_endpoint } = await this.discovery();
    const json = await this.#json(token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code_verifier: codeVerifier,
      }).toString(),
    });
    if (typeof json.id_token !== 'string') throw new OidcError('応答に ID トークンが無い');
    return this.verifyIdToken(json.id_token, nonce);
  }

  async verifyIdToken(idToken, nonce) {
    const parts = String(idToken).split('.');
    if (parts.length !== 3) throw new OidcError('ID トークンの形が違う');
    let header;
    let claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new OidcError('ID トークンを読めない');
    }
    // 署名の方式は RS256 だけ。「署名なし」や共通鍵の方式を名乗るトークンは受けない
    if (header?.alg !== 'RS256' || typeof header.kid !== 'string') throw new OidcError('ID トークンの署名の方式が違う');
    let jwk = (await this.#keys()).find((k) => k.kid === header.kid);
    // 知らない鍵の名前は、相手が鍵を入れ替えた直後かもしれない。1 度だけ読み直す
    if (!jwk) jwk = (await this.#keys(true)).find((k) => k.kid === header.kid);
    if (!jwk || jwk.kty !== 'RSA' || (jwk.use && jwk.use !== 'sig')) throw new OidcError('ID トークンの署名の鍵が見つからない');
    let valid = false;
    try {
      const key = crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
      valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    } catch {
      valid = false;
    }
    if (!valid) throw new OidcError('ID トークンの署名が合わない');

    const nowSec = this.now() / 1000;
    // Google は発行者を 2 つの書き方で出す(https:// あり・なし)
    const issuers = this.issuer === GOOGLE_ISSUER ? [GOOGLE_ISSUER, 'accounts.google.com'] : [this.issuer];
    if (!issuers.includes(claims.iss)) throw new OidcError('ID トークンの発行者が違う');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.clientId)) throw new OidcError('ID トークンの宛先が違う');
    if (aud.length > 1 && claims.azp !== this.clientId) throw new OidcError('ID トークンの宛先が違う');
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS < nowSec) throw new OidcError('ID トークンの期限が切れている');
    if (typeof claims.iat === 'number' && claims.iat - SKEW_SECONDS > nowSec) throw new OidcError('ID トークンの時刻が先すぎる');
    if (typeof claims.nonce !== 'string' || !nonce || claims.nonce !== nonce) throw new OidcError('ID トークンが、この要求のものでない');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new OidcError('ID トークンに利用者の ID が無い');
    return claims;
  }
}
