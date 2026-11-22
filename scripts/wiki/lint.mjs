#!/usr/bin/env node
// Wiki の機械的な健康診断(lint の前半)。中身の矛盾・古い記述・足りない概念ページは LLM が読んで見る(lint の skill)。
//
//   node scripts/wiki/lint.mjs
//
// 見るもの:
//   エラー  … 切れたリンク([[...]] と Markdown のリンク)/ llm-wiki の中を Markdown のリンクで指している / index.md に載っていないページ / frontmatter の type が無い
//             / sources に書いた要約ページが無い / 要約ページの番号(NN-)の重なり / 台帳の source 列が指すページが無い
//             / 各ページの「未解決の問い」の節が llm-wiki/backlog/QUESTIONS.md と合っているか / 問いの項目のファイルの「ページ」が指すページが無い
//             / 台帳に載せない原本(設定の manifest.exclude)が載っている
//             / ファイル名の決まり(空白・アンダースコアを使わない。要約ページは NN- の通し番号で始める。llm-wiki skill)
//             / 直下の AGENTS.md「LLM Wiki」に、始めたときの「(書く: …)」が残っている
//             / 表示名がファイル名と同じだけの別名(`[[wiki/concepts/休暇|休暇]]`。`[[wiki/concepts/休暇]]` と書く)
//             / llm-wiki/wiki/log.md がある(履歴は git のコミットに残す。llm-wiki skill「履歴(git)」。ほかの検査では見ない)
//   注意    … type が一覧に無い / どこからも(index.md 以外から)リンクされていないページ / 台帳で未取り込み(source が —)の原本
//             / 元の置き場と台帳の差(置き場が見えるときだけ)/ 道具が agent-base の正本と違う(隣に agent-base があるときだけ)
// エラーがあれば終了コード 1。
//
// リポジトリごとの値(type の追加、sources/ の目録のページ、台帳)は llm-wiki/wiki.config.json。
// agent-base の templates/wiki/ から配ったもの。このリポジトリで直さない(config.mjs の頭を見る)。

import fs from 'node:fs';
import path from 'node:path';
import { config, REPO, LLM_WIKI, WIKI, rel, staleTools } from './config.mjs';
import { readManifest, scanDrive, diff, DRIVE_DIR, isExcluded } from './raw-manifest.mjs';
import { plan, HEADING } from './open-questions.mjs';

const errors = [];
const warns = [];

if (!fs.existsSync(WIKI)) {
  console.log('エラー\tllm-wiki/wiki が無い(llm-wiki skill の「始める・道具を更新する」で作る)');
  process.exit(1);
}

{
  const stale = staleTools();
  if (stale?.length) {
    warns.push(`道具が agent-base の正本と違う: ${stale.join('・')}(llm-wiki skill「始める・道具を更新する」で配り直す。agent-base が古いなら先に pull する)`);
  }
}

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.md') ? [p] : [];
  });
}

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    // 行末の「 # コメント」は値に含めない(llm-wiki skill の frontmatter の例のとおりに書いたページを読めるように)
    const v = kv[2].replace(/\s+#.*$/, '').trim();
    fm[kv[1]] = v.startsWith('[') ? v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : v;
  }
  return fm;
}

// コードブロックとインラインコードの中のリンクは数えない
const stripCode = (t) => t.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

// 直下の AGENTS.md「LLM Wiki」の節に、始めたとき(wiki-init.mjs)の埋める印が残っていないか
{
  const agents = path.join(REPO, 'AGENTS.md');
  if (fs.existsSync(agents)) {
    const n = fs.readFileSync(agents, 'utf8').split('\n').filter((l) => l.includes('(書く:')).length;
    if (n) errors.push(`AGENTS.md: 「LLM Wiki」の節に埋めていない項目が ${n} 個ある(「(書く:」の行)`);
  }
}

// 未解決の問いの正本は llm-wiki/backlog/QUESTIONS.md。各ページの「## 未解決の問い」は open-questions.mjs --write が作る(llm-wiki skill「未解決の問い」)
const LEGACY_Q = /^##+ .*(答えが無い|確かめたいこと|まだ分かっていない|画面で確かめる所)/;
function checkOpenQuestions(p, text, fm) {
  if (fm?.type === 'source') return; // 要約ページは取り込んだ時点の記録なので見ない
  for (const h of text.split('\n').filter((l) => /^##+ /.test(l))) {
    if (h !== HEADING && /未解決/.test(h)) errors.push(`${rel(p)}: 見出しは「${HEADING}」にそろえる: ${h}`);
    if (LEGACY_Q.test(h)) errors.push(`${rel(p)}: 未解決の点は llm-wiki/backlog/QUESTIONS.md へ移す: ${h}`);
  }
}
{
  const { result, missing } = plan();
  for (const m of missing) errors.push(`llm-wiki/backlog/QUESTIONS.md: ${m}`);
  for (const [abs, v] of result) {
    if (v.now !== v.want) errors.push(`${rel(abs)}: 「${HEADING}」が QUESTIONS.md と合っていない(node scripts/wiki/open-questions.mjs --write)`);
  }
}

// Wiki の履歴は git のコミットに残す(llm-wiki skill「履歴(git)」)。log.md が残っていればエラーにして、ほかの検査では見ない
const log = path.join(WIKI, 'log.md');
if (fs.existsSync(log)) errors.push('llm-wiki/wiki/log.md がある。Wiki の履歴は git のコミットに残すので、git rm で消す(中身は git の履歴に残る。llm-wiki skill「履歴(git)」)');
const pages = walk(WIKI).filter((p) => p !== log);
const SOURCES = path.join(WIKI, 'sources');
for (const p of pages) {
  const name = path.basename(p);
  if (/[\s_]/.test(name)) errors.push(`${rel(p)}: ファイル名に空白・アンダースコアを使わない(区切りは「・」か「-」)`);
  if (path.dirname(p) === SOURCES && !config.sourceIndexes.includes(name) && !/^\d{2,}-/.test(name)) {
    errors.push(`${rel(p)}: 要約ページのファイル名は NN- の通し番号で始める(目録のページなら llm-wiki/wiki.config.json の sourceIndexes に足す)`);
  }
}
// 要約ページの通し番号(NN-)は 1 本に 1 つ。並行するセッションが同じ番号を付けると、本文の「30 へ付け替えた」のような番号の参照がどちらを指すか分からなくなる
if (fs.existsSync(SOURCES)) {
  const byNo = new Map();
  for (const f of fs.readdirSync(SOURCES)) {
    const m = f.match(/^(\d+)-.*\.md$/);
    if (m) byNo.set(m[1], [...(byNo.get(m[1]) ?? []), f]);
  }
  for (const [no, fs_] of byNo) if (fs_.length > 1) errors.push(`llm-wiki/wiki/sources: 要約ページの番号 ${no} が重なっている: ${fs_.join(', ')}(後からできた方を最大の番号 + 1 へ改名する)`);
}

const inbound = new Map(pages.map((p) => [p, new Set()]));
const index = path.join(WIKI, 'index.md');

for (const p of pages) {
  const text = fs.readFileSync(p, 'utf8');
  const fm = frontmatter(text);
  if (!fm || !fm.type) errors.push(`${rel(p)}: frontmatter の type が無い`);
  else if (!config.types.includes(fm.type)) warns.push(`${rel(p)}: type が一覧に無い値: ${fm.type}(使うなら llm-wiki/wiki.config.json の extraTypes に足す)`);
  // 問いへの答え(inquiries)は asked(問うた日)と sources を持つ(llm-wiki skill「frontmatter」)
  if (fm && fm.type === 'inquiry') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fm.asked ?? ''))) errors.push(`${rel(p)}: inquiry に asked: YYYY-MM-DD が無い`);
    if (!Array.isArray(fm.sources)) errors.push(`${rel(p)}: inquiry に sources: [...] が無い(根拠の要約ページが無ければ [])`);
  }
  checkOpenQuestions(p, text, fm);
  for (const s of (fm && Array.isArray(fm.sources) && fm.sources) || []) {
    if (!fs.existsSync(path.join(SOURCES, `${s}.md`))) errors.push(`${rel(p)}: sources の ${s} に当たる要約ページが無い`);
  }
  const body = stripCode(text);
  // llm-wiki の中へのリンクは [[llm-wiki からのパス(#見出し)(|表示名)]]。表の中では区切りを \| と書く。拡張子 .md は書かない
  for (const m of body.matchAll(/\[\[([^\]|\\#]+)(#[^\]|\\]*)?(?:\\?\|([^\]]*))?\]\]/g)) {
    const t = m[1].trim();
    // 表示名がファイル名と同じなら同じ文字列の二度書きで、読む側に何も足さない(見出しへのリンクは見出しを隠すので別)
    if (!m[2] && m[3] !== undefined && path.basename(t) === m[3].trim()) errors.push(`${rel(p)}: 表示名がファイル名と同じ別名は書かない: [[${t}|${m[3]}]] → [[${t}]]`);
    // 拡張子 .md は書かない。名前に「.」を含むページ(v1.2改定案 など)もあるので、そのままの名前で無ければ .md を補う
    const abs = [path.join(LLM_WIKI, t), path.join(LLM_WIKI, `${t}.md`)].find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) ?? path.join(LLM_WIKI, `${t}.md`);
    if (!fs.existsSync(abs)) {
      errors.push(`${rel(p)}: 切れたリンク [[${t}]]`);
      continue;
    }
    if (inbound.has(abs) && abs !== p) inbound.get(abs).add(p);
  }
  // Markdown のリンクは llm-wiki の外(docs/ など)と URL だけに使う
  // 「[[A]]([[B]]…)」のように [[...]] の直後に括弧が続く書き方を Markdown のリンクと見なさない
  for (const m of body.matchAll(/(?<!\])\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^[a-z]+:/i.test(target) || target.startsWith('#') || !/[./]/.test(target)) continue; // 「(r88〜r93)」のような括弧書きは飛ばす
    const file = decodeURI(target.split('#')[0]);
    const abs = path.resolve(path.dirname(p), file);
    if (!fs.existsSync(abs)) {
      errors.push(`${rel(p)}: 切れたリンク ${target}`);
      continue;
    }
    if (abs.startsWith(LLM_WIKI + path.sep)) errors.push(`${rel(p)}: llm-wiki の中へのリンクは [[...]] で書く: ${target}`);
    if (inbound.has(abs) && abs !== p) inbound.get(abs).add(p);
  }
}

for (const p of pages) {
  if (p === index) continue;
  if (!inbound.get(p).has(index)) errors.push(`${rel(p)}: index.md に載っていない`);
  const others = [...inbound.get(p)].filter((q) => q !== index);
  if (others.length === 0) warns.push(`${rel(p)}: index.md 以外のどこからもリンクされていない(孤立)`);
}

if (!fs.existsSync(index)) errors.push('llm-wiki/wiki/index.md が無い');

const manifest = readManifest();
for (const r of manifest) {
  if (isExcluded(r.path)) errors.push(`llm-wiki/raw/manifest.tsv: 台帳に載せない原本が載っている(node scripts/wiki/raw-manifest.mjs で落とす): ${r.path}`);
  if (!r.source || r.source === '—') {
    warns.push(`llm-wiki/raw/manifest.tsv: 未取り込み: ${r.path}`);
    continue;
  }
  for (const s of r.source.split(',')) {
    if (!fs.existsSync(path.join(WIKI, `${s}.md`))) errors.push(`llm-wiki/raw/manifest.tsv: ${r.path} の source ${s} に当たるページが無い`);
  }
}
if (config.manifest) {
  if (DRIVE_DIR && fs.existsSync(DRIVE_DIR)) {
    const { added, changed, removed } = diff(manifest, scanDrive());
    for (const r of added) warns.push(`元の置き場に台帳に無い原本がある: ${r.path}`);
    for (const r of changed) warns.push(`元の置き場の原本が台帳から変わった: ${r.path}`);
    for (const r of removed) warns.push(`台帳の原本が元の置き場から消えた: ${r.path}`);
  } else warns.push(`原本の置き場が見えないので、元の置き場と台帳の突き合わせを飛ばした(${DRIVE_DIR || '未設定'})`);
} else if (manifest.length) {
  warns.push('llm-wiki/raw/manifest.tsv があるが、llm-wiki/wiki.config.json に manifest の設定が無い(元の置き場との突き合わせを飛ばした)');
}

for (const e of errors) console.log(`エラー\t${e}`);
for (const w of warns) console.log(`注意\t${w}`);
console.log(`ページ ${pages.length} / エラー ${errors.length} / 注意 ${warns.length}`);
process.exit(errors.length ? 1 : 0);
