// ログインの画面。文字はすべて textContent で入れる。
'use strict';

const $ = (id) => document.getElementById(id);
const ERRORS = {
  google_failed: 'Google でログインできなかった。もう一度試す',
  google_not_registered: 'その Google アカウントは、ここに登録されていない',
};

function notify(text) {
  $('notice').textContent = text;
  $('notice').classList.toggle('error', Boolean(text));
}

notify(ERRORS[new URLSearchParams(location.search).get('error')] ?? '');

fetch('/auth/config')
  .then((r) => r.json())
  .then((c) => { $('google').hidden = !c.google; })
  .catch(() => {});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) return notify('メールアドレスとパスワードを入れる');
  $('submit').disabled = true;
  notify('');
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return location.replace('/');
    const body = await res.json().catch(() => ({}));
    const wait = Number(res.headers.get('Retry-After'));
    notify((body.error ?? 'ログインできなかった') + (res.status === 429 && wait > 0 ? `(あと ${Math.ceil(wait / 60)} 分ほど)` : ''));
    $('password').value = '';
    $('password').focus();
  } catch {
    notify('サーバに届かなかった');
  } finally {
    $('submit').disabled = false;
  }
});
