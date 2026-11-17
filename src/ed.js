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
  var clips = [], titles = [], sel = -1, selT = -1, tab = 'clip', uid = 0, total = 0;
  var music = { id: null, title: '', el: null, node: null, gain: null, url: null, start: 0, vol: 0.8, fade: true, dur: 0, status: '' };
  var origVol = 1;
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
  function addFiles(list) {
    var files = Array.prototype.slice.call(list), n = 0;
    files.forEach(function (f) {
      var isImg = /^image\//.test(f.type) || IMG_RE.test(f.name);
      var isVid = /^video\//.test(f.type) || /\.(mp4|m4v|mov|webm|mkv|3gp)$/i.test(f.name);
      if (!isImg && !isVid) return;
      n++;
      var url = URL.createObjectURL(f);
      var c = { id: ++uid, name: f.name, url: url, kind: isImg ? 'image' : 'video', el: null, src: 0, inp: 0, out: 0, dur: 3, fit: 'fill',
        sound: true, thumb: '', node: null, gain: null, pre: false, ready: false, start: 0, end: 0 };
      if (isImg) {
        var im = new Image();
        im.onload = function () { c.ready = true; c.el = im; thumbOf(c); layout(); paintTl(); };
        im.onerror = function () { toast('Не получилось открыть «' + f.name + '»'); drop(c); };
        c.el = im; im.src = url;
        clips.push(c);
      } else {
        var v = document.createElement('video');
        v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
        c.el = v;
        v.onloadedmetadata = function () {
          c.src = isFinite(v.duration) ? v.duration : 0; c.inp = 0; c.out = c.src; c.ready = true;
          layout(); paintTl(); paintPane(); try { v.currentTime = Math.min(0.1, c.src / 2); } catch (e) {}
        };
        v.onseeked = function () { if (!c.thumb && v.videoWidth) { thumbOf(c); try { v.currentTime = c.inp; } catch (e) {} paintTl(); } };
        v.onerror = function () { toast('Не получилось открыть «' + f.name + '». Попробуй mp4.'); drop(c); };
        v.src = url;
        ensureAudio(); connectClip(c);
        clips.push(c);
      }
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
        if (nx && nx.kind === 'video' && !nx.pre && t >= c.end - 0.8) { nx.pre = true; try { nx.el.currentTime = nx.inp; } catch (e) {} }
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
  function drawClip(c) {
    if (!c || !c.ready) return;
    if (c.kind === 'video' && c.el.readyState < 2) return;
    var sz = srcSize(c), sw = sz[0], sh = sz[1]; if (!sw || !sh) return;
    var cover = Math.max(W / sw, H / sh);
    if (c.fit === 'fit') {
      var k0 = Math.max(bg.width / sw, bg.height / sh);
      bgg.drawImage(c.el, (bg.width - sw * k0) / 2, (bg.height - sh * k0) / 2, sw * k0, sh * k0);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(bg, 0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, W, H);
      var k = Math.min(W / sw, H / sh);
      g.drawImage(c.el, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
    } else g.drawImage(c.el, (W - sw * cover) / 2, (H - sh * cover) / 2, sw * cover, sh * cover);
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
  function draw() {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (clips.length) drawClip(clips[indexAt(t)]);
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
  }
  function paintTabs() {
    var box = $('#edTabs'); box.textContent = '';
    [['clip', 'Клип'], ['music', 'Музыка'], ['titles', 'Титры'], ['fmt', 'Формат']].forEach(function (x) {
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
    var n = { id: ++uid, name: c.name, url: c.url, kind: 'video', el: v, src: c.src, inp: c.inp + local, out: c.out, dur: 0, fit: c.fit, sound: c.sound,
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
      p.appendChild(slider('Длительность', 1, 12, 0.1, c.dur, function (x) { return f1(x) + ' с'; }, function (x) { c.dur = x; layout(); paintTl(); }));
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
    if (music.status) p.appendChild(el('div', 'ed-hint', music.status));
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

  /* ---------- tab: format ---------- */
  function paneFmt(p) {
    p.appendChild(chipRow(Object.keys(RATIOS).map(function (k) { return { label: k + (k === '9:16' ? ' рилсы' : k === '1:1' ? ' квадрат' : ' широкий'), on: ratioKey === k, fn: function () { ratioKey = k; applySize(); paintPane(); } }; }), 'Формат'));
    p.appendChild(chipRow([540, 720, 1080].map(function (q) { return { label: q + 'p', on: quality === q, fn: function () { quality = q; applySize(); paintPane(); } }; }), 'Качество'));
    p.appendChild(el('div', 'ed-hint', 'Для рилсов подходит 9:16 и 720p: ролик получается лёгким и чётким. 1080p весит больше и на слабом телефоне может писаться рывками.'));
    p.appendChild(el('div', 'ed-hint', 'Проект живёт, пока приложение открыто. После перезапуска его придётся собрать заново, поэтому экспортируй готовое.'));
    p.appendChild(chipRow([{ label: 'Начать заново', fn: function () {
      pause(); clips.slice().forEach(function (c) { try { URL.revokeObjectURL(c.url); } catch (e) {} });
      clips = []; titles = []; sel = -1; selT = -1; cur = -1; t = 0; layout(); clearMusic(); paintTl(); paintPane(); } }]));
  }

  function paintPane() {
    var p = $('#edPane'); p.textContent = '';
    if (tab === 'clip') paneClip(p); else if (tab === 'music') paneMusic(p); else if (tab === 'titles') paneTitles(p); else paneFmt(p);
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
  }
  function closeEd(fromPop) {
    if (!openNow) return;
    if (exporting) cancelExport();
    pause(); closeDone(false);
    openNow = false; cancelAnimationFrame(raf);
    root.hidden = true; document.body.classList.remove('ed-open');
    if (!fromPop) { try { if (history.state && history.state.ed) history.back(); } catch (e) {} }
  }
  window.addEventListener('popstate', function () { if (openNow) closeEd(true); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !openNow) return;
    if (!$('#edPick').hidden) $('#edPick').hidden = true; else if (!$('#edDone').hidden) closeDone(false); else if (!exporting) closeEd();
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
  window.Editor = { open: openEd, _s: function () { return { clips: clips, titles: titles, total: total, t: t, music: music }; } };
})();
