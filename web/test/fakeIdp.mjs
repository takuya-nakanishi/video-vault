// 試験の相手になる、偽の「Google」(OpenID Connect の提供元)。この PC の中(127.0.0.1)にだけ立てる。
// 本物と同じ手順(discovery → 許可 → コードの引き換え → RS256 で署名した ID トークン)を返し、
// 試験が中身をわざと壊せるようにしてある。
import crypto from 'node:crypto';
import http from 'node:http';

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export async function startFakeIdp({ clientId, clientSecret }) {
  const good = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const KID = 'key-1';
  /** コード → { claims, challenge, redirectUri, options } */
  const codes = new Map();
  const seen = { tokenRequests: 0, pkceFailures: 0 };
  let issuer = '';

  function sign(claims, { alg = 'RS256', kid = KID, key = good.privateKey } = {}) {
    const head = `${b64url({ alg, kid, typ: 'JWT' })}.${b64url(claims)}`;
    if (alg === 'none') return `${head}.`;
    return `${head}.${crypto.sign('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, issuer);
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [{ ...good.publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] });
    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen.tokenRequests += 1;
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const entry = codes.get(form.get('code'));
        codes.delete(form.get('code')); // コードは 1 度きり
        if (!entry || form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret || form.get('redirect_uri') !== entry.redirectUri) {
          return json(400, { error: 'invalid_grant' });
        }
        // PKCE: 許可のときに受けた challenge と、引き換えのときの verifier が対になっていること
        const challenge = crypto.createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (challenge !== entry.challenge) {
          seen.pkceFailures += 1;
          return json(400, { error: 'invalid_grant' });
        }
        const o = entry.options;
        return json(200, { access_token: 'x', token_type: 'Bearer', id_token: sign(entry.claims, { alg: o.alg, kid: o.kid, key: o.wrongKey ? other.privateKey : good.privateKey }) });
      });
      return;
    }
    return json(404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${server.address().port}`;

  return {
    issuer,
    seen,
    /**
     * 利用者が許可の画面で「許可」を押したことにして、コードを作る。
     * @param {string} authorizationUrl アプリが送り出した許可の画面の URL
     * @param {object} who ID トークンに入れる利用者(sub・email・email_verified)
     * @param {object} [options] わざと壊す所(claims の上書き・署名の鍵・方式)
     */
    approve(authorizationUrl, who, options = {}) {
      const q = new URL(authorizationUrl).searchParams;
      const nowSec = Math.floor(Date.now() / 1000);
      const claims = { iss: issuer, aud: q.get('client_id'), iat: nowSec, exp: nowSec + 300, nonce: q.get('nonce'), ...who, ...(options.claims ?? {}) };
      const code = crypto.randomBytes(16).toString('hex');
      codes.set(code, { claims, challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri'), options });
      return { code, state: q.get('state'), params: Object.fromEntries(q) };
    },
    sign,
    async stop() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
