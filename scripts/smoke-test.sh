#!/usr/bin/env bash
# エミュレータ上で正常系・異常系のシナリオを自動で流す煙試験。
# 実機へ配る前にこれを通す。UIの検証はスクリーンショットではなく
# uiautomatorのビューツリー(テキスト)で行うので、人の目が要らない。
#
# 使い方: scripts/smoke-test.sh [--skip-download | --only-download]
#   --skip-download を付けると実ダウンロード(ネットワーク・時間がかかる)を飛ばす
#   --only-download は実ダウンロードとその後の確認だけ(原因追跡の反復用)
#
# 判定の流儀: ok/ng で数え、最後に失敗0で合格。`set -e` にしないのは、1つ落ちても残りの
# シナリオを流して全体像を出すため。**ただしビルド・インストールの失敗は即終了する**
# (古いAPKで合格を出さない。2026-08-21 Codexレビュー指摘)。
set -uo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"

PKG=com.saneiclover.videovault.debug
ACT="$PKG/com.saneiclover.videovault.MainActivity"
# 保存先は公共の Download/videos(2026-08-21・人間の指定)。app専用領域ではない
DL_DIR="/sdcard/Download/videos"
# 19秒の定番動画(YouTube最古"Me at the zoo")。公開が永続的で短く、煙試験に向く。
# yt-dlp公式テスト動画 BaW_jenozKc は Video unavailable になるため使わない
TEST_VIDEO="https://youtu.be/jNQXAC9IVRw"
TEST_VIDEO_TITLE="Me at the zoo"
SKIP_DOWNLOAD=${1:-}
ONLY_DOWNLOAD=""
[[ "$SKIP_DOWNLOAD" == "--only-download" ]] && ONLY_DOWNLOAD=1

PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
ng()   { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
step() { echo; echo "▶ $1"; }

# エミュレータ限定。実機を壊さないための保険
SERIAL=$(adb devices | awk '$2=="device"{print $1}' | grep '^emulator-' | head -1)
if [[ -z "$SERIAL" ]]; then
  echo "エラー: エミュレータが見つからない。先に起動する:" >&2
  echo '  sg kvm -c "$ANDROID_HOME/emulator/emulator @medium_phone -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect" &' >&2
  exit 1
fi
export ANDROID_SERIAL="$SERIAL"
echo "対象: $SERIAL"

# --- UIツリーの取得と検索 ---
dump() {   # 画面のテキストを全部拾う
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml 2>/dev/null
}
has_text() { dump | grep -qF "$1"; }
# 属性(text / content-desc)が値に一致するノードの中心座標。完全一致を優先し、無ければ部分一致
# (「ダウンロード」を押すつもりで「最近のダウンロード」見出しを押さないため)
node_center() {
  dump | python3 -c "
import sys, re
xml = sys.stdin.read()
attr, target = '$1', '''$2'''
exact = None; partial = None
for m in re.finditer(attr + r'=\"([^\"]*)\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', xml):
    x1,y1,x2,y2 = map(int, m.groups()[1:])
    c = ((x1+x2)//2, (y1+y2)//2)
    if m.group(1) == target and exact is None: exact = c
    elif target in m.group(1) and partial is None: partial = c
best = exact or partial
print(f'{best[0]} {best[1]}' if best else '')
"
}
# 直後の画面更新(ファビコン読み込み・再構成)で uiautomator dump が空や途中切れになることがあるので、
# 見つからなければ少し待って引き直す(2026-08-21 ホームの「追加」で実際に起きた)
tap_node()  { local attr="$1" target="$2" c; for i in 1 2 3 4; do c=$(node_center "$attr" "$target"); [[ -n "$c" ]] && { adb shell input tap $c; return 0; }; sleep 1.5; done; return 1; }
tap_text()  { tap_node text "$1"; }
tap_desc()  { tap_node content-desc "$1"; }
long_press_text() {  # 同じ座標で800msのswipe=長押し
  local c; c=$(node_center text "$1"); [[ -n "$c" ]] && adb shell input swipe $c $c 800
}
relaunch() { adb shell am force-stop $PKG; adb shell am start -n "$ACT" >/dev/null; sleep 3; }
share_url() {
  adb shell am force-stop $PKG
  adb shell am start -a android.intent.action.SEND -t text/plain -e android.intent.extra.TEXT "'$1'" -n "$ACT" >/dev/null
  sleep 3
}
# プロセスを殺して起動し直してから探す(=ファイルに永続化されているかの確認になる)
after_restart_has() { relaunch; has_text "$1"; }
# 結果の帯(MessageBanner)が画面に出ているか。通知にも「完了」「失敗」の同じ文字列が出るので、
# 帯だけが持つ閉じるボタンを併せて見る(通知を見て合格を出さないため。2026-08-25)
# **1回のdumpで両方を見る**。2回引くと、復帰直後の再構成中に片方が空振りして
# 出ている帯を「無い」と判定する(2026-08-25にシナリオ19で実際に踏んだ)。
# 画面が落ち着くまで数回引き直す(出なければ失敗のままなので、緩めることにはならない)
banner_has() {
  local tree
  for _ in 1 2 3 4 5; do
    tree=$(dump)
    if grep -qF "$1" <<<"$tree" && grep -q 'content-desc="閉じる"' <<<"$tree"; then return 0; fi
    sleep 2
  done
  return 1
}
# 通知シェードを開いて中身を見る。アプリを離れている間はここだけが進捗の窓口になる
notification_has() {
  adb shell cmd statusbar expand-notifications >/dev/null 2>&1
  sleep 2
  local found=1
  dump | grep -qF "$1" && found=0
  adb shell cmd statusbar collapse >/dev/null 2>&1
  sleep 1
  return $found
}
# ブラウザ画面が出たか。重いページの読み込み中は uiautomator dump が途中で切れることがあるので
# (2026-08-21 Google検索結果で実際に起きた)、数回引き直す
browser_shown() {
  for i in 1 2 3 4; do
    dump | grep -q 'content-desc="再読込"' && return 0
    sleep 2
  done
  return 1
}

step "準備: ビルドとインストール"
if ! ./gradlew assembleDebug -q; then
  ng "ビルド失敗(古いAPKで試験しないためここで終了)"; exit 1
fi
ok "ビルド成功"
if ! android install --device="$SERIAL" --apks=app/build/outputs/apk/debug/app-debug.apk >/dev/null 2>&1; then
  ng "インストール失敗"; exit 1
fi
ok "インストール成功"
# 履歴・ブックマークを初期状態に戻す(前回の試験結果に左右されないため)
adb shell pm clear $PKG >/dev/null 2>&1
# 保存先(公共の Download/videos)へ書くには「すべてのファイルへのアクセス」が要る。
# pm clear で消えるので毎回付け直す。実機では人が設定画面で許可する導線をアプリが出す
adb shell appops set $PKG MANAGE_EXTERNAL_STORAGE allow >/dev/null 2>&1
# ダウンロードはForegroundServiceが走らせ、進捗と結果は通知に出る。Android 13以降は実行時の
# 許可が要り、未許可だと起動直後にダイアログが被さって以降のタップが全部外れる。
# 実機では人が許可する導線(MainActivity.askNotificationPermission)が出る
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS >/dev/null 2>&1
adb shell rm -rf "$DL_DIR" 2>/dev/null

if [[ -z "$ONLY_DOWNLOAD" ]]; then
step "シナリオ1[正常系]: 起動してホーム画面が出る"
relaunch
has_text "ゲットVIDEO"         && ok "ワードマーク表示" || ng "ワードマークが出ない"
has_text "URLか検索したい言葉" && ok "入力欄表示"       || ng "入力欄が出ない"
has_text "ブックマーク"        && ok "ブックマーク欄あり" || ng "ブックマーク欄が出ない"
has_text "NewsPicks"           && ok "既定ブックマーク NewsPicks" || ng "NewsPicksが出ない"
has_text "TikTok"              && ok "既定ブックマーク TikTok"    || ng "TikTokが出ない"
has_text "最近のダウンロード"  && ok "履歴欄あり"       || ng "履歴欄が出ない"
has_text "まだ何も取っていない" && ok "履歴の空状態"    || ng "履歴の空状態が出ない"

step "シナリオ2[正常系]: ブックマークを1タップで内蔵ブラウザが開く"
if tap_text "NewsPicks"; then
  sleep 6
  browser_shown            && ok "ブラウザ画面が開いた" || ng "ブラウザ画面が出ない"
  has_text "newspicks.com" && ok "飛び先がNewsPicks"    || ng "URLが違う"
  if has_text "このページをダウンロード"; then ng "廃止したフッターボタンが出ている"; else ok "常設のダウンロードボタンは無い"; fi
else
  ng "ブックマークをタップできない"
fi

step "シナリオ3[正常系]: ブックマークを手入力で追加し、再起動後も残る"
relaunch
if tap_text "追加"; then
  sleep 1
  tap_text "名前"; sleep 0.5; adb shell input text "Vimeo"
  tap_text "URL";  sleep 0.5; adb shell input text "vimeo.com"
  tap_text "保存"; sleep 1
  has_text "Vimeo" && ok "一覧に追加された" || ng "一覧に出ない"
  after_restart_has "Vimeo" && ok "再起動後も残る(永続化)" || ng "再起動で消えた"
  has_text "vimeo.com" && ok "URLが https 補完されてホストが出る" || ng "ホストが出ない"
else
  ng "「追加」をタップできない"
fi

step "シナリオ4[正常系]: ブックマークを長押し→編集で名前を変え、再起動後も残る"
if long_press_text "Vimeo"; then
  sleep 1
  has_text "編集" && has_text "削除" && has_text "閉じる" && ok "操作シート(編集/削除/閉じる)が出た" || ng "操作シートが出ない"
  if tap_text "編集"; then
    sleep 1
    has_text "ブックマークを編集" && ok "編集ダイアログが出た" || ng "編集ダイアログが出ない"
    # 名前欄は登録内容入り。末尾に追記して「Vimeo2」にする
    tap_text "名前"; sleep 0.5; adb shell input keyevent KEYCODE_MOVE_END; adb shell input text "2"
    tap_text "保存"; sleep 1
    has_text "Vimeo2" && ok "名前が変わった" || ng "名前が変わらない"
    after_restart_has "Vimeo2" && ok "再起動後も変更が残る(永続化)" || ng "再起動で戻った"
  else
    ng "「編集」をタップできない"
  fi
else
  ng "長押しできない"
fi

step "シナリオ4b[正常系]: ブックマークを長押し→削除し、再起動後も消えたまま"
if long_press_text "Vimeo2"; then
  sleep 1
  tap_text "削除"; sleep 1
  if has_text "Vimeo2"; then ng "削除されていない"; else ok "一覧から消えた"; fi
  if after_restart_has "Vimeo2"; then ng "再起動で復活した"; else ok "再起動後も消えたまま(永続化)"; fi
else
  ng "長押しできない"
fi

step "シナリオ5[正常系]: 動画サイトのURLでダウンロードが第一候補になる"
share_url "$TEST_VIDEO"
has_text "ダウンロード"   && ok "ダウンロード候補あり"   || ng "ダウンロード候補が出ない"
has_text "ブラウザで開く" && ok "ブラウザ候補あり"       || ng "ブラウザ候補が出ない"
if has_text "NewsPicks"; then ng "入力中なのにブックマークが残っている"; else ok "入力中はブックマークを隠す"; fi

step "シナリオ6[異常系]: DRMサイトは対象外として弾く"
share_url "https://www.netflix.com/title/80100172"
has_text "対象外"          && ok "対象外の表示あり" || ng "対象外が表示されない"
has_text "DRM"             && ok "理由の表示あり"   || ng "理由が表示されない"
if dump | grep -qE 'text="ダウンロード"'; then ng "対象外なのにDLボタンが出ている"; else ok "DLボタンは出ない"; fi

step "シナリオ7[正常系]: キーワードは検索になる"
share_url "kessan happyou"
has_text "Googleで検索" && ok "検索候補あり" || ng "検索候補が出ない"

step "シナリオ8[正常系]: 検索から内蔵ブラウザが開き、栞で今のページをブックマークできる"
if tap_text "Googleで検索"; then
  sleep 6
  browser_shown         && ok "ブラウザ画面が開いた" || ng "ブラウザ画面が出ない"
  has_text "google.com" && ok "検索結果を読み込んだ" || ng "URLが表示されない"
  if tap_desc "ブックマークに追加"; then
    sleep 1
    dump | grep -q 'content-desc="ブックマークから外す"' && ok "栞が登録済みに変わった" || ng "栞が変わらない"
    after_restart_has "google.com" && ok "ブラウザから追加したブックマークが再起動後も残る" || ng "ブックマークが残らない"
  else
    ng "栞アイコンをタップできない"
  fi
else
  ng "検索候補をタップできない"
fi

step "シナリオ9[異常系]: 存在しない動画IDはエラーを表示しクラッシュしない(画質シート経由)"
share_url "https://youtu.be/aaaaaaaaaaa"
if tap_text "ダウンロード"; then
  sleep 1
  has_text "画質を選んでダウンロード" && ok "画質シートが出た" || ng "画質シートが出ない"
  has_text "オリジナル" && has_text "HD" && has_text "SD" && ok "3つの画質が並ぶ" || ng "画質の選択肢が揃わない"
  tap_text "オリジナル"
  for i in $(seq 1 24); do sleep 5; has_text "失敗" && break; done
  has_text "失敗" && ok "エラーを表示した" || ng "エラーが表示されない(タイムアウト)"
  adb shell pidof $PKG >/dev/null && ok "プロセス生存(クラッシュなし)" || ng "クラッシュした"
else
  ng "ダウンロードボタンをタップできない"
fi

step "シナリオ10[正常系]: 失敗も履歴に残り(再起動後も)、サイト名と結果が見える"
if after_restart_has "youtu.be/aaaaaaaaaaa"; then
  ok "履歴にURLが残った(永続化)"
  has_text "YouTube" && ok "サイト名が見える" || ng "サイト名が出ない"
  dump | grep -qE 'text="YouTube · [^"]*失敗"' && ok "結果(失敗)が見える" || ng "失敗の表示が無い"
else
  ng "履歴に残っていない"
fi

step "シナリオ11[正常系]: 履歴画面へ遷移でき、URLコピーの反応が返る"
if tap_text "すべて見る"; then
  sleep 2
  has_text "履歴" && has_text "今日" && ok "履歴画面(日付見出しあり)" || ng "履歴画面が出ない"
  has_text "youtu.be/aaaaaaaaaaa" && ok "履歴画面に全件表示" || ng "履歴画面に件が無い"
  if tap_text "youtu.be/aaaaaaaaaaa" && sleep 2 && tap_text "URLをコピー"; then
    sleep 1
    has_text "URLをコピーした" && ok "コピーの反応が履歴画面に出た" || ng "コピーの反応が出ない"
  else
    ng "操作シートからコピーできない"
  fi
else
  ng "「すべて見る」をタップできない"
fi

step "シナリオ12[正常系]: 履歴から再ダウンロード導線(入力欄に戻る)"
if tap_text "youtu.be/aaaaaaaaaaa" && sleep 2 && tap_text "もう一度ダウンロード"; then
  sleep 2
  has_text "ダウンロード" && has_text "ブラウザで開く" && ok "入力欄に戻り候補が並んだ" || ng "候補が並ばない"
else
  ng "履歴の操作シートを開けない"
fi

step "シナリオ13[正常系]: 履歴を1件削除すると再起動後も消えている"
relaunch
if tap_text "youtu.be/aaaaaaaaaaa" && sleep 2 && tap_text "この履歴を削除"; then
  sleep 1
  if has_text "aaaaaaaaaaa"; then ng "削除されていない"; else ok "一覧から消えた"; fi
  if after_restart_has "aaaaaaaaaaa"; then ng "再起動で復活した"; else ok "再起動後も消えたまま(永続化)"; fi
  has_text "まだ何も取っていない" && ok "空状態に戻った" || ng "空状態が出ない"
else
  ng "操作シートから削除できない"
fi

fi  # ONLY_DOWNLOAD

if [[ "$SKIP_DOWNLOAD" == "--skip-download" ]]; then
  echo; echo "シナリオ14〜17[実ダウンロード]は --skip-download のため省略"
else
  step "シナリオ14[正常系・本命]: 実際にYouTubeからダウンロードできる(SDを選ぶ)"
  share_url "$TEST_VIDEO"
  if tap_text "ダウンロード"; then
    sleep 1
    tap_text "SD" && ok "画質SDを選んだ" || ng "SDを選べない"
    echo "  (yt-dlp更新とダウンロードで最大5分待つ)"
    got=""
    for i in $(seq 1 60); do
      sleep 5
      # .ytdl(yt-dlpの内部レジューム情報)や.part(未完了)を成果物と誤認しない
      found=$(adb shell "find $DL_DIR -type f -size +100k \\( -name '*.mp4' -o -name '*.webm' -o -name '*.mkv' -o -name '*.m4a' \\) 2>/dev/null" | tr -d '\r')
      if [[ -n "$found" ]]; then got="$found"; break; fi
      has_text "失敗" && break
    done
    if [[ -n "$got" ]]; then
      ok "動画本体を取得した: $(adb shell ls -la \"$got\" | tr -d '\r')"
      # 完了メッセージが出るまで少し待つ(ファイルが先にできる)
      for i in $(seq 1 12); do has_text "完了" && break; sleep 5; done
      banner_has "完了" && ok "完了を表示した" || ng "完了が表示されない"
    else
      ng "取得できなかった"
      echo "  --- 画面のエラー全文 ---"
      dump | grep -oE 'text="[^"]*(失敗|ERROR|WARNING)[^"]*"' | head -5
    fi
  else
    ng "ダウンロードボタンをタップできない"
  fi

  step "シナリオ15[正常系]: 成功した履歴にタイトルとサイト名が残る(再起動後)"
  if after_restart_has "$TEST_VIDEO_TITLE"; then
    ok "履歴にタイトル「$TEST_VIDEO_TITLE」が残った"
    dump | grep -qE 'text="YouTube · [^"]*"' && ok "サイト名 YouTube が見える" || ng "サイト名が出ない"
    dump | grep -qE 'text="YouTube · SD · [^"]*"' && ok "選んだ画質(SD)が履歴に残る" || ng "画質が履歴に出ない"
  else
    ng "履歴にタイトルが残っていない"
    dump | grep -oE 'text="[^"]*"' | head -20
  fi

  step "シナリオ16[正常系]: 保存済みファイル画面に実ファイルが並び、削除できる"
  if tap_desc "保存済みファイル"; then
    sleep 2
    has_text "保存済みファイル" && has_text "$TEST_VIDEO_TITLE" && ok "ファイル一覧に成果物が出た" || ng "ファイル一覧に出ない"
    if tap_desc "削除" && sleep 1 && tap_text "削除"; then
      sleep 2
      has_text "保存済みのファイルはない" && ok "一覧が空になった" || ng "一覧に残っている"
      left=$(adb shell "find $DL_DIR -type f -name '*.webm' 2>/dev/null" | tr -d '\r')
      [[ -z "$left" ]] && ok "実ファイルも消えた" || ng "実ファイルが残っている: $left"
    else
      ng "削除の確認ダイアログを操作できない"
    fi
  else
    ng "保存済みファイルへ遷移できない"
  fi

  step "シナリオ17[正常系]: 履歴の全消去"
  relaunch
  if tap_text "すべて見る" && sleep 2 && tap_desc "履歴をすべて消去" && sleep 1 && tap_text "消去"; then
    sleep 1
    has_text "履歴はまだない" && ok "履歴画面が空になった" || ng "履歴画面に残っている"
    after_restart_has "まだ何も取っていない" && ok "再起動後も空(永続化)" || ng "再起動で復活した"
  else
    ng "全消去を操作できない"
  fi

  step "シナリオ18[正常系・本命2]: ブラウザ内の動画バッジからダウンロードできる"
  # ページ内部はuiautomatorで見えないので、DevTools(webview-eval.py。debugビルド限定)で確かめる
  WEB_EVAL="scripts/webview-eval.py"
  share_url "https://m.youtube.com/watch?v=jNQXAC9IVRw"
  if tap_text "ブラウザで開く"; then
    vis=0
    # YouTubeのプレイヤー初期化はエミュレータだと遅い。45秒では足りず偽の不合格になった(2026-08-21)
    for i in $(seq 1 25); do
      sleep 3
      vis=$(python3 "$WEB_EVAL" "$SERIAL" youtube.com \
        "[...document.querySelectorAll('.vv-badge')].filter(b=>b.style.display==='flex').length" 2>/dev/null || echo 0)
      [[ "$vis" =~ ^[1-9] ]] && break
    done
    [[ "$vis" =~ ^[1-9] ]] && ok "動画の上にバッジが出た($vis件)" || ng "バッジが出ない(vis=$vis)"
    # バッジが出てから下部バーへ反映されるまで数秒かかる(実測: バッジ5秒 → 下部バー10秒)。
    # 検出直後に1回だけ見ると落ちる=テスト側の偽の不合格だった(2026-08-21に実際に踏んだ)
    bar=""; for i in 1 2 3 4 5; do has_text "動画 " && { bar=1; break; }; sleep 3; done
    [[ -n "$bar" ]] && ok "下部バーに件数が出た" || ng "下部バーの件数が更新されない"
    # バッジが「見えているプレイヤー枠」の右下にあること。実<video>はレターボックスで枠外へずれるので、
    # アプリと同じく「viewportに最も大きく映る箱」を基準に、その右下(44+12pxのインセット内)に居るか見る
    pos=$(python3 "$WEB_EVAL" "$SERIAL" youtube.com "(()=>{const vw=innerWidth,vh=innerHeight;const va=(r)=>{const w=Math.min(r.right,vw)-Math.max(r.left,0),h=Math.min(r.bottom,vh)-Math.max(r.top,0);return (w>0&&h>0)?w*h:0};const anchor=(el)=>{let best=el.getBoundingClientRect(),ba=va(best),n=el.parentElement,k=0;while(n&&k<5){const r=n.getBoundingClientRect();if(r.width<=vw*1.05&&r.height<=vh*1.5){const a=va(r);if(a>ba){best=r;ba=a}}n=n.parentElement;k++}return best};const b=[...document.querySelectorAll('.vv-badge')].find(b=>b.style.display==='flex');const v=document.querySelector('video');if(!b||!v)return 'no';const r=anchor(v);const l=parseInt(b.style.left),t=parseInt(b.style.top);const okL=Math.abs((Math.min(r.right,vw)-56)-l)<=3;const okT=Math.abs((Math.min(r.bottom,vh)-56)-t)<=3;return (okL&&okT)?'ok':'off l='+l+' t='+t+' box='+Math.round(r.right)+','+Math.round(r.bottom)})()" 2>/dev/null)
    [[ "$pos" == ok* ]] && ok "バッジは動画プレイヤー枠の右下に付いている" || ng "バッジの位置が枠の右下ではない($pos)"
    if python3 "$WEB_EVAL" "$SERIAL" youtube.com "(()=>{const b=[...document.querySelectorAll('.vv-badge')].find(b=>b.style.display==='flex');if(!b)return 'no';b.click();return 'clicked'})()" 2>/dev/null | grep -q clicked; then
      sleep 2
      has_text "画質を選んでダウンロード" && ok "バッジからも画質シートが出る" || ng "画質シートが出ない"
      dump | grep -q 'text="SD"' && ok "前回選んだSDが候補にある" || ng "画質の候補が出ない"
      tap_text "オリジナル"; sleep 3
      has_text "ダウンロード中" && ok "タップでダウンロードが始まった" || ng "ダウンロードが始まらない"
      # 2026-08-25変更: ここでホームへ飛ばさない。飛ばすとWebViewごと破棄され、
      # 見ていた動画の再生が止まってページも読み直しになる
      dump | grep -q 'content-desc="再読込"' && ok "ブラウザ画面に留まったまま進捗が出る" || ng "ホームへ戻ってしまった"
      got=""
      for i in $(seq 1 36); do
        sleep 5
        found=$(adb shell "find $DL_DIR -type f -size +100k \\( -name '*.mp4' -o -name '*.webm' -o -name '*.mkv' \\) 2>/dev/null" | tr -d '\r')
        if [[ -n "$found" ]]; then got="$found"; break; fi
        has_text "失敗" && break
      done
      [[ -n "$got" ]] && ok "バッジ経由で動画本体を取得した" || { ng "バッジ経由で取得できない"; dump | grep -oE 'text="失敗[^"]{0,160}"' | head -2; }
    else
      ng "バッジをクリックできない"
    fi
  else
    ng "ブラウザで開けない"
  fi

  step "シナリオ19[正常系・本命3]: 画面を閉じてもダウンロードが続く(ForegroundService)"
  # 前のシナリオの成果物が残っていると「取れた」を誤検出する。毎回まっさらから始める
  adb shell rm -rf "$DL_DIR" 2>/dev/null
  share_url "$TEST_VIDEO"
  if tap_text "ダウンロード" && sleep 1 && tap_text "SD"; then
    ok "ダウンロードを開始した"
    fg=""
    for i in $(seq 1 15); do
      sleep 2
      adb shell dumpsys activity services $PKG 2>/dev/null | tr -d '\r' | grep -q "isForeground=true" && { fg=1; break; }
    done
    [[ -n "$fg" ]] && ok "DownloadServiceがForegroundServiceとして走っている" || ng "ForegroundServiceになっていない"
    # ホームキーでアプリを画面から外し、さらに「安全に殺せるプロセス」の掃除を撃つ。
    # FGSが効いていればここでは死なない(効いていなければプロセスごと消える)
    adb shell input keyevent KEYCODE_HOME >/dev/null 2>&1; sleep 2
    adb shell am kill $PKG >/dev/null 2>&1; sleep 3
    adb shell pidof $PKG >/dev/null 2>&1 && ok "画面を離れてもプロセスが生きている(am killで落ちない)" || ng "プロセスが落ちた"
    # アプリを表示していない間、進捗が見える唯一の窓口が通知になる
    notification_has "ダウンロード中" && ok "通知に進捗が出ている" || ng "進捗通知が見えない"
    got=""
    for i in $(seq 1 60); do
      sleep 5
      found=$(adb shell "find $DL_DIR -type f -size +100k \\( -name '*.mp4' -o -name '*.webm' -o -name '*.mkv' \\) 2>/dev/null" | tr -d '\r')
      if [[ -n "$found" ]]; then got="$found"; break; fi
    done
    [[ -n "$got" ]] && ok "アプリを表示していない間にダウンロードが完了した" || ng "画面を離れると完了しない"
    # プロセスを殺さずに戻る(=実行状態がDownloadCenterに残っているかの確認)
    adb shell am start -n "$ACT" >/dev/null 2>&1; sleep 3
    banner_has "完了" && ok "戻ると完了の帯が出ている" || ng "完了の帯が出ない"
    after_restart_has "$TEST_VIDEO_TITLE" && ok "履歴にも残った(永続化)" || ng "履歴に残っていない"
  else
    ng "ダウンロードを開始できない"
  fi
fi

echo; echo "================================"
echo "結果: 成功 $PASS / 失敗 $FAIL"
echo "================================"
[[ $FAIL -eq 0 ]]
