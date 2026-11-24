/* Carte GTA 6 — fond de carte dessiné sur canvas (aucune image) :
   eau en dégradé de profondeur, terre, occupation du sol, routes hiérarchisées, ponts, voies ferrées,
   noms de rues le long des routes, grille de repérage. Coordonnées monde : x vers l'est, y vers le nord (1 unité ≈ 1 m).
   Expose window.GTA6_BASEMAP = { create(map, data) -> bm, THEMES }. */
(function () {
  'use strict';

  /* ---------- Thèmes ---------- */
  // rings : anneaux d'eau autour des côtes (mètres), du large vers la côte, avec la couleur de chaque anneau.
  // w : largeur en px écran du trait selon le zoom (-6 … 2), interpolée ; cas : liseré (px ajoutés de chaque côté).
  var W = {
    highway: [2, 2.4, 3, 4, 5.4, 7.5, 11, 16, 24],
    major: [1.1, 1.4, 1.9, 2.7, 3.8, 5.6, 8.4, 12.5, 18],
    minor: [0, 0.5, 0.9, 1.4, 2.4, 4, 6.5, 10, 15],
    street: [0, 0, 0, 0.7, 1.4, 2.6, 4.6, 7.5, 12],
    rail: [0, 0, 0.8, 1, 1.3, 1.6, 2, 2.4, 3]
  };
  // anneaux d'eau : couleurs interpolées du large (c0) vers la côte (c1)
  function rampRings(c0, c1, dists) {
    var a = [1, 3, 5].map(function (i) { return parseInt(c0.substr(i, 2), 16); }), b = [1, 3, 5].map(function (i) { return parseInt(c1.substr(i, 2), 16); });
    return dists.map(function (d, k) {
      var t = Math.pow((k + 1) / dists.length, 1.15);
      return [d, 'rgb(' + a.map(function (v, j) { return Math.round(v + (b[j] - v) * t); }).join(',') + ')'];
    });
  }
  var THEMES = {
    game: {
      id: 'game', n: 'Jeu',
      bg: '#4f88b3',
      rings: rampRings('#4f88b3', '#a9d6ec', [1600, 1300, 1050, 850, 680, 540, 420, 320, 240, 175, 120, 80, 45, 20]),
      land: '#e4e8ee', coast: '#8fb0c9', coastW: 1, lake: '#98cbe6',
      lu: {
        forest: '#c3d9b5', swamp: '#bdd3c3', park: '#b9dea1', beach: '#f0e5c3', industrial: '#dad5cd',
        urban: '#cfd5df', airport: '#d9dce4', runway: '#a9b0bc'
      },
      road: {
        street: { c: '#ffffff', cas: 0, casc: '#c8ced8' },
        minor: { c: '#ffffff', cas: 0.6, casc: '#bfc6d1' },
        major: { c: '#ffffff', cas: 0.8, casc: '#aab3c0' },
        highway: { c: '#fbf7ea', cas: 0.9, casc: '#8f98a6' },
        bridge: { casc: '#5d6878' },
        rail: { c: '#8c95a3' }
      },
      runwayLine: '#ffffff',
      grid: 'rgba(36, 58, 92, .28)',
      st: { fill: '#3e4655', halo: 'rgba(255,255,255,.95)', hw: '#3a4250' },
      neon: false
    },
    neon: {
      id: 'neon', n: 'Néon',
      bg: null,
      rings: [],
      land: '#1b1647', coast: '#33e1ff', coastW: 1.3, lake: '#0d0a2e',
      lu: {
        forest: '#172f45', swamp: '#163a42', park: '#1b3d47', beach: '#2a2458', industrial: '#211b4f',
        urban: '#231d58', airport: '#221c55', runway: '#3b3480'
      },
      road: {
        street: { c: '#4c43a0', cas: 0, casc: '#0a0720' },
        minor: { c: '#7c73d6', cas: 0.7, casc: '#0a0720' },
        major: { c: '#c9c3ff', cas: 1.2, casc: '#0a0720' },
        highway: { c: '#ff9bd8', cas: 1.4, casc: '#0a0720' },
        bridge: { casc: '#05030f' },
        rail: { c: '#6fe3ff' }
      },
      runwayLine: '#8f86ff',
      grid: 'rgba(34, 230, 255, .10)',
      st: { fill: '#e6e0ff', halo: 'rgba(10,7,32,.92)', hw: '#ffc2e8' },
      neon: true
    }
  };
  // ordre imposé par le format (pas de trous : une zone urbaine englobe ses parcs, l'ordre corrige l'affichage) ; l'eau est dessinée ensuite
  var LU_ORDER = ['forest', 'swamp', 'urban', 'park', 'industrial', 'airport', 'runway', 'beach'];
  var ROAD_ORDER = ['street', 'minor', 'rail', 'major', 'highway'];
  var ROAD_KINDS = { highway: 1, major: 1, minor: 1, street: 1, bridge: 1, rail: 1 };
  var LODS = [-6, -4, -2, 0];
  var CHUNK = 2000;

  function lerpW(arr, z) {
    var t = Math.max(0, Math.min(8, z + 6)), i = Math.floor(t), f = t - i;
    return i >= 8 ? arr[8] : arr[i] + (arr[i + 1] - arr[i]) * f;
  }
  function lodFor(z) { var l = LODS[0]; for (var i = 0; i < LODS.length; i++) if (z >= LODS[i] - 0.25) l = LODS[i]; return l; }

  /* ---------- Géométrie ---------- */
  function okPts(p) { return Array.isArray(p) && p.length >= 2 && p.every(function (q) { return Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]); }); }
  function bboxOf(pts) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < pts.length; i++) { var p = pts[i]; if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }
    return b;
  }
  // Douglas-Peucker itératif
  function simplify(pts, tol) {
    var n = pts.length; if (n < 3 || tol <= 0) return pts;
    var keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    var stack = [0, n - 1], t2 = tol * tol;
    while (stack.length) {
      var b = stack.pop(), a = stack.pop(), ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay, L2 = dx * dx + dy * dy, md = 0, mi = -1;
      for (var i = a + 1; i < b; i++) {
        var px = pts[i][0] - ax, py = pts[i][1] - ay, d;
        if (L2 === 0) d = px * px + py * py;
        else { var t = (px * dx + py * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; var ex = px - t * dx, ey = py - t * dy; d = ex * ex + ey * ey; }
        if (d > md) { md = d; mi = i; }
      }
      if (md > t2 && mi > 0) { keep[mi] = 1; stack.push(a, mi, mi, b); }
    }
    var out = []; for (var k = 0; k < n; k++) if (keep[k]) out.push(pts[k]);
    return out;
  }
  function tolFor(lod) { return 0.45 / Math.pow(2, lod); }

  // Path2D d'une liste de géométries, simplifiées pour le niveau de détail
  function buildPath(geoms, lod, closed) {
    var P = new Path2D(), tol = tolFor(lod), minSpan = tol * 2.5;
    for (var g = 0; g < geoms.length; g++) {
      var it = geoms[g];
      if (it.bb[2] - it.bb[0] < minSpan && it.bb[3] - it.bb[1] < minSpan && lod < 0) continue;
      var pts = simplify(it.pts, tol);
      if (pts.length < (closed ? 3 : 2)) continue;
      P.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) P.lineTo(pts[i][0], pts[i][1]);
      if (closed) P.closePath();
    }
    return P;
  }

  /* ---------- Index spatial par blocs ---------- */
  function Index() { this.chunks = {}; this.list = []; }
  Index.prototype.add = function (key, item) {
    var cx = Math.floor((item.bb[0] + item.bb[2]) / 2 / CHUNK), cy = Math.floor((item.bb[1] + item.bb[3]) / 2 / CHUNK), id = cx + ':' + cy;
    var c = this.chunks[id];
    if (!c) { c = this.chunks[id] = { bb: item.bb.slice(), g: {}, p: {} }; this.list.push(c); }
    else { var b = c.bb; if (item.bb[0] < b[0]) b[0] = item.bb[0]; if (item.bb[1] < b[1]) b[1] = item.bb[1]; if (item.bb[2] > b[2]) b[2] = item.bb[2]; if (item.bb[3] > b[3]) b[3] = item.bb[3]; }
    (c.g[key] || (c.g[key] = [])).push(item);
  };
  Index.prototype.visible = function (v, m) {
    var out = [];
    for (var i = 0; i < this.list.length; i++) {
      var b = this.list[i].bb;
      if (b[2] + m >= v[0] && b[0] - m <= v[2] && b[3] + m >= v[1] && b[1] - m <= v[3]) out.push(this.list[i]);
    }
    return out;
  };
  function chunkPath(c, key, lod, closed) {
    var k = key + '@' + lod;
    var p = c.p[k];
    if (!p) p = c.p[k] = buildPath(c.g[key], lod, closed);
    return p;
  }

  // relie bout à bout les tronçons de même nom (pour placer des noms de rue sur de longues lignes)
  function chains(segs) {
    var ends = {}, used = new Uint8Array(segs.length), out = [];
    function key(p) { return Math.round(p[0] / 4) + ',' + Math.round(p[1] / 4); }
    function add(k, i, e) { (ends[k] || (ends[k] = [])).push([i, e]); }
    segs.forEach(function (s, i) { add(key(s[0]), i, 0); add(key(s[s.length - 1]), i, 1); });
    function take(k) {
      var l = ends[k]; if (!l) return null;
      for (var j = 0; j < l.length; j++) if (!used[l[j][0]]) { used[l[j][0]] = 1; return l[j]; }
      return null;
    }
    for (var i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      var ch = segs[i].slice(), t;
      while ((t = take(key(ch[ch.length - 1])))) { var s = segs[t[0]]; s = t[1] === 0 ? s : s.slice().reverse(); ch = ch.concat(s.slice(1)); }
      while ((t = take(key(ch[0])))) { var s2 = segs[t[0]]; s2 = t[1] === 1 ? s2 : s2.slice().reverse(); ch = s2.slice(0, -1).concat(ch); }
      out.push(ch);
    }
    return out;
  }

  /* ---------- Préparation des données ---------- */
  function prepare(data) {
    var B = { land: [], holes: [], idx: new Index(), lab: new Index(), has: {}, nRoads: 0 };
    var land = data.land || {};
    (Array.isArray(land.polygons) ? land.polygons : []).forEach(function (p) { if (okPts(p) && p.length > 2) B.land.push({ pts: p, bb: bboxOf(p) }); });
    (Array.isArray(land.holes) ? land.holes : []).forEach(function (p) { if (okPts(p) && p.length > 2) B.holes.push({ pts: p, bb: bboxOf(p) }); });
    var lu = data.landuse && typeof data.landuse === 'object' ? data.landuse : {};
    Object.keys(lu).forEach(function (k) {
      if (!Array.isArray(lu[k])) return;
      var key = k === 'water' ? 'water' : LU_ORDER.indexOf(k) >= 0 ? k : null;
      if (!key) return;
      lu[k].forEach(function (p) {
        if (!okPts(p) || p.length < 3) return;
        B.idx.add('lu:' + key, { pts: p, bb: bboxOf(p) }); B.has['lu:' + key] = true;
      });
    });
    var named = {};
    (Array.isArray(data.roads) ? data.roads : []).forEach(function (r) {
      if (!r || !okPts(r.pts)) return;
      var k = ROAD_KINDS[r.k] ? r.k : 'minor';
      var it = { pts: r.pts, bb: bboxOf(r.pts) };
      B.idx.add('rd:' + k, it); B.has['rd:' + k] = true; B.nRoads++;
      var n = typeof r.n === 'string' ? r.n.trim() : '';
      if (n && k !== 'rail') { var kk = (k === 'bridge' ? 'major' : k) + '|' + n; (named[kk] || (named[kk] = [])).push(r.pts); }
    });
    Object.keys(named).forEach(function (kk) {
      var cls = kk.split('|')[0], n = kk.slice(cls.length + 1);
      chains(named[kk]).forEach(function (pts) {
        var len = 0; for (var i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (len < 40) return;
        B.lab.add('lb:' + cls, { pts: pts, bb: bboxOf(pts), n: n, len: len, cls: cls });
      });
    });
    var b = Array.isArray(land.bbox) && land.bbox.length === 4 ? land.bbox : null;
    if (!b && B.land.length) { b = [Infinity, Infinity, -Infinity, -Infinity]; B.land.forEach(function (p) { b[0] = Math.min(b[0], p.bb[0]); b[1] = Math.min(b[1], p.bb[1]); b[2] = Math.max(b[2], p.bb[2]); b[3] = Math.max(b[3], p.bb[3]); }); }
    B.bbox = b;
    B.landP = {}; B.holeP = {}; B.ringP = {};
    return B;
  }

  /* ---------- Grille de repérage ---------- */
  function makeGrid(bbox) {
    var S = 1000, b = bbox || [-10000, -9000, 3000, 10000];
    var x0 = Math.floor(b[0] / S) * S, x1 = Math.ceil(b[2] / S) * S, y0 = Math.floor(b[1] / S) * S, y1 = Math.ceil(b[3] / S) * S;
    var G = { size: S, x0: x0, x1: x1, y0: y0, y1: y1, cols: Math.round((x1 - x0) / S), rows: Math.round((y1 - y0) / S) };
    G.colName = function (i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    G.cellOf = function (x, y) {
      var c = Math.floor((x - x0) / S), r = Math.floor((y1 - y) / S);
      if (c < 0 || r < 0 || c >= G.cols || r >= G.rows) return '';
      return G.colName(c) + (r + 1);
    };
    return G;
  }

  /* ---------- Dessin ---------- */
  // T : { s (px écran par mètre), r (densité de pixels), ox, oy (coin haut-gauche du canvas en coords monde), w, h (px css), z }
  function drawScene(B, ctx, T, th, opt) {
    opt = opt || {};
    var s = T.s, r = T.r, z = T.z, lod = lodFor(z);
    var vx0 = T.ox, vx1 = T.ox + T.w / s, vy1 = T.oy, vy0 = T.oy - T.h / s, view = [vx0, vy0, vx1, vy1];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, T.w * r, T.h * r);
    if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, T.w * r, T.h * r); }
    ctx.setTransform(r * s, 0, 0, -r * s, -r * s * T.ox, r * s * T.oy);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    var px = 1 / s;
    var landP = B.landP[lod] || (B.landP[lod] = (function () { var P = buildPath(B.land, lod, true); P.addPath(buildPath(B.holes, lod, true)); return P; })());
    var holeP = B.holeP[lod] || (B.holeP[lod] = buildPath(B.holes, lod, true));
    // 1. eau : dégradé de profondeur (image pré-calculée une fois, floutée)
    var wb = waterBitmap(B, th);
    if (wb) {
      ctx.save(); ctx.imageSmoothingEnabled = true;
      ctx.translate(wb.x0, wb.y1); ctx.scale(wb.res, -wb.res); ctx.drawImage(wb.img, 0, 0);
      ctx.restore();
    }
    // 2. terre (et effets néon)
    if (th.neon) {
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 26 * r; ctx.shadowOffsetY = 10 * r;
      ctx.fillStyle = '#03020d'; ctx.fill(landP, 'evenodd'); ctx.restore();
      ctx.strokeStyle = 'rgba(255,46,151,.17)'; ctx.lineWidth = (6 + Math.max(0, (z + 6) / 8) * 10) * px; ctx.stroke(landP);
    }
    ctx.fillStyle = th.land; ctx.fill(landP, 'evenodd');
    if (th.neon && opt.tints && opt.tints.length) {
      ctx.save(); ctx.clip(landP, 'evenodd');
      opt.tints.forEach(function (t) {
        if (t.x + t.r < vx0 || t.x - t.r > vx1 || t.y + t.r < vy0 || t.y - t.r > vy1) return;
        var g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, t.r);
        g.addColorStop(0, 'rgba(' + t.c + ',' + t.a + ')'); g.addColorStop(0.55, 'rgba(' + t.c + ',' + (t.a * 0.45).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + t.c + ',0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    }
    var chunks = B.idx.visible(view, 400);
    // 3. occupation du sol
    LU_ORDER.forEach(function (k) {
      if (!B.has['lu:' + k]) return;
      ctx.fillStyle = th.lu[k];
      for (var c = 0; c < chunks.length; c++) if (chunks[c].g['lu:' + k]) ctx.fill(chunkPath(chunks[c], 'lu:' + k, lod, true));
      if (k === 'runway' && z >= -2.5) {   // ligne axiale des pistes
        ctx.strokeStyle = th.runwayLine; ctx.lineWidth = 1.2 * px; ctx.setLineDash([10 * px, 8 * px]);
        for (var c2 = 0; c2 < chunks.length; c2++) {
          var rw = chunks[c2].g['lu:runway']; if (!rw) continue;
          rw.forEach(function (it) { axisLine(ctx, it.pts); });
        }
        ctx.setLineDash([]);
      }
    });
    // 4. eaux intérieures (lacs, rivières, canaux) par-dessus
    ctx.fillStyle = th.lake;
    ctx.fill(holeP, 'evenodd');
    if (B.has['lu:water']) for (var c3 = 0; c3 < chunks.length; c3++) if (chunks[c3].g['lu:water']) ctx.fill(chunkPath(chunks[c3], 'lu:water', lod, true));
    // 5. trait de côte
    ctx.strokeStyle = th.coast; ctx.lineWidth = th.coastW * px; ctx.stroke(landP);
    if (th.neon) { ctx.strokeStyle = 'rgba(111,227,255,.25)'; ctx.lineWidth = 3 * px; ctx.stroke(landP); }
    // 6. routes
    if (!opt.noRoads) drawRoads(B, ctx, chunks, th, z, lod, px, opt);
    // 7. grille
    if (opt.grid) drawGrid(ctx, opt.grid, view, s, th, px);
  }

  // eau autour des côtes : anneaux de plus en plus clairs, dessinés une seule fois dans une image basse résolution puis adoucis
  function waterBitmap(B, th) {
    if (!th.rings.length || !B.bbox || !B.land.length) return null;
    B.wb = B.wb || {};
    if (B.wb[th.id] !== undefined) return B.wb[th.id];
    var pad = th.rings[0][0] + 300, b = B.bbox;
    var x0 = b[0] - pad, x1 = b[2] + pad, y0 = b[1] - pad, y1 = b[3] + pad;
    var res = Math.max(10, (x1 - x0) / 1400, (y1 - y0) / 1400);
    var w = Math.ceil((x1 - x0) / res), h = Math.ceil((y1 - y0) / res), out = null;
    try {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var g = c.getContext('2d');
      g.fillStyle = th.bg; g.fillRect(0, 0, w, h);
      g.setTransform(1 / res, 0, 0, -1 / res, -x0 / res, y1 / res);
      g.lineJoin = 'round';
      var P = buildPath(B.land, -4, true); P.addPath(buildPath(B.holes, -4, true));
      for (var i = 0; i < th.rings.length; i++) { g.strokeStyle = th.rings[i][1]; g.lineWidth = th.rings[i][0] * 2; g.stroke(P); }
      g.fillStyle = th.rings[th.rings.length - 1][1]; g.fill(P, 'evenodd');
      // adoucit les paliers : réduction puis agrandissement (flou léger, compatible partout)
      var sw = Math.max(1, Math.round(w / 5)), sh = Math.max(1, Math.round(h / 5));
      var c2 = document.createElement('canvas'); c2.width = sw; c2.height = sh;
      var g2 = c2.getContext('2d'); g2.imageSmoothingEnabled = true; g2.drawImage(c, 0, 0, sw, sh);
      g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true; g.globalAlpha = 0.85; g.drawImage(c2, 0, 0, w, h); g.globalAlpha = 1;
      out = { img: c, x0: x0, y1: y1, res: res };
    } catch (e) { out = null; }
    B.wb[th.id] = out;
    return out;
  }

  function axisLine(ctx, pts) {
    // axe d'un rectangle (piste) : milieu des deux plus petits côtés
    if (pts.length < 4) return;
    var best = 0, bi = 0;
    for (var i = 0; i < pts.length; i++) { var a = pts[i], b = pts[(i + 1) % pts.length], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d > best) { best = d; bi = i; } }
    var p0 = pts[bi], p1 = pts[(bi + 1) % pts.length], q0 = pts[(bi + 2) % pts.length], q1 = pts[(bi + 3) % pts.length];
    ctx.beginPath();
    ctx.moveTo((p0[0] + q1[0]) / 2, (p0[1] + q1[1]) / 2); ctx.lineTo((p1[0] + q0[0]) / 2, (p1[1] + q0[1]) / 2);
    ctx.stroke();
  }

  function alphaFor(k, z) {
    if (k === 'street') return z < -3.25 ? 0 : Math.min(1, 0.3 + (z + 3.25) * 0.45);
    if (k === 'minor') return z < -5 ? 0 : Math.min(1, 0.45 + (z + 5) * 0.3);
    if (k === 'rail') return z < -4.25 ? 0 : 1;
    return 1;
  }

  function strokeClass(ctx, chunks, key, lod) {
    for (var c = 0; c < chunks.length; c++) if (chunks[c].g[key]) ctx.stroke(chunkPath(chunks[c], key, lod, false));
  }

  function drawRoads(B, ctx, chunks, th, z, lod, px, opt) {
    var only = opt.roadClasses;
    ROAD_ORDER.forEach(function (k) {
      if (only && only.indexOf(k) < 0) return;
      var key = 'rd:' + k; if (!B.has[key]) return;
      var a = alphaFor(k, z); if (!a) return;
      var w = lerpW(W[k], z) * (opt.wk || 1); if (w <= 0) return;
      var st = th.road[k];
      ctx.globalAlpha = a;
      if (k === 'rail') {
        ctx.strokeStyle = st.c; ctx.lineWidth = Math.max(0.8, w * 0.6) * px; ctx.lineCap = 'butt';
        strokeClass(ctx, chunks, key, lod);
        if (z >= -2.5) { ctx.lineWidth = (w * 2.6 + 2) * px; ctx.setLineDash([1.4 * px, 6 * px]); strokeClass(ctx, chunks, key, lod); ctx.setLineDash([]); }
        ctx.lineCap = 'round';
      } else {
        if (st.cas > 0 && (k !== 'minor' || z >= -3.5)) { ctx.strokeStyle = st.casc; ctx.lineWidth = (w + st.cas * 2) * px; strokeClass(ctx, chunks, key, lod); }
        ctx.strokeStyle = st.c; ctx.lineWidth = w * px; strokeClass(ctx, chunks, key, lod);
      }
      ctx.globalAlpha = 1;
    });
    // ponts : chaussée bordée d'un liseré sombre (bien marqué en vue proche, discret en vue large)
    if (B.has['rd:bridge'] && (!only || only.indexOf('major') >= 0)) {
      var wb = (lerpW(W.major, z) + lerpW(W.highway, z)) / 2 * (opt.wk || 1);
      var far = z < -3.5;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = far ? th.road.major.casc : th.road.bridge.casc;
      ctx.lineWidth = (wb + (far ? 1.2 : 2 + Math.max(0, z + 3.5) * 0.7)) * px; strokeClass(ctx, chunks, 'rd:bridge', lod);
      ctx.strokeStyle = th.road.major.c; ctx.lineWidth = wb * px; strokeClass(ctx, chunks, 'rd:bridge', lod);
      ctx.lineCap = 'round';
    }
  }

  function drawGrid(ctx, G, v, s, th, px) {
    if (G.size * s < 10) return;
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1 * px;
    ctx.beginPath();
    for (var x = G.x0; x <= G.x1; x += G.size) { if (x < v[0] - G.size || x > v[2] + G.size) continue; ctx.moveTo(x, Math.max(G.y0, v[1] - 10)); ctx.lineTo(x, Math.min(G.y1, v[3] + 10)); }
    for (var y = G.y0; y <= G.y1; y += G.size) { if (y < v[1] - G.size || y > v[3] + G.size) continue; ctx.moveTo(Math.max(G.x0, v[0] - 10), y); ctx.lineTo(Math.min(G.x1, v[2] + 10), y); }
    ctx.stroke();
  }

  /* ---------- Calques Leaflet ---------- */
  var DPR = function () { return Math.min(2, Math.max(1, window.devicePixelRatio || 1)); };

  var CanvasLayer = L.Renderer.extend({
    options: { padding: 0.25 },
    initialize: function (drawFn, options) { L.Renderer.prototype.initialize.call(this, options); this._drawFn = drawFn; },
    _initContainer: function () {
      var c = this._container = document.createElement('canvas');
      c.style.pointerEvents = 'none';
      this._ctx = c.getContext('2d');
    },
    _destroyContainer: function () { L.DomUtil.remove(this._container); delete this._ctx; delete this._container; },
    _update: function () {
      if (this._map._animatingZoom && this._bounds) return;
      L.Renderer.prototype._update.call(this);
      var b = this._bounds, size = b.getSize(), r = DPR();
      L.DomUtil.setPosition(this._container, b.min);
      this._container.width = Math.round(r * size.x); this._container.height = Math.round(r * size.y);
      this._container.style.width = size.x + 'px'; this._container.style.height = size.y + 'px';
      this.redraw();
      this.fire('update');
    },
    redraw: function () {
      if (!this._map || !this._bounds) return;
      var m = this._map, z = m.getZoom(), s = Math.pow(2, z), po = m.getPixelOrigin(), b = this._bounds, size = b.getSize();
      var T = { s: s, r: DPR(), z: z, w: size.x, h: size.y, ox: (po.x + b.min.x) / s, oy: -(po.y + b.min.y) / s, bmin: b.min };
      var t0 = performance.now();
      this._drawFn(this._ctx, T);
      this.lastMs = performance.now() - t0;
    }
  });

  /* ---------- Noms de rues (texte orienté le long des routes, sans chevauchement) ---------- */
  var ST = {   // classe -> [zoom mini, taille police, graisse, majuscules]
    highway: [-2.5, 12.5, 700, true],
    major: [-1.5, 12, 700, false],
    minor: [-0.75, 11.5, 600, false],
    street: [-0.25, 11, 600, false]
  };
  var widthCache = {};
  function charWidths(ctx, font, txt) {
    var c = widthCache[font] || (widthCache[font] = {}), out = [];
    ctx.font = font;
    for (var i = 0; i < txt.length; i++) { var ch = txt[i]; if (c[ch] == null) c[ch] = ctx.measureText(ch).width; out.push(c[ch]); }
    return out;
  }
  function Collide(cell) { this.cell = cell; this.g = {}; }
  Collide.prototype.hit = function (b) {
    var C = this.cell;
    for (var gx = Math.floor(b[0] / C); gx <= Math.floor(b[2] / C); gx++) for (var gy = Math.floor(b[1] / C); gy <= Math.floor(b[3] / C); gy++) {
      var l = this.g[gx + ',' + gy]; if (!l) continue;
      for (var i = 0; i < l.length; i++) { var q = l[i]; if (b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]) return true; }
    }
    return false;
  };
  Collide.prototype.add = function (b) {
    var C = this.cell;
    for (var gx = Math.floor(b[0] / C); gx <= Math.floor(b[2] / C); gx++) for (var gy = Math.floor(b[1] / C); gy <= Math.floor(b[3] / C); gy++) (this.g[gx + ',' + gy] || (this.g[gx + ',' + gy] = [])).push(b);
  };

  // place un libellé le long de la polyligne écran P (cumul L) à partir de la distance d0 ; renvoie la liste des caractères ou null
  function layoutAlong(P, L, d0, ws) {
    var out = [], acc = 0, seg = 1, prevA = null, firstA = null;
    for (var i = 0; i < ws.length; i++) {
      var d = d0 + acc + ws[i] / 2;
      while (seg < P.length - 1 && L[seg] < d) seg++;
      var a = P[seg - 1], b = P[seg], sl = L[seg] - L[seg - 1] || 1, t = (d - L[seg - 1]) / sl;
      var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (prevA !== null) {
        var da = Math.abs(ang - prevA); if (da > Math.PI) da = 2 * Math.PI - da;
        if (da > 0.42) return null;
        var dt = Math.abs(ang - firstA); if (dt > Math.PI) dt = 2 * Math.PI - dt;
        if (dt > 0.95) return null;
      } else firstA = ang;
      prevA = ang;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ang]);
      acc += ws[i];
    }
    return out;
  }

  function drawStreetLabels(B, ctx, T, th, obstacles) {
    var r = T.r, s = T.s, z = T.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, T.w * r, T.h * r);
    var classes = ['highway', 'major', 'minor', 'street'].filter(function (k) { return z >= ST[k][0] && B.has['lb:' + k] !== false; });
    if (!classes.length) return 0;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    var col = new Collide(80), placedByName = {}, n = 0;
    (obstacles || []).forEach(function (b) { col.add([b[0] - T.bmin.x, b[1] - T.bmin.y, b[2] - T.bmin.x, b[3] - T.bmin.y]); });
    var view = [T.ox, T.oy - T.h / s, T.ox + T.w / s, T.oy];
    var chunks = B.lab.visible(view, 200);
    var margin = 6, rep = 560;
    classes.forEach(function (k) {
      var key = 'lb:' + k, items = [];
      chunks.forEach(function (c) { if (c.g[key]) items = items.concat(c.g[key]); });
      items.sort(function (a, b) { return b.len - a.len; });
      var cfg = ST[k], fs = cfg[1], font = cfg[2] + ' ' + fs + 'px Rajdhani, "Segoe UI", sans-serif';
      for (var it = 0; it < items.length; it++) {
        var f = items[it];
        if (f.len * s < 60) continue;
        if (f.bb[2] < view[0] || f.bb[0] > view[2] || f.bb[3] < view[1] || f.bb[1] > view[3]) continue;
        var txt = cfg[3] ? f.n.toUpperCase() : f.n;
        var ws = charWidths(ctx, font, txt), tw = 0; ws.forEach(function (w) { tw += w; });
        if (cfg[3]) { ws = ws.map(function (w) { return w + 0.6; }); tw += ws.length * 0.6; }
        if (f.len * s < tw + 24) continue;
        // polyligne écran (px css du canvas), sans points trop serrés
        var P = [], last = null;
        for (var i = 0; i < f.pts.length; i++) {
          var x = (f.pts[i][0] - T.ox) * s, y = (T.oy - f.pts[i][1]) * s;
          if (last && Math.abs(x - last[0]) + Math.abs(y - last[1]) < 2 && i < f.pts.length - 1) continue;
          P.push(last = [x, y]);
        }
        if (P.length < 2) continue;
        var L0 = [0]; for (var j = 1; j < P.length; j++) L0.push(L0[j - 1] + Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1]));
        var Lt = L0[L0.length - 1]; if (Lt < tw + 24) continue;
        var cands = [];
        if (Lt < rep * 1.6) cands = [Lt / 2, Lt / 2 - (Lt - tw) / 4, Lt / 2 + (Lt - tw) / 4];
        else for (var dd = rep / 2; dd < Lt - tw / 2; dd += rep) cands.push(dd);
        var R = null, RL = null;
        for (var ci = 0; ci < cands.length; ci++) {
          var mid = cands[ci], d0 = mid - tw / 2;
          if (d0 < 8 || d0 + tw > Lt - 8) continue;
          // pas deux fois le même nom trop près
          var near = false, pl = placedByName[f.n];
          if (pl) {
            for (var q = 0; q < pl.length; q++) {
              var pp = pointAt(P, L0, mid); if (Math.hypot(pp[0] - pl[q][0], pp[1] - pl[q][1]) < 320) { near = true; break; }
            }
          }
          if (near) continue;
          // sens de lecture : jamais à l'envers
          var pa = pointAt(P, L0, d0), pb = pointAt(P, L0, d0 + tw), PP = P, LL = L0, dstart = d0;
          if (pb[0] < pa[0] - 0.5) {
            if (!R) { R = P.slice().reverse(); RL = [0]; for (var u = 1; u < R.length; u++) RL.push(RL[u - 1] + Math.hypot(R[u][0] - R[u - 1][0], R[u][1] - R[u - 1][1])); }
            PP = R; LL = RL; dstart = Lt - (d0 + tw);
          }
          var chs = layoutAlong(PP, LL, dstart, ws);
          if (!chs) continue;
          var boxes = [], ok = true, h = fs * 0.62;
          for (var c = 0; c < chs.length && ok; c++) {
            var bx = [chs[c][0] - h, chs[c][1] - h, chs[c][0] + h, chs[c][1] + h];
            if (bx[0] < margin || bx[1] < margin || bx[2] > T.w - margin || bx[3] > T.h - margin || col.hit(bx)) ok = false;
            boxes.push(bx);
          }
          if (!ok) continue;
          boxes.forEach(function (bx) { col.add(bx); });
          (placedByName[f.n] || (placedByName[f.n] = [])).push(pointAt(P, L0, mid));
          ctx.font = font;
          ctx.strokeStyle = th.st.halo; ctx.lineWidth = k === 'highway' ? 3.6 : 3.2;
          ctx.fillStyle = k === 'highway' ? th.st.hw : th.st.fill;
          for (var p2 = 0; p2 < 2; p2++) {
            for (var c2 = 0; c2 < chs.length; c2++) {
              ctx.save(); ctx.translate(chs[c2][0], chs[c2][1]); ctx.rotate(chs[c2][2]);
              if (p2 === 0) ctx.strokeText(txt[c2], -ws[c2] / 2, 0.5); else ctx.fillText(txt[c2], -ws[c2] / 2, 0.5);
              ctx.restore();
            }
          }
          n++;
        }
      }
    });
    return n;
  }
  function pointAt(P, L, d) {
    for (var i = 1; i < P.length; i++) if (L[i] >= d) { var t = (d - L[i - 1]) / ((L[i] - L[i - 1]) || 1); return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t]; }
    return P[P.length - 1];
  }

  function segDist(x, y, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, t = L2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
  }

  /* ---------- Bâtiments : rectangles orientés (w, h, a), ombre portée + toit plus clair (2,5D discret) ---------- */
  // couleurs par thème : vides = neutres ; avec contenu = teinte de la catégorie principale (mélangée au thème)
  var BLDG = {
    game: { shadow: 'rgba(38,52,78,.20)', wall: '#b3bbc8', roof: '#dfe3ea', line: 'rgba(104,116,138,.55)', far: '#c3cad5',
      mixRoof: ['#ffffff', 0.5], mixWall: ['#3b4354', 0.42], mixLine: ['#1d2330', 0.3], sel: '#ffffff', pill: 'rgba(255,255,255,.94)', pillTxt: '#1f2530' },
    neon: { shadow: 'rgba(0,0,0,.5)', wall: '#0e0b2c', roof: '#29235f', line: 'rgba(140,128,255,.32)', far: '#2a2462',
      mixRoof: ['#1b1647', 0.6], mixWall: ['#05030f', 0.62], mixLine: ['#ffffff', 0.1], sel: '#ffffff', pill: 'rgba(7,11,31,.92)', pillTxt: '#ffffff' }
  };
  var LIFT = { tower: 9, hotel: 6, bank: 4.5, landmark: 5, warehouse: 3.5, store: 3, villa: 3, house: 2.5, other: 3 };
  var BCELL = 400;
  var mixCache = {};
  function mix(c1, c2, t) {
    var k = c1 + c2 + t;
    if (mixCache[k]) return mixCache[k];
    var h = function (c) { c = c.replace('#', ''); if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]; return [0, 2, 4].map(function (i) { return parseInt(c.substr(i, 2), 16) || 0; }); };
    var a = h(c1), b = h(c2);
    return (mixCache[k] = 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }).join(',') + ')');
  }
  function bldgIndex(list) {
    var I = { cells: {}, list: list };
    list.forEach(function (b) {
      var k = Math.floor(b.x / BCELL) + ':' + Math.floor(b.y / BCELL);
      (I.cells[k] || (I.cells[k] = [])).push(b);
    });
    return I;
  }
  function bldgIn(I, x0, y0, x1, y1) {
    var out = [];
    for (var gx = Math.floor(x0 / BCELL); gx <= Math.floor(x1 / BCELL); gx++) {
      for (var gy = Math.floor(y0 / BCELL); gy <= Math.floor(y1 / BCELL); gy++) {
        var c = I.cells[gx + ':' + gy];
        if (c) for (var i = 0; i < c.length; i++) out.push(c[i]);
      }
    }
    return out;
  }
  // coins écran (px CSS) d'un bâtiment, sens horaire à l'écran ; taille mini (px) pour rester lisible au dézoom
  function bldgCorners(b, T, minPx) {
    var s = T.s, cx = (b.x - T.ox) * s, cy = (T.oy - b.y) * s;
    var hw = Math.max(minPx, b.w * s / 2), hh = Math.max(minPx * 0.75, b.h * s / 2);
    var a = (b.a || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    var out = [], U = [-1, 1, 1, -1], V = [1, 1, -1, -1];
    for (var i = 0; i < 4; i++) { var u = U[i] * hw, v = V[i] * hh; out.push([cx + ca * u - sa * v, cy - (sa * u + ca * v)]); }
    return { c: out, cx: cx, cy: cy };
  }
  function polyTo(ctx, p, dx, dy) {
    // sens positif imposé : les morceaux d'un même chemin s'additionnent (règle nonzero, pas de trous)
    var area = 0;
    for (var i = 0; i < p.length; i++) { var q = p[(i + 1) % p.length]; area += p[i][0] * q[1] - q[0] * p[i][1]; }
    var n = p.length;
    if (area >= 0) { ctx.moveTo(p[0][0] + dx, p[0][1] + dy); for (var j = 1; j < n; j++) ctx.lineTo(p[j][0] + dx, p[j][1] + dy); }
    else { ctx.moveTo(p[n - 1][0] + dx, p[n - 1][1] + dy); for (var k = n - 2; k >= 0; k--) ctx.lineTo(p[k][0] + dx, p[k][1] + dy); }
    ctx.closePath();
  }
  // volume extrudé : base + base décalée + faces latérales (enveloppe)
  function extrudeTo(ctx, c, tx, ty) {
    polyTo(ctx, c, 0, 0); polyTo(ctx, c, tx, ty);
    for (var i = 0; i < 4; i++) {
      var a = c[i], b = c[(i + 1) % 4];
      polyTo(ctx, [a, b, [b[0] + tx, b[1] + ty], [a[0] + tx, a[1] + ty]], 0, 0);
    }
  }
  // o : { content, all, sel, minZ, detailZ } ; chaque bâtiment : x, y, w, h, a, k, col (couleur catégorie si contenu affiché), tc / tn (pastille de valeur)
  function drawBuildings(I, ctx, T, th, o) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, T.w * T.r, T.h * T.r);
    if (!I || T.z < o.minZ - 0.01 || (!o.content && !o.all)) return 0;
    var C = BLDG[th.neon ? 'neon' : 'game'], s = T.s, z = T.z;
    var x0 = T.ox - 80, x1 = T.ox + T.w / s + 80, y1 = T.oy + 80, y0 = T.oy - T.h / s - 80;
    var list = bldgIn(I, x0, y0, x1, y1), empty = [], full = [], sel = null;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
      if (b.col) { if (o.content || o.all) full.push(b); } else if (o.all || (o.content && b.ref)) empty.push(b);   // ref : contient un repère gris du jeu
      if (o.sel === b) sel = b;
    }
    // du nord au sud : les toits du sud recouvrent les façades du nord
    var byY = function (p, q) { return q.y - p.y; };
    empty.sort(byY); full.sort(byY);
    ctx.setTransform(T.r, 0, 0, T.r, 0, 0);
    ctx.lineJoin = 'round';
    var detail = z >= o.detailZ, n = 0;
    var E = empty.map(function (b) { return bldgCorners(b, T, 1.2); });
    var F = full.map(function (b) { return bldgCorners(b, T, 2.4); });
    n = E.length + F.length;
    if (!detail) {
      // vue « ville » : simples aplats (2 remplissages), contenus plus marqués
      if (E.length) { ctx.beginPath(); E.forEach(function (g) { polyTo(ctx, g.c, 0, 0); }); ctx.fillStyle = C.far; ctx.fill(); }
      var groups = {};
      F.forEach(function (g, k) { (groups[full[k].col] || (groups[full[k].col] = [])).push(g); });
      Object.keys(groups).forEach(function (col) {
        ctx.beginPath(); groups[col].forEach(function (g) { polyTo(ctx, g.c, 0, 0); });
        ctx.fillStyle = mix(col, C.far, 0.38); ctx.fill();
        ctx.strokeStyle = mix(col, C.mixLine[0], C.mixLine[1] + 0.15); ctx.lineWidth = 0.8; ctx.stroke();
      });
    } else {
      var lift = function (b) { return Math.max(1.2, Math.min(b.k === 'tower' ? 11 : 7, (LIFT[b.k] || 3) * s * 0.9)); };
      var all = E.map(function (g, k) { return { g: g, b: empty[k], e: lift(empty[k]) }; }).concat(F.map(function (g, k) { return { g: g, b: full[k], e: lift(full[k]) }; }));
      // 1. ombres portées (un seul remplissage), vers le bas-droite
      ctx.beginPath();
      all.forEach(function (it) { extrudeTo(ctx, it.g.c, it.e * 0.9, it.e * 0.75); });
      ctx.fillStyle = C.shadow; ctx.fill();
      // 2. façades puis toits (décalés vers le haut), regroupés par couleur
      var layers = {};
      all.forEach(function (it) {
        var key = it.b.col || '';
        (layers[key] || (layers[key] = [])).push(it);
      });
      var keys = Object.keys(layers).sort(function (a, b) { return a === '' ? -1 : b === '' ? 1 : 0; });
      keys.forEach(function (key) {
        var L0 = layers[key], wall = key ? mix(key, C.mixWall[0], C.mixWall[1]) : C.wall;
        var roof = key ? mix(key, C.mixRoof[0], C.mixRoof[1]) : C.roof, line = key ? mix(key, C.mixLine[0], C.mixLine[1]) : C.line;
        ctx.beginPath(); L0.forEach(function (it) { extrudeTo(ctx, it.g.c, 0, -it.e); }); ctx.fillStyle = wall; ctx.fill();
        ctx.beginPath(); L0.forEach(function (it) { polyTo(ctx, it.g.c, 0, -it.e); }); ctx.fillStyle = roof; ctx.fill();
        ctx.strokeStyle = line; ctx.lineWidth = key ? 1.6 : 0.8; ctx.stroke();
      });
      // 3. pastille de valeur au fort zoom (coin du toit le plus haut à droite, si elle ne gêne pas l'icône centrale)
      if (z >= o.pillZ) {
        ctx.font = '700 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        all.forEach(function (it) {
          var b = it.b; if (!b.col || !b.tn) return;
          var c = it.g.c, best = c[0];
          for (var j = 1; j < 4; j++) if (c[j][0] - c[j][1] > best[0] - best[1]) best = c[j];
          var px = best[0], py = best[1] - it.e;
          if (Math.hypot(px - it.g.cx, py - it.g.cy + it.e) < 34) return;
          var txt = new Array(b.tn + 1).join('$'), w = 8 + 6.5 * b.tn;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(px - w / 2, py - 7, w, 14, 7); else ctx.rect(px - w / 2, py - 7, w, 14);
          ctx.fillStyle = C.pill; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = b.tc || '#ffe14d'; ctx.stroke();
          ctx.fillStyle = th.neon ? (b.tc || '#ffe14d') : C.pillTxt; ctx.fillText(txt, px, py + 0.5);
        });
      }
    }
    // bâtiment sélectionné (fiche ouverte) : liseré blanc + couleur
    if (sel) {
      var g = bldgCorners(sel, T, 2.4), e = detail ? Math.max(1.2, Math.min(sel.k === 'tower' ? 11 : 7, (LIFT[sel.k] || 3) * s * 0.9)) : 0;
      ctx.beginPath(); polyTo(ctx, g.c, 0, -e);
      ctx.lineWidth = 5; ctx.strokeStyle = sel.col || '#22e6ff'; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = C.sel; ctx.stroke();
    }
    return n;
  }
  /* ---------- Repères visibles en jeu : petites icônes grises discrètes (canvas) ---------- */
  var pathCache = {};
  function iconPath(k, pathOf) {
    if (pathCache[k] !== undefined) return pathCache[k];
    var d = pathOf ? pathOf(k) : null, p = null;
    try { p = d ? new Path2D(d) : null; } catch (e) { p = null; }
    return (pathCache[k] = p);
  }
  // chaque point : x, y, ic (clé d'icône), show (bool)
  function drawRefs(I, ctx, T, th, o) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, T.w * T.r, T.h * T.r);
    if (!I || !o.on || T.z < o.minZ - 0.01) return 0;
    var s = T.s, x0 = T.ox - 30 / s, x1 = T.ox + (T.w + 30) / s, y1 = T.oy + 30 / s, y0 = T.oy - (T.h + 30) / s;
    var R = T.z >= -1 ? 8.5 : 7, n = 0, sc = (R * 1.25) / 24;
    var list = bldgIn(I, x0, y0, x1, y1).filter(function (p) { return p.show && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; });
    ctx.setTransform(T.r, 0, 0, T.r, 0, 0);
    // pastilles (un seul remplissage) puis icônes
    ctx.beginPath();
    list.forEach(function (p) { var X = (p.x - T.ox) * s, Y = (T.oy - p.y) * s; ctx.moveTo(X + R, Y); ctx.arc(X, Y, R, 0, Math.PI * 2); });
    ctx.fillStyle = th.neon ? 'rgba(52,56,92,.88)' : 'rgba(116,126,142,.82)'; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = th.neon ? 'rgba(170,176,215,.55)' : 'rgba(255,255,255,.9)'; ctx.stroke();
    ctx.strokeStyle = th.neon ? '#c9cde6' : '#ffffff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    list.forEach(function (p) {
      var P = iconPath(p.ic, o.pathOf); if (!P) return;
      var X = (p.x - T.ox) * s, Y = (T.oy - p.y) * s;
      ctx.setTransform(T.r * sc, 0, 0, T.r * sc, T.r * (X - 12 * sc), T.r * (Y - 12 * sc));
      ctx.lineWidth = 2.4; ctx.stroke(P); n++;
    });
    return n;
  }
  function inBldg(b, x, y, tol) {
    var a = -(b.a || 0) * Math.PI / 180, dx = x - b.x, dy = y - b.y;
    var u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(u) <= b.w / 2 + tol && Math.abs(v) <= b.h / 2 + tol;
  }

  /* ---------- API ---------- */
  function create(map, data, o) {
    o = o || {};
    var B = prepare(data);
    var bm = { B: B, theme: THEMES[o.theme] || THEMES.game, grid: null, G: makeGrid(B.bbox), tints: o.tints || [], obstacles: null, stats: {} };
    bm.base = new CanvasLayer(function (ctx, T) { drawScene(B, ctx, T, bm.theme, { grid: bm.grid || (bm.theme.neon ? bm.G : null), tints: bm.tints }); }, { pane: o.pane || 'base' });
    bm.labels = new CanvasLayer(function (ctx, T) {
      bm.stats.streetLabels = drawStreetLabels(B, ctx, T, bm.theme, bm.obstacles ? bm.obstacles() : []);
    }, { pane: o.labelPane || 'streetlbl', padding: 0.15 });
    bm.addTo = function () { bm.base.addTo(map); return bm; };
    bm.addLabels = function () { bm.labels.addTo(map); return bm; };
    bm.setTheme = function (id) { bm.theme = THEMES[id] || THEMES.game; bm.base.redraw(); bm.labels.redraw(); if (bm.bldg) bm.bldg.redraw(); if (bm.refs) bm.refs.redraw(); };
    // bâtiments (calque canvas dédié, pane « bldg ») : bm.setBuildings(liste, options) puis bm.bldg.redraw() après un changement de style
    bm.bldgOpt = { content: true, all: false, sel: null, minZ: -3, detailZ: -1.5, pillZ: 0.5 };
    bm.setBuildings = function (list, opt) {
      bm.bldgIndex = bldgIndex(list || []);
      if (opt) Object.keys(opt).forEach(function (k) { bm.bldgOpt[k] = opt[k]; });
      if (!bm.bldg) {
        bm.bldg = new CanvasLayer(function (ctx, T) { bm.stats.buildings = drawBuildings(bm.bldgIndex, ctx, T, bm.theme, bm.bldgOpt); }, { pane: o.bldgPane || 'bldg', padding: 0.2 });
        bm.bldg.addTo(map);
      } else bm.bldg.redraw();
      return bm;
    };
    // repères visibles en jeu (pane « refs ») : bm.setRefs(liste, { on, minZ, pathOf }) puis bm.refs.redraw()
    bm.refOpt = { on: true, minZ: -2.5, pathOf: null };
    bm.setRefs = function (list, opt) {
      bm.refIndex = bldgIndex(list || []);
      if (opt) Object.keys(opt).forEach(function (k) { bm.refOpt[k] = opt[k]; });
      if (!bm.refs) {
        bm.refs = new CanvasLayer(function (ctx, T) { bm.stats.refs = drawRefs(bm.refIndex, ctx, T, bm.theme, bm.refOpt); }, { pane: o.refPane || 'refs', padding: 0.15 });
        bm.refs.addTo(map);
      } else bm.refs.redraw();
      return bm;
    };
    bm.refAt = function (x, y, tolPx) {
      if (!bm.refIndex || !bm.refOpt.on || map.getZoom() < bm.refOpt.minZ) return null;
      var tol = (tolPx || 10) / Math.pow(2, map.getZoom()), best = null, bd = tol;
      bldgIn(bm.refIndex, x - tol, y - tol, x + tol, y + tol).forEach(function (p) {
        if (!p.show) return;
        var d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; }
      });
      return best;
    };
    // bâtiment sous un point (coordonnées monde) ; tolérance en px écran ; filtre facultatif
    bm.buildingAt = function (x, y, tolPx, test) {
      if (!bm.bldgIndex) return null;
      var tol = (tolPx || 0) / Math.pow(2, map.getZoom()), best = null, bd = Infinity;
      bldgIn(bm.bldgIndex, x - 100 - tol, y - 100 - tol, x + 100 + tol, y + 100 + tol).forEach(function (b) {
        if ((test && !test(b)) || !inBldg(b, x, y, tol)) return;
        var d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; }
      });
      return best;
    };
    bm.setGrid = function (on) { bm.grid = on ? bm.G : null; bm.base.redraw(); };
    bm.hasRoads = function () { return B.nRoads > 0; };
    // nom de la rue la plus proche (ou null)
    bm.nearestStreet = function (x, y, maxD) {
      var best = null, bd = maxD;
      B.lab.visible([x - maxD, y - maxD, x + maxD, y + maxD], 0).forEach(function (c) {
        Object.keys(c.g).forEach(function (k) {
          c.g[k].forEach(function (it) {
            if (it.bb[0] - bd > x || it.bb[2] + bd < x || it.bb[1] - bd > y || it.bb[3] + bd < y) return;
            for (var i = 1; i < it.pts.length; i++) {
              var d = segDist(x, y, it.pts[i - 1], it.pts[i]);
              if (d < bd) { bd = d; best = it.n; }
            }
          });
        });
      });
      return best;
    };
    // rues dont le nom passe le test : le plus long tronçon de chaque nom
    bm.findStreets = function (test, max) {
      var by = {};
      B.lab.list.forEach(function (c) {
        Object.keys(c.g).forEach(function (k) {
          c.g[k].forEach(function (it) { if (test(it.n) && (!by[it.n] || by[it.n].len < it.len)) by[it.n] = it; });
        });
      });
      return Object.keys(by).map(function (n) { return by[n]; }).sort(function (a, b) { return b.len - a.len; }).slice(0, max || 5);
    };
    // mini-vue (« Où est-ce sur la carte du jeu ? ») : dessine une vue fixe dans un canvas
    bm.renderMini = function (canvas, cx, cy, z, w, h) {
      var r = DPR(), s = Math.pow(2, z);
      canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      var T = { s: s, r: r, z: z, w: w, h: h, ox: cx - w / 2 / s, oy: cy + h / 2 / s };
      var ctx = canvas.getContext('2d');
      drawScene(B, ctx, T, bm.theme, { tints: bm.tints, roadClasses: ['minor', 'rail', 'major', 'highway'], wk: 0.9 });
      ctx.setTransform(r, 0, 0, r, 0, 0);
      return function (x, y) { return [(x - T.ox) * s, (T.oy - y) * s]; };
    };
    return bm;
  }

  window.GTA6_BASEMAP = { create: create, THEMES: THEMES, makeGrid: makeGrid, _simplify: simplify, _chains: chains };
})();
