/* ---- Караоке: текст песни, подсветка слов в такт, «Минус», расстановка времени тапами ---- */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var store = {};
  try { store = JSON.parse(localStorage.getItem('mm.kar') || '{}') || {}; } catch (e) {}
  function save() { try { localStorage.setItem('mm.kar', JSON.stringify(store)); } catch (e) { MM.toast('Не хватило места, текст не сохранён'); } }
  var id = null, data = null, idx = -2, raf = 0, syncing = false, syncI = 0, syncLines = null, size = 26, OFFSET = 0.18, lastWords = null;
  try { var sz = parseInt(localStorage.getItem('mm.karsize'), 10); if (sz >= 18 && sz <= 40) size = sz; } catch (e) {}

  function fmtT(s) { s = Math.max(0, s || 0); var m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + Math.floor(r); }
  function stamp(t) { var m = Math.floor(t / 60), r = t - m * 60; return '[' + (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r.toFixed(2) + ']'; }
  function synced(d) { return !!(d && d.lines.length && d.lines.every(function (l) { return l.t != null; })); }

  function parse(text) {
    var lines = [], re = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var s = raw.replace(/<\d+:\d+(?:[.:]\d+)?>/g, ''), stamps = [], m, body = s;
      re.lastIndex = 0;
      while ((m = re.exec(s))) { var frac = m[3] ? parseFloat('0.' + m[3]) : 0; stamps.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac); }
      body = s.replace(re, '').replace(/\s+/g, ' ').trim();
      if (!body) return;
      if (/^(ar|ti|al|by|offset|length|re|ve):/i.test(body)) return;
      if (/^[\[(]?\s*(куплет|припев|бридж|проигрыш|вступление|окончание|соло|строфа|verse|chorus|bridge|intro|outro|pre-?chorus|hook)\s*\d*\s*[\])]?\s*:?$/i.test(body)) return;
      if (stamps.length) stamps.forEach(function (t) { lines.push({ t: t, w: body }); });
      else lines.push({ t: null, w: body });
    });
    if (lines.some(function (l) { return l.t != null; })) {
      lines = lines.filter(function (l) { return l.t != null; }).sort(function (a, b) { return a.t - b.t; });
    }
    return lines;
  }
  function serialize(d) {
    if (!d) return '';
    return d.lines.map(function (l) { return (l.t != null ? stamp(l.t) + ' ' : '') + l.w; }).join('\n');
  }

  function load(tid) { id = tid; data = tid && store[tid] ? store[tid] : null; idx = -2; buildLines(); }
  function buildLines() {
    var box = $('#karLines'); box.textContent = ''; lastWords = null;
    $('#karEmpty').hidden = !!(data && data.lines.length);
    $('#karView').classList.toggle('free', !synced(data));
    if (!data) return;
    data.lines.forEach(function (l, i) {
      var d = document.createElement('div'); d.className = 'kl'; d.dataset.i = i;
      l.w.split(' ').forEach(function (w, j, arr) {
        var sp = document.createElement('span'); sp.className = 'kw'; sp.textContent = w; d.appendChild(sp);
        if (j < arr.length - 1) d.appendChild(document.createTextNode(' '));
      });
      d.addEventListener('click', function () {
        if (syncing || l.t == null) return;
        var a = MM.audio(); try { a.currentTime = Math.max(0, l.t - 0.05); } catch (e) {} a.play().catch(function () {});
      });
      box.appendChild(d);
    });
    $('#karView').style.setProperty('--ks', size + 'px');
    box.parentNode.style.setProperty('--ks', size + 'px');
  }
  function lineAt(t) {
    if (!synced(data)) return -1;
    var L = data.lines, lo = 0, hi = L.length - 1, r = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (L[mid].t <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  function center(i) {
    var box = $('#karLines'), view = $('#karView'), el = box.children[Math.max(0, i)]; if (!el) return;
    var y = view.clientHeight * 0.42 - (el.offsetTop + el.offsetHeight / 2);
    box.style.transform = 'translateY(' + Math.round(y) + 'px)';
  }
  function paintIdx(i) {
    var kids = $('#karLines').children, j;
    for (j = 0; j < kids.length; j++) { kids[j].classList.toggle('on', j === i); kids[j].classList.toggle('past', j < i); }
    lastWords = i >= 0 && kids[i] ? kids[i].querySelectorAll('.kw') : null;
    if (synced(data)) center(i);
  }
  function tick() {
    raf = 0; if ($('#kar').hidden) return;
    if (MM.cur() !== id) { load(MM.cur()); paintTitle(); paintChips(); }
    var a = MM.audio(), t = a.currentTime || 0, dur = isFinite(a.duration) ? a.duration : 0;
    if (!$('#karSeek').matches(':active')) { $('#karSeek').max = dur || 100; $('#karSeek').value = t; }
    $('#karT').textContent = fmtT(t); $('#karD').textContent = fmtT(dur);
    $('#karPlay').innerHTML = a.paused ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
    if (synced(data) && !syncing) {
      var i = lineAt(t + 0.04);
      if (i !== idx) { idx = i; paintIdx(i); }
      if (i >= 0 && lastWords) {
        var L = data.lines, cur = L[i], next = L[i + 1], gap = next ? next.t - cur.t : 8, chars = cur.w.replace(/\s/g, '').length;
        var sung = Math.min(Math.max(1.0, chars * 0.085), 9), span = Math.max(0.5, Math.min(sung, gap * 0.94));
        var P = Math.min(1, Math.max(0, (t - cur.t) / span)) * chars, cum = 0;
        lastWords.forEach(function (w) {
          var n = w.textContent.length, f = Math.min(1, Math.max(0, (P - cum) / n)); cum += n;
          w.style.setProperty('--f', (f * 100).toFixed(1) + '%');
        });
      }
    }
    raf = requestAnimationFrame(tick);
  }
  function paintTitle() { var t = MM.find(id); $('#karTitle').textContent = t ? t.title : 'Караоке'; }
  function chip(label, on, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (on ? ' on' : ''); b.textContent = label; b.addEventListener('click', fn); return b; }
  function shift(dt) {
    if (!synced(data)) return;
    data.lines.forEach(function (l) { l.t = Math.max(0, l.t + dt); }); store[id] = data; save(); idx = -2;
    MM.toast('Строки сдвинуты на ' + (dt > 0 ? '+' : '') + dt.toFixed(1).replace('.', ',') + ' с');
  }
  function paintChips() {
    var box = $('#karChips'); box.textContent = '';
    box.appendChild(chip(MM.vocalCut() ? '✓ Минус (голос тише)' : 'Минус (голос тише)', MM.vocalCut(), function () {
      var on = !MM.vocalCut(); if (!MM.setVocalCut(on)) { MM.toast('Здесь не получилось включить «Минус»'); return; }
      MM.toast(on ? 'Минус включён: голос приглушён (лучше работает на стерео-песнях)' : 'Минус выключен'); paintChips();
    }));
    box.appendChild(chip('Текст', false, openEdit));
    box.appendChild(chip(synced(data) ? 'Переставить время' : 'Расставить время', false, startSync));
    if (synced(data)) { box.appendChild(chip('Раньше −0,1', false, function () { shift(-0.1); })); box.appendChild(chip('Позже +0,1', false, function () { shift(0.1); })); }
    box.appendChild(chip('A−', false, function () { setSize(size - 2); }));
    box.appendChild(chip('A+', false, function () { setSize(size + 2); }));
  }
  function setSize(v) {
    size = Math.max(18, Math.min(40, v)); try { localStorage.setItem('mm.karsize', String(size)); } catch (e) {}
    $('#karView').style.setProperty('--ks', size + 'px'); setTimeout(function () { center(idx); }, 30);
  }
  /* --- ввод текста --- */
  function openEdit() { $('#karTa').value = serialize(data); $('#karEdit').hidden = false; }
  function saveEdit() {
    var lines = parse($('#karTa').value);
    if (!lines.length) { MM.toast('Текст пустой'); return; }
    data = { lines: lines }; store[id] = data; save(); $('#karEdit').hidden = true; buildLines(); paintChips(); idx = -2;
    MM.toast(synced(data) ? 'Текст со временем сохранён' : 'Текст сохранён: теперь расставь время');
    if (!synced(data)) startSync();
  }
  /* --- расстановка времени --- */
  function startSync() {
    if (!data || !data.lines.length) { openEdit(); return; }
    syncing = true; syncI = 0; syncLines = data.lines.map(function (l) { return { t: null, w: l.w }; });
    $('#karSync').hidden = false; $('#karView').classList.add('free'); paintSync();
    var a = MM.audio(); try { a.currentTime = 0; } catch (e) {} a.play().catch(function () {});
    MM.toast('Слушай песню и нажимай большую кнопку, когда начинается строка');
  }
  function paintSync() {
    $('#karPrev').textContent = syncI > 0 ? syncLines[syncI - 1].w : '';
    $('#karNext').textContent = syncLines[syncI] ? syncLines[syncI].w : '';
    $('#karTap').textContent = 'Строка началась (' + (syncI + 1) + ' из ' + syncLines.length + ')';
  }
  function tap() {
    if (!syncing) return;
    var a = MM.audio(), t = Math.max(0, (a.currentTime || 0) - OFFSET), prev = syncI > 0 ? syncLines[syncI - 1].t : 0;
    syncLines[syncI].t = Math.max(prev + 0.05, t); syncI++;
    if (syncI >= syncLines.length) { finishSync(true); return; }
    paintSync();
  }
  function undo() { if (!syncing || syncI <= 0) return; syncI--; syncLines[syncI].t = null; var a = MM.audio(); try { a.currentTime = Math.max(0, (syncI > 0 ? syncLines[syncI - 1].t : 0) - 1.5); } catch (e) {} paintSync(); }
  function finishSync(ok) {
    syncing = false; $('#karSync').hidden = true;
    if (ok) {
      data = { lines: syncLines }; store[id] = data; save();
      var a = MM.audio(); try { a.currentTime = Math.max(0, data.lines[0].t - 2); } catch (e) {}
      MM.toast('Готово! Если строки чуть опаздывают или спешат, сдвинь кнопками «Раньше» и «Позже»');
    }
    syncLines = null; idx = -2; buildLines(); paintChips();
  }
  /* --- открыть / закрыть --- */
  function open() {
    if (!MM.cur()) { MM.toast('Сначала включи песню, потом открой караоке'); return; }
    var t = MM.find(MM.cur()); if (t && MM.isVid(t)) { MM.toast('Караоке работает с песнями, не с фильмами'); return; }
    document.body.classList.add('kar-open'); $('#kar').hidden = false; load(MM.cur()); paintTitle(); paintChips();
    if (!data) { /* пустой экран подскажет, что делать */ }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function close() { if (syncing) finishSync(false); $('#kar').hidden = true; $('#karEdit').hidden = true; document.body.classList.remove('kar-open'); }
  var btn = $('#karBtn'); if (btn) btn.addEventListener('click', open);
  $('#karClose').addEventListener('click', close);
  $('#karPlay').addEventListener('click', function () { MM.togglePlay(); });
  $('#karSeek').addEventListener('input', function () { try { MM.audio().currentTime = parseFloat(this.value); } catch (e) {} });
  $('#karAddTxt').addEventListener('click', openEdit);
  $('#karSave').addEventListener('click', saveEdit);
  $('#karCancel').addEventListener('click', function () { $('#karEdit').hidden = true; });
  $('#karDel').addEventListener('click', function () { delete store[id]; save(); data = null; $('#karEdit').hidden = true; idx = -2; buildLines(); paintChips(); MM.toast('Текст удалён'); });
  $('#karTap').addEventListener('click', tap);
  $('#karUndo').addEventListener('click', undo);
  $('#karRestart').addEventListener('click', function () { if (!syncing) return; syncI = 0; syncLines.forEach(function (l) { l.t = null; }); var a = MM.audio(); try { a.currentTime = 0; } catch (e) {} a.play().catch(function () {}); paintSync(); });
  $('#karSyncX').addEventListener('click', function () { finishSync(false); });
  window.Karaoke = {
    open: open,
    linesFor: function (tid) { var d = store[tid]; return synced(d) ? d.lines.map(function (l) { return { t: l.t, w: l.w }; }) : null; }
  };
})();
