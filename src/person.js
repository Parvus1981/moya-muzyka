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
            for (i = 0; i < N; i++) {
              var a = smooth(0.4, 0.62, md[i * 4] / 255); d[i * 4 + 3] = Math.round(a * 255);
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
