// 画質。Android の domain/Quality.kt と同じ。解像度の上限だけを変え、満たす形式が無ければ最良へ退避する。
export const QUALITIES = Object.freeze({
  ORIGINAL: { name: 'ORIGINAL', label: 'オリジナル', detail: 'サイトの最高画質', formatSelector: null },
  HD: { name: 'HD', label: 'HD', detail: '1080pまで', formatSelector: 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b' },
  SD: { name: 'SD', label: 'SD', detail: '480pまで', formatSelector: 'bv*[height<=480]+ba/b[height<=480]/bv*+ba/b' },
});

export const DEFAULT_QUALITY = QUALITIES.ORIGINAL;

export function qualityFromName(name) {
  return Object.hasOwn(QUALITIES, name) ? QUALITIES[name] : DEFAULT_QUALITY;
}
