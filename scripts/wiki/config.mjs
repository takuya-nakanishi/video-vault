// Wiki の道具(scripts/wiki/)が共通で使うもの: リポジトリの根・設定 llm-wiki/wiki.config.json の読み込み・agent-base の正本との突き合わせ。
//
// agent-base の templates/wiki/ から配ったもの。このリポジトリで直さない。直すなら agent-base の正本を直し、
// llm-wiki skill の「始める・道具を更新する」で配り直す。リポジトリごとの値は llm-wiki/wiki.config.json に書く。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');
export const LLM_WIKI = path.join(REPO, 'llm-wiki');
export const WIKI = path.join(LLM_WIKI, 'wiki');
export const CONFIG_FILE = path.join(LLM_WIKI, 'wiki.config.json');
export const MANIFEST = path.join(LLM_WIKI, 'raw/manifest.tsv');
export const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');

// 配る道具の名前。agent-base の templates/wiki/scripts/wiki/ にあるものと同じ
export const TOOLS = ['config.mjs', 'lint.mjs', 'open-questions.mjs', 'raw-manifest.mjs'];

// 既定の type の値(llm-wiki skill)。リポジトリで足すものは設定の extraTypes
const TYPES = ['overview', 'concept', 'entity', 'inquiry', 'source', 'source-index', 'glossary', 'index'];
// sources/ の中で、要約ページの通し番号(NN-)を付けない目録のページ
const SOURCE_INDEXES = ['README.md', '原本の一覧.md'];

// 設定の形(どのキーも省略できる。ここに無いキーは読まない):
// {
//   "extraTypes": ["person"],                    既定に足す type の値
//   "sourceIndexes": ["README.md", "原本の一覧.md"],  sources/ の目録のページ(既定を置き換える)
//   "manifest": {                                台帳(llm-wiki/raw/manifest.tsv)で原本を指すときだけ書く
//     "dir": "/mnt/g/マイドライブ/...",            元の置き場の既定(WSL から見たパス)
//     "dirEnv": "XXX_DRIVE_DIR",                 元の置き場を変える環境変数の名前(場所が違うマシン用)
//     "exclude": ["(^|/)機密(/|$)"]               台帳に載せない原本。元の置き場からの相対パスに当てる正規表現
//   }
// }
function load() {
  let raw = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
      throw new Error(`${rel(CONFIG_FILE)} を読めない: ${e.message}`);
    }
  }
  const m = raw.manifest;
  return {
    exists: fs.existsSync(CONFIG_FILE),
    types: [...TYPES, ...(raw.extraTypes ?? [])],
    sourceIndexes: raw.sourceIndexes ?? SOURCE_INDEXES,
    manifest: m
      ? {
          dir: (m.dirEnv && process.env[m.dirEnv]) || m.dir || '',
          dirEnv: m.dirEnv || '',
          exclude: (m.exclude ?? []).map((s) => new RegExp(s)),
        }
      : null,
  };
}
export const config = load();

// agent-base の正本の道具の置き場。リポジトリの隣(worktree の中では本体の clone の隣)の agent-base を見る。無ければ null
export function upstreamToolsDir() {
  let main = REPO;
  try {
    const common = execFileSync('git', ['-C', REPO, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    main = path.dirname(common);
  } catch {
    // git が無い・リポジトリでないときは、この道具の置き場から決めた根の隣を見る
  }
  const dir = path.join(path.dirname(main), 'agent-base', 'templates/wiki/scripts/wiki');
  return fs.existsSync(dir) ? dir : null;
}

// 正本と中身が違う道具の名前の一覧。正本が見えなければ null
export function staleTools() {
  const up = upstreamToolsDir();
  if (!up) return null;
  return TOOLS.filter((t) => {
    const mine = path.join(HERE, t);
    const theirs = path.join(up, t);
    if (!fs.existsSync(theirs)) return false;
    return !fs.existsSync(mine) || fs.readFileSync(mine, 'utf8') !== fs.readFileSync(theirs, 'utf8');
  });
}
