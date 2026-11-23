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
  function meta(it) { return { id: it.id, name: it.name, w: it.w, h: it.h, created: it.created, tf: it.tf, pts: it.pts, show: it.show, op: it.op }; }
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
          '<div class="rowbtns"><button type="button" class="btn mbFix">' + ICONS.use('ui_move') + 'Ajuster finement</button><button type="button" class="btn mbCal">' + ICONS.use('ui_center') + 'Recaler</button></div>';
      } else {
        h += '<button type="button" class="btn primary wide mbCal">' + ICONS.use('ui_center') + 'Caler cette capture (2 repères)</button>';
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

  /* ---------- Import ---------- */
  function busyShow(msg) { $('busyMsg').textContent = msg; $('busy').hidden = !msg; }
  function onFile(file) {
    if (!file) return;
    if (file.type && file.type.indexOf('image/') !== 0) { X.toast('Ce fichier n\'est pas une image.'); return; }
    busyShow('Préparation de ta capture…');
    var pre = null;
    prepareImage(file).then(function (r) {
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
        return saveNew(it).then(function () {
          busyShow(''); renderList();
          if (pre) {
            syncLayers(); renderList();
            adjOpen(it, true); fitTo(it);
            X.toast('Carte reconnue : calage automatique fait ✔');
          } else calOpen(it, true);
        });
      });
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

  function calOpen(it, isNew) {
    if (!REP.length) resolveReperes();
    X.closeSheet(); X.closePanel();
    if (adj) adjClose(false);
    cal = { it: it, isNew: isNew, pts: [null, null], tgt: defaultTargets(it), k: 0, touched: false, want3: false };
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
    cal.pts[cal.k] = p; cal.redo = null;
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
  function adjOpen(it, check) {
    if (!it.tf) return;
    X.closeSheet(); if (!X.isWide()) X.closePanel();
    if (adj) adjClose(false);
    adj = { it: it, t0: copyT(it.tf), check: !!check, ptrs: {}, g: null, mode: null, maxB: X.map.options.maxBounds || null };
    if (adj.maxB) X.map.setMaxBounds(null); // libre pendant la vérification (la barre du bas cache une partie de l'écran)
    if (!it.show) { it.show = true; syncLayers(); renderList(); }
    document.body.classList.add('mybg-adjust');
    $('adjTitle').textContent = check ? 'Capture calée ✓ Vérifie' : 'Ajuster « ' + it.name + ' »';
    $('adjText').textContent = check ?
      'Les contours bleus doivent suivre les côtes de ta capture. Si ça ne colle pas, choisis « Bouger la capture » puis glisse-la, pince pour sa taille, ou utilise les flèches.' :
      'Glisse la capture avec un doigt, pince à deux doigts pour sa taille, ou utilise les flèches. Les contours bleus doivent suivre les côtes.';
    $('adjCancel').textContent = check ? 'Refaire le calage' : 'Annuler';
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
    ['Importe-la ici', 'Touche « Importer ma capture ». Elle reste <b>uniquement sur ton téléphone</b> : rien n\'est envoyé sur Internet.',
      '<rect x="40" y="6" width="40" height="66" rx="6" class="s1"/><rect x="45" y="16" width="30" height="40" class="s2"/>' +
      '<path d="M60 48V26M53 33l7-7 7 7" class="s3"/><path d="M90 30h14v12H90zM93 30v-4a4 4 0 0 1 8 0v4" class="s4"/>'],
    ['Touche 2 repères', 'L\'app te dit lesquels (ex. l\'aéroport, Port Gellhorn). Mets chaque repère <b>pile sous la croix</b>, la loupe t\'aide. C\'est une photo ? Ajoute un 3e repère.',
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
    $('mybgFile').addEventListener('change', function () { var f = this.files && this.files[0]; onFile(f); });
    $('calCancel').addEventListener('click', calCancel);
    $('calPickClose').addEventListener('click', function () { $('calPick').hidden = true; });
    $('calPickQ').addEventListener('input', function () { renderPick(this.value); });
    $('calZoomIn').addEventListener('click', function () { if (calMap) { calMap.zoomIn(0.5); markTouched(); } });
    $('calZoomOut').addEventListener('click', function () { if (calMap) calMap.zoomOut(0.5); });
    $('adjModeImg').addEventListener('click', function () { setAdjMode('img'); });
    $('adjModeMap').addEventListener('click', function () { setAdjMode('map'); });
    $('adjDone').addEventListener('click', function () { var ck = adj && adj.check; adjClose(true); X.toast(ck ? 'Ta capture est en place ✓' : 'Réglage mémorisé'); });
    $('adjCancel').addEventListener('click', function () { var it = adj && adj.it, ck = adj && adj.check; adjClose(false); if (ck && it) calOpen(it, false); });
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
            show: r.show !== false, op: typeof r.op === 'number' ? r.op : 1, layer: null };
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
    // pour les tests automatisés
    _debug: function () {
      return { memOnly: memOnly, hasDb: !!db, calMap: calMap, cal: cal, adj: adj, rep: REP,
        items: items.map(function (it) { return { id: it.id, name: it.name, w: it.w, h: it.h, tf: copyT(it.tf), pts: it.pts, show: it.show, op: it.op, onMap: !!(it.layer && X.map.hasLayer(it.layer)), z: it.layer ? it.layer.options.zIndex : 0, bytes: it.blob ? it.blob.size : 0 }; }) };
    }
  };
})();
