/* DJ-пульт: две деки, EQ, фильтр, кроссфейдер, BPM, синхронизация, петли.
   Работает отдельно от основного плеера: свои звуковые элементы и свой AudioContext. */
(function () {
  'use strict';
  var MM = window.MM;
  var root = document.getElementById('dj');
  if (!MM || !root) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var GRID_KEY = 'mm.dj.grid';
  var COLORS = { a: '#ffb224', b: '#5ad1ff' };
  function themeColor() { try { var v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); if (v) COLORS.a = v; } catch (e) {} }
  var grid = {};
  try { grid = JSON.parse(localStorage.getItem(GRID_KEY) || '{}') || {}; } catch (e) { grid = {}; }
  function saveGrid() { try { localStorage.setItem(GRID_KEY, JSON.stringify(grid)); } catch (e) {} }

  var ctx = null, master = null, limiter = null;
  var xfPos = 0.5, curve = 'smooth', masterVol = 0.9, fadeSec = 8, fadeTimer = 0;
  var openNow = false, raf = 0, loopTimer = 0, wakeLock = null, toastT = 0, pickKey = 'a';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function frac(x) { return x - Math.floor(x); }
  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function pct(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + '%'; }
  function toast(msg) {
    var el = $('#djToast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* ---------- decks ---------- */
  var EQ_ROWS = [['low', 'НЧ', -30, 6, 0, 1], ['mid', 'СЧ', -30, 6, 0, 1], ['high', 'ВЧ', -30, 6, 0, 1], ['filt', 'ФИЛ', -100, 100, 0, 1], ['vol', 'ГР', 0, 100, 100, 0]];

  function deckHTML(k) {
    var K = k.toUpperCase();
    var eq = EQ_ROWS.map(function (r) {
      return '<label class="eqs"><span>' + r[1] + '</span><input type="range" data-r="' + r[0] + '"' + (r[5] ? ' class="bi"' : '') +
        ' min="' + r[2] + '" max="' + r[3] + '" step="1" value="' + r[4] + '" aria-label="' + r[1] + ' деки ' + K + '"></label>';
    }).join('');
    return '' +
      '<div class="dk-top"><div class="dk-id">' + K + '</div>' +
      '<div class="dk-meta"><div class="dk-title" data-r="title">Дека пуста</div><div class="dk-art" data-r="artist">Выбери трек</div></div>' +
      '<button class="ghost" data-a="load" type="button">Трек</button></div>' +
      '<div class="dk-read">' +
      '<div class="rd"><b data-r="bpm">—</b><i>BPM</i></div>' +
      '<div class="rd"><b data-r="time">0:00</b><i data-r="rem">−0:00</i></div>' +
      '<div class="rd"><b data-r="pitch">0,0%</b><i>темп</i></div></div>' +
      '<canvas class="dk-wave" data-r="wave"></canvas>' +
      '<canvas class="dk-over" data-r="over"></canvas>' +
      '<div class="dk-note" data-r="note"></div>' +
      '<div class="dk-tr">' +
      '<button class="key" data-a="bendM" type="button" aria-label="Притормозить">◀◀</button>' +
      '<button class="key" data-a="cue" type="button">CUE</button>' +
      '<button class="key play" data-a="play" type="button" aria-label="Играть">▶</button>' +
      '<button class="key" data-a="bendP" type="button" aria-label="Подгнать">▶▶</button>' +
      '<button class="key" data-a="sync" type="button">SYNC</button></div>' +
      '<div class="dk-row"><label>Темп</label><div class="dk-tempo"><input type="range" class="bi" data-r="tempo" min="-8" max="8" step="0.1" value="0" aria-label="Темп деки ' + K + '"></div></div>' +
      '<button class="more" data-a="more" type="button" aria-expanded="false">EQ · петли · сетка <i>▾</i></button>' +
      '<div class="dk-more" data-r="more" hidden>' +
      '<div class="dk-row"><label>Опции</label><div class="chips" data-r="opts"></div></div>' +
      '<div class="dk-row"><label>Петля</label><div class="chips" data-r="loops"></div></div>' +
      '<div class="dk-row"><label>Сетка</label><div class="chips" data-r="gridc"></div></div>' +
      '<div class="dk-eq">' + eq +
      '<div class="eqs"><span>УР.</span><div class="dk-meter" data-r="meter"></div></div></div></div>';
  }

  function makeDeck(k) {
    var sec = document.createElement('section');
    sec.className = 'deck ' + k; sec.id = 'deck-' + k;
    sec.innerHTML = deckHTML(k);
    $('#djDecks').appendChild(sec);
    var el = new Audio(); el.preload = 'auto';
    var d = {
      k: k, sec: sec, el: el, url: null, id: null, tok: 0,
      peaks: null, dur: 0, bpm: 0, off: 0, cue: 0, loop: null, tempo: 0, range: 8, keylock: true, bend: 0,
      filt: 0, eq: { low: 0, mid: 0, high: 0 }, more: window.innerWidth >= 820, auto: null, vol: 1, lvl: 0, taps: [], note: '',
      overCv: null, overW: 0, last: {}
    };
    d.r = function (n) { return $('[data-r="' + n + '"]', sec); };
    d.cvWave = d.r('wave'); d.cvOver = d.r('over');
    var m = d.r('meter'); for (var i = 0; i < 10; i++) { var s = document.createElement('i'); if (i >= 8) s.className = 'hot'; m.appendChild(s); }
    d.segs = m.children;
    el.addEventListener('play', function () { paintTransport(d); });
    el.addEventListener('pause', function () { paintTransport(d); });
    el.addEventListener('ended', function () { paintTransport(d); });
    bindDeck(d);
    return d;
  }

  var D = { a: null, b: null };
  function other(d) { return D[d.k === 'a' ? 'b' : 'a']; }

  /* ---------- audio graph ---------- */
  function biq(type, f, q) { var n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; return n; }
  function ensureCtx() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(function () {}); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = masterVol;
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -4; limiter.knee.value = 3; limiter.ratio.value = 12; limiter.attack.value = 0.002; limiter.release.value = 0.12;
      master.connect(limiter); limiter.connect(ctx.destination);
      ['a', 'b'].forEach(function (k) {
        var d = D[k], src = ctx.createMediaElementSource(d.el);
        d.nLow = biq('lowshelf', 180); d.nMid = biq('peaking', 1100, 0.6); d.nHigh = biq('highshelf', 3200);
        d.nFilt = biq('allpass', 1000, 0.9);
        d.nChan = ctx.createGain(); d.nXf = ctx.createGain();
        d.nAn = ctx.createAnalyser(); d.nAn.fftSize = 256; d.anBuf = new Uint8Array(d.nAn.fftSize);
        src.connect(d.nLow); d.nLow.connect(d.nMid); d.nMid.connect(d.nHigh); d.nHigh.connect(d.nFilt);
        d.nFilt.connect(d.nChan); d.nChan.connect(d.nXf); d.nXf.connect(master); d.nXf.connect(d.nAn);
        applyEq(d); applyFilter(d); applyVol(d);
      });
      applyXf();
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      return true;
    } catch (e) { ctx = null; return false; }
  }
  function set(param, v) { if (ctx) param.setTargetAtTime(v, ctx.currentTime, 0.015); }
  function applyEq(d) { if (!ctx) return; set(d.nLow.gain, d.eq.low); set(d.nMid.gain, d.eq.mid); set(d.nHigh.gain, d.eq.high); }
  function applyFilter(d) {
    if (!ctx) return;
    var v = d.filt;
    if (Math.abs(v) < 0.04) { d.nFilt.type = 'allpass'; return; }
    if (v < 0) { d.nFilt.type = 'lowpass'; set(d.nFilt.frequency, 20000 * Math.pow(0.012, -v)); }
    else { d.nFilt.type = 'highpass'; set(d.nFilt.frequency, 20 * Math.pow(200, v)); }
  }
  function applyVol(d) { if (ctx) set(d.nChan.gain, d.vol); }
  function applyXf() {
    if (!ctx) return;
    var ga, gb;
    if (curve === 'cut') { ga = clamp((1 - xfPos) * 8, 0, 1); gb = clamp(xfPos * 8, 0, 1); }
    else { ga = Math.cos(xfPos * Math.PI / 2); gb = Math.cos((1 - xfPos) * Math.PI / 2); }
    set(D.a.nXf.gain, ga); set(D.b.nXf.gain, gb);
  }

  /* ---------- tempo ---------- */
  function rate(d) { return (1 + d.tempo / 100) * (1 + d.bend); }
  function applyRate(d) {
    var r = clamp(rate(d), 0.25, 4), el = d.el;
    el.playbackRate = r;
    el.preservesPitch = d.keylock; el.webkitPreservesPitch = d.keylock; el.mozPreservesPitch = d.keylock;
  }
  function setTempo(d, p) {
    d.tempo = Math.round(clamp(p, -d.range, d.range) * 10) / 10;
    d.r('tempo').value = d.tempo;
    applyRate(d);
  }

  /* ---------- loading and analysis ---------- */
  function decode(blob) {
    return blob.arrayBuffer().then(function (ab) {
      var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      var oc = new OAC(1, 1, 22050);
      return new Promise(function (res, rej) {
        var p = oc.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      });
    });
  }
  /* Waveform peaks (100 per second) and a beat grid found from the low-frequency onsets. */
  function analyze(buf) {
    var c0 = buf.getChannelData(0), c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    var sr = buf.sampleRate, n = buf.length, PK = 100;
    var np = Math.ceil(n / sr * PK) + 1, peaks = new Float32Array(np);
    var hop = Math.round(sr / 200), ne = Math.floor(n / hop), env = new Float32Array(ne);
    var a = 1 - Math.exp(-2 * Math.PI * 150 / sr), lp = 0;
    var step = sr / PK, next = step, pi = 0, pm = 0, e = 0, ei = 0, ec = 0, i;
    for (i = 0; i < n; i++) {
      var x = c1 ? (c0[i] + c1[i]) * 0.5 : c0[i], ax = x < 0 ? -x : x;
      if (ax > pm) pm = ax;
      if (i + 1 >= next) { if (pi < np) peaks[pi++] = pm; pm = 0; next += step; }
      lp += a * (x - lp); e += lp < 0 ? -lp : lp;
      if (++ec === hop) { if (ei < ne) env[ei++] = e / hop; e = 0; ec = 0; }
    }
    if (pi < np) peaks[pi] = pm;
    var mx = 0; for (i = 0; i < np; i++) if (peaks[i] > mx) mx = peaks[i];
    if (mx > 0) for (i = 0; i < np; i++) peaks[i] = Math.sqrt(peaks[i] / mx);

    var res = { peaks: peaks, dur: n / sr, bpm: 0, off: 0 };
    if (ne < 800) return res;
    var on = new Float32Array(ne), prev = Math.log(1 + 1000 * env[0]);
    for (i = 1; i < ne; i++) { var cur = Math.log(1 + 1000 * env[i]), df = cur - prev; on[i] = df > 0 ? df : 0; prev = cur; }
    var L = Math.min(ne, 30000), s0 = Math.max(0, Math.floor((ne - L) / 2)), s1 = s0 + L;
    /* coarse tempo by autocorrelation, 78..165 BPM (200 frames per second) */
    var best = 0, bestLag = 0, lag;
    for (lag = 72; lag <= 154; lag++) {
      var ac = 0;
      for (i = s0; i + lag < s1; i++) ac += on[i] * on[i + lag];
      ac /= (L - lag);
      if (ac > best) { best = ac; bestLag = lag; }
    }
    if (!bestLag) return res;
    var bpm0 = 12000 / bestLag;
    while (bpm0 < 78) bpm0 *= 2;
    while (bpm0 > 165) bpm0 /= 2;
    /* fine tempo: strength of the beat frequency in the onset signal */
    var bBpm = bpm0, bMag = -1, bRe = 0, bIm = 0, bpm;
    for (bpm = bpm0 - 1.5; bpm <= bpm0 + 1.5; bpm += 0.02) {
      var P = 12000 / bpm, w = 2 * Math.PI / P, wr = Math.cos(w), wi = -Math.sin(w);
      var zr = Math.cos(w * s0), zi = -Math.sin(w * s0), sr2 = 0, si2 = 0;
      for (i = s0; i < s1; i++) {
        var o = on[i];
        sr2 += o * zr; si2 += o * zi;
        var t = zr * wr - zi * wi; zi = zr * wi + zi * wr; zr = t;
      }
      var mag = sr2 * sr2 + si2 * si2;
      if (mag > bMag) { bMag = mag; bBpm = bpm; bRe = sr2; bIm = si2; }
    }
    var Pf = 12000 / bBpm;
    var ph = frac(-Math.atan2(bIm, bRe) / (2 * Math.PI));
    res.bpm = Math.round(bBpm * 100) / 100;
    res.off = ph * Pf / 200;
    return res;
  }

  function loadDeck(k, id) {
    var d = D[k], t = MM.find(id);
    if (!t) return;
    if (MM.isVid(t)) { toast('Видео на деки не грузим — нужен звуковой трек'); return; }
    if (!ensureCtx()) { toast('Здесь не работает Web Audio'); return; }
    try { d.el.pause(); } catch (e) {}
    if (d.url) URL.revokeObjectURL(d.url);
    d.url = URL.createObjectURL(t.blob); d.el.src = d.url; d.el.load();
    d.id = id; d.title = t.title; d.artist = t.artist || 'Без исполнителя';
    d.cue = 0; d.loop = null; d.peaks = null; d.auto = null; d.bpm = 0; d.off = 0; d.overCv = null; d.dur = t.duration || 0; d.taps = [];
    d.bend = 0; setTempo(d, 0);
    var tok = ++d.tok;
    paintDeck(d);
    var g = grid[id];
    if (t.blob.size > 70e6) {
      d.note = 'Большой файл: без волны и авто-BPM. Темп можно задать кнопкой TAP.';
      if (g) { d.bpm = g.bpm; d.off = g.off; }
      paintDeck(d); return;
    }
    d.note = 'Анализ трека…'; paintDeck(d);
    decode(t.blob).then(function (buf) {
      if (d.tok !== tok) return;
      var r = analyze(buf);
      d.peaks = r.peaks; d.dur = r.dur || d.dur; d.overCv = null; d.auto = r.bpm ? { bpm: r.bpm, off: r.off } : null;
      if (g) { d.bpm = g.bpm; d.off = g.off; d.note = ''; }
      else if (r.bpm) { d.bpm = r.bpm; d.off = r.off; grid[id] = { bpm: d.bpm, off: d.off }; saveGrid(); d.note = ''; }
      else d.note = 'Темп не определён. Нажми TAP в такт.';
      paintDeck(d);
    }).catch(function () {
      if (d.tok !== tok) return;
      d.note = 'Не удалось разобрать файл для волны и BPM. Играть он будет.';
      if (g) { d.bpm = g.bpm; d.off = g.off; }
      paintDeck(d);
    });
  }
  function remember(d) { if (d.id && d.bpm) { grid[d.id] = { bpm: d.bpm, off: d.off }; saveGrid(); } }

  /* ---------- transport ---------- */
  function togglePlay(d) {
    if (!d.id) { openPick(d.k); return; }
    ensureCtx();
    if (d.el.paused) d.el.play().catch(function () { toast('Не удалось запустить'); });
    else d.el.pause();
  }
  function cue(d) {
    if (!d.id) return;
    if (!d.el.paused) { d.el.pause(); d.el.currentTime = d.cue; return; }
    if (Math.abs(d.el.currentTime - d.cue) > 0.05) { d.cue = d.el.currentTime; toast('Метка ' + d.k.toUpperCase() + ': ' + fmt(d.cue)); }
    else d.el.currentTime = d.cue;
  }
  function period(d) { return 60 / d.bpm; }
  function syncDeck(d, quiet) {
    var o = other(d);
    if (!d.id || !o.id) { if (!quiet) toast('Загрузи треки на обе деки'); return false; }
    if (!d.bpm || !o.bpm) { if (!quiet) toast('Нужен BPM на обеих деках (кнопка TAP)'); return false; }
    var want = (o.bpm * rate(o) / d.bpm - 1) * 100;
    if (Math.abs(want) > d.range) {
      if (d.range < 50) { d.range = want > 16 || want < -16 ? 50 : 16; d.r('tempo').min = -d.range; d.r('tempo').max = d.range; }
      if (Math.abs(want) > d.range) { if (!quiet) toast('Слишком разный темп для синхронизации'); return false; }
    }
    setTempo(d, want);
    /* align beats: move this deck so both are at the same point inside a beat */
    var pd = frac((d.el.currentTime - d.off) / period(d)), po = frac((o.el.currentTime - o.off) / period(o));
    var delta = pd - po; if (delta > 0.5) delta -= 1; if (delta < -0.5) delta += 1;
    var nt = d.el.currentTime - delta * period(d);
    d.el.currentTime = clamp(nt, 0, d.dur || nt);
    paintDeck(d);
    if (!quiet) toast('Дека ' + d.k.toUpperCase() + ' подогнана под ' + o.k.toUpperCase());
    return true;
  }
  function loopSet(d, beats) {
    if (!d.id) return;
    if (d.loop && d.loop.beats === beats) { d.loop = null; paintDeck(d); return; }
    if (!d.bpm) { toast('Нужен BPM для петли'); return; }
    var P = period(d), t = d.el.currentTime;
    var start = Math.max(0, d.off + Math.round((t - d.off) / P) * P);
    d.loop = { start: start, end: start + beats * P, beats: beats };
    if (t >= d.loop.end) d.el.currentTime = d.loop.start;
    paintDeck(d);
  }
  function loopCheck() {
    ['a', 'b'].forEach(function (k) {
      var d = D[k];
      if (!d.loop || d.el.paused) return;
      var t = d.el.currentTime;
      if (t >= d.loop.end) d.el.currentTime = d.loop.start + (t - d.loop.end);
    });
  }
  function tap(d) {
    if (!d.id) return;
    var now = performance.now(), tp = d.taps;
    if (tp.length && now - tp[tp.length - 1] > 2000) tp.length = 0;
    tp.push(now); if (tp.length > 9) tp.shift();
    if (tp.length < 3) { toast('Ещё пару раз в такт'); return; }
    var sum = (tp[tp.length - 1] - tp[0]) / (tp.length - 1);
    var real = 60000 / sum;
    d.bpm = Math.round(real / rate(d) * 10) / 10;
    d.off = Math.max(0, d.el.currentTime - 0.04);
    d.note = ''; remember(d); paintDeck(d);
  }
  function gridAct(d, a) {
    if (!d.id) return;
    if ((a === 'half' || a === 'dbl') && !d.bpm) { toast('Сначала задай BPM (TAP)'); return; }
    if (a === 'half' || a === 'dbl') {
      var nb = a === 'half' ? d.bpm / 2 : d.bpm * 2;
      if (nb < 50 || nb > 200) { toast('Такой темп не бывает: ' + nb.toFixed(0) + ' BPM'); return; }
      d.bpm = Math.round(nb * 100) / 100;
    }
    else if (a === 'auto') {
      if (!d.auto) { toast('Автоопределение не нашло темп'); return; }
      d.bpm = d.auto.bpm; d.off = d.auto.off; toast('Вернул BPM, найденный автоматически');
    }
    else if (a === 'tap') { tap(d); return; }
    else if (a === 'first') { d.off = d.el.currentTime; if (!d.bpm) { toast('Сначала задай BPM (TAP)'); return; } toast('1-я доля здесь'); }
    d.loop = null; remember(d); paintDeck(d);
  }

  /* ---------- paint ---------- */
  function chipSet(box, items) {
    box.textContent = '';
    items.forEach(function (it) {
      var b = document.createElement('button'); b.type = 'button';
      b.className = 'chip' + (it.on ? ' on' : ''); b.textContent = it.label; b.setAttribute('data-a', it.a);
      if (it.v !== undefined) b.setAttribute('data-v', it.v);
      box.appendChild(b);
    });
  }
  function paintTransport(d) {
    var b = $('[data-a="play"]', d.sec), playing = d.id && !d.el.paused;
    b.textContent = playing ? '❚❚' : '▶';
    b.classList.toggle('on', !!playing);
    b.setAttribute('aria-label', playing ? 'Пауза' : 'Играть');
  }
  function paintMore(d) {
    d.r('more').hidden = !d.more;
    var b = $('[data-a="more"]', d.sec); b.setAttribute('aria-expanded', String(d.more)); b.classList.toggle('open', d.more);
  }
  function paintDeck(d) {
    paintMore(d);
    d.r('title').textContent = d.id ? d.title : 'Дека пуста';
    d.r('artist').textContent = d.id ? d.artist : 'Выбери трек';
    d.r('note').textContent = d.note || '';
    chipSet(d.r('opts'), [
      { a: 'keylock', label: 'Тон сохр.', on: d.keylock },
      { a: 'range', label: '±' + d.range + '%' },
      { a: 'tempo0', label: 'Темп 0' },
      { a: 'eqreset', label: 'Сброс EQ' }
    ]);
    chipSet(d.r('loops'), [1, 2, 4, 8].map(function (n) { return { a: 'loop', v: n, label: String(n), on: !!(d.loop && d.loop.beats === n) }; })
      .concat([{ a: 'loopoff', label: 'Выкл' }]));
    chipSet(d.r('gridc'), [{ a: 'half', label: '÷2' }, { a: 'dbl', label: '×2' }, { a: 'tap', label: 'TAP' }, { a: 'first', label: '1-я доля' }, { a: 'auto', label: 'Авто' }]);
    paintTransport(d);
    d.last = {};
  }
  function setText(d, n, v) { if (d.last[n] !== v) { d.last[n] = v; d.r(n).textContent = v; } }

  /* ---------- drawing ---------- */
  function fit(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    cv._w = w; cv._h = h; return g;
  }
  function drawWave(d) {
    var g = fit(d.cvWave); if (!g) return;
    var W = d.cvWave._w, H = d.cvWave._h, col = COLORS[d.k];
    g.clearRect(0, 0, W, H);
    var t = d.el.currentTime || 0, win = 8 * rate(d), t0 = t - win / 2, pps = W / win, mid = H / 2, i;
    if (d.id && d.bpm) {
      var P = period(d), k0 = Math.ceil((t0 - d.off) / P);
      for (var kk = k0; ; kk++) {
        var bt = d.off + kk * P; if (bt > t0 + win) break;
        var bx = Math.round((bt - t0) * pps), bar = ((kk % 4) + 4) % 4 === 0;
        g.fillStyle = bar ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.12)';
        g.fillRect(bx, bar ? 0 : H * 0.25, 1, bar ? H : H * 0.5);
      }
    }
    if (d.loop) {
      var lx0 = (d.loop.start - t0) * pps, lx1 = (d.loop.end - t0) * pps;
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(lx0, 0, lx1 - lx0, H);
      g.fillStyle = col; g.fillRect(lx0, 0, 2, H); g.fillRect(lx1 - 2, 0, 2, H);
    }
    if (d.peaks) {
      var pk = d.peaks;
      for (var x = 0; x < W; x += 2) {
        var ta = t0 + x / pps, tb = ta + 2 / pps;
        var ia = Math.max(0, Math.floor(ta * 100)), ib = Math.min(pk.length - 1, Math.ceil(tb * 100));
        if (ib < ia) continue;
        var m = 0; for (i = ia; i <= ib; i++) if (pk[i] > m) m = pk[i];
        var h = Math.max(1, m * (H - 10) / 2);
        g.globalAlpha = x < W / 2 ? 0.45 : 0.95; g.fillStyle = col;
        g.fillRect(x, mid - h, 1.6, h * 2);
      }
      g.globalAlpha = 1;
    } else if (d.id) {
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, mid - 1, W, 2);
    }
    if (d.id && d.cue > 0) {
      var cx = (d.cue - t0) * pps;
      if (cx >= 0 && cx <= W) { g.fillStyle = '#fff'; g.fillRect(cx, 0, 1, H); g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx + 7, 0); g.lineTo(cx, 8); g.fill(); }
    }
    g.fillStyle = '#fff'; g.fillRect(Math.round(W / 2) - 1, 0, 2, H);
  }
  function drawOver(d) {
    var g = fit(d.cvOver); if (!g) return;
    var W = d.cvOver._w, H = d.cvOver._h, col = COLORS[d.k];
    g.clearRect(0, 0, W, H);
    if (d.peaks) {
      if (!d.overCv || d.overW !== W) {
        var oc = document.createElement('canvas'); oc.width = Math.round(W); oc.height = Math.round(H);
        var og = oc.getContext('2d'), pk = d.peaks, per = pk.length / oc.width;
        og.fillStyle = col; og.globalAlpha = 0.8;
        for (var x = 0; x < oc.width; x++) {
          var a = Math.floor(x * per), b = Math.max(a, Math.floor((x + 1) * per) - 1), m = 0;
          for (var i = a; i <= b && i < pk.length; i++) if (pk[i] > m) m = pk[i];
          var h = Math.max(1, m * (oc.height - 4) / 2);
          og.fillRect(x, oc.height / 2 - h, 1, h * 2);
        }
        d.overCv = oc; d.overW = W;
      }
      g.drawImage(d.overCv, 0, 0, W, H);
    }
    var dur = d.el.duration || d.dur;
    if (d.id && dur) {
      if (d.loop) { g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(d.loop.start / dur * W, 0, Math.max(2, (d.loop.end - d.loop.start) / dur * W), H); }
      if (d.cue > 0) { g.fillStyle = '#fff'; g.fillRect(d.cue / dur * W, 0, 1, H); }
      g.fillStyle = '#fff'; g.fillRect(clamp((d.el.currentTime || 0) / dur * W, 0, W - 2), 0, 2, H);
    }
  }
  function drawMeter(d) {
    var lv = 0;
    if (ctx && d.nAn && !d.el.paused) {
      d.nAn.getByteTimeDomainData(d.anBuf);
      var pk = 0; for (var i = 0; i < d.anBuf.length; i++) { var v = Math.abs(d.anBuf[i] - 128); if (v > pk) pk = v; }
      lv = pk / 128;
    }
    d.lvl = Math.max(lv, d.lvl * 0.86);
    var n = Math.round(clamp(d.lvl * 1.15, 0, 1) * 10);
    for (var j = 0; j < 10; j++) d.segs[j].classList.toggle('lit', j < n);
  }
  function frame() {
    if (!openNow) return;
    ['a', 'b'].forEach(function (k) {
      var d = D[k], t = d.el.currentTime || 0, dur = d.el.duration || d.dur || 0, r = rate(d);
      setText(d, 'time', fmt(t));
      setText(d, 'rem', '−' + fmt(Math.max(0, dur - t) / r));
      setText(d, 'bpm', d.bpm ? (d.bpm * r).toFixed(1).replace('.', ',') : '—');
      setText(d, 'pitch', pct((r - 1) * 100));
      drawWave(d); drawOver(d); drawMeter(d);
    });
    raf = requestAnimationFrame(frame);
  }

  /* ---------- events ---------- */
  function bindDeck(d) {
    var sec = d.sec;
    sec.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b || !sec.contains(b)) return;
      var a = b.getAttribute('data-a');
      if (a === 'load') openPick(d.k);
      else if (a === 'play') togglePlay(d);
      else if (a === 'cue') cue(d);
      else if (a === 'sync') syncDeck(d);
      else if (a === 'more') { d.more = !d.more; paintMore(d); }
      else if (a === 'keylock') { d.keylock = !d.keylock; applyRate(d); paintDeck(d); }
      else if (a === 'range') { d.range = d.range === 8 ? 16 : d.range === 16 ? 50 : 8; var tr = d.r('tempo'); tr.min = -d.range; tr.max = d.range; setTempo(d, d.tempo); paintDeck(d); }
      else if (a === 'tempo0') { setTempo(d, 0); }
      else if (a === 'eqreset') { d.eq.low = d.eq.mid = d.eq.high = 0; d.filt = 0; ['low', 'mid', 'high', 'filt'].forEach(function (n) { d.r(n).value = 0; }); applyEq(d); applyFilter(d); }
      else if (a === 'loop') loopSet(d, +b.getAttribute('data-v'));
      else if (a === 'loopoff') { d.loop = null; paintDeck(d); }
      else if (a === 'half' || a === 'dbl' || a === 'tap' || a === 'first' || a === 'auto') gridAct(d, a);
    });
    /* hold-to-nudge keys */
    ['bendM', 'bendP'].forEach(function (a) {
      var b = $('[data-a="' + a + '"]', sec), dir = a === 'bendM' ? -1 : 1;
      function down(e) { e.preventDefault(); d.bend = dir * 0.06; applyRate(d); b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch (x) {} }
      function up() { if (!d.bend) return; d.bend = 0; applyRate(d); b.classList.remove('down'); }
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    });
    d.r('tempo').addEventListener('input', function (e) { setTempo(d, parseFloat(e.target.value)); });
    ['low', 'mid', 'high'].forEach(function (n) {
      d.r(n).addEventListener('input', function (e) { d.eq[n] = parseInt(e.target.value, 10); applyEq(d); });
      d.r(n).addEventListener('dblclick', function (e) { e.target.value = 0; d.eq[n] = 0; applyEq(d); });
    });
    d.r('filt').addEventListener('input', function (e) { d.filt = parseInt(e.target.value, 10) / 100; applyFilter(d); });
    d.r('filt').addEventListener('dblclick', function (e) { e.target.value = 0; d.filt = 0; applyFilter(d); });
    d.r('vol').addEventListener('input', function (e) { d.vol = parseInt(e.target.value, 10) / 100; applyVol(d); });
    /* tap on the overview bar to jump */
    function seekFrom(e) {
      var dur = d.el.duration || d.dur; if (!d.id || !dur) return;
      var rc = d.cvOver.getBoundingClientRect();
      d.el.currentTime = clamp((e.clientX - rc.left) / rc.width, 0, 1) * dur;
    }
    var dragging = false;
    d.cvOver.addEventListener('pointerdown', function (e) { dragging = true; try { d.cvOver.setPointerCapture(e.pointerId); } catch (x) {} seekFrom(e); });
    d.cvOver.addEventListener('pointermove', function (e) { if (dragging) seekFrom(e); });
    d.cvOver.addEventListener('pointerup', function () { dragging = false; });
    d.cvOver.addEventListener('pointercancel', function () { dragging = false; });
    /* drag on the zoomed wave to scrub */
    var sx = null, st = 0;
    d.cvWave.addEventListener('pointerdown', function (e) { if (!d.id) return; sx = e.clientX; st = d.el.currentTime; try { d.cvWave.setPointerCapture(e.pointerId); } catch (x) {} });
    d.cvWave.addEventListener('pointermove', function (e) {
      if (sx === null) return;
      var win = 8 * rate(d), dt = -(e.clientX - sx) / d.cvWave.clientWidth * win;
      d.el.currentTime = clamp(st + dt, 0, d.el.duration || d.dur || st + dt);
    });
    function endScrub() { sx = null; }
    d.cvWave.addEventListener('pointerup', endScrub); d.cvWave.addEventListener('pointercancel', endScrub);
  }

  function chips(box, items, onPick) {
    box.textContent = '';
    items.forEach(function (it) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (it.on ? ' on' : ''); b.textContent = it.label;
      b.addEventListener('click', function () { onPick(it); });
      box.appendChild(b);
    });
  }
  function paintMix() {
    chips($('#djCurve'), [{ label: curve === 'smooth' ? 'Плавная' : 'Резкая' }],
      function () { curve = curve === 'smooth' ? 'cut' : 'smooth'; applyXf(); paintMix(); });
    chips($('#djFadeSec'), [4, 8, 16].map(function (s) { return { s: s, label: s + ' с', on: fadeSec === s }; }),
      function (it) { fadeSec = it.s; paintMix(); });
    $('#djFade').textContent = fadeTimer ? 'Стоп' : (xfPos <= 0.5 ? 'A → B' : 'B → A');
  }
  function stopFade() { if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = 0; } }
  function startFade() {
    if (fadeTimer) { stopFade(); paintMix(); return; }
    var toB = xfPos <= 0.5, inD = D[toB ? 'b' : 'a'], outD = D[toB ? 'a' : 'b'];
    if (!inD.id) { toast('Сначала загрузи трек на деку ' + inD.k.toUpperCase()); return; }
    ensureCtx();
    if (inD.el.paused) {
      if (outD.id && !outD.el.paused && inD.bpm && outD.bpm) syncDeck(inD, true);
      inD.el.play().catch(function () {});
    }
    var from = xfPos, target = toB ? 1 : 0, t0 = performance.now(), dur = fadeSec * 1000;
    fadeTimer = setInterval(function () {
      var p = Math.min(1, (performance.now() - t0) / dur);
      xfPos = from + (target - from) * p;
      $('#djXf').value = Math.round(xfPos * 100); applyXf();
      if (p >= 1) { stopFade(); paintMix(); }
    }, 40);
    paintMix();
  }
  $('#djXf').addEventListener('input', function (e) { stopFade(); xfPos = parseInt(e.target.value, 10) / 100; applyXf(); paintMix(); });
  $('#djMaster').addEventListener('input', function (e) { masterVol = parseInt(e.target.value, 10) / 100; if (ctx) set(master.gain, masterVol); });
  $('#djFade').addEventListener('click', startFade);

  /* ---------- track picker ---------- */
  function openPick(k) {
    pickKey = k; $('#djPickTitle').textContent = 'Трек на деку ' + k.toUpperCase();
    $('#djPickQ').value = ''; renderPick(); $('#djPick').hidden = false;
  }
  function closePick() { $('#djPick').hidden = true; }
  function renderPick() {
    var q = $('#djPickQ').value.trim().toLowerCase(), list = $('#djPickList'); list.textContent = '';
    var items = MM.tracks().filter(function (t) { return !MM.isVid(t); });
    if (q) items = items.filter(function (t) { return ((t.title || '') + ' ' + (t.artist || '')).toLowerCase().indexOf(q) !== -1; });
    if (!items.length) { var em = document.createElement('div'); em.className = 'hint2'; em.textContent = q ? 'Ничего не найдено' : 'В библиотеке нет звуковых треков'; list.appendChild(em); return; }
    items.slice(0, 300).forEach(function (t) {
      var b = document.createElement('button'); b.type = 'button';
      b.className = 'pk' + (D.a.id === t.id || D.b.id === t.id ? ' used' : '');
      var tx = document.createElement('div'); tx.className = 't';
      var s1 = document.createElement('b'); s1.textContent = t.title;
      var s2 = document.createElement('span'); s2.textContent = (t.artist || 'Без исполнителя') + (t.duration ? ' · ' + fmt(t.duration) : '');
      tx.appendChild(s1); tx.appendChild(s2); b.appendChild(tx);
      if (grid[t.id] && grid[t.id].bpm) { var em2 = document.createElement('em'); em2.textContent = Math.round(grid[t.id].bpm) + ' BPM'; b.appendChild(em2); }
      b.addEventListener('click', function () { closePick(); loadDeck(pickKey, t.id); });
      list.appendChild(b);
    });
  }
  $('#djPickQ').addEventListener('input', renderPick);
  $('#djPickClose').addEventListener('click', closePick);
  $('#djPick').addEventListener('click', function (e) { if (e.target === $('#djPick')) closePick(); });


  /* ---------- mix recording: what you hear -> WAV (stereo, 16-bit) ---------- */
  var rec = null, recFile = null, recUrl = null;
  function wavHeader(frames, sr) {
    var buf = new ArrayBuffer(44), v = new DataView(buf), n = frames * 4;
    function str(o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n, true);
    return buf;
  }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + '.' + p(d.getMinutes());
  }
  function recStart() {
    if (!ensureCtx()) { toast('Здесь не работает Web Audio'); return; }
    var node = ctx.createScriptProcessor(16384, 2, 2), mute = ctx.createGain(); mute.gain.value = 0;
    var r = { node: node, mute: mute, chunks: [], frames: 0, sr: ctx.sampleRate, t0: Date.now(), timer: 0 };
    node.onaudioprocess = function (e) {
      var l = e.inputBuffer.getChannelData(0), rr = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : l;
      var out = new Int16Array(l.length * 2);
      for (var i = 0; i < l.length; i++) {
        var a = Math.max(-1, Math.min(1, l[i])), b = Math.max(-1, Math.min(1, rr[i]));
        out[i * 2] = a < 0 ? a * 0x8000 : a * 0x7fff; out[i * 2 + 1] = b < 0 ? b * 0x8000 : b * 0x7fff;
      }
      r.chunks.push(out); r.frames += l.length;
    };
    limiter.connect(node); node.connect(mute); mute.connect(ctx.destination);
    rec = r;
    var btn = $('#djRecBtn'); btn.classList.add('rec');
    r.timer = setInterval(function () {
      var s = (Date.now() - r.t0) / 1000;
      btn.textContent = '■ ' + fmt(s);
      if (s > 900) { toast('Запись остановлена: лимит 15 минут'); recStop(); }
    }, 300);
    btn.textContent = '■ 0:00';
  }
  function recStop(silent) {
    if (!rec) return null;
    var r = rec; rec = null;
    clearInterval(r.timer);
    try { limiter.disconnect(r.node); r.node.disconnect(); r.mute.disconnect(); } catch (e) {}
    r.node.onaudioprocess = null;
    var btn = $('#djRecBtn'); btn.classList.remove('rec'); btn.textContent = '● REC';
    if (r.frames < r.sr) { if (!silent) toast('Слишком коротко, запись выброшена'); return null; }
    var file = new File([wavHeader(r.frames, r.sr)].concat(r.chunks), 'Микс ' + stamp() + '.wav', { type: 'audio/wav' });
    return { file: file, sec: r.frames / r.sr };
  }
  function recPanel(res) {
    recFile = res.file;
    if (recUrl) URL.revokeObjectURL(recUrl);
    recUrl = URL.createObjectURL(recFile);
    $('#djRecAudio').src = recUrl;
    $('#djRecInfo').textContent = recFile.name + ' · ' + fmt(res.sec) + ' · ' + Math.max(1, Math.round(recFile.size / 1e6)) + ' МБ (без сжатия)';
    $('#djRecPanel').hidden = false;
  }
  function recClosePanel(drop) {
    var au = $('#djRecAudio'); try { au.pause(); } catch (e) {}
    $('#djRecPanel').hidden = true;
    if (drop && recUrl) { au.removeAttribute('src'); au.load(); URL.revokeObjectURL(recUrl); recUrl = null; recFile = null; }
  }
  $('#djRecBtn').addEventListener('click', function () {
    if (!rec) { recStart(); toast('Запись пошла: играй, мешай и жми ■'); return; }
    var res = recStop(); if (res) recPanel(res);
  });
  $('#djRecClose').addEventListener('click', function () { recClosePanel(false); });
  $('#djRecDrop').addEventListener('click', function () { recClosePanel(true); });
  $('#djRecSave').addEventListener('click', function () {
    if (!recFile) return;
    MM.addFiles([recFile]); toast('Микс добавлен в библиотеку'); recClosePanel(true);
  });
  $('#djRecDl').addEventListener('click', function () {
    if (!recFile) return;
    var a = document.createElement('a'); a.href = recUrl; a.download = recFile.name; document.body.appendChild(a); a.click(); a.remove();
  });

  /* ---------- open / close ---------- */
  function wake() {
    try {
      if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l; l.addEventListener('release', function () { if (wakeLock === l) wakeLock = null; });
      }).catch(function () {});
    } catch (e) {}
  }
  function openDj() {
    if (openNow) return;
    if (!ensureCtx()) { toast('Здесь не работает Web Audio'); return; }
    MM.pauseMain(); MM.closeSheet(); themeColor();
    root.hidden = false; document.body.classList.add('dj-open'); openNow = true;
    try { history.pushState({ dj: 1 }, ''); } catch (e) {}
    paintMix(); paintDeck(D.a); paintDeck(D.b);
    raf = requestAnimationFrame(frame);
    loopTimer = setInterval(loopCheck, 10);
    wake();
    if (!D.a.id && !D.b.id) toast('Выбери трек на деку: кнопка «Трек»');
  }
  function closeDj(fromPop) {
    if (!openNow) return;
    stopFade(); closePick();
    if (rec) { var rr = recStop(true); if (rr) { MM.addFiles([rr.file]); MM.toast('Микс сохранён в библиотеку'); } }
    recClosePanel(false);
    ['a', 'b'].forEach(function (k) { try { D[k].el.pause(); } catch (e) {} });
    openNow = false; cancelAnimationFrame(raf); clearInterval(loopTimer);
    root.hidden = true; document.body.classList.remove('dj-open');
    try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null;
    if (!fromPop) { try { if (history.state && history.state.dj) history.back(); } catch (e) {} }
  }
  window.addEventListener('popstate', function () { if (openNow) closeDj(true); });
  document.addEventListener('visibilitychange', function () { if (openNow && document.visibilityState === 'visible' && !wakeLock) wake(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !openNow) return;
    if (!$('#djPick').hidden) closePick(); else closeDj();
  });
  $('#djClose').addEventListener('click', function () { closeDj(); });
  var openBtn = document.getElementById('djBtn');
  if (openBtn) openBtn.addEventListener('click', openDj);

  D.a = makeDeck('a'); D.b = makeDeck('b');
  paintDeck(D.a); paintDeck(D.b); paintMix();
  /* ритм трека для других модулей (монтаж): темп и смещение первой доли */
  function analyzeTrack(id) {
    var tr = MM.find(id); if (!tr) return Promise.resolve(null);
    var gg = grid[id]; if (gg && gg.bpm) return Promise.resolve({ bpm: gg.bpm, off: gg.off || 0 });
    if (tr.blob.size > 70e6) return Promise.resolve(null);
    return decode(tr.blob).then(function (buf) {
      var r = analyze(buf);
      if (!r.bpm) return null;
      grid[id] = { bpm: r.bpm, off: r.off }; saveGrid();
      return { bpm: r.bpm, off: r.off };
    }).catch(function () { return null; });
  }
  /* ритм звука из любого файла (например звук видео-клипа в монтаже); key нужен, чтобы запомнить результат */
  function analyzeBlob(key, blob) {
    var gg = grid[key]; if (gg && gg.bpm) return Promise.resolve({ bpm: gg.bpm, off: gg.off || 0 });
    if (!blob || blob.size > 150e6) return Promise.resolve(null);
    return decode(blob).then(function (buf) {
      var r = analyze(buf);
      if (!r.bpm) return null;
      grid[key] = { bpm: r.bpm, off: r.off }; saveGrid();
      return { bpm: r.bpm, off: r.off };
    }).catch(function () { return null; });
  }
  window.DJ = { open: openDj, load: function (k, id) { openDj(); if (openNow) loadDeck(k, id); }, analyzeTrack: analyzeTrack, analyzeBlob: analyzeBlob };
})();
