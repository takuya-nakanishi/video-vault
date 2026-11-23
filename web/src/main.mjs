// 起動の入口。`npm start` で呼ぶ。
import { loadConfig } from './config.mjs';
import { createApp } from './server.mjs';

const config = loadConfig();
const app = createApp(config);

try {
  await app.start();
} catch (e) {
  console.error(
    e.code === 'EADDRINUSE'
      ? `ポート ${config.port} が使われている。すでに起動しているか、VIDEO_VAULT_PORT で別の番号を指定する`
      : `起動できない: ${e.message}`,
  );
  process.exit(1);
}

console.log(`ゲットVIDEO(PC 版)を起動した。ブラウザで開く: ${app.url}`);
console.log(`保存先: ${config.outDir}`);
console.log('止めるときは Ctrl+C');

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // 走っているダウンロードは中断の扱いにする(次に起動したとき、履歴は「中断」になる)
  const running = app.center.state().running;
  if (running) app.center.cancel(running.id);
  await app.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
