import { DEFAULTS, validServer } from './shared.js';

const $ = (id) => document.getElementById(id);
const status = (text, ok) => {
  $('status').textContent = text;
  $('status').className = ok ? 'ok' : 'error';
};

const saved = await chrome.storage.local.get(['server', 'key', 'quality']);
$('server').value = saved.server ?? DEFAULTS.server;
$('key').value = saved.key ?? '';
$('quality').value = saved.quality ?? DEFAULTS.quality;

$('save').addEventListener('click', async () => {
  const server = validServer($('server').value);
  const key = $('key').value.trim();
  if (!server) return status('送り先は https の URL にする(この PC の中なら http://127.0.0.1:8787 も可)', false);
  if (!key) return status('端末の鍵を入れる', false);
  await chrome.storage.local.set({ server, key, quality: $('quality').value });
  $('server').value = server;
  try {
    const res = await fetch(`${server}/api/v1/ping`, { headers: { Authorization: `Bearer ${key}` }, credentials: 'omit' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) status(`保存した。つながった(端末の名前: ${body.device})`, true);
    else if (res.status === 401) status('保存した。ただし端末の鍵が違う', false);
    else status(`保存した。ただし、つながらなかった(HTTP ${res.status})`, false);
  } catch {
    status('保存した。ただし、送り先に届かなかった', false);
  }
});
