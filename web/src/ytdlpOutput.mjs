// yt-dlp の出力の行を読む。Android の domain/YtdlpOutput.kt と同じ規則に、進捗とエラーの読み取りを足した。
//
// yt-dlp は保存先を次の形で出す(どれが出るかは形式の選ばれ方で変わる):
// - `[download] Destination: /path/Title.f137.mp4`(分割ダウンロードの各ファイル)
// - `[Merger] Merging formats into "/path/Title.mp4"`(結合後。これが最終形)
// - `[download] /path/Title.mp4 has already been downloaded`

const DESTINATION = /^\[download\] Destination: (.+)$/;
const MERGER = /^\[Merger\] Merging formats into "(.+)"$/;
const ALREADY = /^\[download\] (.+) has already been downloaded$/;
const FORMAT_SUFFIX = /\.f\d+$/;
const PERCENT = /^\[download\]\s+(\d+(?:\.\d+)?)%/;
const ERROR = /^ERROR:\s*(.+)$/;

/** ファイル名=`%(title)s.%(ext)s` で保存しているので、ディレクトリ・拡張子・`.f137` を落とせばタイトルになる */
export function titleFromPath(p) {
  const fileName = p.split(/[\\/]/).pop() ?? '';
  const dot = fileName.lastIndexOf('.');
  const withoutExt = dot > 0 ? fileName.slice(0, dot) : fileName;
  const title = withoutExt.replace(FORMAT_SUFFIX, '').trim();
  return title || null;
}

export function titleFrom(line) {
  const text = line.trim();
  const m = MERGER.exec(text) ?? DESTINATION.exec(text) ?? ALREADY.exec(text);
  return m ? titleFromPath(m[1]) : null;
}

/** 進捗(0〜1)。進捗の行でなければ null */
export function percentFrom(line) {
  const m = PERCENT.exec(line.trim());
  if (!m) return null;
  const v = Number(m[1]) / 100;
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
}

/** `ERROR: …` の行なら、その中身 */
export function errorFrom(line) {
  const m = ERROR.exec(line.trim());
  return m ? m[1] : null;
}
