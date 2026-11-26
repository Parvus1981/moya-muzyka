/* Монтаж: клипы и фото, обрезка, разрез, музыка из библиотеки, титры, подгонка под бит, экспорт в mp4.
   Всё считается на самом телефоне. Ролик собирается на canvas и записывается в реальном времени. */
(function () {
  'use strict';
  var MM = window.MM, root = document.getElementById('ed');
  if (!MM || !root) return;
  var $ = function (s) { return root.querySelector(s); };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmt(s) { if (!isFinite(s) || s < 0) s = 0; var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); }

  /* ---------- state ---------- */
  var RATIOS = { '9:16': [9, 16], '1:1': [1, 1], '16:9': [16, 9] };
  var ratioKey = '9:16', quality = 720, W = 720, H = 1280;
  var clips = [], titles = [], sel = -1, selT = -1, tab = 'tpl', uid = 0, total = 0;
  var music = { id: null, title: '', el: null, node: null, gain: null, url: null, start: 0, vol: 0.8, fade: true, dur: 0, status: '' };
  var origVol = 1;
  var placing = false, chars = [], selC = -1, bgrid = { id: null, bpm: 120, off: 0, busy: false }, drag = null;
  var trans = { type: 'fade', dur: 0.6, scope: 'photos' }, kbAmt = 0.06, pulseAmt = 0;
  var tplLen = 30, tplText = '', tplStatus = '', tplBusy = false, tplHook = true;
  var t = 0, playing = false, last = 0, cur = -1, raf = 0, openNow = false, wakeLock = null, toastT = 0, uiT = 0;
  var ctx = null, mix = null, dest = null;
  var exporting = false, recorder = null, chunks = [], recMime = '', doneFile = null, doneUrl = null, cancelled = false;
  var cv = $('#edCv'), g = cv.getContext('2d');
  var bg = document.createElement('canvas'), bgg = bg.getContext('2d');

  function toast(msg) { var el = $('#edToast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 2600); }

  /* ---------- canvas size ---------- */
  function applySize() {
    var r = RATIOS[ratioKey], sw = r[0], sh = r[1], k = quality / Math.min(sw, sh);
    W = Math.round(sw * k / 2) * 2; H = Math.round(sh * k / 2) * 2;
    cv.width = W; cv.height = H;
    bg.width = Math.max(8, Math.round(W / 24)); bg.height = Math.max(8, Math.round(H / 24));
    cv.style.aspectRatio = W + ' / ' + H;
  }

  /* ---------- timeline model ---------- */
  function cd(c) { return c.kind === 'image' ? c.dur : Math.max(0.1, c.out - c.inp); }
  function layout() {
    var s = 0; clips.forEach(function (c) { c.start = s; s += cd(c); c.end = s; }); total = s;
    $('#edEmpty').hidden = clips.length > 0;
  }
  function indexAt(x) {
    for (var i = 0; i < clips.length; i++) if (x < clips[i].end) return i;
    return clips.length - 1;
  }

  /* ---------- audio graph ---------- */
  function ensureAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(function () {}); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC(); mix = ctx.createGain(); dest = ctx.createMediaStreamDestination();
      mix.connect(ctx.destination); mix.connect(dest);
      clips.forEach(connectClip); connectMusic();
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      return true;
    } catch (e) { ctx = null; return false; }
  }
  function updGain(c) { if (c.gain) c.gain.gain.value = c.sound ? origVol : 0; else if (c.el && c.kind === 'video') c.el.muted = !c.sound || origVol === 0; }
  function connectClip(c) {
    if (c.kind !== 'video' || c.node || !ctx) return;
    try { c.node = ctx.createMediaElementSource(c.el); c.gain = ctx.createGain(); c.node.connect(c.gain); c.gain.connect(mix); updGain(c); } catch (e) {}
  }
  function connectMusic() {
    if (!ctx || !music.el || music.node) return;
    try { music.node = ctx.createMediaElementSource(music.el); music.gain = ctx.createGain(); music.node.connect(music.gain); music.gain.connect(mix); } catch (e) {}
  }

  /* ---------- clips ---------- */
  var IMG_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
  var bidSeq = 0;
  function newBid() { return 'c' + Date.now().toString(36) + (++bidSeq); }
  /* saved != null: восстановление из сохранённого проекта (обрезки и настройки берём оттуда) */
  function buildClip(f, url, bid, saved) {
    var isImg = saved ? saved.kind === 'image' : (/^image\//.test(f.type) || IMG_RE.test(f.name));
    var c = { id: ++uid, name: saved ? saved.name : f.name, url: url, bid: bid, blob: f, kind: isImg ? 'image' : 'video', el: null,
      src: saved ? saved.src || 0 : 0, inp: saved ? saved.inp || 0 : 0, out: saved ? saved.out || 0 : 0, dur: saved ? saved.dur || 3 : 3,
      fit: saved ? saved.fit || 'fill' : 'fill', sound: saved ? saved.sound !== false : true, thumb: saved ? saved.thumb || '' : '',
      node: null, gain: null, pre: false, ready: false, start: 0, end: 0 };
    if (isImg) {
      var im = new Image();
      im.onload = function () { c.ready = true; c.el = im; if (!c.thumb) thumbOf(c); layout(); paintTl(); };
      im.onerror = function () { toast('Не получилось открыть «' + c.name + '»'); drop(c); };
      c.el = im; im.src = url;
    } else {
      var v = document.createElement('video');
      v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      c.el = v;
      v.onloadedmetadata = function () {
        c.src = isFinite(v.duration) ? v.duration : 0;
        if (saved) { c.inp = clamp(c.inp, 0, Math.max(0, c.src - 0.2)); c.out = clamp(c.out || c.src, c.inp + 0.2, Math.max(c.inp + 0.2, c.src)); }
        else { c.inp = 0; c.out = c.src; }
        c.ready = true;
        layout(); paintTl(); paintPane();
        try { v.currentTime = saved ? c.inp : Math.min(0.1, c.src / 2); } catch (e) {}
      };
      v.onseeked = function () { if (!c.thumb && v.videoWidth) { thumbOf(c); try { v.currentTime = c.inp; } catch (e) {} paintTl(); } };
      v.onerror = function () { toast('Не получилось открыть «' + c.name + '». Попробуй mp4.'); drop(c); };
      v.src = url;
      ensureAudio(); connectClip(c);
    }
    return c;
  }
  function addFiles(list) {
    var files = Array.prototype.slice.call(list), n = 0;
    files.forEach(function (f) {
      var isImg = /^image\//.test(f.type) || IMG_RE.test(f.name);
      var isVid = /^video\//.test(f.type) || /\.(mp4|m4v|mov|webm|mkv|3gp)$/i.test(f.name);
      if (!isImg && !isVid) return;
      n++;
      clips.push(buildClip(f, URL.createObjectURL(f), newBid(), null));
    });
    if (!n) { toast('Нужны видео или фото'); return; }
    if (sel < 0) sel = 0;
    layout(); paintTl(); paintPane();
  }
  function thumbOf(c) {
    try {
      var s = document.createElement('canvas'); s.width = s.height = 96; var x = s.getContext('2d');
      var sw = c.kind === 'image' ? c.el.naturalWidth : c.el.videoWidth, sh = c.kind === 'image' ? c.el.naturalHeight : c.el.videoHeight;
      if (!sw || !sh) return;
      var k = Math.max(96 / sw, 96 / sh), dw = sw * k, dh = sh * k;
      x.drawImage(c.el, (96 - dw) / 2, (96 - dh) / 2, dw, dh);
      c.thumb = s.toDataURL('image/jpeg', 0.7);
    } catch (e) {}
  }
  function inUse(url, except) { return clips.some(function (o) { return o !== except && o.url === url; }); }
  function drop(c) {
    var i = clips.indexOf(c); if (i < 0) return;
    try { if (c.kind === 'video') c.el.pause(); } catch (e) {}
    clips.splice(i, 1);
    if (!inUse(c.url, null)) { try { URL.revokeObjectURL(c.url); } catch (e) {} }
    if (sel >= clips.length) sel = clips.length - 1;
    layout(); cur = -1; setTime(Math.min(t, total)); paintTl(); paintPane();
  }

  /* ---------- playback ---------- */
  function activate(i, local) {
    cur = i;
    clips.forEach(function (o, j) { if (j !== i && o.kind === 'video' && !o.el.paused) o.el.pause(); });
    var c = clips[i]; if (!c || c.kind !== 'video') return;
    var want = c.inp + local;
    if (Math.abs(c.el.currentTime - want) > 0.05) { try { c.el.currentTime = want; } catch (e) {} }
    updGain(c);
    if (playing && c.el.paused) c.el.play().catch(function () {});
  }
  function musicSeek() {
    if (!music.el) return;
    var d = music.el.duration, want = music.start + t;
    if (isFinite(d) && d > 0) want = want % d;
    try { music.el.currentTime = want; } catch (e) {}
  }
  function setTime(nt) {
    t = clamp(nt, 0, total);
    clips.forEach(function (c) { c.pre = false; });
    if (!clips.length) { cur = -1; return; }
    var i = indexAt(t); activate(i, t - clips[i].start);
    if (playing) musicSeek();
  }
  function play() {
    if (!total) { toast('Сначала добавь клипы'); return; }
    ensureAudio();
    if (t >= total - 0.03) t = 0;
    playing = true; last = performance.now();
    var i = indexAt(t); activate(i, t - clips[i].start);
    if (music.el) { musicSeek(); music.el.play().catch(function () {}); }
    paintPlay();
  }
  function pause() {
    playing = false;
    clips.forEach(function (c) { if (c.kind === 'video') try { c.el.pause(); } catch (e) {} });
    if (music.el) try { music.el.pause(); } catch (e) {}
    paintPlay();
  }
  function paintPlay() { var b = $('#edPlay'); b.textContent = playing ? '❚❚' : '▶'; b.setAttribute('aria-label', playing ? 'Пауза' : 'Играть'); }

  function tick(now) {
    if (!openNow) return;
    raf = requestAnimationFrame(tick);
    if (playing) {
      var dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
      if (t >= total) { t = total; pause(); if (exporting) finishExport(); }
      else {
        var i = indexAt(t), c = clips[i];
        if (i !== cur) activate(i, t - c.start);
        else if (c.kind === 'video') {
          var want = c.inp + (t - c.start);
          if (Math.abs(c.el.currentTime - want) > 0.35) { try { c.el.currentTime = want; } catch (e) {} }
          else if (c.el.paused) c.el.play().catch(function () {});
        }
        var nx = clips[i + 1];
        if (nx && nx.kind === 'video' && !nx.pre && t >= c.end - Math.max(0.8, trans.dur / 2 + 0.4)) { nx.pre = true; try { nx.el.currentTime = nx.inp; } catch (e) {} }
      }
    }
    if (music.gain) {
      var f = music.fade && total > 0 ? clamp((total - t) / 2, 0, 1) : 1;
      music.gain.gain.value = music.vol * f;
    }
    draw();
    if (now - uiT > 120) { uiT = now; paintTime(); }
  }
  function paintTime() {
    $('#edTime').textContent = fmt(t) + ' / ' + fmt(total);
    var sk = $('#edSeek'); if (document.activeElement !== sk) { sk.value = total ? Math.round(t / total * 1000) : 0; sk.style.setProperty('--p', (total ? t / total * 100 : 0).toFixed(1) + '%'); }
    if (exporting) { $('#edBusyBar').style.width = (total ? t / total * 100 : 0).toFixed(1) + '%'; $('#edBusyT').textContent = fmt(t) + ' / ' + fmt(total); }
  }

  /* ---------- drawing ---------- */
  function srcSize(c) { return c.kind === 'image' ? [c.el.naturalWidth, c.el.naturalHeight] : [c.el.videoWidth, c.el.videoHeight]; }
  function drawClip(c, idx, prog, alpha, dx, zx, srcOv) {
    if (!c || !c.ready) return;
    if (c.kind === 'video' && c.el.readyState < 2) return;
    var sz = srcSize(c), sw = sz[0], sh = sz[1]; if (!sw || !sh) return;
    var z = 1;
    if (c.kind === 'image' && kbAmt > 0) z = (idx % 2 === 0) ? 1 + kbAmt * prog : 1 + kbAmt * (1 - prog);
    if (pulseAmt > 0) { var bp = beatPos(), fr = bp - Math.floor(bp); z *= 1 + pulseAmt * Math.pow(1 - fr, 3); }
    if (zx) z *= zx;
    g.save();
    if (alpha < 1) g.globalAlpha = alpha;
    if (dx) g.translate(dx, 0);
    var im0 = srcOv || c.el;
    if (c.fit === 'fit') {
      var k0 = Math.max(bg.width / sw, bg.height / sh);
      if (!srcOv) {
      bgg.drawImage(c.el, (bg.width - sw * k0) / 2, (bg.height - sh * k0) / 2, sw * k0, sh * k0);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(bg, 0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, W, H);
      }
      var k = Math.min(W / sw, H / sh) * z;
      g.drawImage(im0, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
    } else {
      var kk = Math.max(W / sw, H / sh) * z;
      g.drawImage(im0, (W - sw * kk) / 2, (H - sh * kk) / 2, sw * kk, sh * kk);
    }
    g.restore();
  }
  var SIZES = { S: 0.055, M: 0.08, L: 0.115 };
  function wrapText(txt, maxW) {
    var out = [];
    String(txt).split('\n').forEach(function (par) {
      var words = par.split(/\s+/).filter(Boolean), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (w) {
        var tryL = line ? line + ' ' + w : w;
        if (g.measureText(tryL).width > maxW && line) { out.push(line); line = w; } else line = tryL;
      });
      out.push(line);
    });
    return out;
  }
  function accent() { try { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffb224'; } catch (e) { return '#ffb224'; } }
  function drawTitles() {
    titles.forEach(function (tt) {
      if (!tt.text || t < tt.start || t > tt.start + tt.dur) return;
      var a = Math.min(1, (t - tt.start) / 0.25, (tt.start + tt.dur - t) / 0.25); if (a <= 0) return;
      var base = Math.min(W, H), fs = Math.round(base * SIZES[tt.size]);
      g.save();
      g.font = '700 ' + fs + 'px Inter, "Space Grotesk", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.globalAlpha = a;
      var lines = wrapText(tt.text, W * 0.86), lh = fs * 1.22, n = lines.length;
      var yc = tt.pos === 'top' ? H * 0.15 : tt.pos === 'mid' ? H * 0.5 : H * 0.84;
      var y0 = yc - (n - 1) * lh / 2;
      if (tt.style === 'plate') {
        var mw = 0; lines.forEach(function (l) { mw = Math.max(mw, g.measureText(l).width); });
        var pw = mw + fs * 0.9, ph = n * lh + fs * 0.4, px = (W - pw) / 2, py = yc - ph / 2, r = fs * 0.35;
        g.fillStyle = 'rgba(255,255,255,0.94)'; g.beginPath();
        if (g.roundRect) g.roundRect(px, py, pw, ph, r); else g.rect(px, py, pw, ph);
        g.fill();
        g.fillStyle = '#111';
        lines.forEach(function (l, i) { g.fillText(l, W / 2, y0 + i * lh); });
      } else {
        g.fillStyle = tt.style === 'accent' ? accent() : '#fff';
        g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = fs * 0.14; g.lineJoin = 'round';
        g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = fs * 0.2;
        lines.forEach(function (l, i) { g.strokeText(l, W / 2, y0 + i * lh); g.fillText(l, W / 2, y0 + i * lh); });
      }
      g.restore();
    });
  }
  function ease(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function prog(c) { return clamp((t - c.start) / cd(c), 0, 1); }
  function okPair(a, b) { return trans.type !== 'none' && (trans.scope === 'all' || (a.kind === 'image' && b.kind === 'image')); }
  /* переход «по центру» границы: полпути до стыка и полпути после */
  function trAt(i) {
    if (trans.type === 'none') return null;
    var c = clips[i], nx = clips[i + 1], pv = clips[i - 1], h;
    if (nx && okPair(c, nx)) {
      h = Math.min(trans.dur / 2, cd(c) / 2.2, cd(nx) / 2.2);
      if (t >= c.end - h) return { a: c, b: nx, ai: i, bi: i + 1, p: (t - (c.end - h)) / (2 * h) };
    }
    if (pv && okPair(pv, c)) {
      h = Math.min(trans.dur / 2, cd(c) / 2.2, cd(pv) / 2.2);
      if (t <= c.start + h) return { a: pv, b: c, ai: i - 1, bi: i, p: (t - (c.start - h)) / (2 * h) };
    }
    return null;
  }

  /* ---------- герои из рисунка ---------- */
  var ANIMS = [['party', 'Живой танец'], ['dance', 'Танец'], ['hop', 'Прыжки'], ['sway', 'Покачивание'], ['boil', 'Дрожь линий'], ['none', 'Стоит']];
  function ensureGrid() {
    if (!music.id) { bgrid.id = null; ensureClipGrid(); return; }
    if (bgrid.id === music.id || bgrid.busy || !window.DJ || !window.DJ.analyzeTrack) return;
    bgrid.busy = true; var want = music.id;
    window.DJ.analyzeTrack(want).then(function (r) { if (r && r.bpm) { bgrid.bpm = r.bpm; bgrid.off = r.off || 0; } bgrid.id = want; bgrid.busy = false; },
      function () { bgrid.id = want; bgrid.busy = false; });
  }
  /* ритм из звука самого клипа (если отдельная музыка не выбрана) */
  function ensureClipGrid() {
    if (!window.DJ || !window.DJ.analyzeBlob) return;
    clips.forEach(function (c) {
      if (c.kind !== 'video' || c.sound === false || c.bg || c.bgBusy || !c.blob) return;
      c.bgBusy = true;
      window.DJ.analyzeBlob('clip:' + (c.bid || c.name) + ':' + c.blob.size, c.blob).then(function (r) {
        c.bg = r && r.bpm ? r : { bpm: 0, off: 0 }; c.bgBusy = false; if (tab === 'chars') paintPane(); if (!playing && openNow) draw();
      }, function () { c.bg = { bpm: 0, off: 0 }; c.bgBusy = false; });
    });
  }
  function clipBeat() {
    if (!clips.length) return null; var c = clips[indexAt(t)];
    return c && c.kind === 'video' && c.sound !== false && c.bg && c.bg.bpm ? c : null;
  }
  function curBpm() { if (music.id && bgrid.id === music.id) return bgrid.bpm; var cb = clipBeat(); return cb ? cb.bg.bpm : 120; }
  function beatText() {
    if (music.id) return bgrid.id === music.id ? 'Ритм: из выбранной музыки, ' + Math.round(bgrid.bpm) + ' уд/мин.' : 'Ритм: считаю выбранную музыку…';
    if (clipBeat()) return 'Ритм: из звука клипа, ' + Math.round(clipBeat().bg.bpm) + ' уд/мин. Герои танцуют под его песню.';
    if (clips.some(function (c) { return c.bgBusy; })) return 'Ритм: слушаю звук клипа… (длинный клип может занять до минуты)';
    return 'Ритм: не нашёл, герои двигаются в темпе 120. Включи звук клипа или выбери музыку на вкладке «Музыка».';
  }
  function beatPos() {
    if (!music.id) { var cb = clipBeat(); if (cb) return (cb.inp + (t - cb.start) - cb.bg.off) * cb.bg.bpm / 60; }
    var mt = (music.id ? music.start : 0) + t, bpm = bgrid.id === music.id && music.id ? bgrid.bpm : 120, off = bgrid.id === music.id && music.id ? bgrid.off : 0;
    return (mt - off) * bpm / 60;
  }
  function hash(n) { var x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }
  function charBox(c) {
    var h = c.size * H, w = h * c.img.width / c.img.height; return { w: w, h: h, cx: c.x * W, cy: c.y * H };
  }

  /* ---------- вживление героя в кадр: цвет и свет сцены, тени, мягкость, зерно ---------- */
  var HASF = (function () { try { return 'filter' in CanvasRenderingContext2D.prototype; } catch (e) { return false; } })();
  var lay = document.createElement('canvas'), lg = lay.getContext('2d'), tiny = document.createElement('canvas'), tg = tiny.getContext('2d', { willReadFrequently: true });
  tiny.width = 12; tiny.height = 12;
  var tnC = document.createElement('canvas'), tnG = tnC.getContext('2d');
  var BLEND_DEF = { on: true, col: 0.5, shd: 0.6, soft: 0.25, grain: 0.4, light: 0.5, refl: 0, wrap: 0.5 };
  /* «клей»: общий вид кадра (свечение светлых мест, зерно, виньетка) поверх клипа и героев вместе */
  var glue = { on: true, bloom: 0.5, grain: 0.5, vig: 0.35 };
  var glB = document.createElement('canvas'), glG = glB.getContext('2d'), glTile = null;
  function makeGlueTile() {
    var nc = document.createElement('canvas'); nc.width = nc.height = 256; var ng = nc.getContext('2d'), id = ng.createImageData(256, 256), d = id.data, i;
    for (i = 0; i < 65536; i++) { var v = 128 + Math.round((Math.random() + Math.random() + Math.random() - 1.5) * 70); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.max(0, Math.min(255, v)); d[i * 4 + 3] = 255; }
    ng.putImageData(id, 0, 0); return g.createPattern(nc, 'repeat');
  }
  function drawGlue() {
    if (!glue.on || !HASF || !chars.length) return;
    var any = false; chars.forEach(function (c) { if (c.blend && c.blend.on) any = true; }); if (!any) return;
    if (glue.bloom > 0.02) {
      var bw = Math.max(32, Math.round(W / 4)), bh = Math.max(32, Math.round(H / 4));
      if (glB.width !== bw || glB.height !== bh) { glB.width = bw; glB.height = bh; } else glG.clearRect(0, 0, bw, bh);
      glG.filter = 'brightness(0.75) contrast(1.6) blur(' + Math.max(2, bw * 0.025).toFixed(1) + 'px) saturate(1.3)'; glG.drawImage(cv, 0, 0, bw, bh); glG.filter = 'none';
      g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = Math.min(1, 0.55 * glue.bloom); g.drawImage(glB, 0, 0, W, H); g.restore();
    }
    if (glue.vig > 0.02) { var vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,' + (0.5 * glue.vig).toFixed(3) + ')'); g.save(); g.fillStyle = vg; g.fillRect(0, 0, W, H); g.restore(); }
    if (glue.grain > 0.02) {
      if (!glTile) glTile = makeGlueTile();
      var ox = Math.floor(Math.random() * 256), oy = Math.floor(Math.random() * 256);
      g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = Math.min(1, 0.32 * glue.grain); g.translate(-ox, -oy); g.fillStyle = glTile; g.fillRect(ox, oy, W, H); g.restore();
    }
  }
  function cl01(v, a, b) { return Math.max(a, Math.min(b, v)); }
  /* средний цвет, яркость и сторона света в кадре вокруг героя (до того как герой нарисован) */
  function sceneAt(c, cx, cy, bx) {
    var k = Math.floor(t * 8), old = c._sc;
    if (old && (playing || exporting) && old.k === k) return old;
    var rx = Math.max(0, Math.round(cx - bx.w * 0.9)), ry = Math.max(0, Math.round(cy - bx.h * 0.45)), rw = Math.min(W - rx, Math.round(bx.w * 1.8)), rh = Math.min(H - ry, Math.round(bx.h * 0.9));
    var def = old || { r: 128, g: 128, b: 128, L: 0.5, ld: 0, sat: 0.3, tr: 150, tg: 150, tb: 150, k: k };
    if (rw < 4 || rh < 4) return def;
    var d;
    try { tg.clearRect(0, 0, 12, 12); tg.drawImage(cv, rx, ry, rw, rh, 0, 0, 12, 12); d = tg.getImageData(0, 0, 12, 12).data; } catch (e) { return def; }
    var sr = 0, sg2 = 0, sb = 0, ll = 0, lr = 0, sat = 0, i, x, n = 144;
    for (i = 0; i < n; i++) {
      var r = d[i * 4], g2 = d[i * 4 + 1], b2 = d[i * 4 + 2], lu = 0.2126 * r + 0.7152 * g2 + 0.0722 * b2; sr += r; sg2 += g2; sb += b2; x = i % 12;
      if (x < 6) ll += lu; else lr += lu; sat += (Math.max(r, g2, b2) - Math.min(r, g2, b2)) / (Math.max(r, g2, b2) + 8);
    }
    var R = sr / n, G2 = sg2 / n, B = sb / n, L = (0.2126 * R + 0.7152 * G2 + 0.0722 * B) / 255, ld = cl01((lr - ll) / (lr + ll + 12) * 2.5, -1, 1), kk = 150 / Math.max(L * 255, 25);
    var cur = { r: R, g: G2, b: B, L: L, ld: ld, sat: sat / n, tr: Math.round(Math.min(255, R * kk)), tg: Math.round(Math.min(255, G2 * kk)), tb: Math.round(Math.min(255, B * kk)), k: k };
    if (old) { var m = 0.45; cur.L = old.L + (cur.L - old.L) * m; cur.ld = old.ld + (cur.ld - old.ld) * m; cur.sat = old.sat + (cur.sat - old.sat) * m; cur.tr = Math.round(old.tr + (cur.tr - old.tr) * m); cur.tg = Math.round(old.tg + (cur.tg - old.tg) * m); cur.tb = Math.round(old.tb + (cur.tb - old.tb) * m); }
    c._sc = cur; return cur;
  }
  /* яркость самого героя (по прозрачности), считается один раз на картинку */
  function heroLum(c, im) {
    if (c._hlFor === im && c._hl != null) return c._hl;
    var v = 0.6;
    try {
      tg.clearRect(0, 0, 12, 12); tg.drawImage(im, 0, 0, 12, 12); var d = tg.getImageData(0, 0, 12, 12).data, s = 0, w = 0, i;
      for (i = 0; i < 144; i++) { var a = d[i * 4 + 3] / 255; s += a * (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; w += a; }
      if (w > 1) v = s / w;
    } catch (e) {}
    c._hlFor = im; c._hl = Math.max(0.12, v); return c._hl;
  }
  /* тень под героем: мягкое пятно у ног + отброшенная тень в сторону от света */
  function groundShadow(k, c, bl, sc, im, bx, air) {
    var hopK = 1 - 0.55 * air, a = bl.shd * (0.22 + 0.45 * sc.L) * hopK;
    k.save(); k.translate(0, 2); k.scale(1, 0.14);
    var r = bx.w * 0.42 * (1 - 0.25 * air), rg = k.createRadialGradient(0, 0, 0, 0, 0, r); rg.addColorStop(0, 'rgba(0,0,0,' + (1.5 * a).toFixed(3) + ')'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    k.fillStyle = rg; k.beginPath(); k.arc(0, 0, r, 0, 7); k.fill(); k.restore();
    var sk = -0.35 * (1 - Math.min(1, Math.abs(sc.ld) * 4)) + sc.ld * 0.9; if (c.flip) sk = -sk;
    k.save(); k.globalAlpha = Math.min(0.7, a); k.filter = 'brightness(0) blur(' + (bx.h * 0.012 * (0.6 + bl.soft)).toFixed(2) + 'px)';
    k.transform(1, 0, sk, -0.14, 0, 2); k.drawImage(im, -bx.w / 2, -bx.h, bx.w, bx.h); k.restore();
  }

  /* отражение героя на глянцевом полу: нижняя часть, перевёрнутая, тающая вниз */
  var rfl = document.createElement('canvas'), rg = rfl.getContext('2d');
  function reflection(k, bl, im, bx, lift) {
    var rw = Math.max(2, Math.round(bx.w)), rh = Math.max(2, Math.round(bx.h * 0.55));
    if (rfl.width !== rw || rfl.height !== rh) { rfl.width = rw; rfl.height = rh; } else rg.clearRect(0, 0, rw, rh);
    rg.save(); rg.translate(0, rh); rg.scale(1, -1); rg.drawImage(im, 0, im.height * 0.45, im.width, im.height * 0.55, 0, 0, rw, rh); rg.restore();
    rg.globalCompositeOperation = 'destination-in';
    var gr = rg.createLinearGradient(0, 0, 0, rh); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); rg.fillStyle = gr; rg.fillRect(0, 0, rw, rh); rg.globalCompositeOperation = 'source-over';
    k.save(); k.globalAlpha = Math.min(0.7, bl.refl * 0.7); k.filter = 'brightness(0.6) blur(' + (bx.h * 0.004 * (0.5 + bl.soft)).toFixed(2) + 'px)'; k.drawImage(rfl, -bx.w / 2, 2 + 2 * (lift || 0), bx.w, bx.h * 0.55); k.restore();
  }

  /* свет фона заходит на край героя: цвет размытого фона ложится по контуру внутрь, край перестаёт быть вырезанным */
  var rimC = document.createElement('canvas'), rimG = rimC.getContext('2d'), rimM = document.createElement('canvas'), rimMG = rimM.getContext('2d');
  function lightWrap(bl, rx, ry, rw, rh, bx) {
    if (!(bl.wrap > 0.02)) return;
    var rad = Math.max(1.5, bx.h * 0.01), a = Math.min(1, bl.wrap * 1.2);
    if (rimC.width !== rw || rimC.height !== rh) { rimC.width = rw; rimC.height = rh; rimM.width = rw; rimM.height = rh; } else { rimG.clearRect(0, 0, rw, rh); rimMG.clearRect(0, 0, rw, rh); }
    rimG.globalCompositeOperation = 'source-over'; rimG.drawImage(lay, rx, ry, rw, rh, 0, 0, rw, rh);
    rimMG.filter = 'blur(' + (rad * 1.6).toFixed(2) + 'px)'; rimMG.drawImage(lay, rx, ry, rw, rh, 0, 0, rw, rh); rimMG.filter = 'none';
    rimG.globalCompositeOperation = 'destination-out'; rimG.drawImage(rimM, 0, 0);
    rimG.globalCompositeOperation = 'source-in'; rimG.filter = 'blur(' + (rad * 2.6).toFixed(2) + 'px) brightness(1.35)'; rimG.drawImage(cv, rx, ry, rw, rh, 0, 0, rw, rh); rimG.filter = 'none';
    rimG.globalCompositeOperation = 'source-over';
    lg.save(); lg.globalCompositeOperation = 'source-atop'; lg.globalAlpha = a; lg.drawImage(rimC, rx, ry); lg.restore();
  }
  /* слой героя -> подгонка цвета, света, зерна -> на кадр */
  function blendLayer(c, bl, sc, cx, cy, bx, im) {
    var rx = Math.max(0, Math.floor(cx - bx.w * 0.95)), ry = Math.max(0, Math.floor(cy - bx.h * 0.7)), rx2 = Math.min(W, Math.ceil(cx + bx.w * 0.95)), ry2 = Math.min(H, Math.ceil(cy + bx.h * 0.7)), rw = rx2 - rx, rh = ry2 - ry;
    if (rw < 2 || rh < 2) return;
    lg.save(); lg.globalCompositeOperation = 'source-atop';
    var Lt = bl.light;
    if (Lt > 0.02) {
      var a = Math.min(1, Math.abs(sc.ld) * 3) * Lt, gx = lg.createLinearGradient(cx - bx.w / 2, 0, cx + bx.w / 2, 0), dark = 'rgba(10,8,20,' + (0.3 * a).toFixed(3) + ')', lit = 'rgba(255,240,210,' + (0.16 * a).toFixed(3) + ')';
      if (sc.ld > 0) { gx.addColorStop(0, dark); gx.addColorStop(1, lit); } else { gx.addColorStop(0, lit); gx.addColorStop(1, dark); }
      lg.fillStyle = gx; lg.fillRect(rx, ry, rw, rh);
      var gy = lg.createLinearGradient(0, cy - bx.h / 2, 0, cy + bx.h / 2); gy.addColorStop(0, 'rgba(255,245,220,' + (0.05 * Lt).toFixed(3) + ')'); gy.addColorStop(0.55, 'rgba(0,0,0,0)'); gy.addColorStop(1, 'rgba(8,6,16,' + (0.28 * Lt).toFixed(3) + ')');
      lg.fillStyle = gy; lg.fillRect(rx, ry, rw, rh);
    }
    var mm = Math.min(1, bl.col * 1.6), mx = Math.max(sc.tr, sc.tg, sc.tb), chroma = (mx - Math.min(sc.tr, sc.tg, sc.tb)) / (mx + 1);
    lg.restore();
    if (bl.col > 0.02) {
      /* умножение на цвет сцены: тёмное остаётся тёмным, контраст героя не падает (плоская полупрозрачная заливка его «туманила») */
      var ts = Math.min(0.45, Math.min(1, bl.col * 1.5) * (0.25 + 0.75 * chroma)), tmx = Math.max(sc.tr, sc.tg, sc.tb, 1);
      var mr = Math.round(255 * (1 + (sc.tr / tmx - 1) * ts)), mg = Math.round(255 * (1 + (sc.tg / tmx - 1) * ts)), mb = Math.round(255 * (1 + (sc.tb / tmx - 1) * ts));
      if (tnC.width !== rw || tnC.height !== rh) { tnC.width = rw; tnC.height = rh; } else tnG.clearRect(0, 0, rw, rh);
      tnG.drawImage(lay, rx, ry, rw, rh, 0, 0, rw, rh);
      lg.save(); lg.globalCompositeOperation = 'multiply'; lg.fillStyle = 'rgb(' + mr + ',' + mg + ',' + mb + ')'; lg.fillRect(rx, ry, rw, rh);
      lg.globalCompositeOperation = 'destination-in'; lg.drawImage(tnC, 0, 0, rw, rh, rx, ry, rw, rh); lg.restore();
    }
    lightWrap(bl, rx, ry, rw, rh, bx);
    var f = [];
    if (bl.col > 0.02) {
      var kk = cl01((sc.L + 0.12) / heroLum(c, im), 0.55, 1.1);
      f.push('brightness(' + (1 + (kk - 1) * mm).toFixed(3) + ')'); f.push('saturate(' + (1 - 0.1 * mm).toFixed(3) + ')');
    }
    var rcl = clips.length ? clips[indexAt(t)] : null, rsz = rcl && rcl.kind === 'video' ? srcSize(rcl) : null, resK = rsz && rsz[1] ? cl01(H / rsz[1] / 1.5, 0.8, 2.2) : 1;
    if (bl.soft > 0.04) f.push('blur(' + (bl.soft * Math.max(0.5, bx.h / 500) * resK).toFixed(2) + 'px)');
    if (bl.col > 0.02) f.push('contrast(1.05)');
    g.save(); if (f.length) g.filter = f.join(' '); g.drawImage(lay, rx, ry, rw, rh, rx, ry, rw, rh); g.restore();
  }
  function drawChars() {
    if (!chars.length) return;
    ensureGrid();
    var b = beatPos(), fr = b - Math.floor(b), kick = Math.pow(1 - fr, 2.2), side = (Math.floor(b) % 2) ? 1 : -1;
    chars.forEach(function (c, ci) {
      if (!c.img || !c.img.width) return;
      if (t < c.t0 || (c.t1 > 0 && t >= c.t1)) return;
      var pop = 1, offX = 0, offY = 0, walk = 0;
      var EN = 0.9, eIn = c.enter || 'pop', eOut = c.exit || 'fade';
      var bx = charBox(c);
      if (c.grow && Math.abs(c.grow - 1) > 0.01) {
        var gEnd = c.t1 > 0 ? c.t1 : total, gp = Math.max(0, Math.min(1, (t - c.t0) / Math.max(1, gEnd - c.t0))), gk = 1 + (c.grow - 1) * gp * gp * (3 - 2 * gp), gb = bx.cy + bx.h / 2;
        bx = { w: bx.w * gk, h: bx.h * gk, cx: bx.cx, cy: gb - bx.h * gk / 2 };
      }
      var u = (t - c.t0) / (eIn === 'pop' ? 0.4 : EN);
      if (u < 1 && c.t0 > 0.05) {
        if (eIn === 'pop') { var u1 = u - 1; pop = Math.max(0.01, 1 + 2.7 * u1 * u1 * u1 + 1.7 * u1 * u1); }
        else { var ee = 1 - Math.pow(1 - Math.max(0, u), 3), rem = 1 - ee;
          if (eIn === 'left') offX = -(bx.cx + bx.w) * rem; else if (eIn === 'right') offX = (W - bx.cx + bx.w) * rem; else offY = -(bx.cy + bx.h) * rem;
          walk = rem; }
      }
      if (c.t1 > 0) {
        if (eOut === 'fade') pop *= Math.max(0, Math.min(1, (c.t1 - t) / 0.25));
        else { var uo = Math.max(0, Math.min(1, (t - (c.t1 - EN)) / EN)), eo = uo * uo;
          if (uo > 0) { if (eOut === 'left') offX = -(bx.cx + bx.w) * eo; else if (eOut === 'right') offX = (W - bx.cx + bx.w) * eo; else offY = (H - bx.cy + bx.h) * eo; walk = Math.max(walk, eo); } }
      }
      if (pop <= 0.01) return;
      var N = 28, amt = c.amt, ph = ci * 1.7;
      var rot = 0, sq = 1, hop = 0, wave = 0, wavePh = 0, jit = 0, party = c.anim === 'party';
      var hopAmp = c.anim === 'hop' ? 0.06 * H * amt : party ? 0.01 * H * amt : 0;
      var hopAt = function (x) { x = ((x % 1) + 1) % 1; if (c.anim === 'hop') { var u = Math.min(1, Math.max(0, (x - 0.1) / 0.9)); return 4 * u * (1 - u) * hopAmp; } return Math.abs(Math.sin(Math.PI * x)) * hopAmp; };
      if (party) { rot = side * 0.07 * amt * (0.35 + 0.65 * Math.sin(Math.PI * fr)); hop = hopAt(fr); sq = 1 - 0.05 * amt * kick; wave = 0.04 * amt; wavePh = b * Math.PI + ph; }
      else if (c.anim === 'dance') { rot = side * 0.07 * amt * (0.4 + 0.6 * Math.sin(Math.PI * fr)); sq = 1 - 0.07 * amt * kick; wave = 0.05 * amt; wavePh = b * Math.PI + ph; }
      else if (c.anim === 'hop') { var uh = Math.min(1, Math.max(0, (fr - 0.1) / 0.9)); hop = hopAt(fr); sq = 1 - 0.13 * amt * Math.max(0, 1 - fr / 0.14) + 0.04 * amt * Math.sin(Math.PI * uh); wave = 0.02 * amt; wavePh = b * Math.PI; rot = side * 0.025 * amt * Math.sin(Math.PI * uh); }
      else if (c.anim === 'sway') { rot = Math.sin(t * 2.2 + ph) * 0.05 * amt; wave = 0.06 * amt; wavePh = t * 3 + ph; }
      else if (c.anim === 'boil') { jit = 0.012 * amt; }
      if (walk > 0.001) { rot += Math.sin(t * 13) * 0.09 * walk; hop += Math.abs(Math.sin(t * 8.5)) * 0.035 * H * walk; }
      if (c.react && clips.length > 1) {
        var ci2 = indexAt(t), cs = clips[ci2].start, age = t - cs;
        if (ci2 > 0 && age >= 0 && age < 0.7) { var kk = Math.exp(-age * 6); hop += kk * 0.08 * H; sq *= 1 - 0.1 * kk * (age < 0.1 ? 1 : 0.5); rot += Math.sin(age * 18) * 0.06 * kk; }
      }
      var fi = Math.floor(t * 8);
      var bl = c.blend && c.blend.on && HASF ? c.blend : null;
      var im;
      if (c.frames) {
        var fl = c.frames.length, fidx;
        if (c.sync !== false) { var per = Math.max(1, Math.round(fl / c.fps * curBpm() / 60)), ph0 = ((b / per) % 1 + 1) % 1; fidx = Math.floor(ph0 * fl) % fl; }
        else fidx = Math.floor(Math.max(0, t - c.t0) * c.fps) % fl;
        im = c.frames[fidx];
      } else im = c.img;
      if (!im || !im.width) im = c.img;
      var hcx = bx.cx + offX, hcy = bx.cy + offY - hop, hopK = Math.max(0.3, 1 - hop / H * 2);
      var sc = bl ? sceneAt(c, hcx, hcy, bx) : null;
      var xf = function (k) { k.translate(bx.cx + offX, bx.cy + offY + bx.h / 2 - hop); k.rotate(rot); k.scale((c.flip ? -1 : 1) * pop, sq * pop); };
      if (c.fx === 'aura') {
        var pul = 0.55 + 0.45 * kick, ar = bx.h * 0.62 * (1 + 0.08 * kick), hue = Math.round((b * 25 + ci * 70) % 360), rgA = g.createRadialGradient(hcx, hcy, bx.h * 0.05, hcx, hcy, ar);
        rgA.addColorStop(0, 'hsla(' + hue + ',95%,62%,' + (0.5 * pul).toFixed(3) + ')'); rgA.addColorStop(1, 'hsla(' + hue + ',95%,62%,0)');
        g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = rgA; g.fillRect(hcx - ar, hcy - ar, ar * 2, ar * 2); g.restore();
      }
      var air = Math.min(1, hop / (0.08 * H)), xg = function (k) { k.translate(bx.cx + offX, bx.cy + offY + bx.h / 2); k.scale((c.flip ? -1 : 1) * pop, pop); };
      if (bl && sc) { g.save(); xg(g); if (bl.refl > 0.02) reflection(g, bl, im, bx, hop / Math.max(0.2, pop)); if (bl.shd > 0.02) groundShadow(g, c, bl, sc, im, bx, air); g.restore(); }
      else if (c.shadow !== false) { g.save(); xg(g); g.globalAlpha = 0.25 * (1 - 0.5 * air); g.fillStyle = '#000'; g.beginPath(); g.ellipse(0, 4, bx.w * 0.3 * (1 - 0.3 * air), bx.h * 0.02, 0, 0, 7); g.fill(); g.restore(); }
      var paintHero = function (G) {
        var sh = im.height / N, tilt = party ? Math.sin(b * Math.PI) * 0.16 * amt : 0, nod = party ? kick * 0.014 * bx.h * amt : 0, step = party ? Math.abs(Math.sin(Math.PI * fr)) * 0.025 * bx.h * amt : 0;
        for (var i = 0; i < N; i++) {
          var hh = 1 - (i + 0.5) / N, dx = Math.sin(wavePh - hh * 3.2) * wave * bx.w * hh;
          if (jit) dx += (hash(fi * 31 + i * 7 + ci) - 0.5) * 2 * jit * bx.w;
          var dy = jit ? (hash(fi * 17 + i * 3 + ci) - 0.5) * jit * bx.h : 0;
          if (hopAmp) dy -= (hopAt(fr - 0.12 * hh) - hopAt(fr)) * (1 / Math.max(0.2, pop));
          if (party && hh > 0.84) { dx += (hh - 0.84) * bx.h * Math.sin(tilt); dy += nod * Math.min(1, (hh - 0.84) / 0.08); }
          if (party && hh < 0.3) {
            var M = 8, sw2 = im.width / M, wl = 1 - cl01((hh - 0.05) / 0.25, 0, 1);
            for (var q = 0; q < M; q++) {
              var u = (q + 0.5) / M * 2 - 1, lift = side > 0 ? Math.max(0, -u) : Math.max(0, u);
              G.drawImage(im, q * sw2, i * sh, sw2 + 1, sh + 1, -bx.w / 2 + dx + q * bx.w / M, -bx.h + (i * bx.h / N) + dy - step * lift * wl, bx.w / M + 1.5, bx.h / N + 1.5);
            }
          } else G.drawImage(im, 0, i * sh, im.width, sh + 1, -bx.w / 2 + dx, -bx.h + (i * bx.h / N) + dy, bx.w, bx.h / N + 1.5);
        }
        var m = c.mouth;
        if (m && m.on) {
          var hm = 1 - m.y, mdx = Math.sin(wavePh - hm * 3.2) * wave * bx.w * hm, mxp = (m.x - 0.5) * bx.w * (1) + mdx, myp = -bx.h * (1 - m.y), mrx = Math.max(3, m.s * bx.w / 2);
          var sy = Math.sin(b * Math.PI * 2 + ci * 2), op = Math.max(0, sy) * (hash(Math.floor(b * 2) + ci * 5) > 0.3 ? 1 : 0.25);
          var mry = mrx * (0.18 + 0.82 * op);
          G.save(); G.translate(mxp, myp);
          G.fillStyle = '#3b0a12'; G.strokeStyle = '#1a1a1a'; G.lineWidth = Math.max(1.5, mrx * 0.22);
          G.beginPath(); G.ellipse(0, 0, mrx, mry, 0, 0, 7); G.fill(); G.stroke();
          if (op > 0.45) { G.fillStyle = '#ff6b81'; G.beginPath(); G.ellipse(0, mry * 0.45, mrx * 0.55, mry * 0.5, 0, 0, Math.PI); G.fill(); }
          G.restore();
        }
      };
      if (bl && sc) {
        if (lay.width !== W || lay.height !== H) { lay.width = W; lay.height = H; } else lg.clearRect(0, 0, W, H);
        lg.save(); xf(lg); paintHero(lg); lg.restore();
        blendLayer(c, bl, sc, hcx, hcy, bx, im);
      } else { g.save(); xf(g); paintHero(g); g.restore(); }
      /* эффекты вокруг героя */
      if (c.fx && c.fx !== 'none' && c.fx !== 'aura') {
        var kb = Math.floor(b), every = (c.fx === 'confetti' || c.fx === 'sparkle') ? 1 : 2, headY = bx.cy + offY - bx.h * 0.38 - hop, hx = bx.cx + offX;
        for (var kq = kb - 2; kq <= kb; kq++) {
          if (kq % every !== 0) continue; var age = b - kq; if (age < 0 || age > 2) continue;
          for (var j = 0; j < 7; j++) {
            var sd = hash(kq * 13 + j * 7.3 + ci * 3.1), sd2 = hash(kq * 5 + j * 11.7 + ci), ang = -Math.PI / 2 + (sd - 0.5) * 2.6, spd = (0.5 + sd2) * bx.h * 0.55;
            var px = hx + Math.cos(ang) * spd * age, py = headY + Math.sin(ang) * spd * age + 0.35 * bx.h * age * age, al = Math.max(0, 1 - age / 2), sz = bx.h * (0.05 + sd2 * 0.04);
            if (c.fx === 'notes' || c.fx === 'bubbles') { px = hx + (sd - 0.5) * bx.w * 1.1 + Math.sin(age * 5 + j) * bx.w * 0.05; py = headY - age * bx.h * 0.4 - sd2 * bx.h * 0.1; }
            else if (c.fx === 'sparkle') { px = hx + (sd - 0.5) * bx.w * 1.0; py = bx.cy + offY - hop - bx.h * 0.45 + sd2 * bx.h * 0.9; al = Math.max(0, Math.sin(Math.min(1, age / 1.2) * Math.PI)); }
            g.save(); g.globalAlpha = al; g.translate(px, py);
            if (c.fx === 'hearts') { g.fillStyle = sd > 0.5 ? '#ff4d6d' : '#ff85a1'; g.font = '700 ' + Math.round(sz * 1.6) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('\u2665', 0, 0); }
            else if (c.fx === 'notes') { g.fillStyle = ['#ffffff', '#ffd23f', '#7dd3ff', '#ff85a1'][j % 4]; g.font = '700 ' + Math.round(sz * 1.9) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sd > 0.5 ? '\u266A' : '\u266B', 0, 0); }
            else if (c.fx === 'bubbles') { var br = sz * (0.5 + sd2 * 0.6); g.fillStyle = 'rgba(255,255,255,0.12)'; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1.5, br * 0.12); g.beginPath(); g.arc(0, 0, br, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.arc(-br * 0.35, -br * 0.35, br * 0.18, 0, 7); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill(); }
            else if (c.fx === 'sparkle') { var sr2 = sz * (0.7 + al * 0.8); g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,240,170,0.25)'; g.beginPath(); g.arc(0, 0, sr2 * 0.9, 0, 7); g.fill(); g.fillStyle = '#fff6c4'; g.beginPath(); for (var q = 0; q < 8; q++) { var ra = q % 2 ? sr2 * 0.22 : sr2, an = q * Math.PI / 4 - Math.PI / 2; g.lineTo(Math.cos(an) * ra, Math.sin(an) * ra); } g.closePath(); g.fill(); }
            else if (c.fx === 'stars') { g.fillStyle = sd > 0.5 ? '#ffd23f' : '#fff4a3'; g.font = '700 ' + Math.round(sz * 1.7) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('\u2605', 0, 0); }
            else { g.rotate(age * 6 + sd * 6); g.fillStyle = ['#ff4d6d', '#ffd23f', '#4dd2ff', '#7dff6b', '#c77dff'][j % 5]; g.fillRect(-sz / 3, -sz / 6, sz * 0.66, sz * 0.33); }
            g.restore();
          }
        }
      }
      /* реплика */
      if (c.say) {
        var fs2 = Math.round(Math.min(W, H) * 0.04 * (c.sayS || 1)); g.save();
        g.font = '700 ' + fs2 + 'px Inter, "Space Grotesk", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        var lines2 = wrapText(c.say, W * 0.5), lh2 = fs2 * 1.2, wmax = 0; lines2.forEach(function (l) { wmax = Math.max(wmax, g.measureText(l).width); });
        var bw2 = wmax + fs2 * 1.1, bh2 = lines2.length * lh2 + fs2 * 0.8, bxc = Math.max(bw2 / 2 + 6, Math.min(W - bw2 / 2 - 6, bx.cx + offX)), byb = Math.max(bh2 + fs2 * 0.9, bx.cy + offY - bx.h / 2 - hop - fs2 * 0.3);
        var sc2 = 1 + 0.04 * kick * (c.anim === 'none' ? 0 : 1); g.translate(bxc, byb); g.scale(sc2 * pop, sc2 * pop);
        g.fillStyle = '#fff'; g.strokeStyle = '#222'; g.lineWidth = Math.max(2, fs2 * 0.1); g.beginPath();
        if (g.roundRect) g.roundRect(-bw2 / 2, -bh2 - fs2 * 0.5, bw2, bh2, fs2 * 0.6); else g.rect(-bw2 / 2, -bh2 - fs2 * 0.5, bw2, bh2);
        g.fill(); g.stroke();
        g.beginPath(); g.moveTo(-fs2 * 0.4, -fs2 * 0.52); g.lineTo(0, 0); g.lineTo(fs2 * 0.4, -fs2 * 0.52); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.fillRect(-fs2 * 0.36, -fs2 * 0.56, fs2 * 0.72, fs2 * 0.1);
        g.fillStyle = '#111'; lines2.forEach(function (l, i) { g.fillText(l, 0, -bh2 - fs2 * 0.5 + fs2 * 0.4 + lh2 * (i + 0.5)); });
        g.restore();
      }
      if (ci === selC && !exporting && tab === 'chars' && c.mouth && c.mouth.on) {
        var mm = c.mouth, ox = bx.cx + (c.flip ? -1 : 1) * (mm.x - 0.5) * bx.w + offX, oy = bx.cy - bx.h / 2 + mm.y * bx.h + offY - hop;
        g.save(); g.strokeStyle = accent(); g.lineWidth = 2; g.beginPath(); g.arc(ox, oy, Math.max(6, mm.s * bx.w * 0.8), 0, 7); g.stroke(); g.restore();
      }
      if (ci === selC && !exporting && tab === 'chars') {
        g.save(); g.strokeStyle = accent(); g.lineWidth = Math.max(2, W / 240); g.setLineDash([W / 60, W / 90]);
        g.strokeRect(bx.cx - bx.w / 2, bx.cy - bx.h / 2, bx.w, bx.h); g.restore();
      }
    });
  }
  function canvasXY(e) { var r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; }
  function hitChar(x, y) {
    for (var i = chars.length - 1; i >= 0; i--) { var c = chars[i]; if (!c.img) continue; var b = charBox(c); if (Math.abs(x - b.cx) <= b.w / 2 && Math.abs(y - b.cy) <= b.h / 2) return i; }
    return -1;
  }
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', function (e) {
    if (!chars.length || tab !== 'chars') return;
    var p = canvasXY(e), i = hitChar(p[0], p[1]);
    if (placing && selC >= 0 && chars[selC]) {
      var pc = chars[selC], pb = charBox(pc);
      if (Math.abs(p[0] - pb.cx) <= pb.w / 2 && Math.abs(p[1] - pb.cy) <= pb.h / 2) {
        var fx = (p[0] - (pb.cx - pb.w / 2)) / pb.w; if (pc.flip) fx = 1 - fx;
        pc.mouth.x = clamp(fx, 0, 1); pc.mouth.y = clamp((p[1] - (pb.cy - pb.h / 2)) / pb.h, 0, 1); pc.mouth.on = true; placing = false;
        saveProject(); paintPane(); if (!playing) draw(); e.preventDefault(); return;
      }
    }
    if (i < 0) return;
    selC = i; drag = { i: i, dx: chars[i].x * W - p[0], dy: chars[i].y * H - p[1] };
    try { cv.setPointerCapture(e.pointerId); } catch (er) {}
    e.preventDefault(); paintPane();
  });
  cv.addEventListener('pointermove', function (e) {
    if (!drag) return; var p = canvasXY(e), c = chars[drag.i];
    c.x = clamp((p[0] + drag.dx) / W, 0, 1); c.y = clamp((p[1] + drag.dy) / H, 0, 1); if (!playing) draw();
  });
  function endDrag() { if (drag) { drag = null; saveProject(); } }
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

  function mkChar(canvas, bid, m) {
    var c = { bid: bid, cv: canvas, img: canvas, x: 0.5, y: 0.7, size: 0.3, anim: 'dance', amt: 1, flip: false, t0: 0, t1: 0, enter: 'pop', exit: 'fade', react: false, fx: 'none', say: '', sayS: 1, mouth: { on: false, x: 0.5, y: 0.16, s: 0.12 }, blend: Object.assign({}, BLEND_DEF) };
    if (m && m.blend) c.blend = Object.assign(c.blend, m.blend);
    if (m) { c.t0 = m.t0 || 0; c.t1 = m.t1 || 0; c.enter = m.enter || 'pop'; c.exit = m.exit || 'fade'; c.react = !!m.react; c.fx = m.fx || 'none'; c.say = m.say || ''; c.sayS = m.sayS || 1; if (m.mouth) c.mouth = m.mouth; c.x = m.x; c.y = m.y; c.size = m.size; c.grow = m.grow || 1; c.anim = m.anim; c.amt = m.amt; c.flip = !!m.flip; c.behind = !!m.behind; }
    return c;
  }
  function addChars(list) {
    var n = list.length, i;
    list.forEach(function (cd, k) {
      var c = mkChar(cd.cv, 'ch' + Date.now().toString(36) + (uid++));
      var asp = cd.cv.width / cd.cv.height;
      c.size = Math.min(0.34, (1.6 / n) / asp * (W / H)); c.size = Math.max(0.12, c.size);
      c.x = n === 1 ? 0.5 : (k + 0.5) / n; c.y = 0.95 - c.size / 2 - 0.03; if (cd.kind === 'sheet') { c.size = 0.5; c.y = 0.5; c.x = 0.5; c.anim = 'sway'; }
      c.anim = cd.kind === 'sheet' ? 'sway' : cd.kind === 'person' ? 'party' : 'dance';
      c.blob = null; c.full = cd.full || null; if (cd.kind === 'person') { c.size = n === 1 ? 0.5 : Math.min(0.45, c.size * 1.3); c.y = 0.95 - c.size / 2 - 0.03; } chars.push(c);
      cd.cv.toBlob(function (bl) { c.blob = bl; saveProject(true); }, 'image/png');
    });
    selC = chars.length - 1; tab = 'chars'; paintTabs(); paintPane(); if (!playing) draw();
    toast('Героев добавлено: ' + n + '. Двигай их пальцем по кадру');
  }
  var scanRes = null, scanImg = null;
  function openScan(how, mode) {
    scanMode = mode || 'draw';
    var i = $(how === 'cam' ? '#edScanCam' : '#edScanFile'); i.value = ''; i.click();
  }
  function addCandBtn(c, front) {
    var box = $('#edScanList'), b = el('button', 'sc-c' + (c.sel ? ' on' : '')); b.type = 'button';
    var th = document.createElement('canvas'); th.width = c.cv.width; th.height = c.cv.height; th.getContext('2d').drawImage(c.cv, 0, 0); b.appendChild(th);
    b.appendChild(el('i', '', c.kind === 'sheet' ? 'лист' : c.kind === 'text' ? 'надпись' : c.kind === 'person' ? '🧍' : '✓'));
    b.addEventListener('click', function () { c.sel = !c.sel; b.classList.toggle('on', c.sel); });
    if (front && box.firstChild) box.insertBefore(b, box.firstChild); else box.appendChild(b);
  }
  $('#edScanPerson').addEventListener('click', function () {
    if (!scanImg || !window.Person) return; var info = $('#edScanInfo'), btn = this; btn.disabled = true;
    info.textContent = 'Вырезаю человека… в первый раз скачается модель (около 37 МБ), потом всё работает без интернета. Это может занять до минуты.';
    window.Person.onStatus = function (t) { if (t) info.textContent = t; };
    window.Person.cut(scanImg).then(function (res) {
      btn.disabled = false; window.Person.onStatus = null;
      var cd = { cv: res.cv, full: res.full, kind: 'person', sel: true, sheet: 0, w: res.cv.width, h: res.cv.height };
      if (!scanRes) scanRes = { cands: [] }; scanRes.cands.unshift(cd); addCandBtn(cd, true); $('#edScanAdd').hidden = false;
      info.textContent = 'Человек вырезан. Края можно подчистить потом кнопкой «Подчистить» у героя.' + (window.Person.lastEngine === 'selfie' ? ' Точная модель не загрузилась (нужен интернет в первый раз), поэтому вырезка простая: попробуй ещё раз при интернете.' : '');
    }, function (e) {
      btn.disabled = false; window.Person.onStatus = null;
      info.textContent = (e && e.message === 'nobody') ? 'Человека на фото не нашёл. Попробуй снять крупнее и при хорошем свете.' : 'Не получилось загрузить вырезку человека (нужен интернет в первый раз). Рисунки вырезаются и без неё.';
    });
  });
  function onScanPick() { var f = this.files && this.files[0]; if (f) scanFile(f); }
  var scanMode = 'draw';
  function scanFile(f) {
    var box = $('#edScanList'), info = $('#edScanInfo'); box.textContent = ''; info.textContent = 'Ищу героев на рисунке…';
    $('#edScan').hidden = false; $('#edScanAdd').hidden = true;
    var url = URL.createObjectURL(f), im = new Image();
    im.onload = function () {
      setTimeout(function () {
        if (scanMode === 'person') { scanImg = im; scanRes = { cands: [] }; $('#edScanPerson').hidden = false; info.textContent = 'Вырезаю человека…'; $('#edScanPerson').click(); return; }
        var r; try { r = window.Scan.find(im); } catch (e) { r = null; }
        scanImg = im; $('#edScanPerson').hidden = false;
        if (!r || !r.cands.length) { info.textContent = 'Рисунок не нашёл. Если это обычное фото человека, нажми «Вырезать человека». Для рисунка снимай на светлом листе при хорошем свете.'; scanRes = { cands: [] }; return; }
        scanRes = r;
        info.textContent = 'Если на фото человек (не рисунок) — нажми зелёную кнопку «Вырезать» ниже. Для рисунка на листе: нашёл героев: ' + r.cands.filter(function (c) { return c.kind === 'figure'; }).length + '. Нажми, чтобы снять или поставить галочку. «Лист» — весь лист как картинка.';
        r.cands.forEach(addCandBtn);
        $('#edScanAdd').hidden = false;
      }, 30);
    };
    im.onerror = function () { info.textContent = 'Не получилось открыть фото'; };
    im.src = url;
  }
  /* своя камера: на Android выбор файла камеру не даёт, поэтому снимаем прямо в приложении */
  var camStream = null, camFace = 'environment', camMode = 'scan';
  function stopCam() { if (camStream) { camStream.getTracks().forEach(function (tr) { tr.stop(); }); camStream = null; } $('#edCamV').srcObject = null; }
  function startCam() {
    stopCam(); var info = $('#edCamInfo'); info.textContent = 'Включаю камеру…';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { info.textContent = 'Камера в этом окне недоступна. Используй «Из галереи».'; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: camFace }, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false }).then(function (st) {
      if ($('#edCam').hidden) { st.getTracks().forEach(function (tr) { tr.stop(); }); return; }
      camStream = st; var v = $('#edCamV'); v.srcObject = st; v.play().catch(function () {});
      info.textContent = camMode === 'person' ? 'Сними человека целиком, лучше на спокойном фоне при хорошем свете.' : camMode === 'vid' ? 'Встань так, чтобы тебя было видно целиком, и подвигайся: потанцуй, помаши рукой. Запись 5 секунд.' : camMode === 'scan' ? 'Положи рисунок на ровную поверхность при хорошем свете, чтобы лист был виден целиком.' : 'Снимок добавится в ролик как фото.';
    }, function (e) {
      info.textContent = (e && e.name === 'NotAllowedError') ? 'Нет доступа к камере. Разреши камеру для приложения в настройках телефона (Приложения → Моя музыка → Разрешения) и нажми «Другая камера».' : 'Не удалось включить камеру (' + (e && e.name || 'ошибка') + '). Можно снять в обычной камере и выбрать «Из галереи».';
    });
  }
  function openCam(mode) { camMode = mode; $('#edCam').hidden = false; $('#edCamShot').hidden = mode === 'vid'; $('#edCamRec').hidden = mode !== 'vid'; startCam(); }
  function closeCam() { stopCam(); $('#edCam').hidden = true; }
  $('#edCamClose').addEventListener('click', closeCam);
  $('#edCamFlip').addEventListener('click', function () { camFace = camFace === 'environment' ? 'user' : 'environment'; startCam(); });
  $('#edCamShot').addEventListener('click', function () {
    var v = $('#edCamV'); if (!camStream || !v.videoWidth) { toast('Камера ещё не готова'); return; }
    var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    var mode = camMode;
    c.toBlob(function (bl) {
      if (!bl) { toast('Не получилось сохранить снимок'); return; }
      var f = new File([bl], 'camera-' + Date.now() + '.jpg', { type: 'image/jpeg' });
      closeCam();
      if (mode === 'scan' || mode === 'person') { scanMode = mode === 'person' ? 'person' : 'draw'; scanFile(f); } else { addFiles([f]); toast('Фото добавлено в ролик'); }
    }, 'image/jpeg', 0.92);
  });
  $('#edScanFile').addEventListener('change', onScanPick); $('#edScanCam').addEventListener('change', onScanPick);
  $('#edScanAdd').addEventListener('click', function () {
    var pick = scanRes ? scanRes.cands.filter(function (c) { return c.sel; }) : [];
    if (!pick.length) { toast('Отметь хотя бы одного героя'); return; }
    $('#edScan').hidden = true; addChars(pick);
  });
  $('#edScanClose').addEventListener('click', function () { $('#edScan').hidden = true; });

  /* ---------- подчистка героя: ластик, возврат, палочка ---------- */
  var br = { c: null, mode: 'erase', size: 0.05, tol: 40, stack: [], last: null };
  function brSnap() { var cc = br.c.cv; br.stack.push(cc.getContext('2d').getImageData(0, 0, cc.width, cc.height)); if (br.stack.length > 8) br.stack.shift(); }
  function brPos(e) { var cc = br.c.cv, r = cc.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * cc.width, (e.clientY - r.top) / r.height * cc.height]; }
  function brDab(x, y) {
    var cc = br.c.cv, gx = cc.getContext('2d'), rad = Math.max(3, br.size * cc.width / 2);
    if (br.mode === 'erase') { gx.save(); gx.globalCompositeOperation = 'destination-out'; gx.beginPath(); gx.arc(x, y, rad, 0, 7); gx.fill(); gx.restore(); }
    else if (br.mode === 'restore' && br.c.full) { gx.save(); gx.beginPath(); gx.arc(x, y, rad, 0, 7); gx.clip(); gx.drawImage(br.c.full, 0, 0, cc.width, cc.height); gx.restore(); }
  }
  function brWand(x, y) {
    var cc = br.c.cv, gx = cc.getContext('2d', { willReadFrequently: true }), w = cc.width, h = cc.height, im = gx.getImageData(0, 0, w, h), d = im.data;
    var fu = br.c.full ? br.c.full.getContext('2d').getImageData(0, 0, w, h).data : d, xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
    var p0 = (yi * w + xi) * 4, r0 = fu[p0], g0 = fu[p0 + 1], b0 = fu[p0 + 2], tol2 = br.tol * br.tol * 3, seen = new Uint8Array(w * h), st = [yi * w + xi]; seen[yi * w + xi] = 1;
    while (st.length) {
      var q = st.pop(), qx = q % w, qy = (q - qx) / w, o = q * 4, dr = fu[o] - r0, dg = fu[o + 1] - g0, db = fu[o + 2] - b0;
      if (dr * dr + dg * dg + db * db > tol2) continue; d[o + 3] = 0;
      if (qx > 0 && !seen[q - 1]) { seen[q - 1] = 1; st.push(q - 1); } if (qx < w - 1 && !seen[q + 1]) { seen[q + 1] = 1; st.push(q + 1); }
      if (qy > 0 && !seen[q - w]) { seen[q - w] = 1; st.push(q - w); } if (qy < h - 1 && !seen[q + w]) { seen[q + w] = 1; st.push(q + w); }
    }
    gx.putImageData(im, 0, 0);
  }
  function brModes() {
    var m = $('#edBrushModes'); m.textContent = '';
    [['erase', 'Стереть'], ['restore', 'Вернуть'], ['wand', 'Палочка']].forEach(function (a) {
      var b = el('button', 'chip' + (br.mode === a[0] ? ' on' : ''), a[1]); b.type = 'button';
      b.addEventListener('click', function () { br.mode = a[0]; brModes(); }); m.appendChild(b);
    });
    var u = el('button', 'chip', '↶ Отмена'); u.type = 'button'; u.addEventListener('click', function () { var s2 = br.stack.pop(); if (s2) { br.c.cv.getContext('2d').putImageData(s2, 0, 0); if (!playing) draw(); } }); m.appendChild(u);
    var ctl = $('#edBrushCtl'); ctl.textContent = '';
    if (br.mode === 'wand') ctl.appendChild(slider('Допуск', 8, 90, 1, br.tol, function (v) { return String(Math.round(v)); }, function (v) { br.tol = v; }));
    else ctl.appendChild(slider('Кисть', 0.01, 0.2, 0.005, br.size, function (v) { return Math.round(v * 100) + '%'; }, function (v) { br.size = v; }));
    if (br.mode === 'restore' && !br.c.full) ctl.appendChild(el('div', 'ed-hint', 'Вернуть можно только в этой сессии: исходник не сохраняется после перезапуска.'));
  }
  function openBrush(c) {
    br.c = c; br.stack = []; var box = $('#edBrushBox'); box.textContent = ''; box.appendChild(c.cv);
    c.cv.style.cssText = 'max-width:100%;max-height:48vh;touch-action:none;display:block'; br.mode = 'erase'; brModes(); $('#edBrush').hidden = false;
    var down = false;
    c.cv.onpointerdown = function (e) { e.preventDefault(); brSnap(); down = true; try { c.cv.setPointerCapture(e.pointerId); } catch (er) {} var p = brPos(e); br.last = p; if (br.mode === 'wand') { brWand(p[0], p[1]); down = false; } else brDab(p[0], p[1]); if (!playing) draw(); };
    c.cv.onpointermove = function (e) {
      if (!down) return; var p = brPos(e), l = br.last || p, dist = Math.hypot(p[0] - l[0], p[1] - l[1]), step = Math.max(2, br.size * c.cv.width / 4), n = Math.max(1, Math.ceil(dist / step));
      for (var i = 1; i <= n; i++) brDab(l[0] + (p[0] - l[0]) * i / n, l[1] + (p[1] - l[1]) * i / n); br.last = p; if (!playing) draw();
    };
    c.cv.onpointerup = c.cv.onpointercancel = function () { down = false; };
  }
  function closeBrush() {
    var c = br.c; if (!c) { $('#edBrush').hidden = true; return; }
    c.cv.onpointerdown = c.cv.onpointermove = c.cv.onpointerup = c.cv.onpointercancel = null; c.cv.style.cssText = '';
    $('#edBrushBox').textContent = ''; $('#edBrush').hidden = true; br.c = null;
    c.cv.toBlob(function (bl) { c.blob = bl; saveProject(true); }, 'image/png'); paintPane(); if (!playing) draw();
  }
  $('#edBrushDone').addEventListener('click', closeBrush);

  /* ---------- герой из видео: вырезка кадр за кадром ---------- */
  var proc = { cancel: false };
  function pbar(i, n, txt) { $('#edProcBar').style.width = (n ? i / n * 100 : 0).toFixed(1) + '%'; $('#edProcInfo').textContent = txt || ('Кадр ' + i + ' из ' + n); }
  function seekTo(v, tm) { return new Promise(function (ok) { var done = false; function fin() { if (!done) { done = true; v.removeEventListener('seeked', fin); ok(); } } v.addEventListener('seeked', fin); v.currentTime = tm; setTimeout(fin, 3000); }); }

  /* ---------- герой за людьми в клипе: маски людей по кадрам клипа ---------- */
  var pm = {}, mskC = document.createElement('canvas'), mskG = mskC.getContext('2d'), frC = document.createElement('canvas'), frG = frC.getContext('2d'), mkc = document.createElement('canvas'), mkg = mkc.getContext('2d'), mkKey = '';
  var PM_FPS = 10, PM_MAXS = 60;
  function maskClipFor(c) {
    var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', ''); v.src = c.url;
    return new Promise(function (ok, bad) { v.onloadedmetadata = ok; v.onerror = function () { bad(new Error('video')); }; setTimeout(function () { bad(new Error('video')); }, 15000); }).then(function () {
      var vw = v.videoWidth, vh = v.videoHeight, k = 256 / Math.max(vw, vh), w = Math.max(16, Math.round(vw * k)), h = Math.max(16, Math.round(vh * k));
      var dur = Math.min(isFinite(v.duration) ? v.duration : c.src, PM_MAXS), n = Math.max(1, Math.floor(dur * PM_FPS)), frames = [], prev = null, i = 0;
      var cs = document.createElement('canvas'); cs.width = w; cs.height = h; var cg = cs.getContext('2d', { willReadFrequently: true });
      return window.Person.ready().then(function step() {
        if (proc.cancel) throw new Error('cancel');
        if (i >= n) return;
        return seekTo(v, i / PM_FPS).then(function () {
          cg.drawImage(v, 0, 0, w, h);
          return window.Person.maskOnly(cs);
        }).then(function (m) {
          if (prev) for (var q = 0; q < m.length; q++) m[q] = (m[q] * 0.6 + prev[q] * 0.4) | 0;
          prev = m; frames.push(m); i++;
          if (i % 3 === 0 || i === n) pbar(i, n, 'Маска людей: кадр ' + i + ' из ' + n);
          return step();
        });
      }).then(function () { pm[c.bid] = { fps: PM_FPS, n: n, w: w, h: h, frames: frames }; try { v.removeAttribute('src'); v.load(); } catch (e) {} });
    });
  }
  function needMasks() {
    var seen = {}, out = [];
    clips.forEach(function (c) { if (c.kind === 'video' && c.url && !pm[c.bid] && !seen[c.bid]) { seen[c.bid] = 1; out.push(c); } });
    return out;
  }
  function enableBehind(c) {
    if (!clips.some(function (x) { return x.kind === 'video'; })) { toast('Нужен видеоклип с людьми'); return; }
    var need = needMasks();
    if (!need.length) { c.behind = true; saveProject(true); paintPane(); if (!playing) draw(); return; }
    proc.cancel = false; pause();
    var st = $('#edProc strong'), oldT = st ? st.textContent : ''; if (st) st.textContent = 'Ищу людей в клипе';
    $('#edProc').hidden = false; pbar(0, 1, 'Загружаю модель…');
    need.reduce(function (pr, cl) { return pr.then(function () { return maskClipFor(cl); }); }, Promise.resolve()).then(function () {
      c.behind = true; saveProject(true); toast('Готово: люди из клипа закрывают героя');
    }).catch(function (e) { toast(e && e.message === 'cancel' ? 'Отменено' : 'Не получилось найти людей в клипе'); }).then(function () {
      if (st) st.textContent = oldT; $('#edProc').hidden = true; paintPane(); if (!playing) draw();
    });
  }
  function drawOcclusion() {
    if (!chars.length || !chars.some(function (x) { return x.behind; })) return;
    var i = indexAt(t), cl = clips[i]; if (!cl || cl.kind !== 'video' || trAt(i)) return;
    var m = pm[cl.bid]; if (!m) return;
    var fi = Math.floor((cl.inp + (t - cl.start)) * m.fps), fr = m.frames[fi]; if (!fr) return;
    var key = cl.bid + ':' + fi;
    if (mkc.width !== m.w || mkc.height !== m.h) { mkc.width = m.w; mkc.height = m.h; mkKey = ''; }
    if (key !== mkKey) {
      var id = mkg.createImageData(m.w, m.h), d = id.data, q, N = m.w * m.h;
      for (q = 0; q < N; q++) { d[q * 4] = 255; d[q * 4 + 1] = 255; d[q * 4 + 2] = 255; d[q * 4 + 3] = fr[q]; }
      mkg.putImageData(id, 0, 0); mkKey = key;
    }
    if (mskC.width !== W || mskC.height !== H) { mskC.width = W; mskC.height = H; frC.width = W; frC.height = H; }
    var sv = g;
    mskG.clearRect(0, 0, W, H); g = mskG; drawClip(cl, i, prog(cl), 1, 0, 0, mkc);
    frG.globalCompositeOperation = 'source-over'; frG.clearRect(0, 0, W, H); g = frG; drawClip(cl, i, prog(cl), 1, 0);
    g = sv;
    frG.globalCompositeOperation = 'destination-in'; frG.drawImage(mskC, 0, 0); frG.globalCompositeOperation = 'source-over';
    g.drawImage(frC, 0, 0);
  }
  function makeVideoHero(n, getRaw) {
    proc.cancel = false; $('#edProc').hidden = false; pbar(0, n, 'Загружаю модель вырезки (первый раз ~37 МБ, нужен интернет)…'); window.Person.onStatus = function (t) { if (t) $('#edProcInfo').textContent = t; };
    var frames = [], prev = null, i = 0;
    return window.Person.warm().then(function step() {
      if (proc.cancel) throw new Error('cancel');
      if (i >= n) return;
      return getRaw(i).then(function (raw) { window.Person.onStatus = null; return window.Person.frameBest(raw, prev); }).then(function (r) { prev = r.alpha; frames.push(r.cv); i++; pbar(i, n); return step(); });
    }).then(function () {
      /* общая рамка по всем кадрам, чтобы герой не дёргался */
      var w = frames[0].width, h = frames[0].height, x0 = w, y0 = h, x1 = 0, y1 = 0, colC = new Int32Array(w), rowC = new Int32Array(h);
      frames.forEach(function (f) { var d = f.getContext('2d').getImageData(0, 0, w, h).data, x, y; for (y = 0; y < h; y += 2) for (x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 140) { colC[x]++; rowC[y]++; } });
      var cm = Math.max.apply(null, colC), rm2 = Math.max.apply(null, rowC), ct = Math.max(3, cm * 0.04), rt = Math.max(3, rm2 * 0.04), k2;
      for (k2 = 0; k2 < w; k2++) if (colC[k2] >= ct) { if (k2 < x0) x0 = k2; if (k2 > x1) x1 = k2; }
      for (k2 = 0; k2 < h; k2++) if (rowC[k2] >= rt) { if (k2 < y0) y0 = k2; if (k2 > y1) y1 = k2; }
      if (x1 <= x0 || y1 <= y0) throw new Error('nobody');
      x0 = Math.max(0, x0 - 6); y0 = Math.max(0, y0 - 6); x1 = Math.min(w - 1, x1 + 6); y1 = Math.min(h - 1, y1 + 6);
      var cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      var out = frames.map(function (f) { var cc = document.createElement('canvas'); cc.width = cw; cc.height = ch; cc.getContext('2d').drawImage(f, x0, y0, cw, ch, 0, 0, cw, ch); return cc; });
      var c = mkChar(out[0], 'chv' + Date.now().toString(36) + (uid++));
      c.frames = out; c.fps = 12; c.img = out[0]; c.blend = { on: true, col: 0.3, shd: 0.5, soft: 0.15, grain: 0.35, light: 0.35, refl: 0, wrap: 0.4 }; c.anim = 'none'; c.size = 0.5; c.x = 0.5; c.y = 0.95 - c.size / 2 - 0.03; c.fb = [];
      chars.push(c); selC = chars.length - 1; tab = 'chars';
      out.reduce(function (pr, cc, k) { return pr.then(function () { return new Promise(function (ok) { cc.toBlob(function (bl) { c.fb[k] = bl; ok(); }, 'image/png'); }); }); }, Promise.resolve()).then(function () { saveProject(true); });
      $('#edProc').hidden = true; paintTabs(); paintPane(); if (!playing) draw(); toast('Герой готов. Двигай и увеличивай его, он двигается как в видео');
    }).catch(function (e) {
      $('#edProc').hidden = true; window.Person.onStatus = null;
      toast(e && e.message === 'cancel' ? 'Отменено' : e && e.message === 'nobody' ? 'Человека в видео не нашёл' : 'Не получилось вырезать (нужен интернет для первой загрузки модели)');
    });
  }
  function rawFromVideoFile(f) {
    var url = URL.createObjectURL(f), v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    return new Promise(function (ok, bad) { v.onloadedmetadata = ok; v.onerror = function () { bad(); }; }).then(function () {
      var dur = Math.min(isFinite(v.duration) ? v.duration : 5, 6), n = Math.max(2, Math.floor(dur * 12)), sc = Math.min(1, 480 / v.videoHeight), w = Math.round(v.videoWidth * sc), h = Math.round(v.videoHeight * sc);
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var g2 = cv.getContext('2d');
      return makeVideoHero(n, function (i) { return seekTo(v, i / 12).then(function () { var c2 = document.createElement('canvas'); c2.width = w; c2.height = h; c2.getContext('2d').drawImage(v, 0, 0, w, h); return c2; }); }).then(function () { URL.revokeObjectURL(url); });
    }, function () { toast('Не получилось открыть видео'); });
  }
  $('#edVidFile').addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) rawFromVideoFile(f); });
  $('#edProcCancel').addEventListener('click', function () { proc.cancel = true; });
  var recT = null;
  $('#edCamRec').addEventListener('click', function () {
    var v = $('#edCamV'); if (!camStream || !v.videoWidth) { toast('Камера ещё не готова'); return; }
    var sc = Math.min(1, 480 / v.videoHeight), w = Math.round(v.videoWidth * sc), h = Math.round(v.videoHeight * sc), raws = [], btn = this, left = 5;
    btn.disabled = true; btn.textContent = '● Идёт запись…';
    var iv = setInterval(function () { var c2 = document.createElement('canvas'); c2.width = w; c2.height = h; c2.getContext('2d').drawImage(v, 0, 0, w, h); raws.push(c2); if (raws.length % 12 === 0) { left--; btn.textContent = '● Идёт запись… ' + left; } if (raws.length >= 60) { clearInterval(iv); btn.disabled = false; btn.textContent = '● Записать 5 с'; closeCam(); makeVideoHero(raws.length, function (i) { return Promise.resolve(raws[i]); }); } }, 1000 / 12);
  });

  function paneChars(p) {
    p.appendChild(chipRow([{ label: '📷 Рисунок: камера', on: true, fn: function () { openCam('scan'); } }, { label: '🖼 Рисунок: галерея', fn: function () { openScan('gal'); } }], 'Рисунок'));
    p.appendChild(chipRow([{ label: '🧍 Человек из фото: камера', on: true, fn: function () { openCam('person'); } }, { label: '🧍 из галереи', fn: function () { openScan('gal', 'person'); } }], 'Человек'));
    p.appendChild(chipRow([{ label: '🎬 Герой из видео: записать', on: true, fn: function () { openCam('vid'); } }, { label: '📁 из файла', fn: function () { $('#edVidFile').click(); } }]));
    if (!chars.length) { p.appendChild(el('div', 'ed-hint', 'Сними рисунок на светлом листе (можно сразу два листа в кадре) — герои вырежутся сами и оживут в ролике поверх фото и видео. Они пляшут в такт выбранной музыки.')); return; }
    var c = chars[selC] || chars[0]; if (!chars[selC]) selC = 0;
    p.appendChild(el('div', 'ed-hint', beatText()));
    var tl = el('div', 'ed-tl'); tl.style.padding = '2px 0';
    chars.forEach(function (ch, i) {
      var b = el('button', 'cl' + (i === selC ? ' on' : '')); b.type = 'button'; b.style.width = '56px'; b.style.height = '56px'; b.style.background = '#2a2d34';
      var th = document.createElement('canvas'); th.width = ch.cv.width; th.height = ch.cv.height; th.style.cssText = 'width:100%;height:100%;object-fit:contain'; th.getContext('2d').drawImage(ch.cv, 0, 0); b.appendChild(th);
      b.addEventListener('click', function () { selC = i; paintPane(); if (!playing) draw(); }); tl.appendChild(b);
    });
    p.appendChild(tl);
    p.appendChild(chipRow(ANIMS.map(function (a) { return { label: a[1], on: c.anim === a[0], fn: function () { c.anim = a[0]; saveProject(); paintPane(); } }; }), 'Движение'));
    p.appendChild(slider('Сила', 0.2, 2, 0.1, c.amt, function (v) { return f1(v) + '×'; }, function (v) { c.amt = v; saveProject(); }));
    p.appendChild(slider('Размер', 0.08, 0.9, 0.01, c.size, function (v) { return Math.round(v * 100) + '%'; }, function (v) { c.size = v; saveProject(); if (!playing) draw(); }));
    p.appendChild(slider('Рост к концу', 0.3, 4, 0.05, c.grow || 1, function (v) { return Math.abs(v - 1) < 0.03 ? 'нет' : (v > 1 ? '↑ ' : '↓ ') + f1(v > 1 ? v : 1 / v) + '×'; }, function (v) { c.grow = Math.abs(v - 1) < 0.03 ? 1 : v; saveProject(); if (!playing) draw(); }));
    var tmax = Math.max(1, Math.round(total * 10) / 10);
    p.appendChild(slider('Появится', 0, tmax, 0.1, Math.min(c.t0, tmax), function (v) { return fmt(v); }, function (v) { c.t0 = v; if (c.t1 > 0 && c.t1 <= v) c.t1 = 0; saveProject(); if (!playing) draw(); }));
    p.appendChild(slider('Исчезнет', 0, tmax, 0.1, Math.min(c.t1, tmax), function (v) { return v < 0.05 ? 'в конце' : fmt(v); }, function (v) { c.t1 = v < 0.05 ? 0 : Math.max(v, c.t0 + 0.5); saveProject(); if (!playing) draw(); }));
    p.appendChild(chipRow([
      { label: 'Появится сейчас', fn: function () { c.t0 = t; if (c.t1 > 0 && c.t1 <= t) c.t1 = 0; saveProject(); paintPane(); if (!playing) draw(); } },
      { label: 'Исчезнет сейчас', fn: function () { c.t1 = Math.max(t, c.t0 + 0.5); saveProject(); paintPane(); if (!playing) draw(); } },
      { label: 'Весь ролик', fn: function () { c.t0 = 0; c.t1 = 0; saveProject(); paintPane(); if (!playing) draw(); } }
    ]));
    p.appendChild(chipRow([['pop', 'Выскочит'], ['left', 'Слева'], ['right', 'Справа'], ['top', 'Сверху']].map(function (a) { return { label: a[1], on: (c.enter || 'pop') === a[0], fn: function () { c.enter = a[0]; saveProject(); paintPane(); if (!playing) draw(); } }; }), 'Вход'));
    p.appendChild(chipRow([['fade', 'Исчезнет'], ['left', 'Уйдёт влево'], ['right', 'Уйдёт вправо'], ['down', 'Уйдёт вниз']].map(function (a) { return { label: a[1], on: (c.exit || 'fade') === a[0], fn: function () { c.exit = a[0]; saveProject(); paintPane(); if (!playing) draw(); } }; }), 'Уход'));
    p.appendChild(chipRow([{ label: 'Прыгает на каждое новое фото', on: !!c.react, fn: function () { c.react = !c.react; saveProject(); paintPane(); } }], 'Реакция'));
    var lost = c.behind && needMasks().length > 0;
    p.appendChild(chipRow([{ label: lost ? 'Пересчитать маску людей' : (c.behind ? 'За людьми в клипе: вкл' : 'За людьми в клипе: выкл'), on: !!c.behind && !lost, fn: function () { if (c.behind && !lost) { c.behind = false; saveProject(true); paintPane(); if (!playing) draw(); } else enableBehind(c); } }], 'Глубина'));
    if (lost) p.appendChild(el('div', 'ed-hint', 'После перезапуска маски людей пропали: нажми «Пересчитать маску людей» (1–2 минуты на 30 секунд клипа).'));
    else if (!c.behind) p.appendChild(el('div', 'ed-hint', '«За людьми в клипе»: телефон найдёт людей в видеоклипе, и они закроют героя, будто он стоит позади них. Считается один раз на каждый клип, примерно минута на 30 секунд видео.'));
    p.appendChild(chipRow([['none', 'Нет'], ['hearts', 'Сердечки'], ['stars', 'Звёздочки'], ['confetti', 'Конфетти'], ['notes', 'Ноты'], ['bubbles', 'Пузыри'], ['sparkle', 'Блёстки'], ['aura', 'Аура']].map(function (a) { return { label: a[1], on: (c.fx || 'none') === a[0], fn: function () { c.fx = a[0]; saveProject(); paintPane(); } }; }), 'Эффект'));
    var bl = c.blend, blSet = function (o) { Object.keys(o).forEach(function (k) { bl[k] = o[k]; }); bl.on = true; saveProject(); paintPane(); if (!playing) draw(); };
    p.appendChild(chipRow([
      { label: bl.on ? 'Вжиться в кадр: вкл' : 'Вжиться в кадр: выкл', on: bl.on, fn: function () { bl.on = !bl.on; saveProject(); paintPane(); if (!playing) draw(); } },
      { label: 'Естественно', fn: function () { blSet({ col: 0.5, shd: 0.6, soft: 0.25, light: 0.5, wrap: 0.5 }); glue.bloom = 0.5; glue.grain = 0.5; glue.vig = 0.35; glue.on = true; } },
      { label: 'Сильнее', fn: function () { blSet({ col: 0.8, shd: 0.85, soft: 0.45, light: 0.75, wrap: 0.85, refl: 0.3 }); glue.bloom = 0.8; glue.grain = 0.75; glue.vig = 0.5; glue.on = true; } }
    ], 'Вжиться'));
    if (!HASF) p.appendChild(el('div', 'ed-hint', 'В этом браузере не работают фильтры холста, поэтому вживление недоступно.'));
    else if (bl.on) {
      var pct = function (v) { return Math.round(v * 100) + '%'; };
      p.appendChild(slider('Цвет и свет кадра', 0, 1, 0.05, bl.col, pct, function (v) { bl.col = v; saveProject(); if (!playing) draw(); }));
      p.appendChild(slider('Тень на земле', 0, 1, 0.05, bl.shd, pct, function (v) { bl.shd = v; saveProject(); if (!playing) draw(); }));
      p.appendChild(slider('Объём от света', 0, 1, 0.05, bl.light, pct, function (v) { bl.light = v; saveProject(); if (!playing) draw(); }));
      p.appendChild(slider('Отражение на полу', 0, 1, 0.05, bl.refl || 0, pct, function (v) { bl.refl = v; saveProject(); if (!playing) draw(); }));
      p.appendChild(slider('Мягкость краёв', 0, 1, 0.05, bl.soft, pct, function (v) { bl.soft = v; saveProject(); if (!playing) draw(); }));
      p.appendChild(slider('Свет фона по краю', 0, 1, 0.05, bl.wrap == null ? 0.5 : bl.wrap, pct, function (v) { bl.wrap = v; saveProject(); if (!playing) draw(); }));
      p.appendChild(chipRow([{ label: glue.on ? 'Единый вид кадра: вкл' : 'Единый вид кадра: выкл', on: glue.on, fn: function () { glue.on = !glue.on; saveProject(); paintPane(); if (!playing) draw(); } }], 'Склейка'));
      if (glue.on) {
        p.appendChild(slider('Свечение светлых мест', 0, 1, 0.05, glue.bloom, pct, function (v) { glue.bloom = v; saveProject(); if (!playing) draw(); }));
        p.appendChild(slider('Зерно на весь кадр', 0, 1, 0.05, glue.grain, pct, function (v) { glue.grain = v; saveProject(); if (!playing) draw(); }));
        p.appendChild(slider('Виньетка', 0, 1, 0.05, glue.vig, pct, function (v) { glue.vig = v; saveProject(); if (!playing) draw(); }));
      }
    }
    p.appendChild(chipRow([
      { label: c.mouth.on ? 'Поющий рот: вкл' : 'Поющий рот: выкл', on: c.mouth.on, fn: function () { c.mouth.on = !c.mouth.on; if (c.mouth.on) placing = true; else placing = false; saveProject(); paintPane(); if (!playing) draw(); } },
      { label: placing ? 'Нажми на рот героя…' : 'Поставить рот', on: placing, fn: function () { placing = !placing; if (placing) { c.mouth.on = true; pause(); } paintPane(); } }
    ], 'Рот'));
    if (c.mouth.on) p.appendChild(slider('Рот: размер', 0.04, 0.4, 0.01, c.mouth.s, function (v) { return Math.round(v * 100) + '%'; }, function (v) { c.mouth.s = v; saveProject(); if (!playing) draw(); }));
    var say = el('input', 'search'); say.type = 'text'; say.placeholder = 'Реплика героя (облачко над головой)'; say.value = c.say || ''; say.style.flex = 'none';
    say.addEventListener('input', function () { c.say = say.value; saveProject(); if (!playing) draw(); });
    p.appendChild(say);
    p.appendChild(chipRow([
      { label: 'Отразить', fn: function () { c.flip = !c.flip; saveProject(); if (!playing) draw(); } },
      c.frames ? { label: 'Видео-герой', on: true, fn: function () {} } : { label: '✂ Подчистить', fn: function () { openBrush(c); } },
      { label: 'Удалить героя', fn: function () { chars.splice(selC, 1); selC = chars.length ? 0 : -1; saveProject(true); paintPane(); if (!playing) draw(); } }
    ]));
    p.appendChild(el('div', 'ed-hint', 'Тащи героя пальцем прямо по кадру. Рот: нажми «Поставить рот» и коснись рта на рисунке героя. Ритм берётся из музыки ролика: выбери музыку на вкладке «Музыка».'));
  }
  function draw() {
    if (pulseAmt > 0) ensureGrid();
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (clips.length) {
      var i = indexAt(t), tr = trAt(i);
      if (tr) {
        var e = ease(tr.p);
        if (trans.type === 'slide') { drawClip(tr.a, tr.ai, prog(tr.a), 1, -e * W); drawClip(tr.b, tr.bi, prog(tr.b), 1, (1 - e) * W); }
        else if (trans.type === 'flash') {
          if (tr.p < 0.5) drawClip(tr.a, tr.ai, prog(tr.a), 1, 0); else drawClip(tr.b, tr.bi, prog(tr.b), 1, 0);
          g.save(); g.globalAlpha = Math.sin(Math.PI * clamp(tr.p, 0, 1)) * 0.9; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.restore();
        }
        else if (trans.type === 'zoom') { drawClip(tr.b, tr.bi, prog(tr.b), 1, 0, 1.25 - 0.25 * e); drawClip(tr.a, tr.ai, prog(tr.a), 1 - e, 0, 1 + 0.4 * e); }
        else { drawClip(tr.a, tr.ai, prog(tr.a), 1, 0); drawClip(tr.b, tr.bi, prog(tr.b), e, 0); }
      } else drawClip(clips[i], i, prog(clips[i]), 1, 0);
    }
    drawChars();
    drawOcclusion();
    drawGlue();
    drawTitles();
  }

  /* ---------- UI helpers ---------- */
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function paintRange(r) { var mn = +r.min || 0, mx = +r.max || 100; r.style.setProperty('--p', (((+r.value || 0) - mn) / (mx - mn || 1) * 100).toFixed(1) + '%'); }
  function slider(label, min, max, step, val, show, onInput) {
    var row = el('div', 'ed-row'), lb = el('label', '', label), inp = el('input'), v = el('span', 'v', show(val));
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val; paintRange(inp);
    inp.addEventListener('input', function () { var x = parseFloat(inp.value); paintRange(inp); v.textContent = show(x); onInput(x, inp, v); });
    row.appendChild(lb); row.appendChild(inp); row.appendChild(v);
    return row;
  }
  function chipRow(items, label) {
    var row = el('div', 'ed-row');
    if (label) row.appendChild(el('label', '', label));
    var box = el('div', 'chips'); box.style.flex = '1';
    items.forEach(function (it) {
      var b = el('button', 'chip' + (it.on ? ' on' : ''), it.label); b.type = 'button';
      b.addEventListener('click', it.fn); box.appendChild(b);
    });
    row.appendChild(box); return row;
  }
  function paintTl() {
    var box = $('#edTl'); box.textContent = '';
    clips.forEach(function (c, i) {
      var b = el('button', 'cl' + (i === sel ? ' on' : '')); b.type = 'button';
      if (c.thumb) b.style.backgroundImage = 'url(' + c.thumb + ')';
      b.appendChild(el('b', '', String(i + 1))); b.appendChild(el('i', '', c.ready ? f1(cd(c)) + ' с' : '…'));
      b.addEventListener('click', function () { sel = i; tab = 'clip'; pause(); setTime(c.start); paintTl(); paintTabs(); paintPane(); });
      box.appendChild(b);
    });
    var add = el('button', 'cl add', '+'); add.type = 'button'; add.setAttribute('aria-label', 'Добавить клип');
    add.addEventListener('click', function () { $('#edFile').click(); });
    box.appendChild(add);
    var cam = el('button', 'cl add', '📷'); cam.type = 'button'; cam.style.fontSize = '24px'; cam.setAttribute('aria-label', 'Снять фото камерой');
    cam.addEventListener('click', function () { openCam('clip'); });
    box.appendChild(cam);
  }
  function paintTabs() {
    var box = $('#edTabs'); box.textContent = '';
    [['tpl', 'Шаблоны'], ['clip', 'Клип'], ['music', 'Музыка'], ['titles', 'Титры'], ['chars', 'Герои'], ['fx', 'Эффекты'], ['fmt', 'Формат']].forEach(function (x) {
      var b = el('button', 'chip' + (tab === x[0] ? ' on' : ''), x[1]); b.type = 'button';
      b.addEventListener('click', function () { tab = x[0]; paintTabs(); paintPane(); });
      box.appendChild(b);
    });
  }

  /* ---------- tab: clip ---------- */
  function move(i, d) {
    var j = i + d; if (j < 0 || j >= clips.length) return;
    var c = clips.splice(i, 1)[0]; clips.splice(j, 0, c); sel = j;
    layout(); cur = -1; setTime(clips[j].start); paintTl(); paintPane();
  }
  function split() {
    var c = clips[sel]; if (!c || c.kind !== 'video') { toast('Разрезать можно только видео'); return; }
    var local = t - c.start;
    if (t < c.start || t > c.end || local < 0.3 || cd(c) - local < 0.3) { toast('Поставь перемотку внутрь клипа, не у самого края'); return; }
    var v = document.createElement('video');
    v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', ''); v.src = c.url;
    var n = { id: ++uid, name: c.name, url: c.url, bid: c.bid, blob: c.blob, kind: 'video', el: v, src: c.src, inp: c.inp + local, out: c.out, dur: 0, fit: c.fit, sound: c.sound,
      thumb: '', node: null, gain: null, pre: false, ready: true, start: 0, end: 0 };
    c.out = c.inp + local;
    clips.splice(sel + 1, 0, n);
    ensureAudio(); connectClip(n);
    v.onloadedmetadata = function () { try { v.currentTime = n.inp; } catch (e) {} };
    v.onseeked = function () { if (!n.thumb && v.videoWidth) { thumbOf(n); paintTl(); } };
    layout(); sel = sel + 1; cur = -1; setTime(n.start); paintTl(); paintPane();
  }
  function paneClip(p) {
    var c = clips[sel];
    if (!c) { p.appendChild(el('div', 'ed-hint', 'Добавь видео или фото кнопкой «+» в ленте выше. Нажми на клип, чтобы его обрезать.')); return; }
    p.appendChild(el('div', 'ed-name', (sel + 1) + '. ' + c.name));
    if (c.kind === 'video') {
      if (!c.src) { p.appendChild(el('div', 'ed-hint', 'Читаю видео…')); return; }
      p.appendChild(slider('Начало', 0, Math.max(0.1, c.src - 0.2), 0.1, c.inp, f1, function (x) {
        c.inp = Math.min(x, c.src - 0.2); if (c.out < c.inp + 0.2) c.out = Math.min(c.src, c.inp + 0.2);
        layout(); cur = -1; setTime(c.start); paintTl(); sync(p);
      }));
      p.appendChild(slider('Конец', 0.2, c.src, 0.1, c.out, f1, function (x) {
        c.out = Math.max(x, c.inp + 0.2); if (c.out > c.src) c.out = c.src;
        layout(); cur = -1; setTime(Math.max(c.start, c.end - 0.05)); paintTl(); sync(p);
      }));
      p.appendChild(el('div', 'ed-hint', 'В ролике: ' + f1(cd(c)) + ' с из ' + f1(c.src) + ' с'));
    } else {
      p.appendChild(slider('Длительность', 1, 30, 0.1, c.dur, function (x) { return f1(x) + ' с'; }, function (x) { c.dur = x; layout(); paintTl(); }));
    }
    p.appendChild(chipRow([
      { label: 'Заполнить', on: c.fit === 'fill', fn: function () { c.fit = 'fill'; paintPane(); } },
      { label: 'Вписать', on: c.fit === 'fit', fn: function () { c.fit = 'fit'; paintPane(); } }
    ], 'Кадр'));
    if (c.kind === 'video') p.appendChild(chipRow([
      { label: 'Вкл', on: c.sound, fn: function () { c.sound = true; updGain(c); paintPane(); } },
      { label: 'Выкл', on: !c.sound, fn: function () { c.sound = false; updGain(c); paintPane(); } }
    ], 'Звук клипа'));
    p.appendChild(chipRow([
      { label: '← Раньше', fn: function () { move(sel, -1); } },
      { label: 'Позже →', fn: function () { move(sel, 1); } },
      { label: 'Разрезать здесь', fn: split },
      { label: 'Удалить', fn: function () { drop(c); } }
    ]));
  }
  function sync(p) { /* labels in the clip pane that depend on both sliders */
    var c = clips[sel]; if (!c || c.kind !== 'video') return;
    var rs = p.querySelectorAll('input[type=range]');
    if (rs.length >= 2) { rs[0].value = c.inp; rs[1].value = c.out; paintRange(rs[0]); paintRange(rs[1]);
      var vs = p.querySelectorAll('.v'); if (vs.length >= 2) { vs[0].textContent = f1(c.inp); vs[1].textContent = f1(c.out); } }
    var h = p.querySelectorAll('.ed-hint'); if (h.length) h[h.length - 1].textContent = 'В ролике: ' + f1(cd(c)) + ' с из ' + f1(c.src) + ' с';
  }

  /* ---------- fit the whole reel to the song ---------- */
  function cloneClip(c) {
    var n = { id: ++uid, name: c.name, url: c.url, bid: c.bid, blob: c.blob, kind: c.kind, el: null, src: c.src, inp: c.inp, out: c.out, dur: c.dur, fit: c.fit,
      sound: c.sound, thumb: c.thumb, node: null, gain: null, pre: false, ready: true, start: 0, end: 0 };
    if (c.kind === 'image') n.el = c.el;
    else {
      var v = document.createElement('video');
      v.playsInline = true; v.preload = 'metadata'; v.setAttribute('playsinline', ''); v.src = c.url; n.el = v;
      v.onloadedmetadata = function () { try { v.currentTime = n.inp; } catch (e) {} };
      ensureAudio(); connectClip(n);
    }
    return n;
  }
  function fitToSong() {
    if (!music.id) { toast('Сначала выбери музыку'); return; }
    if (!clips.length) { toast('Сначала добавь клипы'); return; }
    if (clips.some(function (c) { return !c.ready; })) { toast('Клипы ещё читаются, подожди секунду'); return; }
    var songLen = music.el && isFinite(music.el.duration) && music.el.duration > 0 ? music.el.duration : music.dur;
    if (!songLen) { toast('Не удалось узнать длину песни'); return; }
    music.status = 'Считаю ритм и подгоняю ролик под песню…'; paintPane();
    var run = function (r) {
      var P = r && r.bpm ? 60 / r.bpm : 0;
      if (P) music.start = ((r.off % P) + P) % P;
      var T = Math.max(5, songLen - music.start);
      var base = clips.slice(), imgs = base.filter(function (c) { return c.kind === 'image'; }), n = imgs.length;
      var F = base.reduce(function (a, c) { return a + (c.kind === 'video' ? cd(c) : 0); }, 0);
      var reps = n ? Math.max(1, Math.round(T / (n * 4.5 + F))) : Math.max(1, Math.ceil(T / Math.max(F, 1)));
      var imgDur = 0;
      if (n) { while (reps > 1 && (T / reps - F) / n < 1.5) reps--; imgDur = clamp((T / reps - F) / n, 1.5, 30); if (P) imgDur = Math.max(1, Math.round(imgDur / P)) * P; }
      var seq = [], k, j;
      for (k = 0; k < reps; k++) base.forEach(function (c) { seq.push(k === 0 ? c : cloneClip(c)); });
      seq.forEach(function (c) { if (c.kind === 'image') c.dur = imgDur; });
      var sum = 0; seq.forEach(function (c) { sum += cd(c); });
      /* last photo absorbs the small difference so the reel ends exactly with the song */
      for (j = seq.length - 1; j >= 0 && seq[j].kind !== 'image'; j--);
      if (sum < T && j >= 0) seq[j].dur += T - sum;
      else if (sum < T) { var lv = seq[seq.length - 1]; lv.out = Math.min(lv.src, lv.out + (T - sum)); }
      /* too long: cut the tail */
      var acc = 0, cut = seq.length;
      for (k = 0; k < seq.length; k++) { var d = cd(seq[k]); if (acc + d >= T - 0.01) { cut = k + 1; var rest = T - acc; if (seq[k].kind === 'image') seq[k].dur = Math.max(0.5, rest); else seq[k].out = seq[k].inp + Math.max(0.5, rest); break; } acc += d; }
      seq.length = cut;
      /* a tiny last piece looks like a glitch: merge it into the previous photo */
      if (seq.length > 1) {
        var lastC = seq[seq.length - 1], prevC = seq[seq.length - 2];
        if (cd(lastC) < 1.5 && prevC.kind === 'image') { prevC.dur += cd(lastC); seq.pop(); }
      }
      clips.forEach(function (c) { if (seq.indexOf(c) < 0 && c.kind === 'video') { try { c.el.pause(); } catch (e) {} } });
      clips = seq; sel = 0; layout(); cur = -1; setTime(0); paintTl();
      music.status = 'Готово: ролик ' + fmt(total) + ' (вся песня)' + (reps > 1 ? ', клипы идут по кругу ×' + reps : '') + (P ? ', склейки на долях ' + (Math.round(60 / P * 10) / 10) + ' BPM' : '') + '.';
      paintPane();
    };
    if (window.DJ && window.DJ.analyzeTrack) window.DJ.analyzeTrack(music.id).then(run, function () { run(null); });
    else run(null);
  }

  /* ---------- tab: music ---------- */
  function setMusic(id) {
    var tr = MM.find(id); if (!tr) return;
    if (music.el) { try { music.el.pause(); } catch (e) {} }
    if (music.url) { try { URL.revokeObjectURL(music.url); } catch (e) {} }
    music.node = null; music.gain = null;
    music.url = URL.createObjectURL(tr.blob); music.el = new Audio(); music.el.loop = true; music.el.preload = 'auto'; music.el.src = music.url;
    music.id = id; music.title = tr.title + (tr.artist ? ' — ' + tr.artist : ''); music.dur = tr.duration || 0; music.start = 0; music.status = '';
    ensureAudio(); connectMusic();
    if (playing) { musicSeek(); music.el.play().catch(function () {}); }
    paintPane();
  }
  function clearMusic() {
    if (music.el) { try { music.el.pause(); } catch (e) {} }
    if (music.url) { try { URL.revokeObjectURL(music.url); } catch (e) {} }
    try { if (music.gain) music.gain.disconnect(); } catch (e) {}
    music.el = null; music.node = null; music.gain = null; music.url = null; music.id = null; music.title = ''; music.status = '';
    paintPane();
  }
  function beatSnap() {
    if (!music.id) return;
    if (!clips.length) { toast('Сначала добавь клипы'); return; }
    if (!window.DJ || !window.DJ.analyzeTrack) { toast('Анализ ритма недоступен'); return; }
    music.status = 'Считаю ритм песни…'; paintPane();
    window.DJ.analyzeTrack(music.id).then(function (r) {
      if (!r || !r.bpm) { music.status = 'Ритм не найден: подгонка не сделана.'; paintPane(); return; }
      var P = 60 / r.bpm, off = (r.off % P + P) % P;
      music.start = off;
      clips.forEach(function (c) {
        if (!c.ready) return;
        var beats = Math.max(1, Math.round(cd(c) / P));
        if (c.kind === 'image') c.dur = beats * P;
        else {
          var maxB = Math.floor((c.src - c.inp) / P);
          if (maxB < 1) c.inp = Math.max(0, c.src - P), maxB = Math.max(1, Math.floor((c.src - c.inp) / P));
          c.out = Math.min(c.src, c.inp + Math.min(beats, maxB) * P);
        }
      });
      layout(); cur = -1; setTime(Math.min(t, total)); paintTl();
      music.status = 'Готово: ' + (Math.round(r.bpm * 10) / 10) + ' BPM, склейки легли на доли.'; paintPane();
    }).catch(function () { music.status = 'Не получилось разобрать трек.'; paintPane(); });
  }
  function paneMusic(p) {
    if (!music.id) {
      p.appendChild(el('div', 'ed-hint', 'Выбери песню из библиотеки: она будет играть под роликом. Если песня короче ролика, она повторится.'));
      p.appendChild(chipRow([{ label: 'Выбрать трек', on: true, fn: openPick }]));
      p.appendChild(slider('Звук клипов', 0, 100, 1, Math.round(origVol * 100), function (x) { return x + '%'; }, function (x) { origVol = x / 100; clips.forEach(updGain); }));
      return;
    }
    p.appendChild(el('div', 'ed-name', '♪ ' + music.title));
    p.appendChild(chipRow([{ label: 'Заменить', fn: openPick }, { label: 'Убрать', fn: clearMusic }]));
    p.appendChild(slider('Музыка', 0, 100, 1, Math.round(music.vol * 100), function (x) { return x + '%'; }, function (x) { music.vol = x / 100; }));
    p.appendChild(slider('Звук клипов', 0, 100, 1, Math.round(origVol * 100), function (x) { return x + '%'; }, function (x) { origVol = x / 100; clips.forEach(updGain); }));
    p.appendChild(slider('Старт песни', 0, Math.max(1, Math.floor(music.dur || 120)), 0.1, music.start, function (x) { return fmt(x); }, function (x) { music.start = x; if (playing) musicSeek(); }));
    p.appendChild(chipRow([
      { label: 'Затухание в конце', on: music.fade, fn: function () { music.fade = !music.fade; paintPane(); } },
      { label: 'Подогнать нарезку под бит', fn: beatSnap }
    ]));
    p.appendChild(chipRow([{ label: 'Растянуть на всю песню', on: true, fn: fitToSong }]));
    if (music.status) p.appendChild(el('div', 'ed-hint', music.status));
    p.appendChild(el('div', 'ed-hint', '«На всю песню» растягивает фото так, чтобы ролик шёл от старта до конца песни. Если фото мало, они пойдут по кругу, а склейки лягут на доли. «Под бит» только подравнивает нарезку, не меняя общую длину сильно.'));
    p.appendChild(el('div', 'ed-hint', '«Под бит» ставит старт песни на первую долю и подрезает клипы и фото до целого числа долей, чтобы склейки попадали в ритм.'));
  }
  function openPick() { $('#edPickQ').value = ''; renderPick(); $('#edPick').hidden = false; }
  function renderPick() {
    var q = $('#edPickQ').value.trim().toLowerCase(), list = $('#edPickList'); list.textContent = '';
    var items = MM.tracks().filter(function (x) { return !MM.isVid(x); });
    if (q) items = items.filter(function (x) { return ((x.title || '') + ' ' + (x.artist || '')).toLowerCase().indexOf(q) !== -1; });
    if (!items.length) { list.appendChild(el('div', 'hint2', q ? 'Ничего не найдено' : 'В библиотеке нет музыки')); return; }
    items.slice(0, 300).forEach(function (x) {
      var b = el('button', 'pk'); b.type = 'button';
      var tx = el('div', 't'); tx.appendChild(el('b', '', x.title)); tx.appendChild(el('span', '', (x.artist || 'Без исполнителя') + (x.duration ? ' · ' + fmt(x.duration) : '')));
      b.appendChild(tx); b.addEventListener('click', function () { $('#edPick').hidden = true; setMusic(x.id); });
      list.appendChild(b);
    });
  }

  /* ---------- tab: titles ---------- */
  function paneTitles(p) {
    var items = titles.map(function (tt, i) { return { label: (i + 1) + '. ' + (tt.text || '…').slice(0, 14), on: i === selT, fn: function () { selT = i; setTime(tt.start + 0.3); pause(); paintPane(); } }; });
    items.push({ label: '+ Титр', fn: function () {
      titles.push({ text: 'Текст', start: Math.min(t, Math.max(0, total - 1)), dur: Math.min(3, Math.max(1, total - t) || 3), pos: 'bottom', size: 'M', style: 'white' });
      selT = titles.length - 1; paintPane(); } });
    p.appendChild(chipRow(items));
    var tt = titles[selT];
    if (!tt) { p.appendChild(el('div', 'ed-hint', 'Нажми «+ Титр», чтобы добавить надпись. Она появится с текущего места перемотки.')); return; }
    var ta = el('textarea', 'search'); ta.value = tt.text; ta.placeholder = 'Текст титра'; ta.maxLength = 140;
    ta.addEventListener('input', function () { tt.text = ta.value; setTime(Math.max(tt.start + 0.3, t)); });
    p.appendChild(ta);
    p.appendChild(slider('Появится', 0, Math.max(1, Math.round(total * 10) / 10), 0.1, tt.start, function (x) { return fmt(x); }, function (x) { tt.start = x; setTime(x + 0.3); pause(); }));
    p.appendChild(slider('Длится', 0.5, 12, 0.1, tt.dur, function (x) { return f1(x) + ' с'; }, function (x) { tt.dur = x; }));
    p.appendChild(chipRow([{ label: 'Верх', on: tt.pos === 'top', fn: function () { tt.pos = 'top'; paintPane(); } }, { label: 'Центр', on: tt.pos === 'mid', fn: function () { tt.pos = 'mid'; paintPane(); } }, { label: 'Низ', on: tt.pos === 'bottom', fn: function () { tt.pos = 'bottom'; paintPane(); } }], 'Место'));
    p.appendChild(chipRow([{ label: 'Мелкий', on: tt.size === 'S', fn: function () { tt.size = 'S'; paintPane(); } }, { label: 'Средний', on: tt.size === 'M', fn: function () { tt.size = 'M'; paintPane(); } }, { label: 'Крупный', on: tt.size === 'L', fn: function () { tt.size = 'L'; paintPane(); } }], 'Размер'));
    p.appendChild(chipRow([{ label: 'Белый', on: tt.style === 'white', fn: function () { tt.style = 'white'; paintPane(); } }, { label: 'Цвет темы', on: tt.style === 'accent', fn: function () { tt.style = 'accent'; paintPane(); } }, { label: 'Плашка', on: tt.style === 'plate', fn: function () { tt.style = 'plate'; paintPane(); } }], 'Стиль'));
    p.appendChild(chipRow([{ label: 'Удалить титр', fn: function () { titles.splice(selT, 1); selT = Math.min(selT, titles.length - 1); paintPane(); } }]));
  }

  /* ---------- tab: effects ---------- */
  function paneFx(p) {
    function T(k, label) { return { label: label, on: trans.type === k, fn: function () { trans.type = k; paintPane(); } }; }
    p.appendChild(chipRow([T('none', 'Нет'), T('fade', 'Плавный'), T('slide', 'Сдвиг'), T('flash', 'Вспышка'), T('zoom', 'Зум')], 'Переход'));
    p.appendChild(slider('Длительность', 0.2, 1.5, 0.1, trans.dur, function (x) { return f1(x) + ' с'; }, function (x) { trans.dur = x; }));
    p.appendChild(chipRow([
      { label: 'Только фото', on: trans.scope === 'photos', fn: function () { trans.scope = 'photos'; paintPane(); } },
      { label: 'Везде', on: trans.scope === 'all', fn: function () { trans.scope = 'all'; paintPane(); } }
    ], 'Где'));
    function K(v, label) { return { label: label, on: Math.abs(kbAmt - v) < 0.001, fn: function () { kbAmt = v; paintPane(); } }; }
    p.appendChild(chipRow([K(0, 'Нет'), K(0.06, 'Лёгкий'), K(0.12, 'Сильный')], 'Наезд'));
    function PU(v, label) { return { label: label, on: Math.abs(pulseAmt - v) < 0.001, fn: function () { pulseAmt = v; paintPane(); } }; }
    p.appendChild(chipRow([PU(0, 'Нет'), PU(0.04, 'Лёгкий'), PU(0.09, 'Сильный')], 'Пульс в такт'));
    p.appendChild(el('div', 'ed-hint', 'Переход проходит вокруг стыка: конец одного кадра растворяется в начале следующего, общая длина ролика не меняется. «Наезд» слегка приближает и отдаляет каждое фото по очереди, чтобы кадр жил.'));
    p.appendChild(el('div', 'ed-hint', '«Везде» добавляет переход и на стыках с видео. Там первый кадр следующего видео на время перехода стоит неподвижно, и это стоит проверить на настоящих клипах.'));
    p.appendChild(el('div', 'ed-hint', 'Чтобы посмотреть, перемотай к стыку и нажми ▶.'));
  }


  /* ---------- tab: templates (автомонтаж в один тап) ---------- */
  var TPLS = [
    { k: 'punch', label: '⚡ Панч', beats: 2, tr: { type: 'flash', dur: 0.24 }, kb: 0.06, pulse: 0.07, style: 'white', pos: 'mid' },
    { k: 'zoom', label: '🔍 Зум', beats: 2, tr: { type: 'zoom', dur: 0.3 }, kb: 0.0, pulse: 0.09, style: 'accent', pos: 'top' },
    { k: 'slide', label: '➡ Сдвиг', beats: 4, tr: { type: 'slide', dur: 0.4 }, kb: 0.0, pulse: 0.03, style: 'plate', pos: 'bottom' },
    { k: 'smooth', label: '🌊 Плавный', beats: 8, tr: { type: 'fade', dur: 0.8 }, kb: 0.1, pulse: 0, style: 'white', pos: 'bottom' }
  ];
  function autoCut(tpl) {
    if (!clips.length) { toast('Сначала добавь фото или видео кнопкой «+»'); return; }
    if (clips.some(function (c) { return !c.ready; })) { toast('Файлы ещё читаются, подожди секунду'); return; }
    if (tplBusy) return;
    tplBusy = true; pause();
    tplStatus = 'Считаю ритм и режу ролик…'; paintPane();
    var run = function (r, hk) {
      try {
        var hasM = !!music.id, P = r && r.bpm ? 60 / r.bpm : 0.5;
        if (hasM && r && r.bpm) music.start = ((r.off % P) + P) % P;
        if (hasM && hk && isFinite(hk.start)) music.start = hk.start;
        var L = Math.max(0.5, tpl.beats * P);
        while (L < 0.8) L += P;
        var songLen = hasM ? (music.el && isFinite(music.el.duration) && music.el.duration > 0 ? music.el.duration : music.dur) : 0;
        var T = tplLen || 0;
        if (hasM && songLen) { var room = songLen - music.start; T = T ? Math.min(T, room) : room; }
        if (!T) T = 30;
        T = Math.max(4, T);
        var base = clips.slice().map(function (c) { return { c: c, inp: c.inp, out: c.out, used: false }; });
        var seq = [], acc = 0, round = 0, guard = 0;
        while (acc < T - 0.01 && guard++ < 80) {
          base.forEach(function (b) {
            if (acc >= T - 0.01 || seq.length >= 70) return;
            var o = b.c, n = b.used ? cloneClip(o) : o, d;
            b.used = true;
            if (o.kind === 'image') { n.dur = L; d = L; }
            else {
              var span = b.out - b.inp, segs = Math.max(1, Math.floor(span / L)), k = round % segs;
              n.inp = span >= L ? b.inp + k * L : b.inp; n.out = span >= L ? n.inp + L : b.out; d = n.out - n.inp;
            }
            n.fit = 'fill'; seq.push(n); acc += d;
          });
          round++;
        }
        /* подрезаем хвост, чтобы ролик закончился ровно на нужной длине */
        var a2 = 0, cut = seq.length, k2;
        for (k2 = 0; k2 < seq.length; k2++) {
          var dd = cd(seq[k2]);
          if (a2 + dd >= T - 0.01) { cut = k2 + 1; var rest = Math.max(0.5, T - a2); if (seq[k2].kind === 'image') seq[k2].dur = rest; else seq[k2].out = Math.min(seq[k2].src, seq[k2].inp + rest); break; }
          a2 += dd;
        }
        seq.length = cut;
        clips.forEach(function (c) { if (seq.indexOf(c) < 0 && c.kind === 'video') { try { c.el.pause(); } catch (e) {} } });
        clips = seq; sel = 0;
        ratioKey = '9:16'; applySize();
        trans = { type: tpl.tr.type, dur: tpl.tr.dur, scope: 'all' }; kbAmt = tpl.kb; pulseAmt = tpl.pulse;
        if (tplText.trim()) titles = [{ text: tplText.trim(), start: 0.3, dur: Math.min(3.5, Math.max(1, T - 0.6)), pos: tpl.pos, size: 'L', style: tpl.style }]; else titles = [];
        selT = -1; layout(); cur = -1; setTime(0); paintTl(); saveProject(true);
        tplStatus = 'Готово: «' + tpl.label.replace(/^\S+\s/, '') + '», ' + clips.length + ' кадров, ' + fmt(total) + (hasM ? ', склейки на долях ' + Math.round(60 / P) + ' BPM' + (tplHook && tplLen > 0 && music.start > 1 ? ', песня с ' + fmt(music.start) + ' (самый живой кусок).' : '.') : '. Музыки нет: темп 120, выбери трек на вкладке «Музыка» и нажми стиль ещё раз.') + ' Нажми ▶, чтобы посмотреть.';
      } catch (e) { tplStatus = 'Не получилось собрать: ' + (e && e.message ? e.message : 'ошибка'); }
      tplBusy = false; paintPane();
    };
    if (music.id && window.DJ && window.DJ.analyzeTrack) window.DJ.analyzeTrack(music.id).then(function (r) {
      if (tplHook && tplLen > 0 && window.DJ.findHook) return window.DJ.findHook(music.id, tplLen).then(function (hk) { run(r, hk); });
      run(r, null);
    }, function () { run(null, null); });
    else run(null, null);
  }
  function paneTpl(p) {
    p.appendChild(el('div', 'ed-hint', 'Автомонтаж для Reels и TikTok: добавь фото или видео («+»), выбери музыку, подпиши ролик и нажми на стиль. Нарезка ляжет на ритм песни, формат 9:16.'));
    p.appendChild(chipRow([{ label: music.id ? '♪ ' + music.title.slice(0, 26) : 'Выбрать музыку', on: !!music.id, fn: openPick }]));
    var ta = el('input', 'search'); ta.type = 'text'; ta.maxLength = 60; ta.value = tplText; ta.placeholder = 'Надпись на ролике (по желанию)'; ta.setAttribute('autocomplete', 'off');
    ta.addEventListener('input', function () { tplText = ta.value; });
    p.appendChild(ta);
    p.appendChild(chipRow([[15, '15 с'], [30, '30 с'], [60, '60 с'], [0, music.id ? 'Вся песня' : '30 с']].map(function (x) { return { label: x[1], on: tplLen === x[0], fn: function () { tplLen = x[0]; paintPane(); } }; }), 'Длина'));
    if (music.id) p.appendChild(chipRow([{ label: tplHook ? '✓ Самый живой кусок песни' : 'Песня с начала', on: tplHook, fn: function () { tplHook = !tplHook; paintPane(); } }], 'Песня'));
    p.appendChild(chipRow(TPLS.map(function (tp) { return { label: tp.label, on: false, fn: function () { autoCut(tp); } }; }), 'Стиль'));
    if (tplStatus) p.appendChild(el('div', 'ed-hint', tplStatus));
    p.appendChild(el('div', 'ed-hint', 'Панч: быстрые склейки со вспышкой и пульсом. Зум: наезды в такт. Сдвиг: спокойная смена кадров. Плавный: медленные растворения. После сборки всё можно донастроить на других вкладках и записать через «Экспорт».'));
  }

  /* ---------- tab: format ---------- */
  function paneFmt(p) {
    p.appendChild(chipRow(Object.keys(RATIOS).map(function (k) { return { label: k + (k === '9:16' ? ' рилсы' : k === '1:1' ? ' квадрат' : ' широкий'), on: ratioKey === k, fn: function () { ratioKey = k; applySize(); paintPane(); } }; }), 'Формат'));
    p.appendChild(chipRow([540, 720, 1080].map(function (q) { return { label: q + 'p', on: quality === q, fn: function () { quality = q; applySize(); paintPane(); } }; }), 'Качество'));
    p.appendChild(chipRow([
      { label: 'Заполнить всем', fn: function () { clips.forEach(function (c) { c.fit = 'fill'; }); toast('Кадр: заполнить'); } },
      { label: 'Вписать всем', fn: function () { clips.forEach(function (c) { c.fit = 'fit'; }); toast('Кадр: вписать, края не обрезаются'); } }
    ], 'Кадр'));
    p.appendChild(el('div', 'ed-hint', 'Для рилсов подходит 9:16 и 720p: ролик получается лёгким и чётким. 1080p весит больше и на слабом телефоне может писаться рывками.'));
    p.appendChild(el('div', 'ed-hint', 'Проект сохраняется на телефоне сам и вернётся после перезапуска приложения. Сейчас он занимает ' + (projectMB() < 10 ? f1(projectMB()) : Math.round(projectMB())) + ' МБ: туда попадают копии твоих фото и видео.'));
    p.appendChild(chipRow([{ label: resetAsk ? 'Точно удалить проект?' : 'Начать заново', on: resetAsk, fn: function () {
      if (!resetAsk) { resetAsk = true; paintPane(); setTimeout(function () { if (resetAsk) { resetAsk = false; if (tab === 'fmt') paintPane(); } }, 4000); return; }
      resetAsk = false; pause(); clips.slice().forEach(function (c) { try { URL.revokeObjectURL(c.url); } catch (e) {} });
      clips = []; titles = []; sel = -1; selT = -1; cur = -1; t = 0; layout(); clearMusic(); paintTl(); paintPane(); saveProject(true); } }]));
  }

  function paintPane() {
    var p = $('#edPane'); p.textContent = '';
    if (tab === 'clip') paneClip(p); else if (tab === 'music') paneMusic(p); else if (tab === 'titles') paneTitles(p); else if (tab === 'chars') paneChars(p); else if (tab === 'fx') paneFx(p); else if (tab === 'tpl') paneTpl(p); else paneFmt(p);
  }

  /* ---------- export ---------- */
  function pickMime() {
    var list = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < list.length; i++) { try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {} }
    return '';
  }
  function startExport() {
    if (!clips.length || !total) { toast('Добавь клипы'); return; }
    if (clips.some(function (c) { return !c.ready; })) { toast('Клипы ещё читаются, подожди секунду'); return; }
    if (!window.MediaRecorder || !cv.captureStream) { toast('Здесь нельзя записать видео'); return; }
    if (!ensureAudio()) { toast('Здесь не работает Web Audio'); return; }
    recMime = pickMime(); if (!recMime) { toast('Здесь нет подходящего формата записи'); return; }
    pause(); setTime(0); chunks = []; cancelled = false;
    var tracks = cv.captureStream(30).getVideoTracks().concat(dest.stream.getAudioTracks());
    try {
      recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: recMime, videoBitsPerSecond: quality >= 1080 ? 9e6 : quality >= 720 ? 5.5e6 : 3.5e6, audioBitsPerSecond: 160000 });
    } catch (e) { toast('Не получилось начать запись'); return; }
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = onRecStop;
    recorder.start(1000);
    exporting = true; $('#edBusyBar').style.width = '0%'; $('#edBusy').hidden = false;
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {}); } catch (e) {}
    setTimeout(play, 250);
  }
  function finishExport() {
    exporting = false;
    setTimeout(function () { try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) {} }, 200);
  }
  function cancelExport() {
    cancelled = true; exporting = false; pause();
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
    $('#edBusy').hidden = true; releaseWake();
  }
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + '.' + p(d.getMinutes()); }
  function onRecStop() {
    releaseWake(); $('#edBusy').hidden = true;
    if (cancelled) { chunks = []; return; }
    var type = recMime.split(';')[0], ext = /mp4/.test(type) ? 'mp4' : 'webm';
    var blob = new Blob(chunks, { type: type }); chunks = [];
    if (!blob.size) { toast('Запись получилась пустой'); return; }
    doneFile = new File([blob], 'Монтаж ' + stamp() + '.' + ext, { type: type });
    if (doneUrl) URL.revokeObjectURL(doneUrl);
    doneUrl = URL.createObjectURL(doneFile);
    $('#edDoneV').src = doneUrl;
    $('#edDoneInfo').textContent = doneFile.name + ' · ' + fmt(total) + ' · ' + Math.max(1, Math.round(doneFile.size / 1e6)) + ' МБ' + (ext === 'webm' ? ' · формат webm (mp4 здесь недоступен)' : '');
    $('#edDone').hidden = false;
  }
  function closeDone(dropIt) {
    var v = $('#edDoneV'); try { v.pause(); } catch (e) {}
    $('#edDone').hidden = true;
    if (dropIt && doneUrl) { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(doneUrl); doneUrl = null; doneFile = null; }
  }

  /* ---------- автосохранение проекта (IndexedDB на телефоне) ---------- */
  var dbp = null, lastSig = '', saving = false, again = false, restored = false, saveTimer = 0, resetAsk = false;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('mm-editor', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('meta'); r.result.createObjectStore('blobs'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function idb(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(store, mode), rq = fn(tx.objectStore(store));
        tx.oncomplete = function () { res(rq && rq.result !== undefined ? rq.result : undefined); };
        tx.onerror = tx.onabort = function () { rej(tx.error); };
      });
    });
  }
  function sigOf() {
    return JSON.stringify([ratioKey, quality, origVol, trans, kbAmt, pulseAmt, glue, titles, music.id, music.start, music.vol, music.fade,
      chars.map(function (c) { return [c.bid, +c.x.toFixed(3), +c.y.toFixed(3), +c.size.toFixed(3), c.anim, c.amt, c.flip ? 1 : 0, c.blob ? 1 : 0, c.frames ? c.frames.length : 0, c.fb ? c.fb.filter(Boolean).length : 0, c.t0, c.t1, c.enter, c.exit, c.react ? 1 : 0, c.fx, c.say, c.sayS, c.grow || 1, c.behind ? 1 : 0, c.blend.on ? 1 : 0, c.blend.col, c.blend.shd, c.blend.soft, c.blend.grain, c.blend.light, c.blend.refl, c.blend.wrap, c.mouth.on ? 1 : 0, c.mouth.x, c.mouth.y, c.mouth.s]; }),
      clips.map(function (c) { return [c.bid, c.kind, c.name, c.src, +c.inp.toFixed(3), +c.out.toFixed(3), +c.dur.toFixed(3), c.fit, c.sound ? 1 : 0, c.thumb ? 1 : 0]; })]);
  }
  function projectMB() {
    var seen = {}, sum = 0; clips.forEach(function (c) { if (c.blob && !seen[c.bid]) { seen[c.bid] = 1; sum += c.blob.size; } });
    return Math.max(0.1, sum / 1e6);
  }
  function saveProject(force) {
    if (!window.indexedDB) return;
    if (saving) { again = true; return; }
    var sig = sigOf(); if (!force && sig === lastSig) return;
    saving = true;
    var meta = { v: 1, ratioKey: ratioKey, quality: quality, origVol: origVol, trans: trans, kbAmt: kbAmt, pulseAmt: pulseAmt, glue: glue, titles: titles,
      music: { id: music.id, start: music.start, vol: music.vol, fade: music.fade },
      chars: chars.map(function (c) { return { bid: c.bid, x: c.x, y: c.y, size: c.size, grow: c.grow || 1, anim: c.anim, amt: c.amt, flip: c.flip, t0: c.t0, t1: c.t1, enter: c.enter, exit: c.exit, react: c.react, fx: c.fx, say: c.say, sayS: c.sayS, mouth: c.mouth, blend: c.blend, vid: c.frames ? c.frames.length : 0, fps: c.fps || 0, behind: c.behind ? 1 : 0 }; }),
      clips: clips.map(function (c) { return { bid: c.bid, kind: c.kind, name: c.name, src: c.src, inp: c.inp, out: c.out, dur: c.dur, fit: c.fit, sound: c.sound, thumb: c.thumb }; }) };
    var blobs = {}; clips.forEach(function (c) { if (c.blob) blobs[c.bid] = c.blob; }); chars.forEach(function (c) { if (c.blob) blobs[c.bid] = c.blob; if (c.fb) c.fb.forEach(function (fb, i) { if (fb) blobs[c.bid + '_' + i] = fb; }); });
    idb('blobs', 'readonly', function (st) { return st.getAllKeys(); }).then(function (keys) {
      var have = {}; keys.forEach(function (k) { have[k] = 1; });
      return idb('blobs', 'readwrite', function (st) {
        Object.keys(blobs).forEach(function (b) { if (!have[b]) st.put(blobs[b], b); });
        keys.forEach(function (k) { if (!blobs[k]) st.delete(k); });
      });
    }).then(function () { return idb('meta', 'readwrite', function (st) { st.put(meta, 'project'); }); })
      .then(function () { lastSig = sig; })
      .catch(function () { lastSig = sig; toast('Не хватило места на телефоне: проект не сохранён'); })
      .then(function () { saving = false; if (again) { again = false; saveProject(); } });
  }
  function restoreProject() {
    if (restored || !window.indexedDB) return;
    restored = true;
    idb('meta', 'readonly', function (st) { return st.get('project'); }).then(function (meta) {
      if (!meta || !meta.clips || (!meta.clips.length && !(meta.chars && meta.chars.length)) || clips.length) return;
      var ids = []; meta.clips.forEach(function (m) { if (ids.indexOf(m.bid) < 0) ids.push(m.bid); });
      (meta.chars || []).forEach(function (m) { if (m.vid) { for (var q = 0; q < m.vid; q++) ids.push(m.bid + '_' + q); } else if (ids.indexOf(m.bid) < 0) ids.push(m.bid); });
      return Promise.all(ids.map(function (b) { return idb('blobs', 'readonly', function (st) { return st.get(b); }); })).then(function (arr) {
        if (clips.length) return;
        var blobs = {}, urls = {}; ids.forEach(function (b, i) { if (arr[i]) blobs[b] = arr[i]; });
        ratioKey = RATIOS[meta.ratioKey] ? meta.ratioKey : '9:16'; quality = meta.quality || 720;
        origVol = meta.origVol == null ? 1 : meta.origVol; titles = meta.titles || [];
        if (meta.trans) trans = { type: meta.trans.type || 'fade', dur: meta.trans.dur || 0.6, scope: meta.trans.scope || 'photos' };
        if (meta.kbAmt != null) kbAmt = meta.kbAmt;
        if (meta.pulseAmt != null) pulseAmt = meta.pulseAmt;
        if (meta.glue) Object.keys(meta.glue).forEach(function (k) { glue[k] = meta.glue[k]; });
        meta.clips.forEach(function (m) {
          var b = blobs[m.bid]; if (!b) return;
          var url = urls[m.bid] || (urls[m.bid] = URL.createObjectURL(b));
          clips.push(buildClip(b, url, m.bid, m));
        });
        chars = []; selC = -1;
        (meta.chars || []).forEach(function (m) {
          if (m.vid) {
            var fr = [], fbs = [], okv = true; for (var q = 0; q < m.vid; q++) { var bq = blobs[m.bid + '_' + q]; if (!bq) { okv = false; break; } var imq = new Image(); imq.src = URL.createObjectURL(bq); fr.push(imq); fbs.push(bq); }
            if (!okv) return; var cv0 = mkChar(fr[0], m.bid, m); cv0.frames = fr; cv0.fps = m.fps || 12; cv0.fb = fbs; cv0.cv = fr[0]; chars.push(cv0);
            fr[0].onload = function () { if (!playing && openNow) draw(); if (tab === 'chars') paintPane(); }; return;
          }
          var b = blobs[m.bid]; if (!b) return;
          var im = new Image(), ch = mkChar(im, m.bid, m); ch.blob = b; chars.push(ch);
          im.onload = function () { ch.cv = im; if (!playing && openNow) draw(); if (tab === 'chars') paintPane(); };
          im.src = URL.createObjectURL(b);
        });
        if (chars.length) selC = 0;
        sel = clips.length ? 0 : -1; applySize(); layout();
        var mm = meta.music;
        if (mm && mm.id && MM.find(mm.id)) { setMusic(mm.id); music.start = mm.start || 0; music.vol = mm.vol == null ? 0.8 : mm.vol; music.fade = mm.fade !== false; }
        lastSig = sigOf(); paintTabs(); paintTl(); paintPane();
        if (clips.length) toast('Проект восстановлен: клипов ' + clips.length);
      });
    }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && openNow) saveProject(); });

  /* ---------- open / close ---------- */
  function openEd() {
    if (openNow) return;
    MM.pauseMain(); MM.closeSheet();
    ensureAudio();
    try { if (document.fonts && document.fonts.load) document.fonts.load('700 40px Inter', 'Аа'); } catch (e) {}
    root.hidden = false; document.body.classList.add('ed-open'); openNow = true;
    try { history.pushState({ ed: 1 }, ''); } catch (e) {}
    applySize(); layout(); paintTabs(); paintTl(); paintPane(); paintPlay();
    raf = requestAnimationFrame(tick);
    restoreProject();
    clearInterval(saveTimer); saveTimer = setInterval(function () { saveProject(); }, 2500);
  }
  function closeEd(fromPop) {
    if (!openNow) return;
    if (exporting) cancelExport();
    closeCam(); pause(); closeDone(false);
    saveProject(); clearInterval(saveTimer);
    openNow = false; cancelAnimationFrame(raf);
    root.hidden = true; document.body.classList.remove('ed-open');
    if (!fromPop) { try { if (history.state && history.state.ed) history.back(); } catch (e) {} }
  }
  window.addEventListener('popstate', function () { if (openNow) closeEd(true); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !openNow) return;
    if (!$('#edCam').hidden) closeCam(); else if (!$('#edPick').hidden) $('#edPick').hidden = true; else if (!$('#edDone').hidden) closeDone(false); else if (!exporting) closeEd();
  });

  $('#edClose').addEventListener('click', function () { closeEd(); });
  $('#edExport').addEventListener('click', startExport);
  $('#edPlay').addEventListener('click', function () { if (playing) pause(); else play(); });
  $('#edSeek').addEventListener('input', function (e) { var v = parseInt(e.target.value, 10) / 1000 * total; e.target.style.setProperty('--p', (v / (total || 1) * 100).toFixed(1) + '%'); setTime(v); });
  $('#edFile').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
  $('#edPickQ').addEventListener('input', renderPick);
  $('#edPickClose').addEventListener('click', function () { $('#edPick').hidden = true; });
  $('#edPick').addEventListener('click', function (e) { if (e.target === $('#edPick')) $('#edPick').hidden = true; });
  $('#edBusyCancel').addEventListener('click', cancelExport);
  $('#edDoneClose').addEventListener('click', function () { closeDone(false); });
  $('#edDoneDrop').addEventListener('click', function () { closeDone(true); });
  $('#edDoneSave').addEventListener('click', function () { if (!doneFile) return; MM.addFiles([doneFile]); toast('Ролик добавлен в библиотеку'); closeDone(true); });
  $('#edDoneDl').addEventListener('click', function () {
    if (!doneFile) return;
    var a = document.createElement('a'); a.href = doneUrl; a.download = doneFile.name; document.body.appendChild(a); a.click(); a.remove();
  });
  var btn = document.getElementById('edBtn'); if (btn) btn.addEventListener('click', openEd);
  applySize(); layout();
  window.Editor = { open: openEd, _set: function (x) { pause(); setTime(x); }, _s: function () { return { clips: clips, titles: titles, total: total, t: t, music: music }; } };
})();
