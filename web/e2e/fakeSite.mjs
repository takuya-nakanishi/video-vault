// 通しの試験の相手になる、偽のログイン付き動画サイト。この PC の中(127.0.0.1)にだけ立てる。
// 実在の外部サイトやアカウントには触らない。
import http from 'node:http';
import crypto from 'node:crypto';

/** 決まった中身の「動画」。中身は再生できなくてよい(yt-dlp はそのまま保存する)。1 バイトでも違えば試験が気づける */
function mediaBytes(size, seed) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 31 + seed * 17 + (i >> 8)) & 0xff;
  Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(buf); // mp4 の頭(ftyp isom)
  return buf;
}

const page = (title, body) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

export const PASSWORD = 'correct-horse';
export const TITLES = { member: '会員向けの動画 第1回', slow: 'ゆっくり届く動画', fast: 'すぐ届く動画' };

export async function startFakeSite() {
  // ログインの印。試験は、この値がアプリの状態・履歴・ログに出ていないことを確かめる
  const secret = `sid-${crypto.randomBytes(12).toString('hex')}`;
  const media = { member: mediaBytes(300_000, 1), slow: mediaBytes(900_000, 2), fast: mediaBytes(200_000, 3) };
  /** 届いた要求の記録 */
  const hits = [];
  const state = { slowAborted: 0 };

  const loggedIn = (req) => String(req.headers.cookie ?? '').split(/;\s*/).includes(`sid=${secret}`);

  function sendMedia(req, res, bytes, { throttle = false } = {}) {
    const head = { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length, 'Accept-Ranges': 'none' };
    res.writeHead(200, head);
    if (req.method === 'HEAD') return res.end();
    if (!throttle) return res.end(bytes);
    // 少しずつ送る。中断の試験が、取得の途中で止められるようにする
    let offset = 0;
    const timer = setInterval(() => {
      if (offset >= bytes.length) {
        clearInterval(timer);
        return res.end();
      }
      res.write(bytes.subarray(offset, (offset += 8192)));
    }, 60);
    res.on('close', () => {
      clearInterval(timer);
      if (offset < bytes.length) state.slowAborted += 1;
    });
  }

  const html = (res, status, text) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(text);
  };
  const video = (src) => `<video src="${src}" controls width="640" height="360"></video>`;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    hits.push({ method: req.method, path: url.pathname, loggedIn: loggedIn(req) });
    const p = url.pathname;

    if (p === '/login' && req.method === 'GET') {
      return html(res, 200, page('ログイン', '<form method="post" action="/login"><input name="user"><input name="pass" type="password"><button type="submit">ログイン</button></form>'));
    }
    if (p === '/login' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        if (form.get('pass') !== PASSWORD) return html(res, 401, page('ログインできません', '<p id="error">パスワードが違います</p>'));
        // 期限の無い Cookie(セッション Cookie)。ブラウザのプロファイルには残らないので、アプリの写しが要る
        res.writeHead(303, { Location: '/watch', 'Set-Cookie': `sid=${secret}; Path=/; HttpOnly` });
        res.end();
      });
      return;
    }
    if (p === '/watch') {
      if (!loggedIn(req)) return html(res, 403, page('会員限定', '<p>ログインが必要です</p>'));
      return html(res, 200, page(TITLES.member, video('/media/clip.mp4')));
    }
    if (p === '/media/clip.mp4') {
      if (!loggedIn(req)) return html(res, 403, page('会員限定', '<p>ログインが必要です</p>'));
      return sendMedia(req, res, media.member);
    }
    if (p === '/open/watch') return html(res, 200, page(TITLES.slow, video('/open/slow.mp4')));
    if (p === '/open/slow.mp4') return sendMedia(req, res, media.slow, { throttle: true });
    if (p === '/open/watch2') return html(res, 200, page(TITLES.fast, video('/open/fast.mp4')));
    if (p === '/open/fast.mp4') return sendMedia(req, res, media.fast);

    // 悪用の試験。埋め込みの枠(広告などを想定)の JS が、アプリの口を直接呼ぶ
    if (p === '/abuse') return html(res, 200, page('枠のあるページ', '<p>本文</p><iframe id="ad" src="/abuse-frame" width="300" height="100"></iframe>'));
    if (p === '/abuse-frame') {
      return html(res, 200, page('枠', `<script>(async () => {
        try { await window.__vvNative('download', JSON.stringify({ targetUrl: location.origin + '/open/watch2' })); } catch (e) {}
        document.title = 'frame-called';
      })();</script>`));
    }
    // 一番上のページの JS が、バッジを押さずに口を呼ぶ。1 回目は http でない先、直後に 2 回目
    if (p === '/abuse-top') {
      return html(res, 200, page('口を直接呼ぶページ', `<p>動画は無い</p><script>window.addEventListener('load', async () => {
        try { await window.__vvNative('download', JSON.stringify({ targetUrl: 'file:///etc/passwd' })); } catch (e) {}
        try { await window.__vvNative('download', JSON.stringify({ targetUrl: location.origin + '/open/watch2' })); } catch (e) {}
        document.title = 'top-called';
      });</script>`));
    }
    return html(res, 404, page('無い', '<p>無い</p>'));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    secret,
    media,
    hits,
    state,
    async stop() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
