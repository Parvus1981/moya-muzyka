/* Person: вырезает человека из обычного фото. Модель и код лежат в приложении (public/mp), без внешних сервисов. */
(function () {
  'use strict';
  var seg = null, loading = null, pending = null;
  function loadScript(src) {
    return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { bad(new Error('load ' + src)); }; document.head.appendChild(s); });
  }
  function init() {
    if (seg) return Promise.resolve(seg);
    if (loading) return loading;
    loading = loadScript('mp/selfie_segmentation.js').then(function () {
      var s = new window.SelfieSegmentation({ locateFile: function (f) { return 'mp/' + f; } });
      s.setOptions({ modelSelection: 0, selfieMode: false });
      s.onResults(function (r) { if (pending) { var p = pending; pending = null; p(r); } });
      return s.initialize().then(function () { seg = s; return s; });
    }).catch(function (e) { loading = null; throw e; });
    return loading;
  }
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }


  /* размытие рамкой (быстрое, по строкам и столбцам) */
  function boxBlur(a, w, h, r) {
    var N = w * h, t = new Float32Array(N), o = new Float32Array(N), n = 2 * r + 1, x, y, s, k, row;
    for (y = 0; y < h; y++) {
      row = y * w; s = 0; for (k = -r; k <= r; k++) s += a[row + Math.min(w - 1, Math.max(0, k))];
      for (x = 0; x < w; x++) { t[row + x] = s / n; s += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; }
    }
    for (x = 0; x < w; x++) {
      s = 0; for (k = -r; k <= r; k++) s += t[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (y = 0; y < h; y++) { o[y * w + x] = s / n; s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; }
    }
    return o;
  }
  /* оставляет самый большой кусок (и куски не меньше четверти от него): мусор вокруг героя убирается */
  function keepMain(al, w, h) {
    var N = w * h, lab = new Int32Array(N), stack = new Int32Array(N), sizes = [0], id = 0, i, sp, big = 0;
    for (i = 0; i < N; i++) {
      if (lab[i] || al[i] <= 0.5) continue;
      id++; var cnt = 0; sp = 0; stack[sp++] = i; lab[i] = id;
      while (sp) {
        var q = stack[--sp], x = q % w; cnt++;
        if (x > 0 && !lab[q - 1] && al[q - 1] > 0.5) { lab[q - 1] = id; stack[sp++] = q - 1; }
        if (x < w - 1 && !lab[q + 1] && al[q + 1] > 0.5) { lab[q + 1] = id; stack[sp++] = q + 1; }
        if (q >= w && !lab[q - w] && al[q - w] > 0.5) { lab[q - w] = id; stack[sp++] = q - w; }
        if (q < N - w && !lab[q + w] && al[q + w] > 0.5) { lab[q + w] = id; stack[sp++] = q + w; }
      }
      sizes[id] = cnt; if (cnt > big) big = cnt;
    }
    if (!id) return null;
    var keep = new Float32Array(N); for (i = 0; i < N; i++) { var L = lab[i]; if (L && sizes[L] >= big * 0.25) keep[i] = 1; }
    return keep;
  }
  /* дыры внутри героя (полупрозрачные места тела) становятся плотными; большие просветы (между рукой и телом) не трогаем */
  function fillHoles(al, w, h) {
    var N = w * h, lab = new Int32Array(N), stack = new Int32Array(N), id = 0, i, person = 0, sizes = [0], touch = [false];
    for (i = 0; i < N; i++) if (al[i] > 0.5) person++;
    for (i = 0; i < N; i++) {
      if (lab[i] || al[i] > 0.5) continue;
      id++; var cnt = 0, sp = 0, tb = false; stack[sp++] = i; lab[i] = id;
      while (sp) {
        var q = stack[--sp], x = q % w, y = (q - x) / w; cnt++;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tb = true;
        if (x > 0 && !lab[q - 1] && al[q - 1] <= 0.5) { lab[q - 1] = id; stack[sp++] = q - 1; }
        if (x < w - 1 && !lab[q + 1] && al[q + 1] <= 0.5) { lab[q + 1] = id; stack[sp++] = q + 1; }
        if (y > 0 && !lab[q - w] && al[q - w] <= 0.5) { lab[q - w] = id; stack[sp++] = q - w; }
        if (y < h - 1 && !lab[q + w] && al[q + w] <= 0.5) { lab[q + w] = id; stack[sp++] = q + w; }
      }
      sizes[id] = cnt; touch[id] = tb;
    }
    for (i = 0; i < N; i++) { var L = lab[i]; if (L && !touch[L] && sizes[L] < person * 0.08) al[i] = 1; }
  }
  /* убрать мусор, чуть подрезать край (там остаётся цвет старого фона) и смягчить его */
  function refine(al, w, h) {
    var i, N = w * h, mn = Math.min(w, h), keep = keepMain(al, w, h);
    if (keep) { var near = boxBlur(keep, w, h, Math.max(3, Math.round(mn * 0.012))); for (i = 0; i < N; i++) if (near[i] < 0.02) al[i] = 0; }
    fillHoles(al, w, h);
    var b = boxBlur(al, w, h, Math.max(1, Math.round(mn * 0.003)));
    for (i = 0; i < N; i++) al[i] = smooth(0.45, 0.88, b[i]);
  }
  /* img -> Promise<canvas с прозрачным фоном, обрезан по человеку> */
  function cut(img) {
    return init().then(function (s) {
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.min(1, 1600 / Math.max(iw, ih)), w = Math.round(iw * k), h = Math.round(ih * k);
      var src = document.createElement('canvas'); src.width = w; src.height = h; var sg = src.getContext('2d', { willReadFrequently: true }); sg.drawImage(img, 0, 0, w, h);
      return new Promise(function (ok, bad) {
        var to = setTimeout(function () { pending = null; bad(new Error('timeout')); }, 40000);
        pending = function (r) {
          clearTimeout(to);
          try {
            var mc = document.createElement('canvas'); mc.width = w; mc.height = h; var mg = mc.getContext('2d', { willReadFrequently: true });
            mg.drawImage(r.segmentationMask, 0, 0, w, h);
            var md = mg.getImageData(0, 0, w, h).data, id = sg.getImageData(0, 0, w, h), d = id.data, N = w * h, i, x0 = w, y0 = h, x1 = 0, y1 = 0, cnt = 0;
            /* маска лежит в красном канале (0..255) */
            var al0 = new Float32Array(N);
            for (i = 0; i < N; i++) al0[i] = smooth(0.25, 0.5, md[i * 4] / 255);
            refine(al0, w, h);
            for (i = 0; i < N; i++) {
              var a = al0[i]; d[i * 4 + 3] = Math.round(a * 255);
              if (a > 0.5) { var x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; cnt++; }
            }
            if (cnt < N * 0.01) { bad(new Error('nobody')); return; }
            sg.putImageData(id, 0, 0);
            var pad = 4; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
            var out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
            var full = document.createElement('canvas'); full.width = out.width; full.height = out.height;
            var raw = document.createElement('canvas'); raw.width = w; raw.height = h; raw.getContext('2d').drawImage(img, 0, 0, w, h);
            full.getContext('2d').drawImage(raw, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
            out.getContext('2d').drawImage(full, 0, 0);
            var od = out.getContext('2d').getImageData(0, 0, out.width, out.height), od2 = od.data, j;
            for (j = 0; j < out.width * out.height; j++) { var xx = (j % out.width) + x0, yy = ((j / out.width) | 0) + y0; od2[j * 4 + 3] = id.data[(yy * w + xx) * 4 + 3]; }
            out.getContext('2d').putImageData(od, 0, 0);
            ok({ cv: out, full: full });
          } catch (e) { bad(e); }
        };
        s.send({ image: src }).catch(function (e) { clearTimeout(to); pending = null; bad(e); });
      });
    });
  }

  /* кадр видео: вырезка того же размера, мягкая маска, сглаживание во времени против мерцания */
  function frame(src, prev) {
    return init().then(function (s) {
      var w = src.width, h = src.height;
      return new Promise(function (ok, bad) {
        var to = setTimeout(function () { pending = null; bad(new Error('timeout')); }, 20000);
        pending = function (r) {
          clearTimeout(to);
          try {
            var mc = document.createElement('canvas'); mc.width = w; mc.height = h; var mg = mc.getContext('2d', { willReadFrequently: true });
            mg.drawImage(r.segmentationMask, 0, 0, w, h);
            var md = mg.getImageData(0, 0, w, h).data, out = document.createElement('canvas'); out.width = w; out.height = h;
            var og = out.getContext('2d', { willReadFrequently: true }); og.drawImage(src, 0, 0);
            var id = og.getImageData(0, 0, w, h), d = id.data, N = w * h, al = new Float32Array(N), i;
            for (i = 0; i < N; i++) { var a = smooth(0.4, 0.62, md[i * 4] / 255); if (prev) a = 0.55 * a + 0.45 * prev[i]; al[i] = a; d[i * 4 + 3] = Math.round(a * 255); }
            og.putImageData(id, 0, 0); ok({ cv: out, alpha: al });
          } catch (e) { bad(e); }
        };
        s.send({ image: src }).catch(function (e) { clearTimeout(to); pending = null; bad(e); });
      });
    });
  }
  window.Person = { cut: cut, frame: frame, ready: init };
})();
