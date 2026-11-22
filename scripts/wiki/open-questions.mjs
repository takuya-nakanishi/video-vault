#!/usr/bin/env node
// 未解決の問いの正本は llm-wiki/backlog/ の問い(書式は questions-jobs skill)。索引 QUESTIONS.md の項目ごとに、項目のファイル
// llm-wiki/backlog/questions/QNNNN.md の frontmatter「ページ: llm-wiki/wiki/....md」に書いた Wiki のページの末尾へ、「## 未解決の問い」の節を作る(手で書かない)。
// 項目のファイルが無いとき(1項目1ファイルへ分ける前の形。2026-10-16 まで)は、QUESTIONS.md の子行「ページ:」を読む。
//
//   node scripts/wiki/open-questions.mjs            ページごとに問いを出す(語を渡すと、その語を含む問いだけ)
//   node scripts/wiki/open-questions.mjs --write    各ページの「## 未解決の問い」を QUESTIONS.md から作り直す
//   node scripts/wiki/open-questions.mjs --check    作り直すと変わるページがあれば出して終了コード 1(lint が使う)
//
// agent-base の templates/wiki/ から配ったもの。このリポジトリで直さない(config.mjs の頭を見る)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, WIKI } from './config.mjs';

const QUESTIONS = path.join(REPO, 'llm-wiki/backlog/QUESTIONS.md');
const QDIR = path.join(REPO, 'llm-wiki/backlog/questions');
export const HEADING = '## 未解決の問い';
const NOTE =
  'この節は `node scripts/wiki/open-questions.mjs --write` が `llm-wiki/backlog/` の問いから作る。手で書かない。問いの中身・経緯は各 ID のリンク先(一覧は {link})を見る。';

// 項目のファイルの frontmatter から「ページ」を読む(「a, b」・クォート・「  - 値」のリストのどれでも)
function framePages(file) {
  const m = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
  const unq = (v) => (/^".*"$/.test(v) ? JSON.parse(v) : /^'.*'$/.test(v) ? v.slice(1, -1) : v);
  const i = lines.findIndex((l) => /^ページ:/.test(l));
  if (i === -1) return [];
  const v = lines[i].replace(/^ページ:\s*/, '').trim();
  // リストの形は「ページ:」の直後に続く「  - 値」の行だけ(次のキーに達したら止める。後ろの別のキーのリストを読まない)
  const list = [];
  for (const l of lines.slice(i + 1)) { if (!/^\s+-\s+/.test(l)) break; list.push(unq(l.replace(/^\s+-\s+/, '').trim())); }
  const vals = v ? [unq(v)] : list;
  return vals.flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);
}

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.md') ? [p] : [];
  });
}

// QUESTIONS.md の「## 未解決」「## 保留」の項目を読む。{ id, title, pages: [リポジトリからのパス], hold }
export function readQuestions(file = QUESTIONS) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  let section = '';
  let cur = null;
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    const h = l.match(/^## (.*)/);
    if (h) {
      section = h[1].trim();
      cur = null;
      continue;
    }
    if (section !== '未解決' && section !== '保留') continue;
    const m = l.match(/^- (?:\[ \] )?\*\*(Q\d{4})\*\* (.*?)(?:[(\uFF08]\d{4}-\d{2}-\d{2}[)\uFF09])?$/);
    if (m) {
      cur = { id: m[1], title: m[2].trim(), pages: [], hold: section === '保留' };
      const f = path.join(QDIR, `${m[1]}.md`);
      if (fs.existsSync(f)) { cur.file = f; cur.pages.push(...framePages(f)); }
      out.push(cur);
      continue;
    }
    const p = l.match(/^  - ページ: (.*)$/);
    if (p && cur && !cur.file) cur.pages.push(...p[1].split(',').map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

// ページの本文を「## 未解決の問い」の節の前(head)と後ろ(tail)に分ける。節は次の「## 」の見出しの手前まで。
// 節の後ろに別の節(「## 閉じた問い」など)があっても消さない
function splitSection(text) {
  const i = text.indexOf(`\n${HEADING}\n`);
  if (i === -1) return { head: text, tail: '' };
  const rest = text.slice(i + HEADING.length + 2);
  const m = rest.match(/^## /m);
  return { head: text.slice(0, i).replace(/\n+$/, '\n'), tail: m ? rest.slice(m.index) : '' };
}

// リンクは [[llm-wiki からのパス]](拡張子 .md は書かない。表示名はファイル名と違うときだけ付ける)
const llmWikiPath = (abs) => path.relative(path.join(REPO, 'llm-wiki'), abs).split(path.sep).join('/').replace(/\.md$/, '');
function render(pageAbs, qs) {
  const link = `[[${llmWikiPath(QUESTIONS)}|llm-wiki/backlog/QUESTIONS.md]]`;
  const id = (q) => (q.file ? `[[${llmWikiPath(q.file)}]]` : q.id); // 表示名は ID と同じなので付けない
  const items = qs.map((q) => `- **${id(q)}** ${q.title}${q.hold ? '(保留)' : ''}`);
  return `\n${HEADING}\n\n${NOTE.replace('{link}', link)}\n\n${items.join('\n')}\n`;
}

// ページごとの「あるべき本文」を返す。{ abs: { now, want } }
export function plan() {
  const qs = readQuestions();
  const byPage = new Map();
  const missing = [];
  for (const q of qs) {
    for (const p of q.pages) {
      const abs = path.join(REPO, p);
      if (!fs.existsSync(abs)) {
        missing.push(`${q.id}: ページ ${p} が無い`);
        continue;
      }
      if (!byPage.has(abs)) byPage.set(abs, []);
      byPage.get(abs).push(q);
    }
  }
  const result = new Map();
  for (const abs of walk(WIKI)) {
    const now = fs.readFileSync(abs, 'utf8');
    const { head, tail } = splitSection(now);
    const section = byPage.has(abs) ? render(abs, byPage.get(abs)) : '';
    const want = head + section + (tail ? `\n${tail}` : '');
    result.set(abs, { now, want });
  }
  return { result, missing, count: qs.length };
}

function main() {
  const args = process.argv.slice(2);
  const { result, missing, count } = plan();
  for (const m of missing) console.error(`エラー\t${m}`);
  if (args.includes('--write') || args.includes('--check')) {
    const stale = [...result].filter(([, v]) => v.now !== v.want).map(([abs]) => abs);
    if (args.includes('--check')) {
      for (const abs of stale) console.log(`作り直しが要る\t${path.relative(REPO, abs)}`);
      process.exit(stale.length || missing.length ? 1 : 0);
    }
    for (const abs of stale) fs.writeFileSync(abs, result.get(abs).want);
    console.log(`作り直した: ${stale.length} ページ(未解決の問い ${count} 件)`);
    process.exit(missing.length ? 1 : 0);
  }
  const word = args.find((a) => !a.startsWith('--'));
  const qs = readQuestions().filter((q) => !word || q.title.includes(word));
  const byPage = new Map();
  for (const q of qs) for (const p of q.pages.length ? q.pages : ['(ページの指定なし)']) {
    if (!byPage.has(p)) byPage.set(p, []);
    byPage.get(p).push(q);
  }
  for (const [p, list] of [...byPage].sort()) {
    console.log(`\n## ${p}\n`);
    for (const q of list) console.log(`- ${q.id} ${q.title}${q.hold ? '(保留)' : ''}`);
  }
  console.log(`\n合計 ${qs.length} 件`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
