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
DL_DIR="/sdcard/Android/data/$PKG/files/downloads"
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
tap_text()  { local c; c=$(node_center text "$1");         [[ -n "$c" ]] && adb shell input tap $c; }
tap_desc()  { local c; c=$(node_center content-desc "$1"); [[ -n "$c" ]] && adb shell input tap $c; }
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
  has_text "このページをダウンロード" && ok "ブラウザ画面が開いた" || ng "ブラウザ画面が出ない"
  has_text "newspicks.com"           && ok "飛び先がNewsPicks"    || ng "URLが違う"
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

step "シナリオ4[正常系]: ブックマークを長押しで削除し、再起動後も消えたまま"
if long_press_text "Vimeo"; then
  sleep 1
  has_text "ブックマークを削除" && ok "確認ダイアログが出た" || ng "確認ダイアログが出ない"
  tap_text "削除"; sleep 1
  if has_text "Vimeo"; then ng "削除されていない"; else ok "一覧から消えた"; fi
  if after_restart_has "Vimeo"; then ng "再起動で復活した"; else ok "再起動後も消えたまま(永続化)"; fi
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
  has_text "このページをダウンロード" && ok "ブラウザ画面が開いた" || ng "ブラウザ画面が出ない"
  has_text "google.com"              && ok "検索結果を読み込んだ" || ng "URLが表示されない"
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

step "シナリオ9[異常系]: 存在しない動画IDはエラーを表示しクラッシュしない"
share_url "https://youtu.be/aaaaaaaaaaa"
if tap_text "ダウンロード"; then
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
  step "シナリオ14[正常系・本命]: 実際にYouTubeからダウンロードできる"
  share_url "$TEST_VIDEO"
  if tap_text "ダウンロード"; then
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
      has_text "完了" && ok "完了を表示した" || ng "完了が表示されない"
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
fi

echo; echo "================================"
echo "結果: 成功 $PASS / 失敗 $FAIL"
echo "================================"
[[ $FAIL -eq 0 ]]
