// ゲットVIDEO: ページ内の動画を検出し、その枠の右下に「弾むダウンロードバッジ」を重ねる。
// 内蔵ブラウザ(BrowserScreen)が各ページの読み込み完了時に注入する。
//
// - 対象: <video> と、既知の動画埋め込み <iframe>(YouTube / Vimeo / TikTok / ニコニコ / Twitch)
// - 位置: 画面固定のレイヤーに置き、要素の getBoundingClientRect に毎フレーム追従させる
//   (要素の中に入れると overflow:hidden や position の都合で消えるサイトがあるため)
// - タップ: Android側の VideoVault.onVideoDownload(JSON) へ。渡すのは
//   pageUrl(いまのページ)/ targetUrl(動画そのもののURLの推定。ツイートのパーマリンクや watch?v= など)/
//   mediaSrc(<video> の src。yt-dlp がページURLで取れないときの予備)
// - 色・動きはアプリのテーマ(バイオレット)と揃える。上下に弾む=「これはアプリの機能」と分かる合図
(function () {
  'use strict';
  // 再注入(SPAで onPageFinished が複数回来る・「動画を探し直す」)では件数を必ず通知し直す。
  // アプリ側は遷移開始で件数を0に戻すので、変化なしと判断して黙ると表示が「探している…」で止まる
  if (window.__vvBadges) { window.__vvBadges.rescan(true); return; }

  var LAYER_ID = 'vv-badge-layer';
  var SIZE = 44, INSET = 12, MIN_W = 96, MIN_H = 56;
  var EMBED = /(youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/|tiktok\.com\/embed|nicovideo\.jp\/watch\/|player\.twitch\.tv)/;
  var LINK = /(watch\?v=|\/shorts\/|\/status\/\d+|\/video\/\d+|\/videos?\/|\/movie|\/watch\/|\/reel\/)/;

  var style = document.createElement('style');
  style.id = 'vv-badge-style';
  style.textContent = [
    '#' + LAYER_ID + '{position:fixed;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483647;}',
    '.vv-badge{position:absolute;width:' + SIZE + 'px;height:' + SIZE + 'px;border-radius:50%;',
    '  background:#4F3DE8;box-shadow:0 4px 14px rgba(16,0,96,.45);display:none;align-items:center;justify-content:center;',
    '  pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;',
    '  animation:vv-bounce 1.15s cubic-bezier(.45,0,.55,1) infinite;will-change:transform;}',
    '.vv-badge svg{width:24px;height:24px;display:block;}',
    '.vv-badge.vv-sent{animation:none;background:#2E9E5B;}',
    '@keyframes vv-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}',
  ].join('\n');

  // innerHTML は使わない。YouTube等は Trusted Types(CSP)で innerHTML への代入を禁じており、
  // 使うと「This document requires 'TrustedHTML'」で止まる(2026-08-21 エミュレータで実際に踏んだ)
  function makeIcon() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', '#fff');
    svg.setAttribute('stroke-width', '2.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    ['M12 4.5v10', 'M7.5 10.5 12 15l4.5-4.5', 'M5 19.5h14'].forEach(function (d) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  var layer = null;
  var tracked = []; // {el, badge}
  var lastCount = -1;

  function ensureLayer() {
    if (!document.getElementById('vv-badge-style')) (document.head || document.documentElement).appendChild(style);
    layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = LAYER_ID;
      (document.body || document.documentElement).appendChild(layer);
    }
  }

  function targetFor(el) {
    try {
      if (el.tagName === 'IFRAME') return el.src;
      var a = el.closest('a[href]');
      if (a && a.href && /^https?:/.test(a.href)) return a.href;
      var box = el.closest('article,li,[data-testid="tweet"],[data-testid="cellInnerDiv"],ytm-rich-item-renderer,' +
        'ytm-video-with-context-renderer,ytm-reel-item-renderer,ytm-shorts-lockup-view-model,section,[class*="card" i]');
      if (box) {
        var links = box.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
          if (LINK.test(links[i].href)) return links[i].href;
        }
      }
    } catch (e) { /* 推定に失敗してもページURLで続ける */ }
    return location.href;
  }

  function mediaSrcOf(el) {
    if (el.tagName !== 'VIDEO') return '';
    var s = el.currentSrc || el.src || '';
    if (!s) { var src = el.querySelector('source'); if (src) s = src.src || ''; }
    return /^https?:/.test(s) ? s : '';
  }

  function isCandidate(el) {
    if (el.tagName === 'IFRAME') return EMBED.test(el.src || '');
    return true;
  }

  function makeBadge(el) {
    var b = document.createElement('div');
    b.className = 'vv-badge';
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', 'この動画をダウンロード');
    b.appendChild(makeIcon());
    var fire = function (e) {
      e.preventDefault(); e.stopPropagation();
      b.classList.add('vv-sent');
      setTimeout(function () { b.classList.remove('vv-sent'); }, 2500);
      var payload = JSON.stringify({
        pageUrl: location.href,
        targetUrl: targetFor(el),
        mediaSrc: mediaSrcOf(el),
        title: document.title || '',
      });
      if (window.VideoVault && VideoVault.onVideoDownload) VideoVault.onVideoDownload(payload);
    };
    b.addEventListener('click', fire, true);
    b.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
    return b;
  }

  function rescan() {
    ensureLayer();
    var els = Array.prototype.slice.call(document.querySelectorAll('video,iframe')).filter(isCandidate);
    // 消えた要素のバッジを外す
    tracked = tracked.filter(function (t) {
      if (els.indexOf(t.el) >= 0 && document.contains(t.el)) return true;
      if (t.badge.parentNode) t.badge.parentNode.removeChild(t.badge);
      return false;
    });
    // 新しい要素にバッジを付ける
    els.forEach(function (el) {
      for (var i = 0; i < tracked.length; i++) if (tracked[i].el === el) return;
      var badge = makeBadge(el);
      layer.appendChild(badge);
      tracked.push({ el: el, badge: badge });
    });
    layout();
  }

  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight, visible = 0;
    for (var i = 0; i < tracked.length; i++) {
      var t = tracked[i], r = t.el.getBoundingClientRect();
      var ok = r.width >= MIN_W && r.height >= MIN_H && r.bottom > SIZE && r.top < vh && r.right > SIZE && r.left < vw;
      if (ok) {
        var cs = getComputedStyle(t.el);
        ok = cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
      }
      if (ok) {
        visible++;
        t.badge.style.display = 'flex';
        t.badge.style.left = Math.round(Math.min(r.right, vw) - SIZE - INSET) + 'px';
        t.badge.style.top = Math.round(Math.min(r.bottom, vh) - SIZE - INSET) + 'px';
      } else {
        t.badge.style.display = 'none';
      }
    }
    if (visible !== lastCount) {
      lastCount = visible;
      if (window.VideoVault && VideoVault.onVideoCount) VideoVault.onVideoCount(visible);
    }
  }

  var rafPending = false;
  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; layout(); });
  }

  var rescanTimer = null;
  function scheduleRescan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(rescan, 250);
  }

  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  if (window.visualViewport) visualViewport.addEventListener('resize', schedule);
  try {
    new MutationObserver(scheduleRescan).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* 古いWebView */ }
  // SPA(X・YouTube)の画面遷移や遅延再生に備えて定期的にも見る。動画が無いページでは実質無負荷
  setInterval(function () { rescan(); }, 1500);
  setInterval(schedule, 250);

  window.__vvBadges = {
    rescan: function (forceNotify) { if (forceNotify) lastCount = -1; rescan(); },
    layout: layout,
    count: function () { return lastCount; },
  };
  rescan();
})();
