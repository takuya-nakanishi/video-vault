# PC 版(`web/`)の入れ方・使い方・確かめ方

ゲットVIDEO の PC 版。**手元の PC で動かし、アプリが開くブラウザでログインして、yt-dlp で取得する**。
Android アプリと同じ流れ(内蔵ブラウザでログイン → Cookie を渡す → yt-dlp)を、PC の部品で組んだもの。
規約は `../AGENTS.md`「Web(PC 版)と Playwright」、いまの状況は `handoff.md`。

```mermaid
flowchart LR
  UI["画面<br/>(http://127.0.0.1:8787/)"]
  SV["サーバ<br/>(この PC の中だけ)"]
  BR["アプリが開くブラウザ<br/>(ログイン・バッジ)"]
  Q["順番待ち<br/>(1 件ずつ走らせる)"]
  Y["yt-dlp + ffmpeg"]
  F["保存先<br/>(ダウンロード/videos)"]
  UI -->|"URL・画質・パスワード"| SV
  SV -->|"開く"| BR
  BR -->|"バッジを押す"| Q
  SV --> Q
  BR -->|"Cookie(一時ファイル)"| Y
  Q --> Y --> F
```

- 画面から URL を渡すか、ブラウザの動画の枠のバッジを押すと、順番待ちに入る(`web/src/server.mjs`・`web/src/loginBrowser.mjs`)
- 走らせるのは 1 件ずつ。2 件目からは順番待ちに積む(`web/src/downloadCenter.mjs`。Android は 2 件目を断る)
- Cookie は、ブラウザから読んで一時ファイルにし、yt-dlp に `--cookies` で渡して、終わったら消す(`web/src/cookieFile.mjs`)
- 図の対象外: 外からの道(下の「外から使う」)。fire の取り込みへのつなぎ方、ゲットVIDEO(Android)から URL と Cookie を送る口、外からログインの操作をする作りは、まだ無い

## 入れ方(Windows)

1. Node.js(22 以上)・yt-dlp・ffmpeg を入れる。winget なら次の 3 つ(2026-11-23 に ID があることを確かめた):

   ```powershell
   winget install --id OpenJS.NodeJS.LTS --exact
   winget install --id yt-dlp.yt-dlp --exact
   winget install --id Gyan.FFmpeg --exact
   ```

2. このリポジトリを clone し、`web` で依存を入れる:

   ```powershell
   cd C:\workspace\video-vault\web
   npm install
   ```

3. 起動する。出てきた URL をブラウザで開く:

   ```powershell
   npm start
   ```

Windows では、ログイン用のブラウザに**入っている Edge を使う**(Playwright のブラウザを別に入れなくてよい)。
Chrome にしたいときは `VIDEO_VAULT_BROWSER_CHANNEL=chrome`。

WSL・Linux でも同じ手順で動く。ログイン用のブラウザは Playwright の Chromium になるので、`npx playwright install chromium` で入れる
(窓を出すには WSLg などの画面が要る)。

## Surface で常駐させる(WSL)

```bash
web/deploy/install-service.sh            # 入れて起動する(入っていれば入れ直す)
web/deploy/install-service.sh --remove   # 止めて外す(外へつなぐ口も一緒に止まる)
systemctl --user status video-vault-web  # 状態
journalctl --user -u video-vault-web -n 50   # ログ
```

- systemd の利用者ごとのサービス `video-vault-web` として動く。待ち受けるのは `127.0.0.1:8787` のまま。Surface の Windows のブラウザからも同じ URL で開ける
- コードを変えたら `systemctl --user restart video-vault-web` で入れ直す
- 2026-11-23 に SC02-SURFACE へ入れた。サービスのまま YouTube の公開の動画を 1 本渡し、結合された 1 本が Windows のダウンロードフォルダの `videos` にできることを確かめた
- **確かめていないこと**: Claude Code などのセッションを全部閉じたあとも WSL が動き続けるか(WSL は使われていないと止まることがある)。
  ログイン用のブラウザの窓が、サービスから Surface の画面(WSLg)に出るか

## 外から使う(`https://ytdlp.sanei-clover.com`)

2026-11-24 に公開した(本人の決定)。Surface で動くアプリへ、Cloudflare Tunnel で届ける。

```mermaid
flowchart LR
  U["スマホ・ほかの PC"]
  CF["Cloudflare<br/>(入口。認証なし)"]
  T["cloudflared<br/>(video-vault-tunnel)"]
  A["ログイン<br/>+ Host・合言葉・Origin"]
  APP["アプリ<br/>(127.0.0.1:8787。video-vault-web)"]
  U -->|"https"| CF -->|"トンネル video-vault"| T --> A --> APP
```

- 外のブラウザは Cloudflare へ https でつなぐ。DNS は `ytdlp` の CNAME(プロキシ ON)で、トンネル `video-vault` を指す(`web/deploy/cloudflare-tunnel.py`)
- Surface の中の `cloudflared`(サービス `video-vault-tunnel`)が、Cloudflare からの要求を `http://127.0.0.1:8787` へ渡す(`web/deploy/install-service.sh --tunnel`)
- アプリはログインを通るまで何も返さない(開いているのはログインの画面だけ)。通ったあとも Host・合言葉・Origin を確かめる(`web/src/server.mjs`・`web/src/auth/`)
- 図の対象外: ログイン用のブラウザと保存先(上の図)。どちらも Surface の中にあり、外からは届かない

### ログイン

アプリ自身がログインを持つ(2026-11-25。それまでの Basic 認証を置き換えた)。

| 入り方 | 中身 |
|---|---|
| メールアドレスとパスワード | パスワードは 12 文字以上。ハッシュ(scrypt)だけを持つ |
| Google でログイン | OpenID Connect(認可コード + PKCE)。クライアントの ID とシークレットを設定したときだけ、ボタンが出る |

- **入れるのは、利用者の表(`~/.config/video-vault/users.json`)にいる人だけ**。Google で確かめられても、表にいなければ入れない
- Google の利用者との結び付けは、Google の変わらない ID(`sub`)。初めてのときだけ、Google が確かめたアドレスで表を探して結ぶ。
  次からは、Google の側でアドレスが変わっても同じ人として入れる。結んである人に、別の Google アカウントを結び直さない
- セッションは 30 日。Cookie は、外からは `__Host-vv_session`(Secure・HttpOnly・SameSite=Lax)、この PC の中(http)からは `vv_session`
- **まちがいが続いたとき**: 同じ相手(IP)が 5 回まちがえると、15 分のあいだ受け付けない。同じアカウントへのまちがいが 5 回続くと、
  相手を変えても、次を受けるまで待たせる(1 分から倍にして 1 時間まで)。締め出されたら、待つか `systemctl --user restart video-vault-web`
- 公開用の名前に http で来た要求は、ログインを求める前に https へ回す
- 応答に `no-transform` を付け、途中(Cloudflare)にページを書き換えさせない

#### 利用者を足す・パスワードを決め直す

```bash
cd web
npm run user -- list                               # いる人(パスワードは出さない)
npm run user -- add <メールアドレス>                # 足して、パスワードを作って 1 度だけ表示する
npm run user -- add <メールアドレス> --no-password  # Google だけで入る人
npm run user -- set-password <メールアドレス>       # パスワードを作り直す(その人のログインは全部切れる)
npm run user -- remove <メールアドレス>             # 消す(その人のログインは全部切れる)
```

道具で変えた中身は、入れ直さなくてもすぐ効く。

#### 「Google でログイン」を有効にする

1. Google Cloud のコンソールで、OAuth クライアント(種類はウェブ アプリケーション)を作る。同意画面の対象は「内部」(Workspace のアカウントだけ)。
   承認済みのリダイレクト URI は `https://ytdlp.sanei-clover.com/auth/google/callback`
2. `~/.config/video-vault/web.env` に足す:
   `VIDEO_VAULT_GOOGLE_CLIENT_ID=…` と `VIDEO_VAULT_GOOGLE_CLIENT_SECRET=…`
3. Google で入る人を表に足す(Workspace のアドレス): `npm run user -- add <アドレス> --no-password`
4. `systemctl --user restart video-vault-web`。ログインの画面に「Google でログイン」が出る

- **Google Cloud のプロジェクトを Works と分ける必要は無い**。1 つのプロジェクトに OAuth クライアントをいくつも作れ、ID・シークレット・リダイレクト URI はクライアントごとに別。
  プロジェクトごとに 1 つなのは、同意画面(アプリの名前・対象が「内部」か「外部」か)。分けるのは、同意画面の名前を変えたいときと、Works のプロジェクト(ドライブの権限を持つ)と切り離したいとき
- クライアントは Works と分ける(ytdlp のシークレットが漏れても、Works に及ばない)
- 「内部」だけでは足りない。「内部」は Workspace の全員を通すので、入れる人は利用者の表で限る
- **2026-11-25 の時点で、まだ有効にしていない**(クライアントをまだ作っていない)。偽の Google を相手にした試験は通っている。本物の Google では確かめていない

### 手元の PC の Chrome・Edge から送る(拡張機能)

2026-11-25 に入れた(本人の決定。スマホも画面も通さずに、手元の PC から送る)。

```mermaid
flowchart LR
  C["手元の Chrome・Edge<br/>(ふだんどおりログイン)"]
  E["拡張機能 web/extension<br/>(ボタン・右クリック)"]
  A["/api/v1/downloads<br/>(端末の鍵で確かめる)"]
  Y["Surface の yt-dlp"]
  F["Surface の保存先"]
  C -->|"そのページの Cookie"| E -->|"https: URL + Cookie + 端末の鍵"| A --> Y --> F
```

- 手元のブラウザで、ふだんどおりサイトにログインしておく。拡張機能は、押したときに、送る URL に付く Cookie だけを読んで一緒に送る(`web/extension/background.js`)
- Surface は端末の鍵で送り手を確かめる。画面のログイン・合言葉・Origin ではなく、鍵で確かめる口(`web/src/server.mjs` の `deviceApi`)
- 受けた Cookie は、その 1 件の取得にだけ使う。Cookie を送らなかったとき(ほかの道具から送るとき)は、Surface のログイン用のブラウザの Cookie を使う
- 図の対象外: Claude のセッション・Remote Control・スマホ。どれも、この流れに入らない

#### 入れ方(手元の PC ごとに 1 回)

1. Surface で端末の鍵を作る: `cd web && npm run user -- add-device <名前>`(鍵は 1 度だけ表示される。同じ名前で作り直すと、前の鍵は効かなくなる)
2. 拡張機能のフォルダを手元の PC に置く。リポジトリを clone してある PC なら `web\extension`。そうでなければ、そのフォルダを写す
3. Chrome なら `chrome://extensions`、Edge なら `edge://extensions` を開き、「デベロッパー モード」を入れて、「パッケージ化されていない拡張機能を読み込む」で 2 のフォルダを選ぶ
4. 開いた設定の画面に、1 の鍵を貼って「保存してつながるか試す」。「つながった」と出れば済み
5. フォルダを動かしたり消したりすると、拡張機能が動かなくなる。拡張機能を直したら、フォルダを置き換えて、拡張機能の画面の「再読み込み」を押す

#### 使い方

- **ツールバーのボタン**: いま見ているページを送る
- **右クリック**: 「このページをゲットVIDEO に送る」「このリンク先をゲットVIDEO に送る」
- 送れたら、ボタンに ✓ が出て、通知が出る。断られたら ! と理由が出る
- 画質は、拡張機能の設定の画面で決める(既定はオリジナル)

#### 端末の鍵の扱い

```bash
cd web
npm run user -- list-devices                 # いる端末
npm run user -- add-device <名前>             # 作る・作り直す
npm run user -- remove-device <名前>          # 消す(その鍵は、もう効かない)
```

- 鍵のまちがいが同じ相手から 10 回続くと、15 分のあいだ受け付けない
- 端末から来る要求の本文の上限は 512KB(Cookie が入るので、画面からの要求より大きい)

#### 確かめたこと(2026-11-25)

| 確かめ | 結果 |
|---|---|
| 単体の試験(受け口・端末の鍵・送られる Cookie の形) | 合格 |
| 拡張機能を実物の Chromium に読み込ませた通しの試験(偽のログイン付きサイト) | 7 件が合格。ログインした Cookie が渡り、取れたファイルは配った中身と 1 バイトも違わない。ほかのサイトの Cookie は送らない |
| 拡張機能とサーバを 6 か所わざと壊す | どれも試験が落ちた |
| 拡張機能から本番(`ytdlp.sanei-clover.com`)へ YouTube の公開の動画を送る | 結合された 1 本が Surface にできた(確かめたあと、ファイルと履歴は消した) |

- **確かめていないこと**: 本人の手元の Chrome に読み込ませること(人の操作が要る)。ログインが要る実物のサイト(NewsPicks など)を、手元の Chrome の Cookie で取ること
- 試験は Playwright の完全版の Chromium を使う。既定の headless が使う軽い版は拡張機能を読まない。Chrome・Edge の正式版は、起動の引数で拡張機能を読ませる口を閉じている

### 作り方(やり直すとき)

```bash
(cd web && npm run user -- add <メールアドレス>)           # 1. 利用者を足す
# 2. 公開用の名前を ~/.config/video-vault/web.env に書く:  VIDEO_VAULT_PUBLIC_HOST=ytdlp.sanei-clover.com
web/deploy/install-service.sh                             # 3. アプリを入れ直す(ログインなしは、ログインの画面へ送られる)
web/deploy/cloudflare-tunnel.py ytdlp.sanei-clover.com    # 4. トンネル・経路・CNAME を作り、トークンを書く
web/deploy/install-service.sh --tunnel                    # 5. cloudflared を起動する
```

- 公開用の名前があるのに利用者がいなければ、アプリは起動しない。4 は、利用者がいないと止まる。5 は、アプリがログインを求めていないと止まる
- Cloudflare の API のトークンは、agent-base の `.env` から名前で読む(`SC_CLOUDFLARE_SANEI_CLOVER_COM_API_TOKEN` など)
- `cloudflared` は `~/.local/bin/cloudflared`(2026.9.1。Works と同じ版)。GitHub の配布物を置いた

### やめるとき

```bash
web/deploy/install-service.sh --remove-tunnel                     # 外から届かなくなる(すぐ効く)
web/deploy/cloudflare-tunnel.py ytdlp.sanei-clover.com --remove   # DNS のレコードとトンネルを消す
```

### 外から確かめたこと(2026-11-25。ログインに替えたあと)

| 確かめ | 結果 |
|---|---|
| ログインなしで画面を開く | 302 でログインの画面へ |
| ログインなしで API・画面の JS | 401 |
| http で来た要求 | 308 で https へ |
| 前の Basic 認証 | 効かない(ログインの画面へ送られる) |
| スマホの大きさの実物のブラウザで、誤ったパスワード | 断られ、Cookie は付かない |
| 同じく、正しいパスワード | 画面が出て、候補が動く。Cookie は `__Host-vv_session`(Secure・HttpOnly・Lax) |
| ログアウト | Cookie が消え、ログインの画面へ戻る。画面のエラー無し |
| 待ち受けているアドレス | `127.0.0.1:8787` だけ |

2026-11-24(Basic 認証のころ)に外から確かめた、合言葉なしの命令(401)・別のサイトからの命令(403)・YouTube の公開の動画の取得は、
ログインに替えたあとは単体と通しの試験で確かめている(外からは流し直していない)。

### 外から使うときに足りないもの

- **ログインの操作ができない**。ログイン用のブラウザの窓は Surface の画面に出る。会員向けのサイトは、Surface の前(か RDP)でログインする
- **取ったファイルを取り出せない**。Surface のダウンロードフォルダの `videos` に残る
- アプリを入れ直す(`restart`)と、トンネルも一緒に入れ直され、外からは数秒のあいだ届かない(530 が返る)

## 使い方

- **URL を貼る**: 画面の入力欄に貼ると、候補が出る。動画サイトの URL は「ダウンロード」、そのほかの URL は「ブラウザで開く」と「ダウンロードを試す」
- **ログインが要るサイト**: 「ブラウザで開く」か、よく行くページのボタンで、アプリのブラウザを開く。そこでログインする。
  ログインの状態は残るので、次からはログインし直さなくてよい
- **バッジ**: アプリのブラウザでは、ページの動画の枠の右下にバッジが出る。押すと、その動画が順番待ちに入る(画質は既定のオリジナル)
- **ログインしたあとは、画面に URL を貼るだけでも取れる**。ブラウザを閉じていても、取っておいた Cookie を yt-dlp に渡す
- **Vidyard のパスワード**: Vidyard の URL を貼ったときだけ、パスワードの欄が出る。パスワードはメモリにだけ置き、履歴にもファイルにも書かない
- 止めるときは、起動した端末で Ctrl+C

## 設定(環境変数)

| 名前 | 既定 | 中身 |
|---|---|---|
| `VIDEO_VAULT_PORT` | `8787` | 画面のポート |
| `VIDEO_VAULT_OUT` | ダウンロードフォルダの `videos`(WSL では Windows のダウンロードフォルダ) | 保存先 |
| `VIDEO_VAULT_YTDLP` | 自動で探す | yt-dlp の場所。探す順は PATH → `~/.local/bin/yt-dlp` → `python -m yt_dlp` |
| `VIDEO_VAULT_FFMPEG` | 自動で探す | ffmpeg の場所。探す順は PATH → `~/.local/bin/ffmpeg` |
| `VIDEO_VAULT_BROWSER_CHANNEL` | Windows は `msedge`、ほかは空(Playwright の Chromium) | ログイン用のブラウザ |
| `VIDEO_VAULT_HEADLESS` | 無し | `1` で窓を出さない(試験用。ログインの操作ができなくなる) |
| `VIDEO_VAULT_AUTH_DIR` | `web/.auth` | ログインの状態(ブラウザのプロファイルと Cookie の写し) |
| `VIDEO_VAULT_DATA_DIR` | `web/.data` | 履歴とログインのセッション(Cookie の値そのものは持たない) |
| `VIDEO_VAULT_PUBLIC_HOST` | 無し | 外から届く名前(ホスト名だけ)。指定すると、必ずログインを求める |
| `VIDEO_VAULT_GOOGLE_CLIENT_ID`・`VIDEO_VAULT_GOOGLE_CLIENT_SECRET` | 無し | 「Google でログイン」。両方を指定する |
| `VIDEO_VAULT_USERS_FILE` | `~/.config/video-vault/users.json` | 利用者の表 |
| `VIDEO_VAULT_DEVICES_FILE` | `~/.config/video-vault/devices.json` | 端末の鍵の表(sha256 だけ) |

**待ち受けるアドレスは `127.0.0.1` に固定で、環境変数でも変えられない**。外からの道は Cloudflare Tunnel だけにする(下の「外から使う」)。

## Android との違い

| | Android | PC 版 |
|---|---|---|
| 同時に流す件数 | 1 件。2 件目は断る | 1 件ずつ走らせ、あとは順番待ち(20 件まで) |
| ログイン | 内蔵ブラウザ(WebView) | アプリが開くブラウザ(Edge・Chromium)。パスキーも使える |
| バッジを押したあと | 画質の選択を挟む | その場で順番待ちに入る(画質は既定) |
| Cookie | そのページの Cookie だけを渡す | アプリのブラウザが持つ Cookie をまとめて渡す(yt-dlp が、宛先のドメインに合うものだけを送る) |
| 判定表に無い URL | ブラウザで開くだけ | 「ダウンロードを試す」もできる |
| yt-dlp | アプリに同梱し、nightly へ更新する | PC に入っているものを呼ぶ。**更新は自分でする** |
| プレイリスト | yt-dlp の既定のまま | `--no-playlist`(リンク 1 つで 1 本) |
| `--force-ipv4` | 付ける(同梱 python の名前解決の回避) | 付けない |
| 判定表・バッジの JS | `android/app/src/main/assets/` | **同じファイルを読む**(写しを持たない) |

## 認証情報の置き場

| もの | 置き場 | git |
|---|---|---|
| ブラウザのプロファイル | `web/.auth/profile/` | 入らない(`.auth/`) |
| Cookie の写し | `web/.auth/cookies.storageState.json`(持ち主だけが読める) | 入らない |
| yt-dlp に渡す Cookie のファイル | 一時ディレクトリ(`vv-cookies-*`)。終わったら消す | 入らない |
| 履歴 | `web/.data/history.json`。URL・題名・結果だけ。Cookie もパスワードも持たない | 入らない(`.data/`) |
| Vidyard のパスワード・トークン | メモリだけ | — |

Cookie の写しを取るのは、期限の無い Cookie(セッション Cookie)がブラウザのプロファイルに残らないため。
写しが無いと、窓を閉じたあとの取得と、開き直したときのログインが効かない。

## 確かめ方

```bash
cd web
npm test                                 # 単体(外へ通信しない・ブラウザも yt-dlp も起動しない。ログインは偽の Google を相手にする)
npm run e2e                              # 通し(実物の yt-dlp とブラウザ。相手はこの PC の中に立てる偽のサイト)
VIDEO_VAULT_E2E_NETWORK=1 npm run e2e    # 上に加えて、実際の YouTube と公開の Vidyard から取る
# 通しの試験には、拡張機能を実物の Chromium に読み込ませるものも入る(完全版の Chromium が要る。無ければ npx playwright install chromium)
```

- 通しの試験は、偽のログイン付きサイトを 127.0.0.1 に立てて、ログイン → バッジ → 取得 → 中断までを流す。
  **保存されたファイルが、配った中身と 1 バイトも違わないこと**まで見る
- パスワード付きの Vidyard の 3 件は、`VIDYARD_SECURE_URL`・`VIDYARD_SECURE_PASSWORD` を渡したときだけ走る(値はリポジトリに書かない)
- 判定表(`site_patterns.json`)とバッジの JS(`video_badge.js`)は Android と共有している。**どちらかを変えたら、`web` の試験も走らせる**

### 機械では確かめられないもの(人が確かめる)

| もの | なぜ人か |
|---|---|
| 窓を出したブラウザでの実際のログイン | 試験は窓を出さずに走る。本人のアカウントとパスワードが要る |
| Google でログインするサイト(NewsPicks など) | Google は、アプリが動かすブラウザからのログインを断ることがある。通るかは実物でしか分からない |
| NewsPicks・LinkedIn・X・TikTok の会員向けの動画 | 本人のログインが要る。yt-dlp がそのページを扱えるかも、実物でしか分からない |

## つまずきどころ(実際に踏んだ)

- **yt-dlp と ffmpeg が PATH に無い**。サービスや非対話のシェルでは `~/.local/bin` が PATH に入らない。
  ffmpeg が見つからないと、yt-dlp は**映像と音声を結合しないまま終了コード 0 で終わる**(音の無い映像と音声が別々に残る)。
  アプリは両方を自分で探し、それでも結合できなかったときは失敗にする
- **Windows の `yt-dlp.exe` は出力を cp932 で出す**。日本語の題名が化けて履歴に残る。`--encoding utf-8` を渡して防いでいる
  (環境変数 `PYTHONUTF8` は、配布版の exe には効かなかった)
- **yt-dlp は、ページの中の動画に「ページの題名 (1)」と番号を付ける**(判定表に無いサイトで、ページの URL を渡したとき)。保存されるファイル名もそうなる
- **IP アドレスと `localhost` の URL は受け付けない**。入力の判定の規則(Android と同じ)だが、ページの JS がバッジの口から
  この PC や家の中の機器を取りに行かせることも断れる。通しの試験だけが、自分自身(127.0.0.1)を明示して許す
