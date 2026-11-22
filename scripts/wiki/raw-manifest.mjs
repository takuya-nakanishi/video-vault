#!/usr/bin/env node
// llm-wiki/raw/manifest.tsv(元の置き場〈Google ドライブなど〉にある原本の台帳)を作り直す・突き合わせる。
//
//   node scripts/wiki/raw-manifest.mjs                     元の置き場を読んで台帳に新しい原本の行を足す
//   node scripts/wiki/raw-manifest.mjs --check             書かずに、元の置き場と台帳の差(新規・更新・消えた)だけを出す
//   node scripts/wiki/raw-manifest.mjs --accept <path>...  取り込んだ原本の bytes・modified を元の置き場の今の値にする(初回も取り込み直しも)
//
// 台帳の bytes・modified は「取り込んだときの版」。書き直しても、更新された原本の行は古い値のまま残し、
// --accept で取り込み直したと記録するまで「更新」として出し続ける(取り込み待ちの印を消さないため)。
// 差は bytes と modified(秒まで)で見る。中身のハッシュは取らない(録画・zip もあり、毎回は読めない)。
// そのため、大きさも更新時刻も変えずに中身だけ差し替えた原本は検知できない。
//
// 元の置き場・置き場を変える環境変数・台帳に載せない原本(exclude)は llm-wiki/wiki.config.json の manifest に書く。
// agent-base の templates/wiki/ から配ったもの。このリポジトリで直さない(config.mjs の頭を見る)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, MANIFEST, rel } from './config.mjs';

const HEADER = ['path', 'bytes', 'modified', 'source'];
// 元の置き場。台帳を使わない(設定に manifest が無い)リポジトリでは空
export const DRIVE_DIR = config.manifest?.dir ?? '';

// 台帳に載せない原本か。走査で飛ばすだけでなく、台帳に残った行も作り直しで落とす(lint は載っていればエラーにする)
export const isExcluded = (p) => (config.manifest?.exclude ?? []).some((re) => re.test(p));

export function readManifest(file = MANIFEST) {
  if (!fs.existsSync(file)) return [];
  // コメント行はタブを含まない「#」始まりの行。元の置き場に「# OLD」のようなフォルダがあるので、path が「#」で始まる行は残す
  const isComment = (l) => l.startsWith('#') && !l.includes('\t');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && !isComment(l));
  if (!lines.length) return [];
  const [head, ...rows] = lines;
  const cols = head.split('\t');
  return rows.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i], v])));
}

export function scanDrive(dir = DRIVE_DIR) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const p = path.relative(dir, abs).split(path.sep).join('/');
      if (isExcluded(p)) continue;
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        const st = fs.statSync(abs);
        out.push({ path: p, bytes: String(st.size), modified: st.mtime.toISOString().slice(0, 19) + 'Z' });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// 台帳の modified が日付だけ(秒まで記録する前の行)なら、日付の部分だけを比べる
export function sameVersion(recorded, current) {
  if (recorded.bytes !== current.bytes) return false;
  const m = recorded.modified || '';
  return m.length === 10 ? current.modified.startsWith(m) : m === current.modified;
}

export function diff(manifest, drive) {
  const m = new Map(manifest.map((r) => [r.path, r]));
  const d = new Map(drive.map((r) => [r.path, r]));
  return {
    added: drive.filter((r) => !m.has(r.path)),
    changed: drive.filter((r) => m.has(r.path) && !sameVersion(m.get(r.path), r)),
    removed: manifest.filter((r) => !d.has(r.path)),
  };
}

function main() {
  if (!config.manifest) {
    console.error('台帳を使う設定が無い(llm-wiki/wiki.config.json の manifest。書き方は scripts/wiki/config.mjs の頭)');
    process.exit(2);
  }
  if (!DRIVE_DIR || !fs.existsSync(DRIVE_DIR)) {
    const env = config.manifest.dirEnv ? `。環境変数 ${config.manifest.dirEnv} で指定できる` : '';
    console.error(`原本の置き場が見えない: ${DRIVE_DIR || '(未設定)'}(llm-wiki/wiki.config.json の manifest.dir${env})`);
    process.exit(2);
  }
  const all = readManifest();
  const manifest = all.filter((r) => !isExcluded(r.path));
  for (const r of all.filter((r) => isExcluded(r.path))) console.log(`除外\t${r.path}`);
  const drive = scanDrive();
  const accept = new Set();
  const ai = process.argv.indexOf('--accept');
  if (ai !== -1) {
    for (const a of process.argv.slice(ai + 1)) {
      if (a.startsWith('--')) break;
      if (!drive.some((r) => r.path === a)) {
        console.error(`元の置き場に無い原本: ${a}`);
        process.exit(2);
      }
      accept.add(a);
    }
    if (!accept.size) {
      console.error('--accept には取り込んだ原本のパス(台帳の path 列)を渡す');
      process.exit(2);
    }
  }
  const { added, changed, removed } = diff(
    manifest.map((r) => (accept.has(r.path) ? { ...r, bytes: '', modified: '' } : r)),
    drive,
  );
  for (const r of added) console.log(`新規\t${r.path}`);
  for (const r of changed) console.log(`更新\t${r.path}`);
  for (const r of removed) console.log(`消えた\t${r.path}`);
  if (process.argv.includes('--check')) return;

  const prev = new Map(manifest.map((r) => [r.path, r]));
  const changedPaths = new Set(changed.map((r) => r.path));
  // 更新された原本は、--accept されるまで取り込んだときの版(台帳の値)を残す。
  // 変わっていない原本は今の値に揃える(日付だけの古い行を秒まで記録し直す)。
  // 元の置き場から消えた原本も、要約ページから参照されているので台帳には残す
  const rows = [...drive, ...removed].map((r) => {
    const old = prev.get(r.path);
    const keep = old && changedPaths.has(r.path) && !accept.has(r.path);
    return { ...(keep ? old : r), source: old?.source || '—' };
  });
  rows.sort((a, b) => a.path.localeCompare(b.path));
  const body = [
    '# llm-wiki/raw/manifest.tsv — 元の置き場にある原本の台帳。node scripts/wiki/raw-manifest.mjs で作り直す。source 列は手で(ingest のときに)埋める',
    HEADER.join('\t'),
    ...rows.map((r) => HEADER.map((k) => r[k]).join('\t')),
  ];
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, body.join('\n') + '\n');
  console.log(`書いた: ${rel(MANIFEST)}(${rows.length} 件)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
