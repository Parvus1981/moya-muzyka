/* Scan: из фото детского рисунка вырезает героев (без фона листа).
   Работает на телефоне, без интернета и сторонних сервисов.
   1) находит светлые листы бумаги, 2) оценивает цвет бумаги (с учётом падающего света),
   3) всё, что не бумага, считает рисунком, 4) делит рисунок на отдельных героев,
   5) заливает «дырки» внутри героя (белая одежда остаётся). */
(function () {
  'use strict';
  var MAXS = 2000;

  function otsu(hist, total) {
    var sum = 0, i; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, thr = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, d = wB * wF * (mB - mF) * (mB - mF);
      if (d > best) { best = d; thr = i; }
    }
    return thr;
  }

  /* квадратное расширение/сужение за два прохода */
  function morph(src, w, h, r, erode) {
    var tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), pre = new Int32Array(Math.max(w, h) + 1), x, y, lo, hi, c, full = 2 * r + 1;
    for (y = 0; y < h; y++) {
      pre[0] = 0; for (x = 0; x < w; x++) pre[x + 1] = pre[x] + src[y * w + x];
      for (x = 0; x < w; x++) { lo = x - r < 0 ? 0 : x - r; hi = x + r >= w ? w - 1 : x + r; c = pre[hi + 1] - pre[lo]; tmp[y * w + x] = erode ? (c === full ? 1 : 0) : (c > 0 ? 1 : 0); }
    }
    for (x = 0; x < w; x++) {
      pre[0] = 0; for (y = 0; y < h; y++) pre[y + 1] = pre[y] + tmp[y * w + x];
      for (y = 0; y < h; y++) { lo = y - r < 0 ? 0 : y - r; hi = y + r >= h ? h - 1 : y + r; c = pre[hi + 1] - pre[lo]; out[y * w + x] = erode ? (c === full ? 1 : 0) : (c > 0 ? 1 : 0); }
    }
    return out;
  }

  /* связные области (8 соседей) */
  function label(mask, w, h) {
    var n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), count = 0, areas = [0], bbs = [null], i, dx, dy;
    for (i = 0; i < n; i++) {
      if (!mask[i] || lab[i]) continue;
      count++; var sp = 0, a = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
      stack[sp++] = i; lab[i] = count;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p - x) / w; a++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (dy = -1; dy <= 1; dy++) {
          var ny = y + dy; if (ny < 0 || ny >= h) continue;
          for (dx = -1; dx <= 1; dx++) {
            var nx = x + dx; if (nx < 0 || nx >= w) continue;
            var q = ny * w + nx; if (mask[q] && !lab[q]) { lab[q] = count; stack[sp++] = q; }
          }
        }
      }
      areas[count] = a; bbs[count] = [x0, y0, x1, y1];
    }
    return { lab: lab, n: count, areas: areas, bb: bbs };
  }


  /* склеенные герои (держатся за руки): сужаем, пока не распадутся, затем растим обратно */
  function splitTouching(D, lc, w, h) {
    var N = w * h, lab = new Int32Array(N), next = 0, id;
    for (id = 1; id <= lc.n; id++) {
      var bb = lc.bb[id], bw2 = bb[2] - bb[0] + 1, bh2 = bb[3] - bb[1] + 1, tot = lc.areas[id];
      var M = new Uint8Array(bw2 * bh2), x, y;
      for (y = 0; y < bh2; y++) for (x = 0; x < bw2; x++) if (lc.lab[(bb[1] + y) * w + bb[0] + x] === id) M[y * bw2 + x] = 1;
      var seeds = null;
      if (bw2 > 0.55 * bh2 && tot > 0.0015 * N) {
        for (var r = 4; r <= 22; r += 2) {
          var E = morph(M, bw2, bh2, r, true), le = label(E, bw2, bh2), big = [], j;
          for (j = 1; j <= le.n; j++) if (le.areas[j] > 0.12 * tot * Math.pow(0.9, r / 4) && le.areas[j] > 120) big.push(j);
          if (big.length >= 2) { seeds = { le: le, big: big }; break; }
          if (!le.n) break;
        }
      }
      if (!seeds) { next++; for (var p = 0; p < bw2 * bh2; p++) if (M[p]) lab[(bb[1] + ((p / bw2) | 0)) * w + bb[0] + (p % bw2)] = next; continue; }
      var base = next, A = new Int32Array(bw2 * bh2), q = [], qi = 0;
      seeds.big.forEach(function (j, k) { for (var p = 0; p < bw2 * bh2; p++) if (seeds.le.lab[p] === j) { A[p] = k + 1; q.push(p); } });
      while (qi < q.length) {
        var pp = q[qi++], px = pp % bw2, py = (pp - px) / bw2, nb = [px > 0 ? pp - 1 : -1, px < bw2 - 1 ? pp + 1 : -1, py > 0 ? pp - bw2 : -1, py < bh2 - 1 ? pp + bw2 : -1];
        for (var t = 0; t < 4; t++) { var n2 = nb[t]; if (n2 >= 0 && M[n2] && !A[n2]) { A[n2] = A[pp]; q.push(n2); } }
      }
      next += seeds.big.length;
      for (var p2 = 0; p2 < bw2 * bh2; p2++) if (A[p2]) lab[(bb[1] + ((p2 / bw2) | 0)) * w + bb[0] + (p2 % bw2)] = base + A[p2];
    }
    var res = label2(lab, w, h, next); return res;
  }
  function label2(lab, w, h, n) {
    var areas = new Array(n + 1).fill(0), bbs = new Array(n + 1), i;
    for (i = 0; i < w * h; i++) { var l = lab[i]; if (!l) continue; areas[l]++; var x = i % w, y = (i - x) / w, b = bbs[l]; if (!b) bbs[l] = [x, y, x, y]; else { if (x < b[0]) b[0] = x; if (x > b[2]) b[2] = x; if (y < b[1]) b[1] = y; if (y > b[3]) b[3] = y; } }
    return { lab: lab, n: n, areas: areas, bb: bbs };
  }

  function hull(pts) {
    pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
    up.pop(); lo.pop(); return lo.concat(up);
  }

  /* плоскость цвета бумаги: c(x,y) = a + b*u + c*v, по трём каналам */
  function fitPlane(samples) {
    var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], i, j, k;
    samples.forEach(function (s) {
      var f = [1, s[0], s[1]];
      for (i = 0; i < 3; i++) { for (j = 0; j < 3; j++) A[i][j] += f[i] * f[j]; for (k = 0; k < 3; k++) B[k][i] += f[i] * s[2 + k]; }
    });
    function solve(b) {
      var m = [[A[0][0], A[0][1], A[0][2], b[0]], [A[1][0], A[1][1], A[1][2], b[1]], [A[2][0], A[2][1], A[2][2], b[2]]], r, c, p, t;
      for (c = 0; c < 3; c++) {
        p = c; for (r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
        t = m[c]; m[c] = m[p]; m[p] = t;
        if (Math.abs(m[c][c]) < 1e-9) return [b[0] / (A[0][0] || 1), 0, 0];
        for (r = c + 1; r < 3; r++) { var f = m[r][c] / m[c][c]; for (var q = c; q < 4; q++) m[r][q] -= f * m[c][q]; }
      }
      var x = [0, 0, 0]; for (r = 2; r >= 0; r--) { var s = m[r][3]; for (c = r + 1; c < 3; c++) s -= m[r][c] * x[c]; x[r] = s / m[r][r]; }
      return x;
    }
    return [solve(B[0]), solve(B[1]), solve(B[2])];
  }

  function find(img, opts) {
    opts = opts || {};
    var thr = opts.thr || 34;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var k = Math.min(1, MAXS / Math.max(iw, ih)), cw = Math.round(iw * k), ch = Math.round(ih * k);
    var src = document.createElement('canvas'); src.width = cw; src.height = ch;
    var sg = src.getContext('2d', { willReadFrequently: true }); sg.drawImage(img, 0, 0, cw, ch);
    var data = sg.getImageData(0, 0, cw, ch).data, N = cw * ch, i;

    /* 1. светлая малоцветная область: кандидаты в бумагу */
    var hist = new Int32Array(256), minC = new Uint8Array(N), spread = new Uint8Array(N);
    for (i = 0; i < N; i++) {
      var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], mn = r < g ? (r < b ? r : b) : (g < b ? g : b), mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      minC[i] = mn; spread[i] = mx - mn; hist[mn]++;
    }
    var T0 = Math.max(90, otsu(hist, N) * (opts.paper || 1));
    var P = new Uint8Array(N); for (i = 0; i < N; i++) P[i] = (minC[i] >= T0 && spread[i] < 100) ? 1 : 0;
    var lp = label(P, cw, ch), sheets = [], id;
    for (id = 1; id <= lp.n; id++) {
      var bb = lp.bb[id], a = lp.areas[id], touches = bb[0] <= 1 || bb[1] <= 1 || bb[2] >= cw - 2 || bb[3] >= ch - 2;
      if (a >= 0.012 * N && (!touches || a >= 0.25 * N)) sheets.push({ id: id, bb: bb, area: a });
    }
    var whole = false;
    if (!sheets.length) { whole = true; sheets.push({ id: -1, bb: [0, 0, cw - 1, ch - 1], area: N }); }
    sheets.sort(function (a, b) { return a.bb[0] - b.bb[0]; });

    var cands = [], rj = Math.max(2, Math.round(0.0022 * Math.max(cw, ch))), minArea = 0.0005 * N;
    sheets.forEach(function (sh, si) {
      var x0 = sh.bb[0], y0 = sh.bb[1], bw = sh.bb[2] - x0 + 1, bh = sh.bb[3] - y0 + 1, x, y, p;
      /* 2. форма листа: выпуклая оболочка найденной бумаги */
      var H = new Uint8Array(bw * bh);
      if (whole) { H.fill(1); }
      else {
        var pts = [];
        for (y = 0; y < bh; y += 2) {
          var lo = -1, hi = -1;
          for (x = 0; x < bw; x++) if (lp.lab[(y0 + y) * cw + x0 + x] === sh.id) { if (lo < 0) lo = x; hi = x; }
          if (lo >= 0) { pts.push([lo, y]); pts.push([hi, y]); }
        }
        var hl = hull(pts), oc = document.createElement('canvas'); oc.width = bw; oc.height = bh;
        var og = oc.getContext('2d', { willReadFrequently: true }); og.fillStyle = '#fff'; og.beginPath();
        hl.forEach(function (q, j) { if (j) og.lineTo(q[0], q[1]); else og.moveTo(q[0], q[1]); }); og.closePath(); og.fill();
        var od = og.getImageData(0, 0, bw, bh).data; for (p = 0; p < bw * bh; p++) H[p] = od[p * 4 + 3] > 127 ? 1 : 0;
        H = morph(H, bw, bh, Math.max(2, Math.round(0.003 * Math.max(cw, ch))), true);
      }
      /* 3. цвет бумаги с учётом света */
      var samples = [], stride = Math.max(1, Math.floor(sh.area / 7000)), cnt = 0;
      for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) {
        var gi = (y0 + y) * cw + x0 + x; if (!P[gi] || !H[y * bw + x]) continue;
        if ((cnt++ % stride) === 0) samples.push([x / bw, y / bh, data[gi * 4], data[gi * 4 + 1], data[gi * 4 + 2]]);
      }
      if (samples.length < 20) return;
      var pl = fitPlane(samples);
      /* 4. рисунок = всё, что заметно отличается от бумаги */
      var I = new Uint8Array(bw * bh), thr2 = thr * thr;
      for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) {
        if (!H[y * bw + x]) continue;
        var gi2 = (y0 + y) * cw + x0 + x, u = x / bw, v = y / bh, d2 = 0;
        for (var c = 0; c < 3; c++) { var e = pl[c][0] + pl[c][1] * u + pl[c][2] * v, df = data[gi2 * 4 + c] - e; d2 += df * df; }
        if (d2 > thr2) I[y * bw + x] = 1;
      }
      /* 5. делим на героев */
      /* убираем подпись/надпись сверху листа */
      var l1 = label(morph(I, bw, bh, 2, false), bw, bh), q1;
      var rm = new Uint8Array(l1.n + 1);
      for (q1 = 1; q1 <= l1.n; q1++) { var bq = l1.bb[q1], wq = bq[2] - bq[0] + 1, hq = bq[3] - bq[1] + 1; if ((bq[1] + hq / 2) < 0.3 * bh && (wq > 2.2 * hq || hq < 0.1 * bh) && !(hq > 0.12 * bh)) rm[q1] = 1; }
      for (q1 = 0; q1 < bw * bh; q1++) if (I[q1]) { var lb = l1.lab[q1]; if (!lb) { /* пиксель вне расширения невозможен */ } else if (rm[lb]) I[q1] = 0; }
      var Di = morph(I, bw, bh, rj, false), lc = label(Di, bw, bh), j2;
      lc = splitTouching(Di, lc, bw, bh);
      var picked = [];
      for (j2 = 1; j2 <= lc.n; j2++) {
        var b2 = lc.bb[j2], cwid = b2[2] - b2[0] + 1, chei = b2[3] - b2[1] + 1;
        if (lc.areas[j2] < minArea * 0.6 || cwid < 12 || chei < 12) continue;
        picked.push({ id: j2, bb: b2 });
      }
      picked.sort(function (a, b) { return a.bb[0] - b.bb[0]; });
      picked.forEach(function (pc) {
        var pad = 8, ex0 = Math.max(0, pc.bb[0] - pad), ey0 = Math.max(0, pc.bb[1] - pad), ex1 = Math.min(bw - 1, pc.bb[2] + pad), ey1 = Math.min(bh - 1, pc.bb[3] + pad);
        var mw = ex1 - ex0 + 1, mh = ey1 - ey0 + 1, M = new Uint8Array(mw * mh), q, yy, xx;
        for (yy = 0; yy < mh; yy++) for (xx = 0; xx < mw; xx++) { q = (ey0 + yy) * bw + ex0 + xx; if (I[q] && lc.lab[q] === pc.id) M[yy * mw + xx] = 1; }
        M = morph(morph(M, mw, mh, 3, false), mw, mh, 3, true);
        /* убираем тонкие хвосты (линия подписи, соринки) и мелкие обрывки */
        var Mo = morph(morph(M, mw, mh, 3, true), mw, mh, 3, false), Mn = morph(Mo, mw, mh, 7, false);
        for (ii = 0; ii < mw * mh; ii++) M[ii] = M[ii] && Mn[ii] ? 1 : 0;
        var lk = label(M, mw, mh), bigA = 0, kk; for (kk = 1; kk <= lk.n; kk++) if (lk.areas[kk] > bigA) bigA = lk.areas[kk];
        for (ii = 0; ii < mw * mh; ii++) if (M[ii] && lk.areas[lk.lab[ii]] < 0.15 * bigA) M[ii] = 0;
        /* заливка снаружи: всё, что не достижимо от края, — внутри героя */
        var out = new Uint8Array(mw * mh), st = new Int32Array(mw * mh), sp = 0, ii;
        for (xx = 0; xx < mw; xx++) { if (!M[xx]) { out[xx] = 1; st[sp++] = xx; } ii = (mh - 1) * mw + xx; if (!M[ii] && !out[ii]) { out[ii] = 1; st[sp++] = ii; } }
        for (yy = 0; yy < mh; yy++) { ii = yy * mw; if (!M[ii] && !out[ii]) { out[ii] = 1; st[sp++] = ii; } ii = yy * mw + mw - 1; if (!M[ii] && !out[ii]) { out[ii] = 1; st[sp++] = ii; } }
        while (sp) {
          var pp = st[--sp], px = pp % mw, py = (pp - px) / mw;
          if (px > 0 && !M[pp - 1] && !out[pp - 1]) { out[pp - 1] = 1; st[sp++] = pp - 1; }
          if (px < mw - 1 && !M[pp + 1] && !out[pp + 1]) { out[pp + 1] = 1; st[sp++] = pp + 1; }
          if (py > 0 && !M[pp - mw] && !out[pp - mw]) { out[pp - mw] = 1; st[sp++] = pp - mw; }
          if (py < mh - 1 && !M[pp + mw] && !out[pp + mw]) { out[pp + mw] = 1; st[sp++] = pp + mw; }
        }
        var area = 0; for (ii = 0; ii < mw * mh; ii++) { M[ii] = out[ii] ? 0 : 1; area += M[ii]; }
        if (area < minArea) return;
        /* ровный край: чуть сглаживаем маску */
        var cvs = document.createElement('canvas'); cvs.width = mw; cvs.height = mh;
        var cg = cvs.getContext('2d'), im = cg.createImageData(mw, mh), dd = im.data;
        for (yy = 0; yy < mh; yy++) for (xx = 0; xx < mw; xx++) {
          var s = 0, n2 = 0;
          for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) { var ax = xx + ox, ay = yy + oy; if (ax >= 0 && ay >= 0 && ax < mw && ay < mh) { s += M[ay * mw + ax]; n2++; } }
          var al = Math.round(255 * s / n2), o4 = (yy * mw + xx) * 4, gsrc = ((y0 + ey0 + yy) * cw + x0 + ex0 + xx) * 4;
          dd[o4] = data[gsrc]; dd[o4 + 1] = data[gsrc + 1]; dd[o4 + 2] = data[gsrc + 2]; dd[o4 + 3] = M[yy * mw + xx] ? Math.max(al, 200) : (al > 100 ? al : 0);
        }
        cg.putImageData(im, 0, 0);
        var cx0 = mw, cy0 = mh, cx1 = 0, cy1 = 0;
        for (yy = 0; yy < mh; yy++) for (xx = 0; xx < mw; xx++) if (M[yy * mw + xx]) { if (xx < cx0) cx0 = xx; if (xx > cx1) cx1 = xx; if (yy < cy0) cy0 = yy; if (yy > cy1) cy1 = yy; }
        cx0 = Math.max(0, cx0 - 3); cy0 = Math.max(0, cy0 - 3); cx1 = Math.min(mw - 1, cx1 + 3); cy1 = Math.min(mh - 1, cy1 + 3);
        var cc = document.createElement('canvas'); cc.width = cx1 - cx0 + 1; cc.height = cy1 - cy0 + 1;
        cc.getContext('2d').drawImage(cvs, cx0, cy0, cc.width, cc.height, 0, 0, cc.width, cc.height);
        cvs = cc; ex0 += cx0; ey0 += cy0; mw = cc.width; mh = cc.height;
        var aspect = mw / mh, relY = (ey0 + mh / 2) / bh;
        var kind = (aspect > 2.6 && relY < 0.4) || aspect > 4 ? 'text' : 'figure';
        cands.push({ cv: cvs, kind: kind, sheet: si, w: mw, h: mh, area: area, x: x0 + ex0, y: y0 + ey0, sel: kind === 'figure' });
      });
      /* весь лист целиком как один «стикер» */
      var scv = document.createElement('canvas'); scv.width = bw; scv.height = bh;
      var sgx = scv.getContext('2d'), sim = sgx.createImageData(bw, bh), sd = sim.data;
      for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) { var g4 = ((y0 + y) * cw + x0 + x) * 4, o5 = (y * bw + x) * 4; sd[o5] = data[g4]; sd[o5 + 1] = data[g4 + 1]; sd[o5 + 2] = data[g4 + 2]; sd[o5 + 3] = H[y * bw + x] ? 255 : 0; }
      sgx.putImageData(sim, 0, 0);
      cands.push({ cv: scv, kind: 'sheet', sheet: si, w: bw, h: bh, area: bw * bh, x: x0, y: y0, sel: false });
    });
    return { cands: cands, size: [cw, ch], sheets: sheets.length, whole: whole };
  }

  window.Scan = { find: find };
})();
