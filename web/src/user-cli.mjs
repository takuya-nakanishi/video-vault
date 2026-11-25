// 利用者を足す・パスワードを決め直す・消す道具。
//
//   npm run user -- add <メールアドレス>            足して、パスワードを作って 1 度だけ表示する
//   npm run user -- add <メールアドレス> --no-password   Google だけで入る人(パスワードを持たない)
//   npm run user -- set-password <メールアドレス>   パスワードを作り直して 1 度だけ表示する(その人のログインは全部切れる)
//   npm run user -- list                           いる人を並べる(パスワードは出さない)
//   npm run user -- remove <メールアドレス>         消す(その人のログインは全部切れる)
//
// 自分で決めたパスワードを使うときは、標準入力から渡す: echo '…' | npm run user -- set-password <メールアドレス> --stdin
import crypto from 'node:crypto';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { UserStore, normalizeEmail } from './auth/users.mjs';
import { SessionStore } from './auth/sessions.mjs';
import { hashPassword } from './auth/password.mjs';

const [command, rawEmail, ...flags] = process.argv.slice(2);
// 保存先などの探索(Windows のダウンロードフォルダ)を走らせないために、保存先だけ仮に決める
const config = loadConfig({ ...process.env, VIDEO_VAULT_OUT: process.env.VIDEO_VAULT_OUT ?? '.' });
const users = new UserStore(config.usersFile);
const sessions = new SessionStore(path.join(config.dataDir, 'sessions.json'));
const fail = (text) => {
  console.error(text);
  process.exit(1);
};

async function newPassword() {
  if (!flags.includes('--stdin')) return { password: crypto.randomBytes(18).toString('base64url'), generated: true };
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return { password: text.replace(/\r?\n$/, ''), generated: false };
}

if (command === 'list') {
  const all = users.list();
  if (!all.length) console.log(`利用者はいない(${users.file})`);
  for (const u of all) console.log(`${u.email}\tパスワード: ${u.passwordHash ? 'あり' : 'なし'}\tGoogle: ${u.googleSub ? '結んである' : 'まだ'}`);
} else if (command === 'add' || command === 'set-password') {
  const email = normalizeEmail(rawEmail) ?? fail('メールアドレスの形が違う');
  const exists = users.find(email);
  if (command === 'add' && exists) fail(`すでにいる: ${email}(パスワードを決め直すなら set-password)`);
  if (command === 'set-password' && !exists) fail(`いない: ${email}(足すなら add)`);
  if (flags.includes('--no-password')) {
    users.upsert(email, { passwordHash: null });
    console.log(`足した: ${email}(パスワードなし。Google でだけ入れる)`);
  } else {
    const { password, generated } = await newPassword();
    let passwordHash;
    try {
      passwordHash = await hashPassword(password);
    } catch (e) {
      fail(e.message);
    }
    users.upsert(email, { passwordHash });
    // パスワードを変えたら、前のログインは全部切る
    sessions.deleteFor(email);
    console.log(`${command === 'add' ? '足した' : 'パスワードを決め直した'}: ${email}`);
    if (generated) console.log(`パスワード(この 1 度だけ表示する): ${password}`);
  }
} else if (command === 'remove') {
  const email = normalizeEmail(rawEmail) ?? fail('メールアドレスの形が違う');
  if (!users.remove(email)) fail(`いない: ${email}`);
  sessions.deleteFor(email);
  console.log(`消した: ${email}`);
} else {
  fail('使い方: npm run user -- <add|set-password|list|remove> [メールアドレス] [--no-password|--stdin]');
}
