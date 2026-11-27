/* ---- Будильник: время, песня, дни недели, плавный старт, Wake Lock ---- */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var DN = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  var cfg = { on: false, time: '07:00', track: '', fade: 30, days: [1, 2, 3, 4, 5, 6, 0] };
  try { cfg = Object.assign(cfg, JSON.parse(localStorage.getItem('mm.alarm') || '{}')); } catch (e) {}
  var lock = null, timer = 0, ringing = false, firedKey = '', fadeT = 0, snoozeAt = 0;
  function save() { try { localStorage.setItem('mm.alarm', JSON.stringify(cfg)); } catch (e) {} }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nextTime() {
    var p = cfg.time.split(':'), now = new Date();
    for (var k = 0; k < 8; k++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, +p[0], +p[1], 0);
      if (d > now && cfg.days.indexOf(d.getDay()) >= 0) return d;
    }
    return null;
  }
  function paintState() {
    var el = $('#alrState'), t = $('#alrToggle');
    t.textContent = cfg.on ? 'Выключить будильник' : 'Включить будильник';
    if (!cfg.on) { el.textContent = 'Будильник выключен'; return; }
    var n = snoozeAt || (nextTime() || 0);
    el.textContent = n ? 'Зазвонит: ' + (n instanceof Date ? n : new Date(n)).toLocaleString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Выбери хотя бы один день';
  }
  function fillTracks() {
    var s = $('#alrTrack'); s.textContent = '';
    MM.tracks().filter(function (t) { return !MM.isVid(t); }).forEach(function (t) {
      var o = document.createElement('option'); o.value = t.id; o.textContent = t.title; s.appendChild(o);
    });
    if (!s.options.length) { var o = document.createElement('option'); o.value = ''; o.textContent = 'Сначала добавь песни'; s.appendChild(o); }
    if (cfg.track && MM.find(cfg.track)) s.value = cfg.track; else if (s.options.length) cfg.track = s.value;
  }
  function paintDays() {
    var box = $('#alrDays'); box.textContent = '';
    [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (cfg.days.indexOf(d) >= 0 ? ' on' : ''); b.textContent = DN[d];
      b.addEventListener('click', function () { var i = cfg.days.indexOf(d); if (i >= 0) cfg.days.splice(i, 1); else cfg.days.push(d); save(); paintDays(); paintState(); });
      box.appendChild(b);
    });
  }
  async function wake(on) {
    try {
      if (on && 'wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', function () { lock = null; }); }
      else if (!on && lock) { await lock.release(); lock = null; }
    } catch (e) {}
  }
  function startCheck() { if (!timer) timer = setInterval(check, 1000); }
  function stopCheck() { clearInterval(timer); timer = 0; }
  function check() {
    if (!cfg.on || ringing) return;
    var now = new Date(), key = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate() + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    if (snoozeAt && Date.now() >= snoozeAt) { snoozeAt = 0; ring(); return; }
    if (!snoozeAt && cfg.days.indexOf(now.getDay()) >= 0 && pad(now.getHours()) + ':' + pad(now.getMinutes()) === cfg.time && key !== firedKey) { firedKey = key; ring(); }
  }
  function ring() {
    ringing = true; var a;
    var id = cfg.track && MM.find(cfg.track) ? cfg.track : (MM.tracks().filter(function (t) { return !MM.isVid(t); })[0] || {}).id;
    $('#alrClock').textContent = pad(new Date().getHours()) + ':' + pad(new Date().getMinutes());
    $('#alrRing').hidden = false; wake(true);
    if (id) {
      MM.play(id); a = MM.audio();
      try { a.loop = true; a.volume = 0.02; } catch (e) {}
      var t0 = Date.now(), ms = cfg.fade * 1000; clearInterval(fadeT);
      fadeT = setInterval(function () { var f = Math.min(1, (Date.now() - t0) / ms); try { MM.audio().volume = 0.02 + 0.98 * f * f; } catch (e) {} if (f >= 1) clearInterval(fadeT); }, 500);
    }
    try { if (navigator.vibrate) navigator.vibrate([600, 400, 600, 400, 600]); } catch (e) {}
  }
  function quiet() {
    clearInterval(fadeT); ringing = false; $('#alrRing').hidden = true;
    try { var a = MM.audio(); a.pause(); a.loop = false; a.volume = 1; } catch (e) {}
  }
  function stop() { quiet(); snoozeAt = 0; if (!$('#alr').hidden) paintState(); }
  function snooze() { quiet(); snoozeAt = Date.now() + 5 * 60 * 1000; paintState(); }
  function open() { fillTracks(); paintDays(); $('#alrTime').value = cfg.time; $('#alrFade').value = String(cfg.fade); $('#alr').hidden = false; paintState(); }
  function arm() { if (cfg.on) { startCheck(); wake(true); } else { stopCheck(); wake(false); } paintState(); }
  $('#alrBtn').addEventListener('click', open);
  $('#alrClose').addEventListener('click', function () { $('#alr').hidden = true; });
  $('#alrTime').addEventListener('change', function () { if (this.value) { cfg.time = this.value; firedKey = ''; save(); paintState(); } });
  $('#alrTrack').addEventListener('change', function () { cfg.track = this.value; save(); });
  $('#alrFade').addEventListener('change', function () { cfg.fade = +this.value; save(); });
  $('#alrToggle').addEventListener('click', function () {
    cfg.on = !cfg.on; snoozeAt = 0; save(); arm();
    MM.toast(cfg.on ? 'Будильник включён. Оставь приложение открытым' : 'Будильник выключен');
  });
  $('#alrStop').addEventListener('click', stop);
  $('#alrSnooze').addEventListener('click', snooze);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && cfg.on) { wake(true); check(); } });
  if (cfg.on) { cfg.on = false; save(); } /* v33: кнопка скрыта, веб-будильник не работает при погашенном экране */
  window.Alarm = { open: open };
})();
