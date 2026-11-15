/* «Что за песня?»: слушает микрофоном ~12 секунд, отправляет короткую запись в AudD и показывает название и ссылки.
   Ключ (токен) AudD хранится только на этом устройстве. */
(function () {
  'use strict';
  var MM = window.MM;
  var root = document.getElementById('ls');
  if (!MM || !root) return;
  var $ = function (s) { return root.querySelector(s); };
  var TOKEN_KEY = 'mm.audd.token', HIST_KEY = 'mm.listen.history';
  var REC_SEC = 12, RATE = 16000;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var state = 'idle', rec = null, cancelled = false;

  function show(s, msg) {
    state = s;
    ['setup', 'idle', 'listen', 'busy', 'result', 'miss', 'err'].forEach(function (n) { $('[data-s="' + n + '"]').hidden = n !== s; });
    if (msg !== undefined) { var m = $('[data-s="' + s + '"] .ls-msg'); if (m) m.textContent = msg; }
  }
  function open() {
    MM.pauseMain(); MM.closeSheet();
    root.hidden = false; document.body.classList.add('ls-open');
    show(lsGet(TOKEN_KEY) ? 'idle' : 'setup');
    paintHistory();
  }
  function close() {
    cancelRec(); root.hidden = true; document.body.classList.remove('ls-open');
  }

  /* ---- recording: raw audio -> 16 kHz mono WAV ---- */
  function downsample(chunks, inRate) {
    var total = 0, i; chunks.forEach(function (c) { total += c.length; });
    var all = new Float32Array(total), o = 0; chunks.forEach(function (c) { all.set(c, o); o += c.length; });
    if (inRate === RATE) return all;
    var ratio = inRate / RATE, n = Math.floor(all.length / ratio), out = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var a = Math.floor(i * ratio), b = Math.min(all.length, Math.floor((i + 1) * ratio)), s = 0;
      for (var j = a; j < b; j++) s += all[j];
      out[i] = b > a ? s / (b - a) : 0;
    }
    return out;
  }
  function toWav(f32) {
    var n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), i;
    function str(o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    var peak = 0; for (i = 0; i < n; i++) { var a = Math.abs(f32[i]); if (a > peak) peak = a; }
    var gain = peak > 0.001 && peak < 0.5 ? 0.8 / peak : 1;  /* quiet room recording: bring it up */
    for (i = 0; i < n; i++) { var x = Math.max(-1, Math.min(1, f32[i] * gain)); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }
  function cancelRec() {
    cancelled = true;
    if (!rec) return;
    try { rec.node.disconnect(); rec.src.disconnect(); } catch (e) {}
    try { rec.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { rec.ctx.close(); } catch (e) {}
    clearInterval(rec.timer); rec = null;
  }
  function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { show('err', 'Здесь нет доступа к микрофону. Открой приложение по https.'); return; }
    cancelled = false;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
      if (cancelled) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      var AC = window.AudioContext || window.webkitAudioContext, ctx;
      try { ctx = new AC({ sampleRate: RATE }); } catch (e) { ctx = new AC(); }
      var src = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(4096, 1, 1), chunks = [], got = 0, lvl = 0;
      var t0 = Date.now();
      node.onaudioprocess = function (e) {
        var d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d)); got += d.length;
        var p = 0; for (var i = 0; i < d.length; i += 16) { var a = Math.abs(d[i]); if (a > p) p = a; }
        lvl = Math.max(p, lvl * 0.8);
      };
      var mute = ctx.createGain(); mute.gain.value = 0;
      src.connect(node); node.connect(mute); mute.connect(ctx.destination);
      rec = { ctx: ctx, src: src, node: node, stream: stream, timer: 0 };
      show('listen');
      var bar = $('.ls-bar i'), meter = $('.ls-level i');
      rec.timer = setInterval(function () {
        var p = Math.min(1, (Date.now() - t0) / (REC_SEC * 1000));
        bar.style.width = (p * 100).toFixed(1) + '%';
        meter.style.transform = 'scaleX(' + Math.min(1, lvl * 3).toFixed(2) + ')';
        $('[data-s="listen"] .ls-sec').textContent = Math.max(0, Math.ceil(REC_SEC - p * REC_SEC)) + ' с';
        if (p >= 1) finish(ctx.sampleRate, chunks);
      }, 100);
    }).catch(function (e) {
      show('err', e && e.name === 'NotAllowedError' ? 'Нет доступа к микрофону. Разреши его в настройках сайта или приложения.' : 'Не удалось включить микрофон.');
    });
  }
  function finish(inRate, chunks) {
    cancelRec(); cancelled = false;
    show('busy');
    var wav = toWav(downsample(chunks, inRate));
    recognize(lsGet(TOKEN_KEY), wav).then(handle).catch(function () {
      show('err', 'Не удалось связаться с сервисом. Проверь интернет и попробуй ещё раз.');
    });
  }

  /* ---- AudD ---- */
  function toBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1] || ''); };
      r.onerror = rej; r.readAsDataURL(blob);
    });
  }
  function recognize(token, wav) {
    var fd = new FormData();
    fd.append('api_token', token); fd.append('return', 'apple_music,spotify'); fd.append('file', wav, 'clip.wav');
    return fetch('https://api.audd.io/', { method: 'POST', body: fd }).catch(function () {
      /* the browser may block the direct call; go through the small function on our own site */
      return toBase64(wav).then(function (b64) {
        return fetch('/.netlify/functions/recognize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token, audio: b64 }) });
      });
    }).then(function (r) { return r.json(); });
  }
  function handle(j) {
    if (!j || j.status === 'error' || j.error) {
      var code = j && j.error && j.error.error_code;
      if (code === 900 || code === 901) { show('err', 'Сервис не принял ключ: он неверный или закончились запросы. Проверь его в настройках распознавания.'); return; }
      show('err', 'Сервис вернул ошибку' + (code ? ' #' + code : '') + '. Попробуй ещё раз.'); return;
    }
    var r = j.result;
    if (!r || (Array.isArray(r) && !r.length)) { show('miss'); return; }
    showResult(r);
  }

  /* ---- result ---- */
  function safeUrl(u) { return typeof u === 'string' && /^https:\/\//i.test(u) ? u : null; }
  function enc(s) { return encodeURIComponent(s); }
  function addLink(box, label, url) {
    if (!url) return;
    var a = document.createElement('a'); a.className = 'chip'; a.textContent = label; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    box.appendChild(a);
  }
  function linksFor(r) {
    var q = enc((r.artist || '') + ' ' + (r.title || ''));
    var am = r.apple_music || {}, sp = r.spotify || {};
    var sUrl = sp.external_urls && sp.external_urls.spotify;
    return [
      ['Все сервисы', safeUrl(r.song_link)],
      ['Apple Music', safeUrl(am.url)],
      ['Spotify', safeUrl(sUrl)],
      ['YouTube', 'https://www.youtube.com/results?search_query=' + q],
      ['YouTube Music', 'https://music.youtube.com/search?q=' + q],
      ['Bandcamp', 'https://bandcamp.com/search?q=' + q]
    ];
  }
  function artOf(r) {
    var am = r.apple_music && r.apple_music.artwork && r.apple_music.artwork.url;
    if (am) return safeUrl(am.replace('{w}', '300').replace('{h}', '300'));
    var im = r.spotify && r.spotify.album && r.spotify.album.images && r.spotify.album.images[0];
    return im ? safeUrl(im.url) : null;
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim(); }
  function inLibrary(r) {
    var t = norm(r.title);
    if (!t) return null;
    var list = MM.tracks();
    for (var i = 0; i < list.length; i++) { var x = norm(list[i].title); if (x && (x === t || x.indexOf(t) !== -1)) return list[i]; }
    return null;
  }
  function showResult(r) {
    $('.ls-t').textContent = r.title || 'Без названия';
    $('.ls-a').textContent = r.artist || '';
    $('.ls-meta').textContent = [r.album, r.release_date && String(r.release_date).slice(0, 4), r.label].filter(Boolean).join(' · ');
    var art = $('.ls-art'), u = artOf(r);
    art.style.backgroundImage = u ? 'url("' + u + '")' : ''; art.classList.toggle('empty', !u);
    var box = $('.ls-links'); box.textContent = '';
    linksFor(r).forEach(function (l) { addLink(box, l[0], l[1]); });
    var have = inLibrary(r);
    $('.ls-have').textContent = have ? 'Уже есть в твоей библиотеке: «' + have.title + '»' : '';
    show('result');
    pushHistory({ title: r.title || '', artist: r.artist || '', link: safeUrl(r.song_link) || 'https://www.youtube.com/results?search_query=' + enc((r.artist || '') + ' ' + (r.title || '')), ts: Date.now() });
  }

  /* ---- history ---- */
  function history() { try { return JSON.parse(lsGet(HIST_KEY) || '[]') || []; } catch (e) { return []; } }
  function pushHistory(h) {
    var list = history().filter(function (x) { return !(x.title === h.title && x.artist === h.artist); });
    list.unshift(h); lsSet(HIST_KEY, JSON.stringify(list.slice(0, 30))); paintHistory();
  }
  function paintHistory() {
    var list = history(), box = $('.ls-hist'); box.textContent = '';
    $('.ls-hist-h').hidden = !list.length;
    list.slice(0, 8).forEach(function (h) {
      var a = document.createElement('a'); a.className = 'ls-hrow'; a.href = h.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
      var t = document.createElement('b'); t.textContent = h.title || 'Без названия';
      var s = document.createElement('span'); s.textContent = h.artist || '';
      a.appendChild(t); a.appendChild(s); box.appendChild(a);
    });
  }

  /* ---- buttons ---- */
  $('[data-a="listen"]').addEventListener('click', start);
  $('[data-a="again"]').addEventListener('click', function () { show('idle'); start(); });
  $('[data-a="again2"]').addEventListener('click', function () { show('idle'); start(); });
  $('[data-a="again3"]').addEventListener('click', function () { show('idle'); });
  $('[data-a="stop"]').addEventListener('click', function () { cancelRec(); show('idle'); });
  $('[data-a="key"]').addEventListener('click', function () { $('#lsToken').value = lsGet(TOKEN_KEY) || ''; show('setup'); });
  $('[data-a="saveKey"]').addEventListener('click', function () {
    var v = $('#lsToken').value.trim();
    if (!v) { $('.ls-hint-err').textContent = 'Вставь ключ.'; return; }
    $('.ls-hint-err').textContent = ''; lsSet(TOKEN_KEY, v); show('idle');
  });
  $('[data-a="close"]').addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !root.hidden) close(); });
  var b = document.getElementById('lsBtn'); if (b) b.addEventListener('click', open);
  window.Listen = { open: open };
})();
