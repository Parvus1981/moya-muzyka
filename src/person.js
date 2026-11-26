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
  /* направляющий фильтр: подгоняет мягкую маску под настоящие края картинки (волосы, пальцы, кружево) */
  function guided(I, P, w, h, r, eps) {
    var N = w * h, i, II = new Float32Array(N), IP = new Float32Array(N);
    for (i = 0; i < N; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * P[i]; }
    var mI = boxBlur(I, w, h, r), mP = boxBlur(P, w, h, r), mII = boxBlur(II, w, h, r), mIP = boxBlur(IP, w, h, r), A = II, B = IP;
    for (i = 0; i < N; i++) { var v = mII[i] - mI[i] * mI[i], c = mIP[i] - mI[i] * mP[i], a = c / (v + eps); A[i] = a; B[i] = mP[i] - a * mI[i]; }
    var mA = boxBlur(A, w, h, r), mB = boxBlur(B, w, h, r), q = new Float32Array(N);
    for (i = 0; i < N; i++) q[i] = mA[i] * I[i] + mB[i];
    return q;
  }
  /* убрать мусор, закрыть дыры, подтянуть край к картинке, очистить цвет на краю от старого фона.
     px: RGBA исходной картинки того же размера (цвет на краю правится на месте) */
  function refine(al, w, h, px, soft) {
    var i, N = w * h, mn = Math.min(w, h), keep = keepMain(al, w, h);
    if (keep) { var near = boxBlur(keep, w, h, Math.max(3, Math.round(mn * 0.012))); for (i = 0; i < N; i++) if (near[i] < 0.02) al[i] = 0; }
    fillHoles(al, w, h);
    if (px) {
      if (soft) { for (i = 0; i < N; i++) al[i] = smooth(0.06, 0.9, al[i]); }
      else {
        var r = Math.max(3, Math.round(mn * 0.012)), q = new Float32Array(N), ch, G = new Float32Array(N);
        for (ch = 0; ch < 3; ch++) {
          for (i = 0; i < N; i++) G[i] = px[i * 4 + ch] / 255;
          var qq = guided(G, al, w, h, r, 0.0009);
          for (i = 0; i < N; i++) q[i] += qq[i] / 3;
        }
        for (i = 0; i < N; i++) al[i] = smooth(0.3, 0.72, Math.min(1, Math.max(0, q[i])));
      }
      /* цвет края: берём цвет изнутри героя, чтобы не было ореола старого фона (трава, небо) */
      var strict = new Float32Array(N), cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);
      for (i = 0; i < N; i++) if (al[i] > 0.92) { strict[i] = 1; cr[i] = px[i * 4]; cg[i] = px[i * 4 + 1]; cb[i] = px[i * 4 + 2]; }
      var rd = Math.max(3, Math.round(mn * 0.02)), ws = boxBlur(strict, w, h, rd), fr = boxBlur(cr, w, h, rd), fg = boxBlur(cg, w, h, rd), fb = boxBlur(cb, w, h, rd);
      for (i = 0; i < N; i++) {
        var a = al[i]; if (a <= 0.02 || a >= 0.97 || ws[i] < 0.01) continue;
        var m = Math.min(0.9, 1.3 * (1 - a)), s = 1 / ws[i];
        px[i * 4] += (fr[i] * s - px[i * 4]) * m; px[i * 4 + 1] += (fg[i] * s - px[i * 4 + 1]) * m; px[i * 4 + 2] += (fb[i] * s - px[i * 4 + 2]) * m;
      }
    } else {
      var b2 = boxBlur(al, w, h, Math.max(1, Math.round(mn * 0.003)));
      for (i = 0; i < N; i++) al[i] = smooth(0.45, 0.88, b2[i]);
    }
  }
  /* mask-канвас для картинки: читаем результат сразу, модель переиспользует свой буфер */
  function segment(canvas) {
    return init().then(function (s) {
      var w = canvas.width, h = canvas.height;
      return new Promise(function (ok, bad) {
        var to = setTimeout(function () { pending = null; bad(new Error('timeout')); }, 40000);
        pending = function (r) {
          clearTimeout(to);
          try { var mc = document.createElement('canvas'); mc.width = w; mc.height = h; mc.getContext('2d', { willReadFrequently: true }).drawImage(r.segmentationMask, 0, 0, w, h); ok(mc); } catch (e) { bad(e); }
        };
        s.send({ image: canvas }).catch(function (e) { clearTimeout(to); pending = null; bad(e); });
      });
    });
  }
  /* где человек: рамка вокруг главной фигуры в долях кадра (или null) */
  function locate(img) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.min(1, 768 / Math.max(iw, ih)), w = Math.max(8, Math.round(iw * k)), h = Math.max(8, Math.round(ih * k));
    var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
    return segment(c).then(function (mc) {
      var md = mc.getContext('2d').getImageData(0, 0, w, h).data, N = w * h, al = new Float32Array(N), i, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (i = 0; i < N; i++) al[i] = md[i * 4] / 255 > 0.5 ? 1 : 0;
      var keep = keepMain(al, w, h); if (!keep) return null;
      for (i = 0; i < N; i++) if (keep[i]) { var x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < x0) return null;
      return { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
    });
  }
  /* два прохода: сначала находим человека, потом вырезаем по увеличенному кадру вокруг него (из оригинала).
     Далёкий человек так получает маску в разы чётче, а цвет берётся из полного разрешения */
  function cutSelfie(img) {
    return locate(img).then(function (bb) {
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!bb) return cutCore(img);
      var bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
      if (bw * bh > 0.5) return cutCore(img);
      var ex = Math.max(bw * iw, bh * ih) * 0.14; /* поля вокруг человека, в пикселях оригинала */
      var cx0 = Math.max(0, Math.floor(bb.x0 * iw - ex)), cy0 = Math.max(0, Math.floor(bb.y0 * ih - ex)), cx1 = Math.min(iw, Math.ceil(bb.x1 * iw + ex)), cy1 = Math.min(ih, Math.ceil(bb.y1 * ih + ex));
      var cw = cx1 - cx0, ch = cy1 - cy0; if (cw < 16 || ch < 16) return cutCore(img);
      var up = Math.min(3, Math.max(1, 900 / Math.max(cw, ch))), cc = document.createElement('canvas'); cc.width = Math.round(cw * up); cc.height = Math.round(ch * up);
      cc.getContext('2d').drawImage(img, cx0, cy0, cw, ch, 0, 0, cc.width, cc.height);
      return cutCore(cc).catch(function () { return cutCore(img); });
    }, function () { return cutCore(img); });
  }
  /* один проход по картинке целиком -> Promise<{cv: канвас с прозрачным фоном, обрезан по человеку, full: оригинал того же размера}> */
  function cutCore(img) {
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
            refine(al0, w, h, d);
            for (i = 0; i < N; i++) {
              var a = al0[i]; d[i * 4 + 3] = Math.round(a * 255);
              if (a > 0.5) { var x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; cnt++; }
            }
            if (cnt < N * 0.01) { bad(new Error('nobody')); return; }
            var pad = 4; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
            var cw = x1 - x0 + 1, ch2 = y1 - y0 + 1, out = document.createElement('canvas'); out.width = cw; out.height = ch2;
            out.getContext('2d').putImageData(id, -x0, -y0, x0, y0, cw, ch2);
            var full = document.createElement('canvas'); full.width = cw; full.height = ch2;
            var raw = document.createElement('canvas'); raw.width = w; raw.height = h; raw.getContext('2d').drawImage(img, 0, 0, w, h);
            full.getContext('2d').drawImage(raw, x0, y0, cw, ch2, 0, 0, cw, ch2);
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
            var id = og.getImageData(0, 0, w, h), d = id.data, N = w * h, raw0 = new Float32Array(N), al = new Float32Array(N), i;
            for (i = 0; i < N; i++) { var a = smooth(0.25, 0.5, md[i * 4] / 255); if (prev) a = 0.55 * a + 0.45 * prev[i]; raw0[i] = a; al[i] = a; }
            refine(al, w, h, d);
            for (i = 0; i < N; i++) d[i * 4 + 3] = Math.round(al[i] * 255);
            og.putImageData(id, 0, 0); ok({ cv: out, alpha: raw0 });
          } catch (e) { bad(e); }
        };
        s.send({ image: src }).catch(function (e) { clearTimeout(to); pending = null; bad(e); });
      });
    });
  }

  /* ---------- MODNet на ONNX Runtime Web: мягкая точная вырезка человека (модель и движок лежат в приложении, public/ml) ---------- */
  var ortSess = null, ortLoading = null;
  function status(t) { var P = window.Person; if (P && typeof P.onStatus === 'function') P.onStatus(t); }
  function absUrl(u) { return new URL(u, document.baseURI).href; }
  function fetchBuf(url, label) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      var total = +r.headers.get('content-length') || 0;
      if (!r.body || !r.body.getReader) return r.arrayBuffer();
      var rd = r.body.getReader(), parts = [], got = 0;
      return (function pump() {
        return rd.read().then(function (x) {
          if (x.done) { var out = new Uint8Array(got), o = 0; parts.forEach(function (q) { out.set(q, o); o += q.length; }); return out.buffer; }
          parts.push(x.value); got += x.value.length;
          if (total) status(label + ' ' + Math.round(Math.min(got, total) / 1048576) + ' из ' + Math.round(total / 1048576) + ' МБ');
          return pump();
        });
      })();
    });
  }
  function initOrt() {
    if (ortSess) return Promise.resolve(ortSess);
    if (ortLoading) return ortLoading;
    status('Загружаю движок вырезки…');
    ortLoading = loadScript('ml/ort.wasm.min.js').then(function () {
      var o = window.ort; o.env.wasm.numThreads = 1; o.env.wasm.proxy = false;
      o.env.wasm.wasmPaths = { mjs: absUrl('ml/ort-loader.js'), wasm: absUrl('ml/ort-wasm-simd-threaded.wasm') };
      return fetchBuf(absUrl('ml/ort-wasm-simd-threaded.wasm'), 'Загружаю движок:').then(function () {});
    }).then(function () { return fetchBuf(absUrl('ml/modnet.onnx'), 'Загружаю модель вырезки (один раз):'); })
      .then(function (buf) { status('Запускаю модель…'); return window.ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); })
      .then(function (s) { ortSess = s; return s; })
      .catch(function (e) { ortLoading = null; throw e; });
    return ortLoading;
  }
  function resizeAlpha(a, sw, sh, dw, dh) {
    var out = new Float32Array(dw * dh), x, y, xi0 = new Int32Array(dw), xi1 = new Int32Array(dw), xw = new Float32Array(dw), xr = sw / dw, yr = sh / dh;
    for (x = 0; x < dw; x++) { var fx = Math.max(0, (x + 0.5) * xr - 0.5), x0 = Math.min(sw - 1, Math.floor(fx)); xi0[x] = x0; xi1[x] = Math.min(sw - 1, x0 + 1); xw[x] = fx - x0; }
    for (y = 0; y < dh; y++) {
      var fy = Math.max(0, (y + 0.5) * yr - 0.5), y0 = Math.min(sh - 1, Math.floor(fy)), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0, r0 = y0 * sw, r1 = y1 * sw, ro = y * dw;
      for (x = 0; x < dw; x++) {
        var a0 = a[r0 + xi0[x]] * (1 - xw[x]) + a[r0 + xi1[x]] * xw[x], a1 = a[r1 + xi0[x]] * (1 - xw[x]) + a[r1 + xi1[x]] * xw[x], v = a0 * (1 - wy) + a1 * wy;
        out[ro + x] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
    }
    return out;
  }
  /* мягкая маска человека (0..1) того же размера, что и канвас; ref: короткая сторона для модели */
  function matte(canvas, ref) {
    return initOrt().then(function (s) {
      var w = canvas.width, h = canvas.height, k = ref / Math.min(w, h), L = Math.max(w, h) * k; if (L > 1088) k *= 1088 / L;
      var nw = Math.max(32, Math.round(w * k / 32) * 32), nh = Math.max(32, Math.round(h * k / 32) * 32);
      var tc = document.createElement('canvas'); tc.width = nw; tc.height = nh; var tg = tc.getContext('2d', { willReadFrequently: true }); tg.imageSmoothingQuality = 'high'; tg.drawImage(canvas, 0, 0, nw, nh);
      var d = tg.getImageData(0, 0, nw, nh).data, N = nw * nh, f = new Float32Array(3 * N), i;
      for (i = 0; i < N; i++) { f[i] = d[i * 4] / 127.5 - 1; f[N + i] = d[i * 4 + 1] / 127.5 - 1; f[2 * N + i] = d[i * 4 + 2] / 127.5 - 1; }
      status('Вырезаю человека…');
      return new Promise(function (go) { setTimeout(go, 40); }).then(function () { return s.run({ input: new window.ort.Tensor('float32', f, [1, 3, nh, nw]) }); })
        .then(function (out) { return resizeAlpha(out[Object.keys(out)[0]].data, nw, nh, w, h); });
    });
  }
  function canvasFrom(img, sx, sy, sw, sh, dw, dh) {
    var c = document.createElement('canvas'); c.width = dw; c.height = dh; var g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh); return c;
  }
  function bboxOfAlpha(a, w, h) {
    var N = w * h, b = new Float32Array(N), i, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (i = 0; i < N; i++) b[i] = a[i] > 0.5 ? 1 : 0;
    var keep = keepMain(b, w, h); if (!keep) return null;
    for (i = 0; i < N; i++) if (keep[i]) { var x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < x0 ? null : { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
  }
  /* маска + исходные цвета -> {cv: человек на прозрачном фоне, обрезан по рамке, full: оригинал того же размера} */
  function finishCut(src, al, w, h) {
    var id = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h), d = id.data, N = w * h, i, x0 = w, y0 = h, x1 = 0, y1 = 0, cnt = 0;
    refine(al, w, h, d, true);
    for (i = 0; i < N; i++) {
      var a = al[i]; d[i * 4 + 3] = Math.round(a * 255);
      if (a > 0.5) { var x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; cnt++; }
    }
    if (cnt < N * 0.005) throw new Error('nobody');
    var pad = 4; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    var cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = document.createElement('canvas'); out.width = cw; out.height = ch;
    out.getContext('2d').putImageData(id, -x0, -y0, x0, y0, cw, ch);
    var full = document.createElement('canvas'); full.width = cw; full.height = ch; full.getContext('2d').drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
    return { cv: out, full: full };
  }
  /* два прохода: находим человека по всему кадру, потом вырезаем по увеличенному кадру вокруг него (если он небольшой) */
  function cutModnet(img) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var k1 = Math.min(1, 1024 / Math.max(iw, ih)), w1 = Math.max(8, Math.round(iw * k1)), h1 = Math.max(8, Math.round(ih * k1));
    return matte(canvasFrom(img, 0, 0, iw, ih, w1, h1), 512).then(function (a1) {
      var bb = bboxOfAlpha(a1, w1, h1); if (!bb) throw new Error('nobody');
      var bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0, rx = 0, ry = 0, rw = iw, rh = ih, whole = true;
      if (bw * bh <= 0.5) {
        var ex = Math.max(bw * iw, bh * ih) * 0.14, cx0 = Math.max(0, Math.floor(bb.x0 * iw - ex)), cy0 = Math.max(0, Math.floor(bb.y0 * ih - ex)), cx1 = Math.min(iw, Math.ceil(bb.x1 * iw + ex)), cy1 = Math.min(ih, Math.ceil(bb.y1 * ih + ex));
        if (cx1 - cx0 >= 16 && cy1 - cy0 >= 16) { rx = cx0; ry = cy0; rw = cx1 - cx0; rh = cy1 - cy0; whole = false; }
      }
      var s = Math.min(1, 1600 / Math.max(rw, rh)), w = Math.max(8, Math.round(rw * s)), h = Math.max(8, Math.round(rh * s)), src = canvasFrom(img, rx, ry, rw, rh, w, h);
      return (whole ? Promise.resolve(resizeAlpha(a1, w1, h1, w, h)) : matte(src, 512)).then(function (al) { return finishCut(src, al, w, h); });
    });
  }
  /* основной вход: точная модель, если не получилось (нет интернета в первый раз) — простая встроенная */
  function cut(img) {
    return cutModnet(img).then(function (r) { window.Person.lastEngine = 'modnet'; return r; }, function () {
      status('Точная модель недоступна, вырезаю простым способом…'); window.Person.lastEngine = 'selfie'; return cutSelfie(img);
    });
  }
  /* кадр видео: точная модель с гладкостью по времени; если модель недоступна — простая */
  var modnetBad = false;
  function warm() { return initOrt().then(function () { return true; }, function () { modnetBad = true; return init().then(function () { return false; }); }); }
  function frameBest(src, prev) {
    if (modnetBad) return frame(src, prev);
    var w = src.width, h = src.height;
    return matte(src, 352).then(function (al) {
      var N = w * h, i, raw0 = new Float32Array(N);
      if (prev && prev.length === N) for (i = 0; i < N; i++) al[i] = 0.62 * al[i] + 0.38 * prev[i];
      raw0.set(al);
      var out = document.createElement('canvas'); out.width = w; out.height = h; var og = out.getContext('2d', { willReadFrequently: true }); og.drawImage(src, 0, 0);
      var id = og.getImageData(0, 0, w, h), d = id.data;
      refine(al, w, h, d, true);
      for (i = 0; i < N; i++) d[i * 4 + 3] = Math.round(al[i] * 255);
      og.putImageData(id, 0, 0); return { cv: out, alpha: raw0 };
    }, function () { modnetBad = true; return frame(src, prev); });
  }
  /* только маска людей кадра (0..255), без вырезки: для того, чтобы прятать героя за людьми в клипе */
  function maskOnly(src) {
    return init().then(function (sg) {
      var w = src.width, h = src.height;
      return new Promise(function (ok, bad) {
        var to = setTimeout(function () { pending = null; bad(new Error('timeout')); }, 20000);
        pending = function (r) {
          clearTimeout(to);
          try {
            var mc = document.createElement('canvas'); mc.width = w; mc.height = h; var mg = mc.getContext('2d', { willReadFrequently: true });
            mg.drawImage(r.segmentationMask, 0, 0, w, h);
            var md = mg.getImageData(0, 0, w, h).data, N = w * h, out = new Uint8Array(N), i;
            for (i = 0; i < N; i++) out[i] = Math.round(smooth(0.3, 0.6, md[i * 4] / 255) * 255);
            ok(out);
          } catch (e) { bad(e); }
        };
        sg.send({ image: src }).catch(function (e) { clearTimeout(to); pending = null; bad(e); });
      });
    });
  }
  window.Person = { maskOnly: maskOnly, cut: cut, cutSelfie: cutSelfie, cutModnet: cutModnet, frame: frame, frameBest: frameBest, warm: warm, ready: init, core: cutCore, onStatus: null, lastEngine: '' };
})();
