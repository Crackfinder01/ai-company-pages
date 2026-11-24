/* « Mon fond de carte » : la capture (ou photo) de la carte du jeu importée par l'utilisateur,
   calée sur les coordonnées du monde (CRS.Simple, latlng = [y, x]) et affichée sous les points.
   L'app ne contient, ne télécharge et n'envoie AUCUNE image de carte : l'image vient uniquement
   du sélecteur de fichier et reste sur l'appareil (IndexedDB, sinon mémoire de la session).

   Transformation image -> monde (u vers la droite, v vers le bas, en pixels de l'image stockée) :
     x = a*u + b*v + c ;  y = d*u + e*v + f
   2 repères : similitude sans rotation (b = d = 0, e = -a) ; 3 repères ou plus : affine (moindres carrés). */
(function () {
  'use strict';

  var ICONS = window.GTA6_ICONS;
  var $ = function (id) { return document.getElementById(id); };
  var MAXPX = 4096, MAXAREA = 16000000, QUALITY = 0.85;
  var DBNAME = 'carte-gta6-fond', META = 'captures', IMGS = 'images';

  var X = null;            // contexte fourni par app.js
  var items = [];          // captures de l'utilisateur
  var db = null;
  var memOnly = false;     // stockage indisponible : mémoire de la session seulement
  var cal = null;          // état du calage en cours
  var adj = null;          // état du réglage fin en cours
  var calMap = null, calOverlay = null;
  var outline = null;
  var REP = [];            // repères évidents résolus depuis les données
  var miniPath = '', miniBox = null;

  /* ---------- Repères proposés (résolus par leur nom dans markers.json / labels.json) ---------- */
  var REPERES = [
    { q: ['Aéroport international de Vice City', 'VCIA'], h: "Le milieu des pistes de l'aéroport, à l'ouest de Vice City.", z: 'all' },
    { q: ['Port Gellhorn'], h: "La ville au bord de l'eau, tout au nord-ouest.", z: 'all' },
    { q: ['Key Lento'], h: 'La ville sur les îles du sud (les Keys).', z: 'all' },
    { q: ['Ambrosia'], h: 'La ville au sud-ouest du grand lac, au centre de la carte.', z: 'all' },
    { q: ['Seven Mile Bridge'], h: 'Le long pont qui relie les îles du sud.', z: 'all' },
    { q: ['Base aérienne de Mile Zero', 'Mile Zero Air Station'], h: "La base militaire sur l'île tout au sud-ouest.", z: 'all' },
    { q: ['Capri'], h: "La ville tout à l'ouest, au milieu de la carte.", z: 'all' },
    { q: ['Waning Sands'], h: 'La ville sur la côte est, au nord de Vice City.', z: 'all' },
    { q: ['Gellhorn International Raceway'], h: 'Le circuit automobile au sud de Port Gellhorn.', z: 'all' },
    { q: ['Pont Bocamar'], h: 'Le pont de Port Gellhorn.', z: 'all' },
    { q: ['Lac Leonida', 'Lake Leonida'], h: 'Le centre du grand lac.', z: 'all' },
    { q: ['Moreau'], h: 'La ville tout au nord.', z: 'all' },
    { q: ['Port de Vice City'], h: "Les quais du port, sur l'île à l'est du centre-ville.", z: 'vc' },
    { q: ['Pont de Star Island'], h: 'Le pont qui mène à Star Island.', z: 'vc' },
    { q: ['Pont Rivo'], h: 'Le pont qui traverse les Rialto Islands.', z: 'vc' },
    { q: ['Pont de Catalan Boulevard'], h: 'Le pont de Catalan Boulevard, au sud du centre.', z: 'vc' },
    { q: ['Grande roue de Vice City'], h: 'La grande roue sur le front de mer du centre-ville.', z: 'vc' },
    { q: ['Fleeca Field'], h: 'Le stade de baseball de Rockridge.', z: 'vc' },
    { q: ['Phare de Catalan Key'], h: 'Le phare au bout de Catalan Key.', z: 'vc' },
    { q: ['Ocean View Hotel'], h: "L'hôtel sur Ocean Beach, côté plage.", z: 'vc' },
    { q: ['Vice City Oceanarium'], h: 'Le parc marin sur Catalan Key.', z: 'vc' }
  ];

  function resolveReperes() {
    var byName = {};
    var put = function (n, o, rank) { var k = X.norm(n); if (!byName[k] || byName[k].rank > rank) byName[k] = { n: n, x: o.x, y: o.y, rank: rank }; };
    X.markers.forEach(function (m) {
      var r = (m.c === 'landmark' || m.c === 'city-town') ? (m.src === 'gta6map' ? 0 : 1) : 3;
      put(m.n, m, r);
    });
    (X.labels || []).forEach(function (l) { put(l.n, l, 2); });
    REP = [];
    REPERES.forEach(function (r, i) {
      for (var j = 0; j < r.q.length; j++) {
        var f = byName[X.norm(r.q[j])];
        if (f) { REP.push({ key: 'r' + i, n: f.n, x: f.x, y: f.y, h: r.h, z: r.z }); return; }
      }
    });
  }
  function searchPlaces(q) {
    var nq = X.norm(q).trim(); if (nq.length < 2) return [];
    var out = [], seen = {};
    var add = function (n, x, y, h) { var k = X.norm(n) + '|' + Math.round(x / 50) + '|' + Math.round(y / 50); if (seen[k]) return; seen[k] = 1; out.push({ key: 'q' + out.length + k, n: n, x: x, y: y, h: h }); };
    REP.forEach(function (r) { if (X.norm(r.n).indexOf(nq) >= 0) add(r.n, r.x, r.y, r.h); });
    (X.labels || []).forEach(function (l) { if (X.norm(l.n).indexOf(nq) >= 0) add(l.n, l.x, l.y, l.k === 'region' ? 'Région (centre approximatif).' : l.k === 'city' ? 'Ville (centre approximatif).' : 'Quartier (centre approximatif).'); });
    X.markers.forEach(function (m) { if (out.length < 60 && m.key.indexOf(nq) >= 0) add(m.n, m.x, m.y, X.cats[m.c] ? X.cats[m.c].n : ''); });
    return out.slice(0, 40);
  }

  /* ---------- Stockage local (IndexedDB, sinon mémoire) ---------- */
  function idbOpen() {
    return new Promise(function (res) {
      var settled = false, fin = function (v) { if (!settled) { settled = true; res(v); } };
      setTimeout(function () { fin(null); }, 4000);
      try {
        var idb = window.indexedDB;
        if (!idb) { fin(null); return; }
        var r = idb.open(DBNAME, 1);
        r.onupgradeneeded = function () {
          try { var d = r.result; if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' }); if (!d.objectStoreNames.contains(IMGS)) d.createObjectStore(IMGS); } catch (e) { /* ignoré */ }
        };
        r.onsuccess = function () { if (settled) { try { r.result.close(); } catch (e) { /* */ } return; } fin(r.result); };
        r.onerror = function (e) { try { e.preventDefault(); } catch (x) { /* */ } fin(null); };
        r.onblocked = function () { fin(null); };
      } catch (e) { fin(null); }
    });
  }
  function tx(stores, mode, fn) {
    return new Promise(function (res, rej) {
      if (!db) { rej(new Error('pas de base')); return; }
      try {
        var t = db.transaction(stores, mode), out;
        var r = fn(t);
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = function (e) { try { e.preventDefault(); } catch (x) { /* */ } rej(t.error || new Error('idb')); };
        t.onabort = function () { rej(t.error || new Error('idb')); };
      } catch (e) { rej(e); }
    });
  }
  function meta(it) { return { id: it.id, name: it.name, w: it.w, h: it.h, created: it.created, tf: it.tf, pts: it.pts, show: it.show, op: it.op, rectified: !!it.rectified }; }
  function storageFailed() {
    if (memOnly) return;
    memOnly = true;
    showNote();
    X.toast('Stockage plein ou refusé : ta capture restera seulement jusqu\'à la fermeture de la page.');
  }
  function saveMeta(it) {
    if (memOnly || !db) return Promise.resolve();
    return tx([META], 'readwrite', function (t) { return t.objectStore(META).put(meta(it)); }).catch(storageFailed);
  }
  function saveNew(it) {
    if (memOnly || !db) return Promise.resolve();
    return tx([META, IMGS], 'readwrite', function (t) {
      t.objectStore(IMGS).put(it.blob, it.id);
      return t.objectStore(META).put(meta(it));
    }).catch(storageFailed);
  }
  function removeStored(id) {
    if (memOnly || !db) return Promise.resolve();
    return tx([META, IMGS], 'readwrite', function (t) { t.objectStore(IMGS).delete(id); return t.objectStore(META).delete(id); }).catch(function () { /* ignoré */ });
  }
  function loadAll() {
    if (!db) return Promise.resolve([]);
    var metas;
    return tx([META], 'readonly', function (t) { return t.objectStore(META).getAll(); }).then(function (ms) {
      metas = ms || [];
      return Promise.all(metas.map(function (m) {
        return tx([IMGS], 'readonly', function (t) { return t.objectStore(IMGS).get(m.id); }).catch(function () { return null; });
      }));
    }).then(function (blobs) {
      var out = [];
      metas.forEach(function (m, i) { if (blobs[i]) { m.blob = blobs[i]; out.push(m); } });
      return out;
    }).catch(function () { return []; });
  }
  function showNote() {
    var n = $('mybgNote');
    n.hidden = !memOnly;
    n.textContent = 'Stockage indisponible ici (navigation privée ou app intégrée) : ta capture restera seulement jusqu\'à la fermeture de la page.';
  }

  /* ---------- Image : décodage, réduction, compression (tout sur l'appareil) ---------- */
  function decode(file) {
    return new Promise(function (res, rej) {
      var url;
      try { url = URL.createObjectURL(file); } catch (e) { rej(e); return; }
      var img = new Image();
      img.onload = function () { res({ img: img, url: url }); };
      img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) { /* */ } rej(new Error('image illisible')); };
      img.src = url;
    });
  }
  function canvasToBlob(c) {
    return new Promise(function (res) {
      try { if (c.toBlob) { c.toBlob(function (b) { res(b || null); }, 'image/jpeg', QUALITY); return; } } catch (e) { /* repli */ }
      res(null);
    }).then(function (b) {
      if (b) return b;
      var du = c.toDataURL('image/jpeg', QUALITY);
      var bin = atob(du.split(',')[1]), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'image/jpeg' });
    });
  }
  function shrink(img, maxpx) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return Promise.reject(new Error('image vide'));
    var k = Math.min(1, maxpx / Math.max(w, h), Math.sqrt(MAXAREA / (w * h)));
    var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    var g = c.getContext('2d');
    if (!g) return Promise.reject(new Error('canvas'));
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    try { g.imageSmoothingQuality = 'high'; } catch (e) { /* */ }
    g.drawImage(img, 0, 0, cw, ch);
    return canvasToBlob(c).then(function (b) { c.width = 1; c.height = 1; if (!b || !b.size) throw new Error('compression'); return { blob: b, w: cw, h: ch }; });
  }
  function prepareImage(file) {
    return decode(file).then(function (o) {
      return shrink(o.img, MAXPX).catch(function () { return shrink(o.img, 2048); }).then(function (r) {
        try { URL.revokeObjectURL(o.url); } catch (e) { /* */ }
        return r;
      }, function (e) { try { URL.revokeObjectURL(o.url); } catch (x) { /* */ } throw e; });
    });
  }
  function blobUrl(blob) {
    try { return Promise.resolve(URL.createObjectURL(blob)); } catch (e) {
      return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); });
    }
  }

  /* ---------- Mathématiques du calage ---------- */
  function copyT(t) { return t ? { a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f } : null; }
  function apply(t, u, v) { return [t.a * u + t.b * v + t.c, t.d * u + t.e * v + t.f]; }
  function scaleOf(t) { return Math.sqrt(Math.abs(t.a * t.e - t.b * t.d)); } // unités monde par pixel d'image
  function centered(P) {
    var n = P.length, mu = 0, mv = 0, mx = 0, my = 0;
    P.forEach(function (p) { mu += p.u; mv += p.v; mx += p.x; my += p.y; });
    return { n: n, mu: mu / n, mv: mv / n, mx: mx / n, my: my / n };
  }
  function fitSim(P) {
    if (P.length < 2) return null;
    var m = centered(P), num = 0, den = 0;
    P.forEach(function (p) { var u = p.u - m.mu, v = p.v - m.mv, x = p.x - m.mx, y = p.y - m.my; num += u * x - v * y; den += u * u + v * v; });
    if (den <= 0) return null;
    var s = num / den;
    if (!(s > 0) || !isFinite(s)) return null;
    return { a: s, b: 0, c: m.mx - s * m.mu, d: 0, e: -s, f: m.my + s * m.mv, kind: 'sim' };
  }
  function fitAffine(P) {
    if (P.length < 3) return null;
    var m = centered(P), Suu = 0, Svv = 0, Suv = 0, Sux = 0, Svx = 0, Suy = 0, Svy = 0;
    P.forEach(function (p) {
      var u = p.u - m.mu, v = p.v - m.mv, x = p.x - m.mx, y = p.y - m.my;
      Suu += u * u; Svv += v * v; Suv += u * v; Sux += u * x; Svx += v * x; Suy += u * y; Svy += v * y;
    });
    var det = Suu * Svv - Suv * Suv;
    if (!(det > 1e-3 * Suu * Svv)) return null; // repères presque alignés
    var a = (Sux * Svv - Svx * Suv) / det, b = (Svx * Suu - Sux * Suv) / det;
    var d = (Suy * Svv - Svy * Suv) / det, e = (Svy * Suu - Suy * Suv) / det;
    if (!(a * e - b * d < 0)) return null; // image retournée : repère mal placé
    // déformation excessive -> on reste en similitude
    var p2 = a * a + b * b + d * d + e * e, q = Math.abs(a * e - b * d);
    var r = Math.sqrt(Math.max(0, p2 * p2 / 4 - q * q));
    var s1 = Math.sqrt(p2 / 2 + r), s2 = Math.sqrt(Math.max(1e-12, p2 / 2 - r));
    if (s1 / s2 > 1.6) return null;
    return { a: a, b: b, c: m.mx - a * m.mu - b * m.mv, d: d, e: e, f: m.my - d * m.mu - e * m.mv, kind: 'affine' };
  }
  function fit(P) { return (P.length >= 3 && fitAffine(P)) || fitSim(P); }
  function rms(t, P) {
    var s = 0; P.forEach(function (p) { var q = apply(t, p.u, p.v); s += (q[0] - p.x) * (q[0] - p.x) + (q[1] - p.y) * (q[1] - p.y); });
    return Math.sqrt(s / P.length);
  }
  function relErr(t, P, w) { return rms(t, P) / (scaleOf(t) * w); }
  function translateT(t, dx, dy) { var r = copyT(t); r.c += dx; r.f += dy; return r; }
  function scaleT(t, k, px, py) { return { a: t.a * k, b: t.b * k, c: px + k * (t.c - px), d: t.d * k, e: t.e * k, f: py + k * (t.f - py) }; }
  function rotateT(t, ang, px, py) {
    var co = Math.cos(ang), si = Math.sin(ang);
    return { a: co * t.a - si * t.d, b: co * t.b - si * t.e, c: px + co * (t.c - px) - si * (t.f - py),
      d: si * t.a + co * t.d, e: si * t.b + co * t.e, f: py + si * (t.c - px) + co * (t.f - py) };
  }
  function boundsOf(it) {
    var t = it.tf, c = [apply(t, 0, 0), apply(t, it.w, 0), apply(t, 0, it.h), apply(t, it.w, it.h)];
    return L.latLngBounds(c.map(function (p) { return [p[1], p[0]]; }));
  }

  /* ---------- Calque image affine (CSS matrix) ---------- */
  var AffineImage = L.Layer.extend({
    options: { pane: 'mybg', opacity: 1, zIndex: 1 },
    initialize: function (url, w, h, tf, opts) { this._url = url; this._w = w; this._h = h; this._tf = tf; L.setOptions(this, opts); },
    onAdd: function () {
      if (!this._img) {
        var img = this._img = L.DomUtil.create('img', 'mybg-img leaflet-zoom-animated');
        img.alt = ''; img.draggable = false; img.decoding = 'async';
        img.style.width = this._w + 'px'; img.style.height = this._h + 'px';
        img.src = this._url;
      }
      this.getPane().appendChild(this._img);
      this.setOpacity(this.options.opacity); this.setZIndex(this.options.zIndex);
      this._reset();
    },
    onRemove: function () { L.DomUtil.remove(this._img); },
    getEvents: function () {
      var ev = { zoom: this._reset, viewreset: this._reset };
      if (this._zoomAnimated) ev.zoomanim = this._animateZoom;
      return ev;
    },
    setTf: function (tf) { this._tf = tf; if (this._map) this._reset(); return this; },
    setOpacity: function (o) { this.options.opacity = o; if (this._img) this._img.style.opacity = o; return this; },
    setZIndex: function (z) { this.options.zIndex = z; if (this._img) this._img.style.zIndex = z; return this; },
    _css: function (toPt) {
      var t = this._tf, w = this._w, h = this._h;
      var ll = function (p) { return L.latLng(p[1], p[0]); };
      var p0 = toPt(ll(apply(t, 0, 0))), pw = toPt(ll(apply(t, w, 0))), ph = toPt(ll(apply(t, 0, h)));
      var m = [(pw.x - p0.x) / w, (pw.y - p0.y) / w, (ph.x - p0.x) / h, (ph.y - p0.y) / h, p0.x, p0.y];
      return 'matrix(' + m.map(function (v) { return +v.toFixed(6); }).join(',') + ')';
    },
    _reset: function () {
      var map = this._map; if (!map || !this._img) return;
      var origin = map.getPixelOrigin();
      this._img.style.transform = this._css(function (ll) { return map.project(ll)._subtract(origin); });
    },
    _animateZoom: function (e) {
      var map = this._map;
      this._img.style.transform = this._css(function (ll) { return map._latLngToNewLayerPoint(ll, e.zoom, e.center); });
    }
  });

  function syncLayers() {
    var cal8 = items.filter(function (it) { return it.tf; });
    cal8.sort(function (p, q) { return scaleOf(q.tf) - scaleOf(p.tf); }); // la plus détaillée au-dessus
    var anyOn = false;
    cal8.forEach(function (it, i) {
      if (it.show) {
        if (!it.layer) it.layer = new AffineImage(it.url, it.w, it.h, it.tf, { opacity: it.op, zIndex: i + 1 });
        it.layer.setTf(it.tf).setOpacity(it.op).setZIndex(i + 1);
        if (!X.map.hasLayer(it.layer)) it.layer.addTo(X.map);
        anyOn = true;
      } else if (it.layer && X.map.hasLayer(it.layer)) X.map.removeLayer(it.layer);
    });
    items.forEach(function (it) { if (!it.tf && it.layer && X.map.hasLayer(it.layer)) X.map.removeLayer(it.layer); });
    document.body.classList.toggle('mybg-on', anyOn);
  }

  function showOutline(on) {
    if (on && !outline) {
      var polys = X.land && Array.isArray(X.land.polygons) ? X.land.polygons : [];
      var rings = polys.filter(function (p) { return Array.isArray(p) && p.length > 2; }).map(function (p) {
        var r = p.map(function (pt) { return [pt[1], pt[0]]; }); r.push(r[0]); return r;
      });
      var rd = L.canvas({ padding: 0.5, pane: 'mybgline' });
      outline = L.layerGroup([
        L.polyline(rings, { renderer: rd, color: '#000', weight: 4, opacity: 0.55, interactive: false }),
        L.polyline(rings, { renderer: rd, color: '#22e6ff', weight: 1.6, opacity: 1, interactive: false })
      ]);
    }
    if (!outline) return;
    if (on && !X.map.hasLayer(outline)) outline.addTo(X.map);
    else if (!on && X.map.hasLayer(outline)) X.map.removeLayer(outline);
  }

  /* ---------- Mini-carte (schéma de NOTRE fond dessiné) pour situer un repère ---------- */
  function buildMini() {
    var b = X.land && X.land.bbox, polys = X.land && X.land.polygons;
    if (!b || !Array.isArray(polys)) return;
    var W = 84, H = Math.round(W * (b[3] - b[1]) / (b[2] - b[0]));
    if (!(H > 0) || H > 160) H = 120;
    var sx = W / (b[2] - b[0]), sy = H / (b[3] - b[1]);
    miniBox = { b: b, W: W, H: H, sx: sx, sy: sy };
    var d = '';
    polys.forEach(function (p) {
      if (!Array.isArray(p) || p.length < 3) return;
      var step = Math.max(1, Math.floor(p.length / 120));
      for (var i = 0; i < p.length; i += step) d += (i ? 'L' : 'M') + ((p[i][0] - b[0]) * sx).toFixed(1) + ' ' + ((b[3] - p[i][1]) * sy).toFixed(1);
      d += 'Z';
    });
    miniPath = d;
  }
  function miniSvg(r) {
    if (!miniBox) return '';
    var m = miniBox, cx = ((r.x - m.b[0]) * m.sx).toFixed(1), cy = ((m.b[3] - r.y) * m.sy).toFixed(1);
    return '<svg class="mini" viewBox="-4 -4 ' + (m.W + 8) + ' ' + (m.H + 8) + '" aria-hidden="true"><path d="' + miniPath + '"/>' +
      '<circle class="pulse" cx="' + cx + '" cy="' + cy + '" r="7"/><circle class="pt" cx="' + cx + '" cy="' + cy + '" r="3.5"/></svg>';
  }

  /* ---------- Liste du panneau ---------- */
  function fmtWidth(it) { return it.tf ? X.fmtDist(scaleOf(it.tf) * it.w) + ' de large' : ''; }
  function renderList() {
    var box = $('mybgList'); box.innerHTML = '';
    items.forEach(function (it) {
      var el = document.createElement('div');
      el.className = 'mybg'; el.setAttribute('data-id', it.id);
      var h = '<div class="mybg-h"><img class="thumb" alt="" src="' + X.esc(it.url) + '"><div class="mybg-t"><b>' + X.esc(it.name) + '</b><small>' +
        (it.tf ? '<span class="ok">Calée ✓</span> · ' + X.esc(fmtWidth(it)) : '<span class="todo">Pas encore calée</span>') + '</small></div></div>';
      if (it.tf) {
        h += '<label class="switch"><input type="checkbox" class="mbShow"' + (it.show ? ' checked' : '') + '><span class="sw"></span><span>Afficher sur la carte</span></label>' +
          '<label class="range"><span>Opacité</span><input type="range" class="mbOp" min="15" max="100" step="5" value="' + Math.round(it.op * 100) + '" aria-label="Opacité de la capture"><output>' + Math.round(it.op * 100) + ' %</output></label>' +
          '<div class="rowbtns"><button type="button" class="btn mbFix">' + ICONS.use('ui_move') + 'Ajuster finement</button><button type="button" class="btn mbCal">' + ICONS.use('ui_center') + 'Recaler à la main</button></div>' +
          '<button type="button" class="btn wide mbAuto">' + ICONS.use('ui_compass') + 'Recaler automatiquement</button>';
      } else {
        h += '<button type="button" class="btn primary wide mbAuto">' + ICONS.use('ui_compass') + 'Caler automatiquement</button>' +
          '<button type="button" class="btn wide mbCal">' + ICONS.use('ui_center') + 'Caler à la main (2 repères)</button>';
      }
      h += '<button type="button" class="btn ghost danger wide mbDel">' + ICONS.use('ui_trash') + 'Supprimer</button>';
      el.innerHTML = h;
      box.appendChild(el);
      var sh = el.querySelector('.mbShow');
      if (sh) sh.addEventListener('change', function () { it.show = sh.checked; syncLayers(); saveMeta(it); X.toast(it.show ? 'Capture affichée' : 'Capture masquée'); });
      var op = el.querySelector('.mbOp');
      if (op) {
        var saveOp = debounceLocal(function () { saveMeta(it); }, 400);
        op.addEventListener('input', function () { it.op = op.value / 100; el.querySelector('output').textContent = op.value + ' %'; if (it.layer) it.layer.setOpacity(it.op); saveOp(); });
      }
      var fx = el.querySelector('.mbFix'); if (fx) fx.addEventListener('click', function () { adjOpen(it, false); });
      el.querySelector('.mbCal').addEventListener('click', function () { calOpen(it, false); });
      el.querySelector('.mbAuto').addEventListener('click', function () { startAuto(it, false); });
      var del = el.querySelector('.mbDel'), armed = false, tmr;
      del.addEventListener('click', function () {
        if (!armed) { armed = true; del.lastChild.textContent = 'Appuie encore pour supprimer'; tmr = setTimeout(function () { armed = false; del.lastChild.textContent = 'Supprimer'; }, 4000); return; }
        clearTimeout(tmr); removeItem(it);
      });
    });
    $('mybgImport').lastChild.textContent = items.length ? 'Importer une autre capture' : 'Importer ma capture de la carte du jeu';
  }
  function debounceLocal(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  function removeItem(it) {
    if (it.layer && X.map.hasLayer(it.layer)) X.map.removeLayer(it.layer);
    items = items.filter(function (x) { return x !== it; });
    try { if (String(it.url).indexOf('blob:') === 0) URL.revokeObjectURL(it.url); } catch (e) { /* */ }
    removeStored(it.id);
    syncLayers(); renderList();
    X.toast('Capture supprimée de ton téléphone');
  }

  /* ---------- Calages automatiques connus (reconnus à la taille de l'image) ----------
     Paramètres calculés à partir d'une image fournie par l'utilisateur ; l'app ne contient aucune image. */
  var PRESETS_TF = [
    { w: 1206, h: 2622, name: 'Carte complète (capture)', crop: [14, 338, 1158, 1448], t: { a: 12.160473, b: 0.030034, c: -10846.069599, d: 0.01328, e: -12.437966, f: 14003.002963 } }
  ];
  function presetFor(w, h) {
    for (var i = 0; i < PRESETS_TF.length; i++) {
      var P = PRESETS_TF[i];
      if (Math.abs(w / h - P.w / P.h) < 0.004 * (P.w / P.h)) {
        var kx = P.w / w, ky = P.h / h, t = P.t;
        var cr = P.crop ? [Math.round(P.crop[0] / kx), Math.round(P.crop[1] / ky), Math.round(P.crop[2] / kx), Math.round(P.crop[3] / ky)] : null;
        return { name: P.name, crop: cr, t: { a: t.a * kx, b: t.b * ky, c: t.c, d: t.d * kx, e: t.e * ky, f: t.f, kind: 'affine' } };
      }
    }
    return null;
  }

  function cropBlob(blob, cr) {
    // recadre l'image (retire les barres d'interface) ; renvoie { blob, w, h } ou null si échec
    return decode(blob).then(function (o) {
      var c = document.createElement('canvas'); c.width = cr[2]; c.height = cr[3];
      c.getContext('2d').drawImage(o.img, cr[0], cr[1], cr[2], cr[3], 0, 0, cr[2], cr[3]);
      try { URL.revokeObjectURL(o.url); } catch (e) { /* */ }
      return canvasToBlob(c).then(function (b) { c.width = 1; c.height = 1; return b && b.size ? { blob: b, w: cr[2], h: cr[3] } : null; });
    }).catch(function () { return null; });
  }

  /* ---------- Calage automatique ----------
     1) segmentation terre / eau / inconnu de la capture (k-moyennes sur les couleurs, bandeaux d'interface ignorés) ;
     2) recherche grossière de l'échelle et de la position par corrélation (FFT) avec la terre de l'app (data/land.json) ;
     3) raffinement (Nelder-Mead) en similitude puis affine, score de confiance.
     Ce bloc n'utilise pas le DOM : il est envoyé tel quel dans un Web Worker (blob URL), sinon exécuté ici. */
  function autoCore() {
    var INF = 1e30;
    /* -- FFT radix 2 -- */
    var tabs = {};
    function fftT(n) {
      if (tabs[n]) return tabs[n];
      var bits = Math.round(Math.log(n) / Math.LN2), rev = new Uint32Array(n), cs = new Float64Array(n >> 1), sn = new Float64Array(n >> 1), i;
      for (i = 0; i < n; i++) { var r = 0, x = i; for (var b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
      for (i = 0; i < n >> 1; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = Math.sin(2 * Math.PI * i / n); }
      tabs[n] = { rev: rev, cs: cs, sn: sn };
      return tabs[n];
    }
    function fft1(re, im, off, st, n, inv, T, br, bi) {
      var rev = T.rev, cs = T.cs, sn = T.sn, i, j;
      for (i = 0; i < n; i++) { j = off + rev[i] * st; br[i] = re[j]; bi[i] = im[j]; }
      for (var size = 2; size <= n; size <<= 1) {
        var half = size >> 1, step = n / size;
        for (var k = 0; k < half; k++) {
          var wr = cs[k * step], wi = inv ? sn[k * step] : -sn[k * step];
          for (var a = k; a < n; a += size) {
            var b2 = a + half, xr = br[b2] * wr - bi[b2] * wi, xi = br[b2] * wi + bi[b2] * wr;
            br[b2] = br[a] - xr; bi[b2] = bi[a] - xi; br[a] += xr; bi[a] += xi;
          }
        }
      }
      for (i = 0; i < n; i++) { j = off + i * st; re[j] = br[i]; im[j] = bi[i]; }
    }
    function fft2(re, im, W, H, inv, rows) {
      var n = Math.max(W, H), br = new Float64Array(n), bi = new Float64Array(n), Tw = fftT(W), Th = fftT(H), y, x;
      for (y = 0; y < H; y++) if (!rows || rows[y]) fft1(re, im, y * W, 1, W, inv, Tw, br, bi);
      for (x = 0; x < W; x++) fft1(re, im, x, W, H, inv, Th, br, bi);
    }

    /* -- Rasterisation de la terre (anneaux plats [x0,y0,x1,y1…] en coordonnées monde) -- */
    function raster(polys, holes, x0, yTop, r, W, H) {
      var out = new Uint8Array(W * H), xs = [];
      function ring(R, val) {
        var n = R.length >> 1, ymin = INF, ymax = -INF, i, k;
        if (n < 3) return;
        for (i = 0; i < n; i++) { var yy = R[2 * i + 1]; if (yy < ymin) ymin = yy; if (yy > ymax) ymax = yy; }
        var j0 = Math.max(0, Math.floor((yTop - ymax) / r - 0.5)), j1 = Math.min(H - 1, Math.ceil((yTop - ymin) / r - 0.5));
        for (var j = j0; j <= j1; j++) {
          var wy = yTop - (j + 0.5) * r; xs.length = 0;
          for (i = 0, k = n - 1; i < n; k = i++) {
            var yi = R[2 * i + 1], yk = R[2 * k + 1];
            if ((yi > wy) !== (yk > wy)) xs.push(R[2 * i] + (wy - yi) * (R[2 * k] - R[2 * i]) / (yk - yi));
          }
          if (xs.length < 2) continue;
          xs.sort(function (p, q) { return p - q; });
          for (var q = 0; q + 1 < xs.length; q += 2) {
            var a = Math.max(0, Math.ceil((xs[q] - x0) / r - 0.5)), b = Math.min(W - 1, Math.floor((xs[q + 1] - x0) / r - 0.5));
            for (var c = a; c <= b; c++) out[j * W + c] = val;
          }
        }
      }
      polys.forEach(function (R) { ring(R, 1); });
      holes.forEach(function (R) { ring(R, 0); });
      return out;
    }
    // terre « douce » (0..1) : rendu sur-échantillonné x ss puis moyenné
    function softRaster(land, x0, yTop, r, W, H, ss) {
      var R = raster(land.polys, land.holes, x0, yTop, r / ss, W * ss, H * ss), out = new Float32Array(W * H), k = 1 / (ss * ss), W2 = W * ss;
      for (var j = 0; j < H * ss; j++) { var o = ((j / ss) | 0) * W; for (var i = 0; i < W2; i++) if (R[j * W2 + i]) out[o + ((i / ss) | 0)] += k; }
      return out;
    }
    function boxBlur(src, W, H, rad, passes) {
      var a = new Float32Array(src), b = new Float32Array(W * H), p, i, j, s, n;
      if (rad < 1) return a;
      for (p = 0; p < passes; p++) {
        for (j = 0; j < H; j++) {
          var o = j * W; s = 0; n = 0;
          for (i = 0; i < Math.min(W, rad + 1); i++) { s += a[o + i]; n++; }
          for (i = 0; i < W; i++) {
            b[o + i] = s / n;
            if (i + rad + 1 < W) { s += a[o + i + rad + 1]; n++; }
            if (i - rad >= 0) { s -= a[o + i - rad]; n--; }
          }
        }
        for (i = 0; i < W; i++) {
          s = 0; n = 0;
          for (j = 0; j < Math.min(H, rad + 1); j++) { s += b[j * W + i]; n++; }
          for (j = 0; j < H; j++) {
            a[j * W + i] = s / n;
            if (j + rad + 1 < H) { s += b[(j + rad + 1) * W + i]; n++; }
            if (j - rad >= 0) { s -= b[(j - rad) * W + i]; n--; }
          }
        }
      }
      return a;
    }

    /* -- Segmentation terre (+1) / eau (-1) / inconnu (0) -- */
    function lab3(r, g, b) {
      var f = function (c) { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
      r = f(r); g = f(g); b = f(b);
      var X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089;
      var h = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
      var fx = h(X), fy = h(Y), fz = h(Z);
      return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    }
    function segment(px, w, h, scr, opt) {
      opt = opt || {};
      var N = w * h, i, j, x, y;
      // 1. léger flou 3x3 (bruit, routes fines)
      var R = new Uint8Array(N), G = new Uint8Array(N), B = new Uint8Array(N);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var sr = 0, sg = 0, sb = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) { var yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (var dx = -1; dx <= 1; dx++) { var xx = x + dx; if (xx < 0 || xx >= w) continue; var q = (yy * w + xx) * 4; sr += px[q]; sg += px[q + 1]; sb += px[q + 2]; n++; } }
        i = y * w + x; R[i] = sr / n; G[i] = sg / n; B[i] = sb / n;
      }
      // 2. histogramme des couleurs (5 bits par canal) et k-moyennes dans l'espace Lab
      var hist = new Float64Array(32768), key = new Uint16Array(N);
      for (i = 0; i < N; i++) { var kk = ((R[i] >> 3) << 10) | ((G[i] >> 3) << 5) | (B[i] >> 3); key[i] = kk; hist[kk]++; }
      var bins = [], bl = [];
      for (i = 0; i < 32768; i++) if (hist[i]) { bins.push(i); bl.push(lab3(((i >> 10) << 3) + 4, (((i >> 5) & 31) << 3) + 4, ((i & 31) << 3) + 4)); }
      var K = Math.min(7, bins.length), C = [], best = 0;
      for (i = 1; i < bins.length; i++) if (hist[bins[i]] > hist[bins[best]]) best = i;
      C.push(bl[best].slice());
      var d2 = function (p, q) { return (p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) + (p[2] - q[2]) * (p[2] - q[2]); };
      while (C.length < K) {
        var bi = -1, bv = -1;
        for (i = 0; i < bins.length; i++) {
          var dm = INF; for (j = 0; j < C.length; j++) dm = Math.min(dm, d2(bl[i], C[j]));
          var v = dm * Math.sqrt(hist[bins[i]]);
          if (v > bv) { bv = v; bi = i; }
        }
        C.push(bl[bi].slice());
      }
      var asg = new Int32Array(bins.length), wsum = [];
      for (var it = 0; it < 14; it++) {
        var acc = C.map(function () { return [0, 0, 0, 0]; });
        for (i = 0; i < bins.length; i++) {
          var bj = 0, bd = INF;
          for (j = 0; j < K; j++) { var dd = d2(bl[i], C[j]); if (dd < bd) { bd = dd; bj = j; } }
          asg[i] = bj; var wgt = hist[bins[i]], A = acc[bj]; A[0] += wgt * bl[i][0]; A[1] += wgt * bl[i][1]; A[2] += wgt * bl[i][2]; A[3] += wgt;
        }
        for (j = 0; j < K; j++) if (acc[j][3]) C[j] = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]];
        wsum = acc.map(function (A) { return A[3] / N; });
      }
      // texture locale : moyenne (fenêtre 9x9) du gradient de luminance -> routes et bâtiments = terre ; eau et brouillard = lisses
      var Y = new Float32Array(N), Gm = new Float32Array(N);
      for (i = 0; i < N; i++) Y[i] = 0.3 * R[i] + 0.59 * G[i] + 0.11 * B[i];
      for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        var gx = Y[i + 1 - w] + 2 * Y[i + 1] + Y[i + 1 + w] - Y[i - 1 - w] - 2 * Y[i - 1] - Y[i - 1 + w];
        var gy = Y[i + w - 1] + 2 * Y[i + w] + Y[i + w + 1] - Y[i - w - 1] - 2 * Y[i - w] - Y[i - w + 1];
        Gm[i] = Math.sqrt(gx * gx + gy * gy) / 4;
      }
      var Tx = boxBlur(Gm, w, h, 4, 1);
      var binK0 = new Int8Array(32768);
      for (i = 0; i < bins.length; i++) binK0[bins[i]] = asg[i];
      var ctex = C.map(function () { return 0; }), ccnt = ctex.slice();
      for (i = 0; i < N; i++) { var kq0 = binK0[key[i]]; ctex[kq0] += Tx[i]; ccnt[kq0]++; }
      ctex = ctex.map(function (v, k) { return ccnt[k] ? v / ccnt[k] : 0; });
      // 3. classe de chaque groupe de couleurs
      var cls = C.map(function (c) {
        var L = c[0], a = c[1], b = c[2], ch = Math.sqrt(a * a + b * b), hue = Math.atan2(b, a) * 180 / Math.PI;
        if (L < 13) return 0;                                  // noir : interface, bords
        if (ch < 9 && L < 30) return 0;                        // gris foncé : interface
        if ((b < -8 && ch >= 15 && hue <= -40 && hue >= -178) || (a < -15 && b < -3 && L < 72)) return -1; // bleus / cyans assez saturés : eau (le gris-bleu clair reste de la terre)
        return 1;                                              // le reste : terre (verts, gris, beiges, blancs…)
      });
      // bleu marine très sombre alors qu'il existe une eau claire : zones non découvertes (« brouillard », qui couvre
      // terre ET mer) ou mer profonde -> inconnu, exclu du score. Sans eau claire, le bleu sombre reste de l'eau.
      var binK = new Int8Array(32768);
      for (i = 0; i < bins.length; i++) binK[bins[i]] = asg[i];
      var pk = new Int8Array(N);
      for (i = 0; i < N; i++) pk[i] = binK[key[i]];
      var maxWL = 0; C.forEach(function (c, k) { if (cls[k] === -1 && wsum[k] > 0.02) maxWL = Math.max(maxWL, c[0]); });
      var fogK = C.map(function (c, k) { return cls[k] === -1 && maxWL >= 42 && c[0] < 32 && c[0] < 0.62 * maxWL; });
      // texture : un pixel bleu (eau ou brouillard d'après sa couleur) dans une zone dense en routes / bâtiments est de la terre
      //   (cartes en jeu au style sombre ou photos à dominante bleue, où la terre elle-même est bleutée)
      var Dn = boxBlur(Tx, w, h, 5, 1), hist2 = new Float64Array(64), nh = 0;
      for (i = 0; i < N; i++) { var kk2 = pk[i]; if (cls[kk2] === -1) { hist2[Math.min(63, Dn[i] | 0)]++; nh++; } }
      var thr = 9;
      if (nh > 100) { // seuil d'Otsu
        var sAll = 0, sB = 0, wB = 0, bestV = -1, ot = 9;
        for (i = 0; i < 64; i++) sAll += i * hist2[i];
        for (i = 0; i < 64; i++) {
          wB += hist2[i]; if (!wB || wB === nh) continue;
          sB += i * hist2[i];
          var mB = sB / wB, mF = (sAll - sB) / (nh - wB), bv = wB * (nh - wB) * (mB - mF) * (mB - mF);
          if (bv > bestV) { bestV = bv; ot = i + 1; }
        }
        thr = Math.max(9, ot);
      }
      // seulement si la couleur ne trouve presque aucune terre (tout est bleu : carte en jeu au style sombre, photo bleutée)
      var nColL = 0, nColK = 0;
      for (i = 0; i < N; i++) { var cc = cls[pk[i]]; if (cc && !fogK[pk[i]]) { nColK++; if (cc > 0) nColL++; } }
      if (nColK && nColL > 0.12 * nColK) thr = 1e9;
      if (opt.noTex) thr = 1e9;
      var lab = new Int8Array(N), texLand = 0, isTex = new Uint8Array(N);
      for (i = 0; i < N; i++) {
        var kc = pk[i], c0 = cls[kc];
        if (c0 === -1 && Dn[i] > thr) { lab[i] = 1; texLand++; isTex[i] = 1; }
        else lab[i] = c0; // le brouillard compte comme de l'eau jusqu'à l'étape 6 (pour la détection des bandeaux)
      }
      // 4. filtre majoritaire 3x3
      var l2 = new Int8Array(N);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var cn = [0, 0, 0];
        for (var ey = Math.max(0, y - 1); ey <= Math.min(h - 1, y + 1); ey++) for (var ex = Math.max(0, x - 1); ex <= Math.min(w - 1, x + 1); ex++) cn[lab[ey * w + ex] + 1]++;
        l2[y * w + x] = cn[1] >= cn[0] && cn[1] >= cn[2] ? 0 : cn[0] > cn[2] ? -1 : 1;
      }
      lab = l2;
      // 5. bandeaux d'interface : lignes / colonnes unies ou surtout « inconnues »
      function band(len, oth, get) {
        var keep = new Uint8Array(len), k2, t;
        for (k2 = 0; k2 < len; k2++) {
          var kn = 0, s1 = 0, s2 = 0;
          for (t = 0; t < oth; t++) { var p = get(k2, t); if (lab[p]) kn++; var lum = R[p] + G[p] + B[p]; s1 += lum; s2 += lum * lum; }
          var sd = Math.sqrt(Math.max(0, s2 / oth - (s1 / oth) * (s1 / oth))) / 3;
          var uniformLand = sd < 4 && lab[get(k2, oth >> 1)] === 1;
          keep[k2] = kn >= 0.3 * oth && !uniformLand ? 1 : 0;
        }
        // plus longue suite de lignes gardées (petits trous tolérés)
        var gap = Math.max(2, Math.round(len * 0.015)), bs = 0, be = -1, s = -1, lastK = -INF;
        for (k2 = 0; k2 < len; k2++) {
          if (!keep[k2]) continue;
          if (k2 - lastK > gap + 1) s = k2;
          lastK = k2;
          if (k2 - s > be - bs) { bs = s; be = k2; }
        }
        return [bs, be];
      }
      var rows = band(h, w, function (k2, t) { return k2 * w + t; });
      var cols = band(w, rows[1] - rows[0] + 1, function (k2, t) { return (rows[0] + t) * w + k2; });
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (y < rows[0] || y > rows[1] || x < cols[0] || x > cols[1]) lab[y * w + x] = 0;
      // 6. brouillard et zones sombres : ignorés, ainsi qu'une marge autour (leurs bords flous ont des couleurs
      //    intermédiaires, souvent bleutées, qui dessineraient de fausses côtes)
      // couleurs « mélange » entre une zone sombre et une couleur de terre (bord flou) : seules celles-ci sont effacées
      var darkC = [], landC = [];
      C.forEach(function (c, k) { if (fogK[k] || cls[k] === 0) darkC.push(c); else if (cls[k] === 1) landC.push(c); });
      var mixK = new Uint8Array(32768);
      for (i = 0; i < bins.length; i++) {
        var P0 = bl[i], mixed = false;
        for (var da = 0; da < darkC.length && !mixed; da++) for (var la = 0; la < landC.length && !mixed; la++) {
          var A0 = darkC[da], B0 = landC[la], vx = B0[0] - A0[0], vy = B0[1] - A0[1], vz = B0[2] - A0[2], vv = vx * vx + vy * vy + vz * vz;
          if (!vv) continue;
          var tt = ((P0[0] - A0[0]) * vx + (P0[1] - A0[1]) * vy + (P0[2] - A0[2]) * vz) / vv;
          if (tt < 0.12 || tt > 0.88) continue;
          var ex = A0[0] + tt * vx - P0[0], ey = A0[1] + tt * vy - P0[1], ez = A0[2] + tt * vz - P0[2];
          if (ex * ex + ey * ey + ez * ez < 64) mixed = true;
        }
        mixK[bins[i]] = mixed ? 1 : 0;
      }
      var dkm = new Uint8Array(N), anyDk = false;
      for (i = 0; i < N; i++) if (!isTex[i] && (fogK[pk[i]] || cls[pk[i]] === 0)) { dkm[i] = 1; anyDk = true; lab[i] = 0; }
      if (anyDk) {
        var D = opt.dil != null ? opt.dil : Math.max(3, Math.round(0.01 * Math.max(w, h))), tmp = new Uint8Array(N), cnt;
        for (y = 0; y < h; y++) {
          cnt = 0; var o = y * w;
          for (x = 0; x < Math.min(w, D); x++) cnt += dkm[o + x];
          for (x = 0; x < w; x++) { if (x + D < w) cnt += dkm[o + x + D]; if (x - D - 1 >= 0) cnt -= dkm[o + x - D - 1]; tmp[o + x] = cnt > 0 ? 1 : 0; }
        }
        for (x = 0; x < w; x++) {
          cnt = 0;
          for (y = 0; y < Math.min(h, D); y++) cnt += tmp[y * w + x];
          for (y = 0; y < h; y++) { if (y + D < h) cnt += tmp[(y + D) * w + x]; if (y - D - 1 >= 0) cnt -= tmp[(y - D - 1) * w + x]; if (cnt > 0 && mixK[key[y * w + x]]) lab[y * w + x] = 0; }
        }
      }
      // 7. interface du jeu (écran 16:9) : bandeau haut, panneau de mission, argent, menu texte à droite, objectif en bas
      if (scr) {
        var UI = [[0, 0, 1, 0.08], [0, 0.07, 0.4, 0.27], [0.84, 0, 1, 0.21], [0.74, 0.7, 1, 1], [0.28, 0.88, 0.72, 1], [0, 0, 0.035, 1]];
        for (y = 0; y < h; y++) {
          var fy = (y + 0.5) / h;
          for (x = 0; x < w; x++) {
            var fx = scr.u0 + (scr.u1 - scr.u0) * (x + 0.5) / w;
            for (var q = 0; q < UI.length; q++) { var Rq = UI[q]; if (fx >= Rq[0] && fx <= Rq[2] && fy >= Rq[1] && fy <= Rq[3]) { lab[y * w + x] = 0; break; } }
          }
        }
      }
      var nl = 0, nw = 0;
      for (i = 0; i < N; i++) { if (lab[i] > 0) nl++; else if (lab[i] < 0) nw++; }
      return { lab: lab, nl: nl, nw: nw, rows: rows, cols: cols, thr: thr, texLand: texLand,
        clusters: C.map(function (c, k) { return { L: Math.round(c[0]), a: Math.round(c[1]), b: Math.round(c[2]), w: +wsum[k].toFixed(3), tex: +ctex[k].toFixed(1), cls: fogK[k] ? 'fog' : cls[k] }; }) };
    }

    /* -- Photo d'une télé : détection de l'écran (quadrilatère lumineux) et redressement (homographie) -- */
    function fitLine(P, pref) { // P : [[t, s]] -> droite s = a + b t, robuste (RANSAC déterministe puis moindres carrés sur les points gardés)
      var n = P.length; if (n < 12) return null;
      var seed = 12345, rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      var best = null, bestK = -1, i, k, cands = [], tm = (P[0][0] + P[n - 1][0]) / 2;
      for (var it = 0; it < 400; it++) {
        var p = P[(rnd() * n) | 0], q = P[(rnd() * n) | 0];
        if (Math.abs(q[0] - p[0]) < n / 6) continue;
        var bb = (q[1] - p[1]) / (q[0] - p[0]), aa = p[1] - bb * p[0];
        if (Math.abs(bb) > 0.25) continue;
        for (i = 0, k = 0; i < n; i++) if (Math.abs(P[i][1] - aa - bb * P[i][0]) <= 1.5) k++;
        cands.push([aa, bb, k]);
        if (k > bestK) { bestK = k; best = [aa, bb]; }
      }
      if (!best || bestK < 0.25 * n) return null;
      // plusieurs bords parallèles (ex. bandeau de menu sombre en haut) : on garde le plus extérieur s'il est bien soutenu
      cands.forEach(function (c) {
        if (c[2] < Math.max(0.2 * n, 0.4 * bestK)) return;
        if (pref * (c[0] + c[1] * tm) > pref * (best[0] + best[1] * tm) + 2) best = [c[0], c[1]];
      });
      var keep = P.filter(function (p) { return Math.abs(p[1] - best[0] - best[1] * p[0]) <= 2; });
      var mt = 0, ms = 0, stt = 0, sts = 0;
      keep.forEach(function (p) { mt += p[0]; ms += p[1]; }); mt /= keep.length; ms /= keep.length;
      keep.forEach(function (p) { stt += (p[0] - mt) * (p[0] - mt); sts += (p[0] - mt) * (p[1] - ms); });
      var b2 = stt ? sts / stt : best[1], a2 = ms - b2 * mt, r2 = 0;
      keep.forEach(function (p) { r2 += (p[1] - a2 - b2 * p[0]) * (p[1] - a2 - b2 * p[0]); });
      return { a: a2, b: b2, rms: Math.sqrt(r2 / keep.length), n: keep.length, frac: keep.length / n };
    }
    function detectScreen(px, w, h) {
      var N = w * h, m = new Uint8Array(N), i, x, y;
      for (i = 0; i < N; i++) {
        var r = px[4 * i], g = px[4 * i + 1], b = px[4 * i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        m[i] = (mx > 60 && b > r + 30 && b - r > 0.4 * b && b >= g - 12) || (mx > 150 && mx - mn < 70) ? 1 : 0;
      }
      // plus grande composante connexe
      var lab = new Int32Array(N), st = new Int32Array(N), best = 0, bestN = 0, cur = 0;
      for (i = 0; i < N; i++) {
        if (!m[i] || lab[i]) continue;
        cur++; var sp = 0, cnt = 0; st[sp++] = i; lab[i] = cur;
        while (sp) {
          var p = st[--sp]; cnt++; x = p % w; y = (p / w) | 0;
          if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = cur; st[sp++] = p - 1; }
          if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = cur; st[sp++] = p + 1; }
          if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = cur; st[sp++] = p - w; }
          if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = cur; st[sp++] = p + w; }
        }
        if (cnt > bestN) { bestN = cnt; best = cur; }
      }
      if (bestN < 0.12 * N) { detectScreen.why = 1; return null; }
      var top = [], bot = [], lef = [], rig = [], cx0 = w, cx1 = -1, cy0 = h, cy1 = -1;
      var colT = new Int32Array(w).fill(-1), colB = new Int32Array(w).fill(-1), rowL = new Int32Array(h).fill(-1), rowR = new Int32Array(h).fill(-1);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (lab[y * w + x] === best) {
        if (colT[x] < 0) colT[x] = y; colB[x] = y; if (rowL[y] < 0) rowL[y] = x; rowR[y] = x;
        if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
      }
      var bw = cx1 - cx0, bh = cy1 - cy0;
      for (x = cx0 + Math.round(0.1 * bw); x <= cx1 - Math.round(0.1 * bw); x++) { if (colT[x] >= 0) { top.push([x, colT[x]]); bot.push([x, colB[x]]); } }
      for (y = cy0 + Math.round(0.1 * bh); y <= cy1 - Math.round(0.1 * bh); y++) { if (rowL[y] >= 0) { lef.push([y, rowL[y]]); rig.push([y, rowR[y]]); } }
      var T = fitLine(top, -1), B = fitLine(bot, 1), Lf = fitLine(lef, -1), Rt = fitLine(rig, 1);
      if (!T || !B) { detectScreen.why = 2; return null; }
      var med = function (P) { var v = P.map(function (p) { return p[1]; }).sort(function (a, b) { return a - b; }); return v[v.length >> 1]; };
      var clipT = med(top) < 3, clipB = med(bot) > h - 4, clipL = med(lef) < 3, clipR = med(rig) > w - 4;
      if (clipT || clipB) { detectScreen.why = 3; return null; }                                     // il faut voir le haut et le bas de l'écran
      if (Math.abs(T.b) > 0.1 || Math.abs(B.b) > 0.1) { detectScreen.why = 4; return null; }
      if (clipL && clipR && bh > 0.9 * h) { detectScreen.why = 5; return null; }                     // c'est une capture d'écran, pas une photo
      if (!(clipL && clipR) && bw < 1.25 * bh) { detectScreen.why = 7; return null; }                                     // un écran de télé est en paysage
      // au-dessus et au-dessous : des bandeaux d'interface unis et sombres (capture d'écran) plutôt qu'une pièce (photo) ?
      var nd = 0, nt = 0;
      for (y = 0; y < h; y += 2) for (x = 0; x < w; x += 2) {
        var yt = T.a + T.b * x, yb = B.a + B.b * x;
        if (y >= yt - 2 && y <= yb + 2) continue;
        var o4 = 4 * (y * w + x); nt++;
        if (Math.max(px[o4], px[o4 + 1], px[o4 + 2]) < 40) nd++;
      }
      if (clipL && clipR && nt && nd > 0.8 * nt) { detectScreen.why = 8; return null; }
      // bord gauche / droit trop près du bord de la photo : l'écran continue probablement au-delà
      if (!clipL && (!Lf || Math.abs(Lf.b) > 0.2 || Lf.a + Lf.b * h / 2 < 0.05 * w)) clipL = true;
      if (!clipR && (!Rt || Math.abs(Rt.b) > 0.2 || Rt.a + Rt.b * h / 2 > 0.95 * w)) clipR = true;
      if (T.frac < 0.2 || B.frac < 0.2) { detectScreen.why = 6; return null; }
      // intersections : ligne haute/basse y = a + b x ; ligne gauche/droite x = a + b y
      var meet = function (H2, V) { var yy = (H2.a + H2.b * V.a) / (1 - H2.b * V.b); return [V.a + V.b * yy, yy]; };
      var onH = function (H2, xx) { return [xx, H2.a + H2.b * xx]; };
      var hs = (B.a - T.a) + (B.b - T.b) * w / 2;
      return { T: T, B: B, L: clipL ? null : Lf, R: clipR ? null : Rt, meet: meet, onH: onH, w: w, h: h, area: bestN / N, hs: hs };
    }
    function solveH(src, dst) { // homographie qui envoie src[k] -> dst[k] (4 points), en tableau de 9
      var A = [], k;
      for (k = 0; k < 4; k++) {
        var X = src[k][0], Y = src[k][1], u = dst[k][0], v = dst[k][1];
        A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y, u]);
        A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y, v]);
      }
      for (var c = 0; c < 8; c++) {
        var pv = c; for (k = c + 1; k < 8; k++) if (Math.abs(A[k][c]) > Math.abs(A[pv][c])) pv = k;
        var t = A[c]; A[c] = A[pv]; A[pv] = t;
        if (Math.abs(A[c][c]) < 1e-12) return null;
        for (k = 0; k < 8; k++) if (k !== c) { var f = A[k][c] / A[c][c]; for (var j = c; j < 9; j++) A[k][j] -= f * A[c][j]; }
      }
      var hh = []; for (k = 0; k < 8; k++) hh.push(A[k][8] / A[k][k]); hh.push(1);
      return hh;
    }
    function applyH(H2, x, y) { var d = H2[6] * x + H2[7] * y + H2[8]; return [(H2[0] * x + H2[1] * y + H2[2]) / d, (H2[3] * x + H2[4] * y + H2[5]) / d]; }
    // écran détecté -> géométrie du redressement : écran complet 16:9 de hauteur SH ; partie visible [u0, u1] (en px écran)
    function screenGeom(S, SH) {
      var SW = Math.round(SH * 16 / 9), T = S.T, B = S.B, d = function (p, q) { return Math.hypot(p[0] - q[0], p[1] - q[1]); };
      var tl, tr, br, bl, src, dst, u0 = 0, u1 = SW;
      if (S.L && S.R) {
        tl = S.meet(T, S.L); tr = S.meet(T, S.R); br = S.meet(B, S.R); bl = S.meet(B, S.L); src = [tl, tr, br, bl];
        var asp = (d(tl, tr) + d(bl, br)) / (d(tl, bl) + d(tr, br)); // proportions mesurées ; une télé est en 16:9
        var W2 = asp > 1.6 && asp < 1.95 ? SW : Math.round(SH * asp);
        dst = [[0, 0], [W2, 0], [W2, SH], [0, SH]]; u1 = W2;
        var Hb = solveH(dst, src);
        return Hb ? { H: Hb, SW: W2, SH: SH, u0: 0, u1: W2 } : null;
      }
      else if (S.R || S.L) {
        var right = !!S.R, V = S.R || S.L, xe = right ? 0 : S.w - 1;
        var a1 = S.meet(T, V), a2 = S.meet(B, V), b1 = S.onH(T, xe), b2 = S.onH(B, xe);
        var k = SH / ((d(a1, a2) + d(b1, b2)) / 2);            // px écran par px photo (moyenne)
        var ut = d(a1, b1) * k, ub = d(a2, b2) * k;
        if (right) { src = [b1, a1, a2, b2]; dst = [[SW - ut, 0], [SW, 0], [SW, SH], [SW - ub, SH]]; u0 = Math.max(0, SW - Math.max(ut, ub)); }
        else { src = [a1, b1, b2, a2]; dst = [[0, 0], [ut, 0], [ub, SH], [0, SH]]; u1 = Math.min(SW, Math.max(ut, ub)); }
      } else {
        var c1 = S.onH(T, 0), c2 = S.onH(T, S.w - 1), c3 = S.onH(B, S.w - 1), c4 = S.onH(B, 0);
        var kk = SH / ((d(c1, c4) + d(c2, c3)) / 2), wt = d(c1, c2) * kk;
        u0 = (SW - wt) / 2; u1 = u0 + wt; // largeur réelle conservée (pas d'étirement en 16:9)
        src = [c1, c2, c3, c4]; dst = [[u0, 0], [u0 + d(c1, c2) * kk, 0], [u0 + d(c4, c3) * kk, SH], [u0, SH]];
        var Hc = solveH(dst, src);
        return Hc ? { H: Hc, SW: SW, SH: SH, u0: Math.floor(u0), u1: Math.ceil(u1) } : null;
      }
      var Hd = solveH(dst, src); // écran -> photo
      if (!Hd) return null;
      return { H: Hd, SW: SW, SH: SH, u0: Math.max(0, Math.floor(u0)), u1: Math.min(SW, Math.ceil(u1)) };
    }
    // redresse : sortie (u1-u0) x SH, chaque pixel écran (u0+i, j) échantillonné dans la photo ; hors photo = noir
    // kin : px de l'image fournie par px d'analyse ; kout : px de sortie par px écran (G est en coordonnées d'analyse)
    function warp(px, w, h, G, kin, kout) {
      kin = kin || 1; kout = kout || 1;
      var ow = Math.round((G.u1 - G.u0) * kout), oh = Math.round(G.SH * kout), out = new Uint8ClampedArray(ow * oh * 4), H2 = G.H;
      for (var j = 0; j < oh; j++) for (var i = 0; i < ow; i++) {
        var q = applyH(H2, G.u0 + (i + 0.5) / kout, (j + 0.5) / kout), X = q[0] * kin - 0.5, Y = q[1] * kin - 0.5, o = (j * ow + i) * 4;
        out[o + 3] = 255;
        if (X < 0 || Y < 0 || X >= w - 1 || Y >= h - 1) continue;
        var ix = X | 0, iy = Y | 0, fx = X - ix, fy = Y - iy, p = (iy * w + ix) * 4;
        for (var c = 0; c < 3; c++) out[o + c] = (px[p + c] * (1 - fx) + px[p + 4 + c] * fx) * (1 - fy) + (px[p + w * 4 + c] * (1 - fx) + px[p + w * 4 + 4 + c] * fx) * fy;
      }
      return { px: out, w: ow, h: oh };
    }

    /* -- Nelder-Mead -- */
    function nelder(f, x0, step, maxIt) {
      var n = x0.length, P = [x0.slice()], F = [f(x0)], i, j;
      for (i = 0; i < n; i++) { var p = x0.slice(); p[i] += step[i]; P.push(p); F.push(f(p)); }
      for (var it = 0; it < maxIt; it++) {
        var ord = P.map(function (_, k) { return k; }).sort(function (a, b) { return F[a] - F[b]; });
        P = ord.map(function (k) { return P[k]; }); F = ord.map(function (k) { return F[k]; });
        if (Math.abs(F[n] - F[0]) < 1e-5 && it > 10) break;
        var c = new Array(n).fill(0);
        for (i = 0; i < n; i++) for (j = 0; j < n; j++) c[j] += P[i][j] / n;
        var mv = function (t) { return c.map(function (v, k) { return v + t * (P[n][k] - v); }); };
        var xr = mv(-1), fr = f(xr);
        if (fr < F[0]) { var xe = mv(-2), fe = f(xe); if (fe < fr) { P[n] = xe; F[n] = fe; } else { P[n] = xr; F[n] = fr; } }
        else if (fr < F[n - 1]) { P[n] = xr; F[n] = fr; }
        else {
          var xc = fr < F[n] ? mv(-0.5) : mv(0.5), fc = f(xc);
          if (fc < Math.min(fr, F[n])) { P[n] = xc; F[n] = fc; }
          else for (i = 1; i <= n; i++) { P[i] = P[i].map(function (v, k) { return P[0][k] + 0.5 * (v - P[0][k]); }); F[i] = f(P[i]); }
        }
      }
      var bi = 0; for (i = 1; i <= n; i++) if (F[i] < F[bi]) bi = i;
      return { x: P[bi], f: F[bi] };
    }

    /* -- Programme principal -- */
    function run(inp, progress) {
      var t0 = Date.now(), w = inp.w, h = inp.h, px = inp.px, scr = null, rect = null;
      var land = { polys: inp.polys, holes: inp.holes || [] };
      progress(0.02);
      // photo d'une télé : on redresse l'écran ; capture d'écran 16:9 : on masque l'interface du jeu
      var S = inp.rectify === false ? null : detectScreen(px, w, h), G = S ? screenGeom(S, 360) : null;
      if (G && G.u1 - G.u0 > 100) {
        var Wp = warp(px, w, h, G, 1, 1);
        rect = { H: G.H, SW: G.SW, SH: G.SH, u0: G.u0, u1: G.u1, hs: S.hs, pw: w, ph: h };
        px = Wp.px; w = Wp.w; h = Wp.h; scr = { u0: G.u0 / G.SW, u1: G.u1 / G.SW };
      } else if (Math.abs(w / h - 16 / 9) < 0.06) scr = { u0: 0, u1: 1 };
      var seg = segment(px, w, h, scr, inp.segOpt), lab = seg.lab, N = w * h, i, j;
      progress(0.1);
      if (inp.debug) progress(-1, lab, w, h, px);
      var info = { segMs: Date.now() - t0, land: seg.nl, water: seg.nw, clusters: seg.clusters, rows: seg.rows, cols: seg.cols };
      var nk = seg.nl + seg.nw;
      if (nk < 0.06 * N || Math.min(seg.nl, seg.nw) < 0.02 * nk) return { ok: false, why: 'seg', rect: rect, info: info, ms: Date.now() - t0 };

      // emprise de la terre
      var bx0 = INF, by0 = INF, bx1 = -INF, by1 = -INF;
      land.polys.forEach(function (R) { for (var k = 0; k < R.length; k += 2) { bx0 = Math.min(bx0, R[k]); bx1 = Math.max(bx1, R[k]); by0 = Math.min(by0, R[k + 1]); by1 = Math.max(by1, R[k + 1]); } });
      var mg = 0.03 * Math.max(bx1 - bx0, by1 - by0);
      bx0 -= mg; by0 -= mg; bx1 += mg; by1 += mg;
      var Wx = bx1 - bx0, Wy = by1 - by0;
      // la partie utile de la capture (sans bandeaux)
      var uw = seg.cols[1] - seg.cols[0] + 1, uh = seg.rows[1] - seg.rows[0] + 1;
      var sFit = Math.max(Wx / uw, Wy / uh) * 0.94, sMax = sFit * 2.2, sMin = sFit / 15, KMIN = inp.kmin || 22;
      var scales = []; for (var s = sMax; s >= sMin; s /= (inp.step || 1.1)) scales.push(s);

      // grilles FFT par bande d'échelles
      var GR = [[256, 256], [256, 512], [512, 512], [512, 1024], [1024, 1024]];
      var cands = [], done = 0, si = 0, fftN = 0, tFFT = 0, grids = [];
      while (si < scales.length) {
        var sHi = scales[si], sLo = sHi / 2.3, g = null, r = 0;
        for (var gi = 0; gi < GR.length; gi++) {
          var Gx = GR[gi][0], Gy = GR[gi][1];
          r = Math.max((Wx + w * sHi) / (Gx - 2), (Wy + h * sHi) / (Gy - 2));
          g = GR[gi];
          if (Math.min(uw, uh) * sLo / r >= KMIN && Math.max(Wx / r, Wy / r) >= 48) break;
        }
        Gx = g[0]; Gy = g[1]; grids.push(Gx + 'x' + Gy + '@' + Math.round(r));
        var mw = Math.ceil(Wx / r), mh = Math.ceil(Wy / r);
        var M = softRaster(land, bx0, by1, r, mw, mh, 2);
        var FMr = new Float64Array(Gx * Gy), FMi = new Float64Array(Gx * Gy);
        for (j = 0; j < mh; j++) for (i = 0; i < mw; i++) FMr[j * Gx + i] = M[j * mw + i];
        fft2(FMr, FMi, Gx, Gy, false); fftN++;
        var Zr = new Float64Array(Gx * Gy), Zi = new Float64Array(Gx * Gy), NC = new Float32Array((mw + Gx) * (mh + Gy));
        var si0 = si;
        for (; si < scales.length && scales[si] >= sLo; si++) {
          s = scales[si];
          var f = s / r, kw = Math.ceil(w * f), kh = Math.ceil(h * f);
          if (mw + kw > Gx || mh + kh > Gy) break; // bande suivante
          var K1 = new Float64Array(kw * kh), K2 = new Float64Array(kw * kh), Kc = new Float64Array(kw * kh);
          for (j = 0; j < h; j++) {
            var kr = Math.min(kh - 1, ((j + 0.5) * f) | 0) * kw;
            for (i = 0; i < w; i++) {
              var q = kr + Math.min(kw - 1, ((i + 0.5) * f) | 0), lv = lab[j * w + i];
              Kc[q]++; if (lv) { K2[q]++; K1[q] += lv; }
            }
          }
          var n = 0, A = 0, Sll = 0;
          Zr.fill(0); Zi.fill(0);
          for (j = 0; j < kh; j++) for (i = 0; i < kw; i++) {
            q = j * kw + i; if (!Kc[q]) continue;
            var w2 = K2[q] / Kc[q], l1 = K1[q] / Kc[q];
            if (!w2) continue;
            n += w2; A += l1; Sll += l1 * l1 / w2;
            var o = ((Gy - j) % Gy) * Gx + ((Gx - i) % Gx);
            Zr[o] = l1; Zi[o] = w2;
          }
          var nzr = new Uint8Array(Gy); for (j = 0; j < kh; j++) nzr[(Gy - j) % Gy] = 1;
          var tf0 = Date.now();
          fft2(Zr, Zi, Gx, Gy, false, nzr);
          for (q = 0; q < Gx * Gy; q++) { var ar = Zr[q], ai = Zi[q], br2 = FMr[q], bi2 = FMi[q]; Zr[q] = ar * br2 - ai * bi2; Zi[q] = ar * bi2 + ai * br2; }
          fft2(Zr, Zi, Gx, Gy, true); fftN += 2; tFFT += Date.now() - tf0;
          var vl = Sll - A * A / n;
          if (!(vl > 1e-6 * n)) continue;
          // carte NCC sur les décalages valides : tx dans ]-kw, mw[, ty dans ]-kh, mh[
          var TW = mw + kw - 1, TH = mh + kh - 1, isc = 1 / (Gx * Gy); // FFT inverse non normalisée
          for (var ty = 0; ty < TH; ty++) {
            var yy = ty - kh + 1, ro = ((yy + Gy) % Gy) * Gx;
            for (var tx = 0; tx < TW; tx++) {
              var xx = tx - kw + 1, p = ro + ((xx + Gx) % Gx);
              var Bm = 2 * Zi[p] * isc - n, Cm = 2 * Zr[p] * isc - A, vm = n - Bm * Bm / n;
              NC[ty * TW + tx] = vm > 0.04 * n ? (Cm - A * Bm / n) / Math.sqrt(vl * vm) : -1;
            }
          }
          // 3 meilleurs pics (suppression des voisins)
          var rad = Math.max(3, Math.round(Math.max(kw, kh) / 5));
          for (var pk = 0; pk < 3; pk++) {
            var bv = -2, bp = -1;
            for (q = 0; q < TW * TH; q++) if (NC[q] > bv) { bv = NC[q]; bp = q; }
            if (bp < 0 || bv < 0.05) break;
            var px0 = bp % TW, py0 = (bp / TW) | 0;
            // sous-pixel (parabole)
            var sub = function (a0, a1, a2) { var dd = a0 - 2 * a1 + a2; return dd < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a0 - a2) / dd)) : 0; };
            var fx = px0 > 0 && px0 < TW - 1 ? sub(NC[bp - 1], bv, NC[bp + 1]) : 0, fy = py0 > 0 && py0 < TH - 1 ? sub(NC[bp - TW], bv, NC[bp + TW]) : 0;
            var txw = px0 + fx - kw + 1, tyw = py0 + fy - kh + 1;
            cands.push({ ncc: bv, s: s, c: bx0 + txw * r, f: by1 - tyw * r, r: r });
            for (var yq = Math.max(0, py0 - rad); yq <= Math.min(TH - 1, py0 + rad); yq++) for (var xq = Math.max(0, px0 - rad); xq <= Math.min(TW - 1, px0 + rad); xq++) NC[yq * TW + xq] = -2;
          }
          done++;
          progress(0.1 + 0.6 * done / scales.length);
        }
        if (si === si0) si++;
      }
      info.fft = fftN; info.fftMs = tFFT; info.grids = grids; info.coarseMs = Date.now() - t0;
      if (!cands.length) return { ok: false, why: 'none', info: info, ms: Date.now() - t0 };

      // candidats distincts (empreinte au sol différente)
      cands.sort(function (a, b) { return b.ncc - a.ncc; });
      var uc = w / 2, vc = h / 2;
      var center = function (c) { return [c.c + c.s * uc, c.f - c.s * vc]; };
      var same = function (a, b) {
        var ca = center(a), cb = center(b), sz = Math.min(a.s, b.s) * Math.max(w, h);
        return Math.abs(Math.log(a.s / b.s)) < 0.22 && Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) < 0.2 * sz;
      };
      var pick = [];
      if (inp.seed) pick.push({ ncc: 0, s: inp.seed.s, c: inp.seed.X - inp.seed.s * uc, f: inp.seed.Y + inp.seed.s * vc });
      cands.forEach(function (c) { if (pick.length < 7 && !pick.some(function (p) { return same(p, c); })) pick.push(c); });

      // échantillons pour le raffinement : bords terre/eau (tous) + intérieur (sous-échantillonné)
      var edge = [], inner = [];
      for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
        var lv2 = lab[j * w + i]; if (!lv2) continue;
        var isE = false;
        for (var dy2 = -2; dy2 <= 2 && !isE; dy2++) { var y2 = j + dy2; if (y2 < 0 || y2 >= h) continue;
          for (var dx2 = -2; dx2 <= 2; dx2++) { var x2 = i + dx2; if (x2 < 0 || x2 >= w) continue; if (lab[y2 * w + x2] === -lv2) { isE = true; break; } } }
        (isE ? edge : inner).push(j * w + i);
      }
      var smp = [], stE = Math.max(1, Math.ceil(edge.length / 9000)), stI = Math.max(1, Math.ceil(inner.length / 4000));
      for (i = 0; i < edge.length; i += stE) smp.push(edge[i]);
      for (i = 0; i < inner.length; i += stI) smp.push(inner[i]);
      var ns = smp.length, SU = new Float64Array(ns), SV = new Float64Array(ns), SL = new Float64Array(ns), SW = new Float64Array(ns);
      var wE = stE, wI = stI;
      for (i = 0; i < ns; i++) { var pp = smp[i]; SU[i] = (pp % w) + 0.5 - uc; SV[i] = ((pp / w) | 0) + 0.5 - vc; SL[i] = lab[pp]; SW[i] = i < Math.ceil(edge.length / stE) ? wE : wI; }

      // modèle fin autour d'une empreinte
      function model(T, rb) {
        var cs2 = [[-uc, -vc], [uc, -vc], [-uc, vc], [uc, vc]].map(function (p) { return [T.X + T.a * p[0] + T.b * p[1], T.Y + T.d * p[0] + T.e * p[1]]; });
        var x0 = INF, x1 = -INF, y0 = INF, y1 = -INF;
        cs2.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
        var m2 = 0.25 * Math.max(x1 - x0, y1 - y0); x0 -= m2; x1 += m2; y0 -= m2; y1 += m2;
        var sc = Math.sqrt(Math.abs(T.a * T.e - T.b * T.d)), rr = Math.max(sc, Math.max(x1 - x0, y1 - y0) / 800);
        var MW = Math.ceil((x1 - x0) / rr), MH = Math.ceil((y1 - y0) / rr);
        var V = boxBlur(softRaster(land, x0, y1, rr, MW, MH, 2), MW, MH, rb, 2);
        return { V: V, x0: x0, y1: y1, r: rr, W: MW, H: MH };
      }
      function score(T, Mo) {
        var sw = 0, sl = 0, sm = 0, sll = 0, smm = 0, slm = 0, V = Mo.V, MW = Mo.W, MH = Mo.H, ir = 1 / Mo.r, out = 0;
        for (var k = 0; k < ns; k++) {
          var u = SU[k], v = SV[k], X = T.X + T.a * u + T.b * v, Y = T.Y + T.d * u + T.e * v;
          var gx = (X - Mo.x0) * ir - 0.5, gy = (Mo.y1 - Y) * ir - 0.5, m;
          if (gx < 0 || gy < 0 || gx >= MW - 1 || gy >= MH - 1) { m = -1; out++; }
          else {
            var ix = gx | 0, iy = gy | 0, fx2 = gx - ix, fy2 = gy - iy, o2 = iy * MW + ix;
            m = 2 * ((V[o2] * (1 - fx2) + V[o2 + 1] * fx2) * (1 - fy2) + (V[o2 + MW] * (1 - fx2) + V[o2 + MW + 1] * fx2) * fy2) - 1;
          }
          var wt = SW[k], l = SL[k];
          sw += wt; sl += wt * l; sm += wt * m; sll += wt * l * l; smm += wt * m * m; slm += wt * l * m;
        }
        var cv = slm - sl * sm / sw, vl2 = sll - sl * sl / sw, vm2 = smm - sm * sm / sw;
        if (out > 0.2 * ns) return -1;
        return vm2 > 1e-9 && vl2 > 1e-9 ? cv / Math.sqrt(vl2 * vm2) : -1;
      }
      var simT = function (X, Y, s3, th) { var co = Math.cos(th), sn2 = Math.sin(th); return { X: X, Y: Y, a: s3 * co, b: s3 * sn2, d: s3 * sn2, e: -s3 * co }; };
      function refineSim(T0, rbs, iters) {
        var s0 = Math.sqrt(Math.abs(T0.a * T0.e - T0.b * T0.d)), th0 = Math.atan2(T0.b, T0.a), U = s0 * Math.max(w, h), T = T0, sc2 = -1;
        rbs.forEach(function (rb, k) {
          var Mo = model(T, rb), Xc = T.X, Yc = T.Y;
          var fn = function (p) {
            var th = th0 + p[3]; if (Math.abs(th) > 0.12) return 2;
            return -score(simT(Xc + p[0] * U, Yc + p[1] * U, s0 * Math.exp(p[2]), th), Mo);
          };
          var st = k === 0 ? 0.025 : 0.006;
          var res = nelder(fn, [0, 0, 0, th0 === 0 ? 0 : 0], [st, st, st * 1.2, st * 1.5], iters);
          T = simT(Xc + res.x[0] * U, Yc + res.x[1] * U, s0 * Math.exp(res.x[2]), th0 + res.x[3]);
          s0 = Math.sqrt(Math.abs(T.a * T.e - T.b * T.d)); th0 = Math.atan2(T.b, T.a); sc2 = -res.f;
        });
        return { T: T, sc: sc2 };
      }
      function refineAff(T0, rb, iters) {
        var s0 = Math.sqrt(Math.abs(T0.a * T0.e - T0.b * T0.d)), U = s0 * Math.max(w, h), Mo = model(T0, rb);
        var mk = function (p) { return { X: T0.X + p[0] * U, Y: T0.Y + p[1] * U, a: T0.a + p[2] * s0, b: T0.b + p[3] * s0, d: T0.d + p[4] * s0, e: T0.e + p[5] * s0 }; };
        var res = nelder(function (p) {
          var T = mk(p), P2 = T.a * T.a + T.b * T.b + T.d * T.d + T.e * T.e, Q = Math.abs(T.a * T.e - T.b * T.d);
          var rr = Math.sqrt(Math.max(0, P2 * P2 / 4 - Q * Q)), an = Math.sqrt((P2 / 2 + rr) / Math.max(1e-12, P2 / 2 - rr));
          if (an > 1.25 || T.a * T.e - T.b * T.d >= 0) return 2;
          return -score(T, Mo);
        }, [0, 0, 0, 0, 0, 0], [0.004, 0.004, 0.01, 0.01, 0.01, 0.01], iters);
        return { T: mk(res.x), sc: -res.f };
      }

      // raffinement rapide de chaque candidat, puis fin sur le meilleur
      var refined = pick.map(function (c, k) {
        var T = { X: c.c + c.s * uc, Y: c.f - c.s * vc, a: c.s, b: 0, d: 0, e: -c.s };
        var R2 = refineSim(T, [4], 60);
        progress(0.7 + 0.15 * (k + 1) / pick.length);
        return { T: R2.T, sc: R2.sc, coarse: c.ncc, s: c.s };
      });
      refined.sort(function (a, b) { return b.sc - a.sc; });
      var top = refined[0];
      var F2 = refineSim(top.T, [2, 1], 140);
      progress(0.92);
      var best = F2, kind = 'sim';
      var Af = refineAff(F2.T, 1, 220);
      if (Af.sc > F2.sc + 0.012) { best = Af; kind = 'affine'; }
      var final = score(best.T, model(best.T, 0));
      var second = -1;
      var tc = function (T) { return [T.X, T.Y, Math.sqrt(Math.abs(T.a * T.e - T.b * T.d))]; };
      var bt = tc(best.T);
      refined.forEach(function (r2) {
        var q2 = tc(r2.T);
        var far = Math.abs(Math.log(q2[2] / bt[2])) > 0.2 || Math.hypot(q2[0] - bt[0], q2[1] - bt[1]) > 0.12 * bt[2] * Math.max(w, h);
        if (far) second = Math.max(second, r2.sc);
      });
      progress(1);
      var T = best.T;
      var conf = final >= 0.58 && top.sc - second >= 0.08 ? 'good' : final >= 0.45 && top.sc - second >= 0.04 ? 'mid' : 'bad';
      info.cands = refined.map(function (r2) { var q2 = tc(r2.T); return { sc: +r2.sc.toFixed(3), coarse: +r2.coarse.toFixed(3), x: Math.round(q2[0]), y: Math.round(q2[1]), s: +q2[2].toFixed(3) }; });
      return { ok: true, rect: rect, w: w, h: h, conf: conf, score: final, margin: top.sc - second, kind: kind, info: info, ms: Date.now() - t0,
        tf: { a: T.a, b: T.b, c: T.X - T.a * uc - T.b * vc, d: T.d, e: T.e, f: T.Y - T.d * uc - T.e * vc } };
    }
    return { run: run, detectScreen: detectScreen, screenGeom: screenGeom, warp: warp };
  }

  var AUTO_PX = 800;             // taille de l'image d'analyse (plus grand côté)
  var autoLog = [];
  var autoWorker = null, autoWorkerBad = false, autoLocal = null, autoSeq = 0, autoJobs = {}, landFlat = null, lastAuto = null;
  function autoOn() { return X.store.get('mybgAuto', true) !== false; }
  function flatLand() {
    if (landFlat) return landFlat;
    var f = function (arr) {
      return (Array.isArray(arr) ? arr : []).filter(function (p) { return Array.isArray(p) && p.length > 2; }).map(function (p) {
        var a = new Float64Array(p.length * 2); p.forEach(function (q, i) { a[2 * i] = q[0]; a[2 * i + 1] = q[1]; }); return a;
      });
    };
    landFlat = { polys: f(X.land && X.land.polygons), holes: f(X.land && X.land.holes) };
    return landFlat;
  }
  function analysisPixels(it) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, AUTO_PX / Math.max(w, h));
          var cw = Math.max(16, Math.round(w * k)), ch = Math.max(16, Math.round(h * k));
          var c = document.createElement('canvas'); c.width = cw; c.height = ch;
          var g = c.getContext('2d');
          try { g.imageSmoothingQuality = 'high'; } catch (e) { /* */ }
          g.drawImage(img, 0, 0, cw, ch);
          var d = g.getImageData(0, 0, cw, ch);
          c.width = 1; c.height = 1;
          res({ px: d.data, w: cw, h: ch });
        } catch (e) { rej(e); }
      };
      img.onerror = function () { rej(new Error('image illisible')); };
      img.src = it.url;
    });
  }
  function workerSrc() {
    return 'var autoCore = ' + autoCore.toString() + ';\nvar CORE = autoCore();\n' +
      'self.onmessage = function (e) { var d = e.data; try {' +
      ' if (d.op === "warp") { var o = CORE.warp(d.px, d.w, d.h, d.G, d.kin, d.kout); self.postMessage({ id: d.id, r: o }, [o.px.buffer]); return; }' +
      ' var r = CORE.run(d, function (p) { self.postMessage({ id: d.id, p: p }); }); self.postMessage({ id: d.id, r: r }); }' +
      ' catch (err) { self.postMessage({ id: d.id, err: String((err && err.message) || err) }); } };';
  }
  function getWorker() {
    if (autoWorker || autoWorkerBad) return autoWorker;
    try {
      var url = URL.createObjectURL(new Blob([workerSrc()], { type: 'text/javascript' }));
      autoWorker = new Worker(url);
      autoWorker.onmessage = function (e) {
        var m = e.data || {}, j = autoJobs[m.id]; if (!j) return;
        if (typeof m.p === 'number') { j.prog(m.p); return; }
        delete autoJobs[m.id];
        if (m.err) j.fail(new Error(m.err)); else j.done(m.r);
      };
      autoWorker.onerror = function (e) {
        try { e.preventDefault(); } catch (x) { /* */ }
        autoWorkerBad = true; try { autoWorker.terminate(); } catch (x) { /* */ } autoWorker = null;
        Object.keys(autoJobs).forEach(function (id) { var j = autoJobs[id]; delete autoJobs[id]; j.retry(); });
      };
    } catch (e) { autoWorkerBad = true; autoWorker = null; }
    return autoWorker;
  }
  function runLocal(job, prog) {
    return new Promise(function (res, rej) {
      setTimeout(function () {
        try {
          autoLocal = autoLocal || autoCore();
          if (job.op === 'warp') { res(autoLocal.warp(job.px, job.w, job.h, job.G, job.kin, job.kout)); return; }
          var r = autoLocal.run(job, prog); r.local = true; res(r);
        } catch (e) { rej(e); }
      }, 40);
    });
  }
  function runCore(job, prog) {
    var wk = getWorker();
    if (!wk) return runLocal(job, prog);
    return new Promise(function (res, rej) {
      var id = ++autoSeq, tmr;
      var fin = function () { clearTimeout(tmr); delete autoJobs[id]; };
      autoJobs[id] = { prog: prog, done: function (r) { fin(); res(r); }, fail: function (e) { fin(); rej(e); },
        retry: function () { fin(); runLocal(job, prog).then(res, rej); } };
      tmr = setTimeout(function () { if (autoJobs[id]) { fin(); rej(new Error('trop long')); } }, 40000);
      job.id = id;
      try { wk.postMessage(job); } catch (e) { fin(); autoWorkerBad = true; runLocal(job, prog).then(res, rej); }
    });
  }
  function busyProg(p) {
    var i = document.querySelector('#busy .bar i'); if (!i) return;
    if (p === null) { i.style.animation = ''; i.style.transform = ''; i.style.width = ''; i.style.transition = ''; return; }
    i.style.animation = 'none'; i.style.transform = 'none'; i.style.transition = 'width .2s';
    i.style.width = Math.round(4 + 96 * Math.max(0, Math.min(1, p))) + '%';
  }
  /* Photo d'une télé : remplace l'image de la capture par l'écran redressé (meilleure résolution possible) */
  function rectifyItem(it, a, rect) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas'); c.width = it.w; c.height = it.h;
          var g = c.getContext('2d'); g.drawImage(img, 0, 0, it.w, it.h);
          var d = g.getImageData(0, 0, it.w, it.h); c.width = 1; c.height = 1;
          var kin = it.w / a.w, outH = Math.max(360, Math.min(2160, Math.round(rect.hs * kin))), kout = outH / rect.SH;
          res(runCore({ op: 'warp', px: d.data, w: it.w, h: it.h, G: { H: rect.H, u0: rect.u0, u1: rect.u1, SH: rect.SH }, kin: kin, kout: kout }, function () { /* */ })
            .then(function (o) { return { o: o, kout: kout }; }));
        } catch (e) { rej(e); }
      };
      img.onerror = function () { rej(new Error('image illisible')); };
      img.src = it.url;
    }).then(function (q) {
      var c = document.createElement('canvas'); c.width = q.o.w; c.height = q.o.h;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(q.o.px.buffer || q.o.px), q.o.w, q.o.h), 0, 0);
      return canvasToBlob(c).then(function (b) {
        c.width = 1; c.height = 1;
        if (!b || !b.size) throw new Error('compression');
        return blobUrl(b).then(function (url) {
          if (it.layer && X.map.hasLayer(it.layer)) X.map.removeLayer(it.layer);
          it.layer = null;
          try { if (String(it.url).indexOf('blob:') === 0) URL.revokeObjectURL(it.url); } catch (e) { /* */ }
          it.blob = b; it.url = url; it.w = q.o.w; it.h = q.o.h; it.rectified = true;
          return saveNew(it).then(function () { return { kout: q.kout }; });
        });
      });
    });
  }
  /* Calage automatique d'une capture : renvoie { conf: 'good'|'mid'|'bad', tf (pixels de l'image stockée), r (détails) }.
     Si c'est une photo d'écran, l'image de la capture est remplacée par l'écran redressé (même si le calage échoue :
     le calage à la main est alors plus facile). */
  function autoCalibrate(it, prog) {
    var land = flatLand();
    if (!land.polys.length) return Promise.resolve({ conf: 'bad', tf: null, r: { why: 'land' } });
    var t0 = Date.now(), pg = prog || function () { /* */ };
    return analysisPixels(it).then(function (a) {
      var job = { px: a.px, w: a.w, h: a.h, polys: land.polys, holes: land.holes, rectify: !it.rectified };
      return runCore(job, function (p) { pg(0.92 * p); }).then(function (r) {
        r.aw = a.w; r.ah = a.h; r.worker = !r.local;
        var after = r.rect && items.indexOf(it) >= 0 ? rectifyItem(it, a, r.rect).catch(function () { return null; }) : Promise.resolve(null);
        return after.then(function (k) {
          pg(1);
          r.totalMs = Date.now() - t0; r.rectified = !!k;
          if (!r.ok || !r.tf || (r.rect && !k)) return { conf: 'bad', tf: null, r: r };
          var t = r.tf, tf;
          if (k) { var q = 1 / k.kout; tf = { a: t.a * q, b: t.b * q, c: t.c, d: t.d * q, e: t.e * q, f: t.f }; }
          else { var kx = a.w / it.w, ky = a.h / it.h; tf = { a: t.a * kx, b: t.b * ky, c: t.c, d: t.d * kx, e: t.e * ky, f: t.f }; }
          tf.kind = r.kind === 'affine' ? 'affine' : 'sim';
          if (!isFinite(tf.a + tf.b + tf.c + tf.d + tf.e + tf.f)) return { conf: 'bad', tf: null, r: r };
          return { conf: r.conf, tf: r.conf === 'bad' ? null : tf, best: tf, r: r };
        });
      });
    });
  }
  function autoInfo(it, o) {
    var r = o.r || {};
    return { id: it.id, conf: o.conf, score: r.score, margin: r.margin, ms: r.totalMs, worker: r.worker, kind: r.kind, rectified: !!r.rectified,
      rect: r.rect ? { H: r.rect.H, u0: r.rect.u0, SH: r.rect.SH, aw: r.aw, ah: r.ah } : null, info: r.info, tf: copyT(o.tf), best: copyT(o.best) };
  }
  function startAuto(it, isNew) {
    var prev = it.tf ? copyT(it.tf) : null;
    X.closeSheet(); X.closePanel();
    busyShow('Calage automatique de ta capture…'); busyProg(0);
    var fail = function (why) {
      busyShow(''); busyProg(null);
      var msg = why === 'err' ? 'Le calage automatique n\'a pas pu se faire sur ce téléphone. Place 2 repères à la main, c\'est rapide.' :
        'Calage automatique impossible : l\'app ne reconnaît pas assez de côtes sur cette image. Place 2 repères à la main.';
      X.toast('Calage automatique impossible : calage à la main');
      calOpen(it, isNew, msg);
    };
    autoCalibrate(it, busyProg).then(function (o) {
      lastAuto = autoInfo(it, o); autoLog.push(lastAuto);
      if (items.indexOf(it) < 0) { busyShow(''); busyProg(null); return; }
      if (o.conf === 'bad' || !o.tf) { fail('bad'); return; }
      busyShow(''); busyProg(null);
      it.tf = copyT(o.tf); it.pts = []; it.show = true;
      saveMeta(it); syncLayers(); renderList();
      adjOpen(it, true, { auto: o.conf, prev: prev });
      fitTo(it);
      X.toast(o.conf === 'good' ? 'Calage automatique ✔' : 'Calage automatique fait : vérifie-le');
    }).catch(function () { lastAuto = { id: it.id, conf: 'error' }; fail('err'); });
  }

  /* ---------- Import ---------- */
  function busyShow(msg) { $('busyMsg').textContent = msg; $('busy').hidden = !msg; }
  // prépare une image (réduction, préréglage reconnu, recadrage) et l'enregistre : renvoie { it, pre }
  function importFile(file) {
    var pre = null;
    return prepareImage(file).then(function (r) {
      pre = presetFor(r.w, r.h);
      if (!pre || !pre.crop) return r;
      return cropBlob(r.blob, pre.crop).then(function (c2) {
        if (!c2) return r;
        var t = pre.t, u0 = pre.crop[0], v0 = pre.crop[1];
        pre.t = { a: t.a, b: t.b, c: t.c + t.a * u0 + t.b * v0, d: t.d, e: t.e, f: t.f + t.d * u0 + t.e * v0, kind: 'affine' };
        return c2;
      });
    }).then(function (r) {
      var n = 1; while (items.some(function (x) { return x.name === 'Capture ' + n; })) n++;
      var it = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: 'Capture ' + n, blob: r.blob, w: r.w, h: r.h,
        created: Date.now(), tf: null, pts: [], show: true, op: 1, layer: null };
      return blobUrl(r.blob).then(function (url) {
        it.url = url;
        items.push(it);
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { /* */ }); } catch (e) { /* */ }
        if (pre) { it.tf = copyT(pre.t); it.pts = []; }
        return saveNew(it).then(function () { return { it: it, pre: pre }; });
      });
    });
  }
  function onFiles(list) {
    list = Array.prototype.filter.call(list || [], function (f) { return f && (!f.type || f.type.indexOf('image/') === 0); });
    if (!list.length) { X.toast('Ce fichier n\'est pas une image.'); return; }
    if (list.length === 1) { onFile(list[0]); return; }
    // plusieurs captures d'un coup (ex. une photo par ville) : chacune calée automatiquement, puis empilées (la plus zoomée au-dessus)
    var n = list.length, done = [], i = 0;
    X.closeSheet(); X.closePanel();
    busyShow('Capture 1 sur ' + n + ' : préparation…'); busyProg(0);
    var next = function () {
      if (i >= n) return Promise.resolve();
      var k = i++;
      var lab = 'Capture ' + (k + 1) + ' sur ' + n;
      busyShow(lab + ' : préparation…'); busyProg(k / n);
      return importFile(list[k]).then(function (o) {
        if (o.pre) { done.push({ it: o.it, conf: 'preset' }); return; }
        if (!autoOn()) { done.push({ it: o.it, conf: 'manual' }); return; }
        busyShow(lab + ' : calage automatique…');
        return autoCalibrate(o.it, function (p) { busyProg((k + p) / n); }).then(function (a) {
          lastAuto = autoInfo(o.it, a); autoLog.push(lastAuto);
          if (a.tf && a.conf !== 'bad') { o.it.tf = copyT(a.tf); o.it.pts = []; o.it.show = true; saveMeta(o.it); }
          done.push({ it: o.it, conf: a.tf && a.conf !== 'bad' ? a.conf : 'bad' });
        }, function () { done.push({ it: o.it, conf: 'bad' }); });
      }, function () { done.push({ it: null, conf: 'err' }); }).then(next);
    };
    next().then(function () {
      busyShow(''); busyProg(null);
      syncLayers(); renderList();
      var ok = done.filter(function (d) { return d.it && d.it.tf; }), bad = done.filter(function (d) { return d.it && !d.it.tf; });
      var err = done.filter(function (d) { return !d.it; }).length;
      X.toast(n + ' captures : ' + ok.length + ' calée' + (ok.length > 1 ? 's' : '') + ' automatiquement' +
        (bad.length ? ', ' + bad.length + ' à caler à la main (panneau Calques)' : '') + (err ? ', ' + err + ' illisible' + (err > 1 ? 's' : '') : ''));
      if (ok.length) {
        ok.sort(function (p, q) { return scaleOf(p.it.tf) - scaleOf(q.it.tf); });
        var mid = ok.filter(function (d) { return d.conf === 'mid'; })[0], first = mid || ok[0];
        adjOpen(first.it, true, { auto: first.conf === 'mid' ? 'mid' : 'good', prev: null });
        fitTo(first.it);
      } else if (bad.length) { X.openPanel(); renderList(); }
    });
  }
  function onFile(file) {
    if (!file) return;
    if (file.type && file.type.indexOf('image/') !== 0) { X.toast('Ce fichier n\'est pas une image.'); return; }
    busyShow('Préparation de ta capture…');
    importFile(file).then(function (o) {
      var it = o.it;
      busyShow(''); renderList();
      if (o.pre) {
        syncLayers(); renderList();
        adjOpen(it, true); fitTo(it);
        X.toast('Carte reconnue : calage automatique fait ✔');
      } else if (autoOn()) startAuto(it, true);
      else calOpen(it, true);
    }).catch(function () {
      busyShow('');
      X.toast('Impossible de lire cette image. Essaie une capture en JPEG ou PNG.');
    });
  }

  /* ---------- Calage ---------- */
  function defaultTargets(it) {
    var pick = function (re) { return REP.filter(function (r) { return re.test(X.norm(r.n)); })[0]; };
    var prev = (it.pts || []).map(function (p) { return REP.filter(function (r) { return r.n === p.n; })[0] || { key: 'p' + p.n, n: p.n, x: p.x, y: p.y, h: '' }; });
    var d = [prev[0] || pick(/aeroport|vcia/) || REP[0], prev[1] || pick(/gellhorn/) || REP[1], prev[2] || pick(/key lento/) || REP[2]];
    // pas deux fois le même repère
    for (var i = 1; i < 3; i++) {
      if (d[i] && d.slice(0, i).some(function (x) { return x && x.n === d[i].n; })) d[i] = REP.filter(function (r) { return !d.some(function (x) { return x && x.n === r.n; }); })[0];
    }
    return d;
  }

  function calOpen(it, isNew, note) {
    if (!REP.length) resolveReperes();
    X.closeSheet(); X.closePanel();
    if (adj) adjClose(false);
    cal = { it: it, isNew: isNew, pts: [null, null], tgt: defaultTargets(it), k: 0, touched: false, want3: false, note: note || '' };
    var c = $('cal'); c.hidden = false;
    document.body.classList.add('mybg-cal');
    if (!calMap) {
      calMap = L.map('calMap', { crs: L.CRS.Simple, zoomControl: false, attributionControl: false, zoomSnap: 0.25, zoomDelta: 0.5,
        minZoom: -8, maxZoom: 3, bounceAtZoomLimits: false, tapTolerance: 12, wheelPxPerZoomLevel: 80 });
      calMap.on('click', function (e) {
        if (!cal || cal.k < 0) return;
        var z = Math.max(calMap.getZoom(), cal.fitZ + 1.5);
        calMap.setView(e.latlng, Math.min(z, calMap.getMaxZoom()));
        markTouched();
      });
      calMap.on('dragstart zoomstart', function () { if (cal && cal.k >= 0 && !cal.fitting) markTouched(); });
      calMap.on('move zoom zoomend moveend', updLoupe);
    }
    if (calOverlay) calMap.removeLayer(calOverlay);
    calOverlay = L.imageOverlay(it.url, [[-it.h, 0], [0, it.w]], { interactive: false }).addTo(calMap);
    $('calLoupeImg').style.backgroundImage = 'url("' + String(it.url).replace(/"/g, '%22') + '")';
    calMap.invalidateSize();
    calPlace(0);
  }
  function calFit() {
    var it = cal.it;
    cal.fitting = true;
    calMap.invalidateSize();
    calMap.setMinZoom(-8);
    calMap.fitBounds([[-it.h, 0], [0, it.w]], { animate: false, padding: [8, 8] });
    cal.fitZ = calMap.getZoom();
    calMap.setMinZoom(cal.fitZ - 1.5);
    cal.fitting = false;
    updLoupe();
  }
  function markTouched() { if (!cal.touched) { cal.touched = true; var b = $('calOk'); if (b) b.disabled = false; } }
  function calPlace(k) {
    cal.k = k; cal.touched = false;
    if (cal.ptsLayer) { calMap.removeLayer(cal.ptsLayer); cal.ptsLayer = null; }
    calFit();
    $('cal').classList.remove('summary');
    renderCard();
  }
  function needed() { return cal.want3 ? 3 : 2; }
  function filled() { return cal.pts.slice(0, needed()).filter(Boolean); }

  function renderCard() {
    var c = $('calCard'), h = '';
    var n = needed();
    var dots = '';
    for (var i = 0; i < n; i++) dots += '<i class="' + (cal.pts[i] ? 'ok' : '') + (i === cal.k ? ' cur' : '') + '"></i>';
    if (cal.k >= 0) {
      var r = cal.tgt[cal.k];
      if (cal.note && cal.k === 0 && !cal.pts[0]) h += '<p class="cal-q mid cal-note">' + X.esc(cal.note) + '</p>';
      h += '<div class="cal-step"><span class="dots">' + dots + '</span>Repère ' + (cal.k + 1) + ' sur ' + n + (cal.k === 2 ? ' (facultatif, plus précis)' : '') + '</div>';
      h += '<div class="cal-target">' + (r ? miniSvg(r) : '') + '<div><p>Touche sur ta capture l\'endroit de ce point :</p><b class="tname">' + X.esc(r ? r.n : '—') + '</b>' +
        (r && r.h ? '<small>' + X.esc(r.h) + '</small>' : '') + '</div></div>';
      h += '<p class="cal-help">Puis glisse ta capture pour mettre ce point <b>pile sous la croix</b> (la loupe t\'aide). Deux doigts ou la molette pour zoomer.</p>';
      h += '<div class="rowbtns"><button type="button" id="calOther" class="btn">' + ICONS.use('ui_search') + 'Autre repère</button>' +
        '<button type="button" id="calOk" class="btn primary"' + (cal.touched ? '' : ' disabled') + '>' + ICONS.use('ui_check') + 'Valider ce point</button></div>';
      if (cal.redo || cal.k === 2) h += '<button type="button" id="calBack" class="btn ghost wide">' + ICONS.use('ui_undo') + 'Annuler, revenir au résumé</button>';
      else if (cal.k === 1 && cal.pts[0]) h += '<button type="button" id="calBack" class="btn ghost wide">' + ICONS.use('ui_undo') + 'Refaire le repère 1 (' + X.esc(cal.pts[0].n) + ')</button>';
    } else {
      var P = filled(), t = fit(P), e = t ? relErr(t, P, cal.it.w) : 1;
      var q = e < 0.015 ? ['good', 'Très bon calage ✓'] : e < 0.04 ? ['mid', 'Calage correct. Pour encore plus de précision, ajoute un 3e repère.'] :
        ['bad', 'Les repères ne collent pas bien entre eux : refais celui qui te semble mal placé, ou ajoute un 3e repère.'];
      h += '<div class="cal-step"><span class="dots">' + dots + '</span>Repères posés</div><ol class="cal-pts">';
      for (var j = 0; j < n; j++) {
        h += '<li><span class="num">' + (j + 1) + '</span><span class="pn">' + X.esc(cal.pts[j].n) + '</span><button type="button" class="btn redo" data-k="' + j + '">' + ICONS.use('ui_undo') + 'Refaire</button></li>';
      }
      h += '</ol><p class="cal-q ' + q[0] + '">' + q[1] + '</p>';
      h += '<div class="rowbtns">' + (n < 3 ? '<button type="button" id="calAdd" class="btn">' + ICONS.use('ui_plus') + '3e repère</button>' : '') +
        '<button type="button" id="calDone" class="btn primary">' + ICONS.use('ui_check') + 'Terminer</button></div>';
      if (n < 3) h += '<p class="cal-help small">Photo de l\'écran ou capture un peu de travers ? Ajoute un 3e repère.</p>';
    }
    c.innerHTML = h;
    var on = function (id, fn) { var el = $(id); if (el) el.addEventListener('click', fn); };
    on('calOther', openPick);
    on('calOk', calValidate);
    on('calBack', function () {
      if (cal.redo) { cal.pts[cal.k] = cal.redo; cal.redo = null; calSummaryOrNext(); }
      else if (cal.k === 2) { cal.want3 = false; cal.pts[2] = null; calSummaryOrNext(); }
      else { cal.pts[0] = null; calPlace(0); }
    });
    on('calAdd', function () { cal.want3 = true; cal.pts[2] = null; calPlace(2); });
    on('calDone', calFinish);
    Array.prototype.forEach.call(c.querySelectorAll('.redo'), function (b) {
      b.addEventListener('click', function () { var k = +b.getAttribute('data-k'); cal.redo = cal.pts[k]; cal.pts[k] = null; calPlace(k); });
    });
    updLoupe();
  }

  function calValidate() {
    if (!cal || cal.k < 0) return;
    var it = cal.it, r = cal.tgt[cal.k];
    if (!r) { X.toast('Choisis d\'abord un repère avec « Autre repère ».'); return; }
    var ctr = calMap.getCenter(), u = ctr.lng, v = -ctr.lat;
    if (u < 0 || v < 0 || u > it.w || v > it.h) { X.toast('La croix est en dehors de ta capture : place-la sur le repère.'); return; }
    var p = { u: u, v: v, x: r.x, y: r.y, n: r.n };
    var diag = Math.hypot(it.w, it.h);
    var others = cal.pts.filter(function (q, i) { return q && i !== cal.k; });
    for (var i = 0; i < others.length; i++) {
      if (Math.hypot(others[i].u - u, others[i].v - v) < 0.12 * diag) { X.toast('Ces repères sont trop proches sur ta capture : choisis-en un plus éloigné (« Autre repère »).'); return; }
      if (others[i].n === r.n) { X.toast('Ce repère est déjà utilisé : choisis-en un autre.'); return; }
    }
    var test = others.concat([p]);
    if (test.length >= 2 && !fit(test)) { X.toast('Ce point ne colle pas avec les autres : vérifie que la croix est bien sur « ' + r.n + ' ».'); return; }
    cal.pts[cal.k] = p; cal.redo = null; cal.note = '';
    calSummaryOrNext();
  }
  function calSummaryOrNext() {
    var n = needed();
    for (var i = 0; i < n; i++) if (!cal.pts[i]) { calPlace(i); return; }
    cal.k = -1;
    $('cal').classList.add('summary');
    renderCard();
    showPtsOnCal();
  }
  function showPtsOnCal() {
    if (cal.ptsLayer) { calMap.removeLayer(cal.ptsLayer); cal.ptsLayer = null; }
    if (cal.k >= 0) return;
    cal.ptsLayer = L.layerGroup(filled().map(function (p, i) {
      return L.marker([-p.v, p.u], { interactive: false, icon: L.divIcon({ className: 'calpt', iconSize: [30, 30], html: '<span>' + (i + 1) + '</span>' }) });
    })).addTo(calMap);
    calFit();
  }
  function calFinish() {
    var it = cal.it, P = filled(), t = fit(P);
    if (!t) { X.toast('Calage impossible avec ces points : refais-en un.'); return; }
    it.tf = copyT(t); it.pts = P.map(function (p) { return { u: p.u, v: p.v, x: p.x, y: p.y, n: p.n }; }); it.show = true;
    saveMeta(it);
    calClose();
    syncLayers(); renderList();
    adjOpen(it, true);
    fitTo(it);
  }
  function calClose() {
    if (!cal) return;
    if (cal.ptsLayer) calMap.removeLayer(cal.ptsLayer);
    var it = cal.it, wasNew = cal.isNew;
    cal = null;
    $('cal').hidden = true; $('calPick').hidden = true;
    document.body.classList.remove('mybg-cal');
    return { it: it, wasNew: wasNew };
  }
  function calCancel() {
    if (!$('calPick').hidden) { $('calPick').hidden = true; return; }
    var r = calClose();
    if (r && !r.it.tf) X.toast('Capture gardée : tu pourras la caler plus tard (panneau Calques).');
  }

  /* loupe : agrandit la zone sous la croix */
  function updLoupe() {
    if (!cal || !calMap) return;
    var el = $('calLoupeImg'), box = $('calLoupe');
    var R = (box.offsetWidth || 120) / 2;
    var c = calMap.getCenter(), u = c.lng, v = -c.lat;
    var ls = Math.min(8, Math.pow(2, calMap.getZoom()) * 3.5);
    el.style.backgroundSize = (cal.it.w * ls).toFixed(1) + 'px ' + (cal.it.h * ls).toFixed(1) + 'px';
    el.style.backgroundPosition = (R - u * ls).toFixed(1) + 'px ' + (R - v * ls).toFixed(1) + 'px';
    box.classList.toggle('off', cal.k < 0);
  }

  /* liste des repères */
  function openPick() {
    $('calPick').hidden = false;
    var q = $('calPickQ'); q.value = '';
    renderPick('');
  }
  function renderPick(q) {
    var box = $('calPickList'); box.innerHTML = '';
    var used = cal.pts.filter(function (p, i) { return p && i !== cal.k; }).map(function (p) { return p.n; });
    var row = function (r) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'res';
      var isUsed = used.indexOf(r.n) >= 0;
      b.disabled = isUsed;
      b.innerHTML = '<span class="rt"><span class="rn">' + X.esc(r.n) + '</span><span class="rc">' + X.esc(isUsed ? 'Déjà utilisé' : (r.h || '')) + '</span></span>';
      b.addEventListener('click', function () { cal.tgt[cal.k] = r; $('calPick').hidden = true; renderCard(); });
      return b;
    };
    var head = function (t) { var d = document.createElement('div'); d.className = 'pick-h'; d.textContent = t; box.appendChild(d); };
    if (q.trim().length >= 2) {
      var res = searchPlaces(q);
      if (!res.length) box.innerHTML = '<div class="res-empty">Aucun lieu trouvé.</div>';
      res.forEach(function (r) { box.appendChild(row(r)); });
      return;
    }
    head('Bien visibles sur la carte entière');
    REP.filter(function (r) { return r.z === 'all'; }).forEach(function (r) { box.appendChild(row(r)); });
    head('Pour une capture zoomée sur Vice City');
    REP.filter(function (r) { return r.z === 'vc'; }).forEach(function (r) { box.appendChild(row(r)); });
  }

  /* ---------- Réglage fin ---------- */
  function adjOpen(it, check, auto) {
    if (!it.tf) return;
    X.closeSheet(); if (!X.isWide()) X.closePanel();
    if (adj) adjClose(false);
    adj = { it: it, t0: copyT(it.tf), check: !!check, ptrs: {}, g: null, mode: null, maxB: X.map.options.maxBounds || null,
      auto: auto ? auto.auto : '', prev: auto ? auto.prev : undefined };
    if (adj.maxB) X.map.setMaxBounds(null); // libre pendant la vérification (la barre du bas cache une partie de l'écran)
    if (!it.show) { it.show = true; syncLayers(); renderList(); }
    document.body.classList.add('mybg-adjust');
    $('adjTitle').textContent = check ? 'Capture calée ✓ Vérifie' : 'Ajuster « ' + it.name + ' »';
    $('adjText').textContent = check ?
      'Les contours bleus doivent suivre les côtes de ta capture. Si ça ne colle pas, choisis « Bouger la capture » puis glisse-la, pince pour sa taille, ou utilise les flèches.' :
      'Glisse la capture avec un doigt, pince à deux doigts pour sa taille, ou utilise les flèches. Les contours bleus doivent suivre les côtes.';
    $('adjCancel').textContent = check ? 'Refaire le calage' : 'Annuler';
    if (adj.auto) {
      $('adjTitle').textContent = adj.auto === 'good' ? 'Calage automatique ✔' : 'Calage automatique : à vérifier';
      $('adjText').textContent = adj.auto === 'good' ?
        'Vérifie : les contours bleus doivent suivre les côtes de ta capture. Si c\'est bon, touche « C\'est bon ». Un petit décalage ? « Bouger la capture ». Complètement faux ? « Caler à la main ».' :
        'L\'app n\'est pas sûre d\'elle : regarde si les contours bleus suivent bien les côtes de ta capture (zoome si besoin). Si c\'est bon, touche « C\'est bon ». Sinon, « Caler à la main ».';
      $('adjCancel').textContent = 'Caler à la main';
    }
    $('adjDone').lastChild.textContent = check ? 'C\'est bon' : 'Terminé';
    showOutline(true);
    setAdjMode(check ? 'map' : 'img');
    $('adj').hidden = false;
    if (!check && !X.map.getBounds().intersects(boundsOf(it))) fitTo(it);
  }
  function fitTo(it) {
    var a = $('adj'), open = !a.hidden;
    var br = X.isWide() ? [open ? a.offsetWidth + 30 : 10, 10] : [10, open ? a.offsetHeight + 10 : 10];
    X.map.fitBounds(boundsOf(it), { paddingTopLeft: [10, 10], paddingBottomRight: br, animate: false });
  }
  function setAdjMode(m) {
    if (!adj) return;
    adj.mode = m;
    var map = X.map, img = m === 'img';
    ['dragging', 'touchZoom', 'doubleClickZoom'].forEach(function (h) { if (map[h]) { if (img) map[h].disable(); else map[h].enable(); } });
    $('adjModeImg').setAttribute('aria-pressed', img ? 'true' : 'false');
    $('adjModeMap').setAttribute('aria-pressed', img ? 'false' : 'true');
    document.body.classList.toggle('mybg-drag', img);
    adj.ptrs = {}; adj.g = null;
  }
  function adjClose(keep) {
    if (!adj) return;
    var it = adj.it;
    if (!keep) { it.tf = adj.t0; if (it.layer) it.layer.setTf(it.tf); }
    else saveMeta(it);
    setAdjMode('map');
    var mb = adj.maxB;
    adj = null;
    if (mb) X.map.setMaxBounds(mb);
    showOutline(false);
    document.body.classList.remove('mybg-adjust', 'mybg-drag');
    $('adj').hidden = true;
    renderList();
  }
  function setTf(t) { adj.it.tf = t; if (adj.it.layer) adj.it.layer.setTf(t); }
  function zs() { return Math.pow(2, X.map.getZoom()); }
  function ptr(e) { var r = X.map.getContainer().getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function gStart() {
    var ids = Object.keys(adj.ptrs), pts = {};
    ids.forEach(function (id) { pts[id] = { x: adj.ptrs[id].x, y: adj.ptrs[id].y }; });
    adj.g = ids.length ? { t0: copyT(adj.it.tf), pts: pts } : null;
  }
  function gMove() {
    var g = adj.g; if (!g) return;
    var ids = Object.keys(adj.ptrs).filter(function (id) { return g.pts[id]; });
    if (!ids.length) return;
    var z = zs(), t;
    if (ids.length === 1) {
      var a0 = g.pts[ids[0]], a1 = adj.ptrs[ids[0]];
      t = translateT(g.t0, (a1.x - a0.x) / z, -(a1.y - a0.y) / z);
    } else {
      var p0 = g.pts[ids[0]], q0 = g.pts[ids[1]], p1 = adj.ptrs[ids[0]], q1 = adj.ptrs[ids[1]];
      var d0 = Math.hypot(q0.x - p0.x, q0.y - p0.y), d1 = Math.hypot(q1.x - p1.x, q1.y - p1.y);
      var k = d0 > 10 ? Math.max(0.2, Math.min(5, d1 / d0)) : 1;
      var m0 = L.point((p0.x + q0.x) / 2, (p0.y + q0.y) / 2), m1 = L.point((p1.x + q1.x) / 2, (p1.y + q1.y) / 2);
      var w0 = X.map.containerPointToLatLng(m0);
      t = translateT(scaleT(g.t0, k, w0.lng, w0.lat), (m1.x - m0.x) / z, -(m1.y - m0.y) / z);
    }
    setTf(t);
  }
  function bindAdjPointers() {
    var ct = X.map.getContainer();
    ct.addEventListener('pointerdown', function (e) {
      if (!adj || adj.mode !== 'img') return;
      if (e.button && e.button !== 0) return;
      adj.ptrs[e.pointerId] = ptr(e);
      try { ct.setPointerCapture(e.pointerId); } catch (x) { /* */ }
      gStart(); e.preventDefault();
    });
    ct.addEventListener('pointermove', function (e) {
      if (!adj || !adj.ptrs[e.pointerId]) return;
      adj.ptrs[e.pointerId] = ptr(e); gMove(); e.preventDefault();
    });
    var up = function (e) {
      if (!adj || !adj.ptrs[e.pointerId]) return;
      delete adj.ptrs[e.pointerId]; gStart();
    };
    ct.addEventListener('pointerup', up); ct.addEventListener('pointercancel', up);
  }
  function padAction(a) {
    if (!adj) return;
    var t = adj.it.tf, z = zs(), st = 4 / z, c = X.map.getCenter();
    if (a === 'left') t = translateT(t, -st, 0);
    else if (a === 'right') t = translateT(t, st, 0);
    else if (a === 'up') t = translateT(t, 0, st);
    else if (a === 'down') t = translateT(t, 0, -st);
    else if (a === 'bigger') t = scaleT(t, 1.005, c.lng, c.lat);
    else if (a === 'smaller') t = scaleT(t, 1 / 1.005, c.lng, c.lat);
    else if (a === 'rotl') t = rotateT(t, 0.2 * Math.PI / 180, c.lng, c.lat);
    else if (a === 'rotr') t = rotateT(t, -0.2 * Math.PI / 180, c.lng, c.lat);
    setTf(t);
  }
  function bindPad() {
    Array.prototype.forEach.call(document.querySelectorAll('#adjPad .padb'), function (b) {
      var a = b.getAttribute('data-a'), t1, t2;
      var stop = function () { clearTimeout(t1); clearInterval(t2); };
      b.addEventListener('pointerdown', function () { stop(); t1 = setTimeout(function () { t2 = setInterval(function () { padAction(a); }, 70); }, 380); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { b.addEventListener(ev, stop); });
      b.addEventListener('click', function () { padAction(a); });
    });
  }

  /* ---------- Mini-tutoriel illustré (schémas, aucune image du jeu) ---------- */
  var TUTO = [
    ['Ouvre la carte du jeu', 'Menu pause › Carte. <b>Dézoome au maximum</b> pour voir tout l\'État. Le nord doit être en haut (c\'est le réglage normal).',
      '<rect x="8" y="6" width="88" height="54" rx="4" class="s1"/><path d="M40 70h24M52 60v10" class="s1"/>' +
      '<path d="M30 22c6-7 16-6 20 0s12 3 18-1 13 3 10 11-9 9-15 13-13 8-20 3-13-3-16-9-3-12 3-17z" class="s2"/>' +
      '<path d="M86 13v12M82 17l4-4 4 4" class="s3"/><circle cx="104" cy="56" r="10" class="s4"/><path d="M99 56h10M111 63l6 6" class="s4"/>'],
    ['Fais une capture d\'écran', '<b>PS5</b> : bouton <b>Create</b> (à gauche du pavé tactile). <b>Xbox</b> : bouton <b>Partage</b> (au centre de la manette). Récupère-la sur ton téléphone avec l\'app PlayStation ou l\'app Xbox (rubrique Captures). Sinon : <b>photo de l\'écran bien de face</b>, écran entier dans le cadre, sans reflet.',
      '<path d="M14 30c2-8 8-10 16-10h28c8 0 14 2 16 10l6 22c1 6-5 9-9 5l-9-9H31l-9 9c-4 4-10 1-9-5z" class="s1"/>' +
      '<rect x="36" y="24" width="16" height="10" rx="2" class="s1"/><rect x="27" y="25" width="6" height="4" rx="2" class="s5"/><circle cx="62" cy="33" r="2.5" class="s1"/>' +
      '<path d="M84 34h12M92 30l4 4-4 4" class="s3"/><rect x="100" y="16" width="16" height="30" rx="3" class="s1"/><rect x="103" y="22" width="10" height="16" class="s2"/>'],
    ['Importe-la ici', 'Touche « Importer ma capture ». Tu peux en choisir <b>plusieurs d\'un coup</b> (une par ville). Elles restent <b>uniquement sur ton téléphone</b> : rien n\'est envoyé sur Internet.',
      '<rect x="40" y="6" width="40" height="66" rx="6" class="s1"/><rect x="45" y="16" width="30" height="40" class="s2"/>' +
      '<path d="M60 48V26M53 33l7-7 7 7" class="s3"/><path d="M90 30h14v12H90zM93 30v-4a4 4 0 0 1 8 0v4" class="s4"/>'],
    ['Vérifie le calage', 'L\'app <b>cale ta capture toute seule</b> (quelques secondes ; une photo de la télé est redressée). Vérifie que les contours bleus suivent les côtes. Si elle n\'y arrive pas, elle te demande de toucher <b>2 repères</b> (la loupe t\'aide).',
      '<rect x="10" y="6" width="100" height="64" rx="4" class="s1"/><path d="M28 24c6-7 16-6 20 0s12 3 18-1 13 3 10 11-9 9-15 13-13 8-20 3-13-3-16-9-3-12 3-17z" class="s2"/>' +
      '<path d="M60 26v20M50 36h20" class="s3"/><circle cx="60" cy="36" r="5" class="s3"/>' +
      '<circle cx="34" cy="26" r="6" class="s5"/><text x="34" y="29.5" class="tn">1</text><circle cx="82" cy="52" r="6" class="s5"/><text x="82" y="55.5" class="tn">2</text>']
  ];
  function buildTuto() {
    $('tutoSteps').innerHTML = TUTO.map(function (s, i) {
      return '<li><svg viewBox="0 0 120 78" class="tsvg" aria-hidden="true">' + s[2] + '</svg><div><b class="tt"><span class="num">' + (i + 1) + '</span>' + s[0] + '</b><p>' + s[1] + '</p></div></li>';
    }).join('');
  }
  function tutoOpen() { $('tuto').hidden = false; X.store.set('mybgTuto', true); }
  function tutoClose() { $('tuto').hidden = true; }
  function pickFile() { var f = $('mybgFile'); f.value = ''; f.click(); }

  /* ---------- Démarrage ---------- */
  function bindUI() {
    $('mybgImport').addEventListener('click', function () { if (!X.store.get('mybgTuto', false)) tutoOpen(); else pickFile(); });
    $('mybgHelp').addEventListener('click', tutoOpen);
    $('tutoClose').addEventListener('click', tutoClose);
    $('tutoGo').addEventListener('click', function () { tutoClose(); pickFile(); });
    $('tuto').addEventListener('click', function (e) { if (e.target === $('tuto')) tutoClose(); });
    try { $('mybgFile').multiple = true; } catch (e) { /* */ } // plusieurs captures d'un coup (une par ville)
    $('mybgFile').addEventListener('change', function () { onFiles(this.files); });
    $('calCancel').addEventListener('click', calCancel);
    $('calPickClose').addEventListener('click', function () { $('calPick').hidden = true; });
    $('calPickQ').addEventListener('input', function () { renderPick(this.value); });
    $('calZoomIn').addEventListener('click', function () { if (calMap) { calMap.zoomIn(0.5); markTouched(); } });
    $('calZoomOut').addEventListener('click', function () { if (calMap) calMap.zoomOut(0.5); });
    $('adjModeImg').addEventListener('click', function () { setAdjMode('img'); });
    $('adjModeMap').addEventListener('click', function () { setAdjMode('map'); });
    $('adjDone').addEventListener('click', function () { var ck = adj && adj.check; adjClose(true); X.toast(ck ? 'Ta capture est en place ✓' : 'Réglage mémorisé'); });
    $('adjCancel').addEventListener('click', function () {
      var it = adj && adj.it, ck = adj && adj.check, au = adj && adj.auto, prev = adj && adj.prev;
      adjClose(false);
      if (ck && it && au) { it.tf = prev ? copyT(prev) : null; saveMeta(it); syncLayers(); renderList(); }
      if (ck && it) calOpen(it, false);
    });
    L.DomEvent.disableClickPropagation($('adj'));
    L.DomEvent.disableScrollPropagation($('adj'));
    bindPad();
    bindAdjPointers();
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('tuto').hidden) tutoClose();
      else if (cal) calCancel();
      else if (adj) adjClose(adj.check);
    });
    window.addEventListener('resize', function () { if (cal && calMap) { calMap.invalidateSize(); updLoupe(); } });
  }

  function init(ctx) {
    if (X) return;
    X = ctx;
    buildMini(); buildTuto();
    var els = document.querySelectorAll('#mybgSec [data-ic], #adj [data-ic], #cal [data-ic], #tuto [data-ic]');
    for (var i = 0; i < els.length; i++) if (!els[i].firstChild) els[i].innerHTML = ICONS.use(els[i].getAttribute('data-ic'));
    bindUI();
    renderList();
    idbOpen().then(function (d) {
      db = d;
      if (!db) { memOnly = true; showNote(); return []; }
      return loadAll();
    }).then(function (recs) {
      return Promise.all(recs.map(function (r) {
        return blobUrl(r.blob).then(function (url) {
          return { id: r.id, name: r.name || 'Capture', blob: r.blob, url: url, w: r.w, h: r.h, created: r.created || 0, tf: r.tf || null, pts: r.pts || [],
            show: r.show !== false, op: typeof r.op === 'number' ? r.op : 1, layer: null, rectified: !!r.rectified };
        }, function () { return null; });
      }));
    }).then(function (arr) {
      arr.filter(Boolean).forEach(function (it) { if (!items.some(function (x) { return x.id === it.id; })) items.push(it); });
      items.sort(function (p, q) { return p.created - q.created; });
      syncLayers(); renderList();
    }).catch(function () { /* la carte reste utilisable */ });
  }

  window.GTA6_MYBG = {
    init: init,
    busy: function () { return !!(cal || adj); },
    setAuto: function (on) { if (X) X.store.set('mybgAuto', !!on); },
    // pour les tests automatisés
    _debug: function () {
      return { memOnly: memOnly, hasDb: !!db, calMap: calMap, cal: cal, adj: adj, rep: REP, auto: lastAuto, autoLog: autoLog, autoOn: autoOn(),
        items: items.map(function (it) { return { id: it.id, name: it.name, w: it.w, h: it.h, tf: copyT(it.tf), rectified: !!it.rectified, url: it.url, pts: it.pts, show: it.show, op: it.op, onMap: !!(it.layer && X.map.hasLayer(it.layer)), z: it.layer ? it.layer.options.zIndex : 0, bytes: it.blob ? it.blob.size : 0 }; }) };
    },
    // tests : calage automatique d'une image (URL) sans interface ; suppression d'une capture
    _autoTest: function (url, w, h) { return autoCalibrate({ url: url, w: w, h: h }).then(function (o) { return { conf: o.conf, tf: o.tf, r: o.r }; }); },
    _remove: function (id) { var it = items.filter(function (x) { return x.id === id; })[0]; if (it) removeItem(it); }
  };
})();
