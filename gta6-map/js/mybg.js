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
    resolveZoneReps(byName);
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
      if (it.tmp) return; // photo en cours de « Où est-ce sur ma photo ? »
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
    wizSync();
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

    // redressement seul (avant la lecture des noms) : géométrie de l'écran, ou null si ce n'est pas une photo d'écran
    function prep(px, w, h) {
      var S = detectScreen(px, w, h), G = S ? screenGeom(S, 360) : null;
      if (!(G && G.u1 - G.u0 > 100)) return null;
      return { H: G.H, SW: G.SW, SH: G.SH, u0: G.u0, u1: G.u1, hs: S.hs, pw: w, ph: h };
    }

    /* -- Lignes de texte (noms de lieux) : les lettres des cartes du jeu sont des traits clairs et fins cernés de sombre.
       Chapeau haut-de-forme morphologique (luminance - ouverture), composantes connexes de la taille d'une lettre,
       regroupées en lignes (même hauteur, alignées, rapprochées). Renvoie les boîtes et le masque des lettres de chaque ligne. -- */
    function mmFilter(src, W, H, r, mx) {
      var t = new Float32Array(W * H), o = new Float32Array(W * H), x, y, k, v, q, a, b, row;
      for (y = 0; y < H; y++) {
        row = y * W;
        for (x = 0; x < W; x++) {
          v = src[row + x]; a = x - r < 0 ? 0 : x - r; b = x + r >= W ? W - 1 : x + r;
          for (k = a; k <= b; k++) { q = src[row + k]; if (mx ? q > v : q < v) v = q; }
          t[row + x] = v;
        }
      }
      for (y = 0; y < H; y++) {
        a = y - r < 0 ? 0 : y - r; b = y + r >= H ? H - 1 : y + r; row = y * W;
        for (x = 0; x < W; x++) {
          v = t[row + x];
          for (k = a; k <= b; k++) { q = t[k * W + x]; if (mx ? q > v : q < v) v = q; }
          o[row + x] = v;
        }
      }
      return o;
    }
    function textLines(px, w, h) {
      var N = w * h, Lm = new Float32Array(N), i, out = [], acc, hist;
      for (i = 0; i < N; i++) Lm[i] = 0.3 * px[4 * i] + 0.59 * px[4 * i + 1] + 0.11 * px[4 * i + 2];
      // 3 passes : traits clairs fins (2 tailles de lettres), puis lettres blanches (les plus claires de l'image, peu colorées)
      [[4, 7, 42], [7, 14, 76], [0, 8, 76]].forEach(function (P) {
        var r = P[0], hmin = P[1], hmax = P[2], m = new Uint8Array(N), lab = new Int32Array(N), st = new Int32Array(N), T;
        if (r) {
          var op = mmFilter(mmFilter(Lm, w, h, r, false), w, h, r, true);
          // seuil : 28 niveaux au-dessus du fond local (moins si la photo est terne)
          hist = new Uint32Array(256);
          for (i = 0; i < N; i++) { var d = Lm[i] - op[i]; if (d > 4) hist[Math.min(255, d | 0)]++; }
          acc = 0; var p995 = 255; for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > 0.005 * N) { p995 = i; break; } }
          T = Math.max(14, Math.min(28, 0.45 * p995));
          for (i = 0; i < N; i++) m[i] = Lm[i] - op[i] > T ? 1 : 0;
        } else {
          var mn = new Uint8Array(N), sat = new Uint8Array(N);
          hist = new Uint32Array(256);
          for (i = 0; i < N; i++) {
            var R = px[4 * i], G = px[4 * i + 1], B = px[4 * i + 2], lo = Math.min(R, G, B);
            mn[i] = lo; sat[i] = Math.max(R, G, B) - lo; hist[lo]++;
          }
          acc = 0; var q995 = 255; for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > 0.005 * N) { q995 = i; break; } }
          T = Math.max(150, q995 - 25);
          for (i = 0; i < N; i++) m[i] = mn[i] > T && sat[i] < 60 ? 1 : 0;
        }
        var comps = [], cur = 0;
        for (i = 0; i < N; i++) {
          if (!m[i] || lab[i]) continue;
          cur++; var sp = 0, cnt = 0, x0 = w, y0 = h, x1 = -1, y1 = -1; st[sp++] = i; lab[i] = cur;
          while (sp) {
            var p = st[--sp], x = p % w, y = (p / w) | 0; cnt++;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = cur; st[sp++] = p - 1; }
            if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = cur; st[sp++] = p + 1; }
            if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = cur; st[sp++] = p - w; }
            if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = cur; st[sp++] = p + w; }
          }
          var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
          if (bh < hmin || bh > hmax || bw > Math.max(hmax * 1.4, 1.2 * bh) || cnt < 0.12 * bw * bh) continue;
          comps.push({ x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1, id: cur });
        }
        comps.sort(function (p2, q2) { return p2.x0 - q2.x0; });
        var n = comps.length, par = new Int32Array(n), j;
        for (i = 0; i < n; i++) par[i] = i;
        var root = function (k2) { while (par[k2] !== k2) { par[k2] = par[par[k2]]; k2 = par[k2]; } return k2; };
        for (i = 0; i < n; i++) {
          var A = comps[i], ha = A.y1 - A.y0;
          for (j = i + 1; j < n; j++) {
            var B = comps[j], hb = B.y1 - B.y0, mxh = Math.max(ha, hb), mnh = Math.min(ha, hb);
            if (B.x0 - A.x1 > 1.2 * mxh) { if (B.x0 > A.x1 + 2.5 * hmax) break; continue; }
            if (mxh > 1.8 * mnh) continue;
            var ov = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
            if (ov < 0.5 * mnh) continue;
            if (B.x0 - A.x1 < -0.5 * mnh && ov < 0.8 * mnh) continue;
            par[root(i)] = root(j);
          }
        }
        var groups = {};
        for (i = 0; i < n; i++) { var g = root(i); (groups[g] = groups[g] || []).push(comps[i]); }
        Object.keys(groups).forEach(function (g) {
          var C = groups[g];
          if (C.length < 3) return;
          var lx0 = w, ly0 = h, lx1 = 0, ly1 = 0, ids = {};
          C.forEach(function (c) { lx0 = Math.min(lx0, c.x0); ly0 = Math.min(ly0, c.y0); lx1 = Math.max(lx1, c.x1); ly1 = Math.max(ly1, c.y1); ids[c.id] = 1; });
          if (lx1 - lx0 < 1.5 * (ly1 - ly0)) return;
          // déjà trouvée à l'autre échelle ?
          for (var q3 = 0; q3 < out.length; q3++) {
            var o3 = out[q3], iw = Math.min(o3.x1, lx1) - Math.max(o3.x0, lx0), ih = Math.min(o3.y1, ly1) - Math.max(o3.y0, ly0);
            if (iw > 0 && ih > 0 && iw * ih > 0.85 * Math.max((o3.x1 - o3.x0) * (o3.y1 - o3.y0), (lx1 - lx0) * (ly1 - ly0))) return;
          }
          var bwl = lx1 - lx0, bhl = ly1 - ly0, bits = new Uint8Array(bwl * bhl);
          for (var yy = 0; yy < bhl; yy++) for (var xx = 0; xx < bwl; xx++) if (ids[lab[(ly0 + yy) * w + lx0 + xx]]) bits[yy * bwl + xx] = 1;
          out.push({ x0: lx0, y0: ly0, x1: lx1, y1: ly1, n: C.length, bits: bits });
        });
      });
      out.sort(function (p2, q2) { return q2.n - p2.n; });
      return out.slice(0, 110);
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
      var uc = w / 2, vc = h / 2;
      // échantillons pour le raffinement : bords terre/eau (tous) + intérieur (sous-échantillonné)
      var ns = 0, SU, SV, SL, SW;
      function buildSamples() {
        var edge = [], inner = [], ii, jj;
        for (jj = 0; jj < h; jj++) for (ii = 0; ii < w; ii++) {
          var lv2 = lab[jj * w + ii]; if (!lv2) continue;
          var isE = false;
          for (var dy2 = -2; dy2 <= 2 && !isE; dy2++) { var y2 = jj + dy2; if (y2 < 0 || y2 >= h) continue;
            for (var dx2 = -2; dx2 <= 2; dx2++) { var x2 = ii + dx2; if (x2 < 0 || x2 >= w) continue; if (lab[y2 * w + x2] === -lv2) { isE = true; break; } } }
          (isE ? edge : inner).push(jj * w + ii);
        }
        var smp = [], stE = Math.max(1, Math.ceil(edge.length / 9000)), stI = Math.max(1, Math.ceil(inner.length / 4000));
        for (ii = 0; ii < edge.length; ii += stE) smp.push(edge[ii]);
        for (ii = 0; ii < inner.length; ii += stI) smp.push(inner[ii]);
        ns = smp.length; SU = new Float64Array(ns); SV = new Float64Array(ns); SL = new Float64Array(ns); SW = new Float64Array(ns);
        var nE = Math.ceil(edge.length / stE);
        for (ii = 0; ii < ns; ii++) { var pp = smp[ii]; SU[ii] = (pp % w) + 0.5 - uc; SV[ii] = ((pp / w) | 0) + 0.5 - vc; SL[ii] = lab[pp]; SW[ii] = ii < nE ? stE : stI; }
      }
      // calage déjà connu (lecture des noms) : simple raffinement local, dans une fenêtre (échelle ± ds, translation ± dt unités)
      if (inp.win) {
        buildSamples();
        var Wn = inp.win, T0 = { X: Wn.a * uc + Wn.b * vc + Wn.c, Y: Wn.d * uc + Wn.e * vc + Wn.f, a: Wn.a, b: Wn.b, d: Wn.d, e: Wn.e };
        var s0w = Math.sqrt(Math.abs(Wn.a * Wn.e - Wn.b * Wn.d)), dt = Wn.dt || 300, lds = Math.log(1 + (Wn.ds || 0.15));
        // les noms lus restent une contrainte : s'éloigner de leurs positions (en écarts types) est pénalisé
        var PT = Wn.pts || [], pen = function (T) {
          var sw = 0, sq = 0;
          PT.forEach(function (p) { var du = p.u - uc, dv = p.v - vc, ex = T.X + T.a * du + T.b * dv - p.x, ey = T.Y + T.d * du + T.e * dv - p.y; sq += p.w * (ex * ex + ey * ey) / (p.sig * p.sig); sw += p.w; });
          return sw ? 0.03 * sq / sw : 0;
        };
        var M0 = model(T0, 0), sc0 = score(T0, M0), bestW = { T: T0, sc: sc0, ob: sc0 - pen(T0) };
        var inWin = function (T) { var sT = Math.sqrt(Math.abs(T.a * T.e - T.b * T.d)); return Math.abs(T.X - T0.X) <= dt && Math.abs(T.Y - T0.Y) <= dt && Math.abs(Math.log(sT / s0w)) <= lds; };
        var starts = [[0, 0, 0], [-0.5, 0, 0], [0.5, 0, 0], [0, -0.5, 0], [0, 0.5, 0], [0, 0, -0.5], [0, 0, 0.5], [-0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, -0.5, 0], [-0.5, 0.5, 0]];
        [3, 1].forEach(function (rb, pass) {
          var Mo = model(T0, rb), cand = [];
          (pass ? [bestW.T] : starts.map(function (q) { return simT(T0.X + q[0] * dt, T0.Y + q[1] * dt, s0w * Math.exp(q[2] * lds), 0); })).forEach(function (Ts) {
            var sS = Math.sqrt(Math.abs(Ts.a * Ts.e - Ts.b * Ts.d)), U = sS * Math.max(w, h);
            var res = nelder(function (p) {
              var T = simT(Ts.X + p[0] * U, Ts.Y + p[1] * U, sS * Math.exp(p[2]), p[3]);
              if (Math.abs(p[3]) > 0.03 || !inWin(T)) return 2;
              return pen(T) - score(T, Mo);
            }, [0, 0, 0, 0], pass ? [0.004, 0.004, 0.005, 0.004] : [0.015, 0.015, 0.02, 0.006], pass ? 120 : 60);
            cand.push(simT(Ts.X + res.x[0] * U, Ts.Y + res.x[1] * U, sS * Math.exp(res.x[2]), res.x[3]));
          });
          cand.forEach(function (T) { if (!inWin(T)) return; var sc = score(T, M0), ob = sc - pen(T); if (ob > bestW.ob) bestW = { T: T, sc: sc, ob: ob }; });
          progress(0.4 + 0.6 * (pass + 1) / 2);
        });
        var Tb = bestW.T;
        return { ok: true, win: true, rect: rect, w: w, h: h, score: bestW.sc, seedScore: sc0, gain: bestW.ob - (sc0 - pen(T0)), kind: 'sim', info: info, ms: Date.now() - t0,
          tf: { a: Tb.a, b: Tb.b, c: Tb.X - Tb.a * uc - Tb.b * vc, d: Tb.d, e: Tb.e, f: Tb.Y - Tb.d * uc - Tb.e * vc } };
      }

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
      var center = function (c) { return [c.c + c.s * uc, c.f - c.s * vc]; };
      var same = function (a, b) {
        var ca = center(a), cb = center(b), sz = Math.min(a.s, b.s) * Math.max(w, h);
        return Math.abs(Math.log(a.s / b.s)) < 0.22 && Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) < 0.2 * sz;
      };
      var pick = [];
      if (inp.seed) pick.push({ ncc: 0, s: inp.seed.s, c: inp.seed.X - inp.seed.s * uc, f: inp.seed.Y + inp.seed.s * vc });
      cands.forEach(function (c) { if (pick.length < 7 && !pick.some(function (p) { return same(p, c); })) pick.push(c); });

      if (inp.seedTf) { var sT = inp.seedTf, ss = Math.sqrt(Math.abs(sT.a * sT.e - sT.b * sT.d)); pick.unshift({ ncc: 0, s: ss, c: sT.c, f: sT.f, seed: 1 }); }
      buildSamples();

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
      function simT(X, Y, s3, th) { var co = Math.cos(th), sn2 = Math.sin(th); return { X: X, Y: Y, a: s3 * co, b: s3 * sn2, d: s3 * sn2, e: -s3 * co }; }
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

    /* -- Calage « par voisinage » : la nouvelle capture est recalée sur une capture déjà calée qui la chevauche.
       Images comparées : module du gradient (indépendant des couleurs), pyramides. Recherche grossière multi-échelle par
       corrélation de phase (FFT, les deux images dans une seule FFT complexe), vérification par corrélation normalisée (NCC),
       puis raffinement Nelder-Mead (position + échelle, nord en haut) de plus en plus fin. -- */
    function nbGrad(px, w, h, band) {
      var N = w * h, Lm = new Float32Array(N), G = new Float32Array(N), i, j;
      for (i = 0; i < N; i++) Lm[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
      Lm = boxBlur(Lm, w, h, 1, 1);
      for (j = 1; j < h - 1; j++) for (i = 1; i < w - 1; i++) {
        var o = j * w + i;
        var gx = (Lm[o - w + 1] + 2 * Lm[o + 1] + Lm[o + w + 1]) - (Lm[o - w - 1] + 2 * Lm[o - 1] + Lm[o + w - 1]);
        var gy = (Lm[o + w - 1] + 2 * Lm[o + w] + Lm[o + w + 1]) - (Lm[o - w - 1] + 2 * Lm[o - w] + Lm[o - w + 1]);
        G[o] = Math.sqrt(Math.sqrt(gx * gx + gy * gy)); // racine du contraste : les textes très contrastés ne dominent pas
      }
      var b = band || [0, 1], I = { w: w, h: h, u0: 2, u1: w - 2, v0: Math.max(2, Math.round(b[0] * h)), v1: Math.min(h - 2, Math.round(b[1] * h)) };
      I.uc = (I.u0 + I.u1) / 2; I.vc = (I.v0 + I.v1) / 2; I.ww = I.u1 - I.u0; I.hh = I.v1 - I.v0;
      var P = [{ g: G, w: w, h: h }], c = P[0];
      while (Math.max(c.w, c.h) > 24 && Math.min(c.w, c.h) > 8) {
        var w2 = c.w >> 1, h2 = c.h >> 1, g2 = new Float32Array(w2 * h2);
        for (j = 0; j < h2; j++) for (i = 0; i < w2; i++) { var q = 2 * j * c.w + 2 * i; g2[j * w2 + i] = 0.25 * (c.g[q] + c.g[q + 1] + c.g[q + c.w] + c.g[q + c.w + 1]); }
        c = { g: g2, w: w2, h: h2 }; P.push(c);
      }
      I.P = P;
      return I;
    }
    function nbLev(I, rho, s) { return Math.max(0, Math.min(I.P.length - 1, Math.floor(Math.log(rho / s) / Math.LN2 + 0.15))); }
    // valeur du gradient au point (u, v) (pixels de l'image d'origine) dans le niveau l de la pyramide
    function nbAt(I, l, u, v) {
      var Lv = I.P[l], k = 1 << l, U = (u + 0.5) / k - 0.5, V = (v + 0.5) / k - 0.5;
      var x0 = Math.floor(U), y0 = Math.floor(V);
      if (x0 < 0) x0 = 0; else if (x0 > Lv.w - 2) x0 = Lv.w - 2;
      if (y0 < 0) y0 = 0; else if (y0 > Lv.h - 2) y0 = Lv.h - 2;
      var fx = Math.max(0, Math.min(1, U - x0)), fy = Math.max(0, Math.min(1, V - y0)), g = Lv.g, o = y0 * Lv.w + x0;
      return (g[o] * (1 - fx) + g[o + 1] * fx) * (1 - fy) + (g[o + Lv.w] * (1 - fx) + g[o + Lv.w + 1] * fx) * fy;
    }
    function nbIn(I, u, v) { return u >= I.u0 && u <= I.u1 && v >= I.v0 && v <= I.v1; }
    function nbTaper(I, u, v) {
      var m = 0.07 * Math.min(I.ww, I.hh);
      return Math.min(1, (u - I.u0) / m, (I.u1 - u) / m) * Math.min(1, (v - I.v0) / m, (I.v1 - v) / m);
    }
    function nbPrepB(B) { // capture déjà calée : transformation inverse, emprise monde
      var t = B.tf, det = t.a * t.e - t.b * t.d;
      B.inv = { a: t.e / det, b: -t.b / det, d: -t.d / det, e: t.a / det };
      B.s = Math.sqrt(Math.abs(det));
      var xs = [], ys = [];
      [[B.u0, B.v0], [B.u1, B.v0], [B.u0, B.v1], [B.u1, B.v1]].forEach(function (p) { xs.push(t.a * p[0] + t.b * p[1] + t.c); ys.push(t.d * p[0] + t.e * p[1] + t.f); });
      B.bx = [Math.min.apply(null, xs), Math.max.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, ys)];
      B.cx = (B.bx[0] + B.bx[1]) / 2; B.cy = (B.bx[2] + B.bx[3]) / 2; B.E = Math.max(B.bx[1] - B.bx[0], B.bx[3] - B.bx[2]);
      return B;
    }
    function nbToB(B, x, y) { var i = B.inv, X2 = x - B.tf.c, Y2 = y - B.tf.f; return [i.a * X2 + i.b * Y2, i.d * X2 + i.e * Y2]; }
    // recherche grossière à l'échelle s (unités monde par pixel de A) : corrélation de phase sur une toile NC x NC
    function nbCoarseAt(A, B, s, NC, out) {
      var Ea = s * Math.max(A.ww, A.hh), E = Math.max(Ea, B.E) + 0.6 * Math.min(Ea, B.E), r = E / NC, N2 = NC * NC, i, j, k;
      var la = nbLev(A, r, s), lb = nbLev(B, r, B.s);
      var va = new Float32Array(N2), vb = new Float32Array(N2), ma = new Uint8Array(N2), mb = new Uint8Array(N2), ta = new Float32Array(N2), tb = new Float32Array(N2);
      var sa = 0, na = 0, sb = 0, nb = 0;
      for (j = 0; j < NC; j++) for (i = 0; i < NC; i++) {
        k = j * NC + i;
        var du = (i + 0.5 - NC / 2) * r, dv = (j + 0.5 - NC / 2) * r;
        var u = A.uc + du / s, v = A.vc + dv / s;
        if (nbIn(A, u, v)) { va[k] = nbAt(A, la, u, v); ma[k] = 1; ta[k] = nbTaper(A, u, v); sa += va[k]; na++; }
        var q = nbToB(B, B.cx + du, B.cy - dv);
        if (nbIn(B, q[0], q[1])) { vb[k] = nbAt(B, lb, q[0], q[1]); mb[k] = 1; tb[k] = nbTaper(B, q[0], q[1]); sb += vb[k]; nb++; }
      }
      if (na < 50 || nb < 50) return;
      sa /= na; sb /= nb;
      var re = new Float64Array(N2), im = new Float64Array(N2);
      for (k = 0; k < N2; k++) { if (mb[k]) re[k] = (vb[k] - sb) * tb[k]; if (ma[k]) im[k] = (va[k] - sa) * ta[k]; }
      fft2(re, im, NC, NC, false);
      var cr = new Float64Array(N2), ci = new Float64Array(N2), mx = 0;
      for (j = 0; j < NC; j++) for (i = 0; i < NC; i++) {
        k = j * NC + i; var kn = ((NC - j) % NC) * NC + ((NC - i) % NC);
        var Zr = re[k], Zi = im[k], Wr = re[kn], Wi = im[kn];
        var Nr = (Zr + Wr) / 2, Ni = (Zi - Wi) / 2, Ar = (Zi + Wi) / 2, Ai = -(Zr - Wr) / 2;
        var Rr = Nr * Ar + Ni * Ai, Ri = Ni * Ar - Nr * Ai, m = Math.sqrt(Rr * Rr + Ri * Ri);
        cr[k] = Rr; ci[k] = Ri; if (m > mx) mx = m;
      }
      var eps = 1e-3 * mx + 1e-12;
      for (k = 0; k < N2; k++) { var m2 = Math.sqrt(cr[k] * cr[k] + ci[k] * ci[k]) + eps; cr[k] /= m2; ci[k] /= m2; }
      fft2(cr, ci, NC, NC, true);
      // pics (maxima locaux, les 3 plus hauts)
      var pk = [];
      for (j = 0; j < NC; j++) for (i = 0; i < NC; i++) {
        k = j * NC + i; var c0 = cr[k], isMax = true;
        if (pk.length >= 3 && c0 <= pk[pk.length - 1].c) continue;
        for (var dy = -2; dy <= 2 && isMax; dy++) for (var dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          if (cr[((j + dy + NC) % NC) * NC + ((i + dx + NC) % NC)] > c0) { isMax = false; break; }
        }
        if (!isMax) continue;
        pk.push({ c: c0, i: i, j: j }); pk.sort(function (p, q2) { return q2.c - p.c; }); if (pk.length > 3) pk.pop();
      }
      var sum = 0; for (k = 0; k < N2; k++) sum += Math.abs(cr[k]);
      var lvl = sum / N2;
      pk.forEach(function (p) {
        var dx2 = p.i > NC / 2 ? p.i - NC : p.i, dy2 = p.j > NC / 2 ? p.j - NC : p.j;
        // NCC directe (valeurs brutes) sur le recouvrement
        var n = 0, s1 = 0, s2 = 0, s11 = 0, s22 = 0, s12 = 0;
        for (var y = 0; y < NC; y++) {
          var yb = y + dy2; if (yb < 0 || yb >= NC) continue;
          for (var x = 0; x < NC; x++) {
            var xb = x + dx2; if (xb < 0 || xb >= NC) continue;
            var ka = y * NC + x, kb = yb * NC + xb;
            if (!ma[ka] || !mb[kb]) continue;
            var a1 = va[ka], b1 = vb[kb];
            n++; s1 += a1; s2 += b1; s11 += a1 * a1; s22 += b1 * b1; s12 += a1 * b1;
          }
        }
        if (n < 0.2 * Math.min(na, nb) || n < 40) return;
        var cov = s12 - s1 * s2 / n, d1 = s11 - s1 * s1 / n, d2 = s22 - s2 * s2 / n;
        var ncc = d1 > 0 && d2 > 0 ? cov / Math.sqrt(d1 * d2) : 0;
        out.push({ s: s, X: B.cx + dx2 * r, Y: B.cy - dy2 * r, r: r, ncc: ncc, pc: p.c / (lvl || 1), ov: n / Math.min(na, nb) });
      });
    }
    // échantillons de A pour la résolution rho (unités monde) ; NCC entre A et B pour la transformation T = { X, Y, s }
    function nbSamples(A, rho, s, maxN) {
      var la = nbLev(A, rho, s), st = Math.max(1, rho / s), n = (A.ww / st) * (A.hh / st);
      if (n > maxN) st *= Math.sqrt(n / maxN);
      var U = [], V = [], G = [];
      for (var v = A.v0 + st / 2; v < A.v1; v += st) for (var u = A.u0 + st / 2; u < A.u1; u += st) { U.push(u - A.uc); V.push(v - A.vc); G.push(nbAt(A, la, u, v)); }
      return { u: Float64Array.from(U), v: Float64Array.from(V), g: Float64Array.from(G), n: U.length, rho: rho };
    }
    function nbNcc(S, B, T) {
      var lb = nbLev(B, S.rho, B.s), n = 0, s1 = 0, s2 = 0, s11 = 0, s22 = 0, s12 = 0, t = B.tf, iv = B.inv;
      for (var k = 0; k < S.n; k++) {
        var x = T.X + T.s * S.u[k] - t.c, y = T.Y - T.s * S.v[k] - t.f;
        var u = iv.a * x + iv.b * y, v = iv.d * x + iv.e * y;
        if (!nbIn(B, u, v)) continue;
        var a1 = S.g[k], b1 = nbAt(B, lb, u, v);
        n++; s1 += a1; s2 += b1; s11 += a1 * a1; s22 += b1 * b1; s12 += a1 * b1;
      }
      if (n < 30) return { ncc: -1, cov: 0 };
      var cov = s12 - s1 * s2 / n, d1 = s11 - s1 * s1 / n, d2 = s22 - s2 * s2 / n;
      return { ncc: d1 > 0 && d2 > 0 ? cov / Math.sqrt(d1 * d2) : 0, cov: n / S.n };
    }
    function nbRefine(A, B, c0) {
      var T = { X: c0.X, Y: c0.Y, s: c0.s }, rho = c0.r, fin = Math.max(T.s, B.s) * 1.2, last = null;
      for (var pass = 0; pass < 6; pass++) {
        var S = nbSamples(A, rho, T.s, 5000), T0 = T, U = 1.5 * rho;
        var f = function (p) {
          var Tt = { X: T0.X + p[0] * U, Y: T0.Y + p[1] * U, s: T0.s * Math.exp(p[2] * 0.03) };
          var q = nbNcc(S, B, Tt);
          return q.cov < 0.12 ? 1 : -q.ncc;
        };
        var res = nelder(f, [0, 0, 0], [0.6, 0.6, 0.6], 70);
        T = { X: T0.X + res.x[0] * U, Y: T0.Y + res.x[1] * U, s: T0.s * Math.exp(res.x[2] * 0.03) };
        last = rho;
        if (rho <= fin) break;
        rho = Math.max(fin, rho / 2);
      }
      // score final comparable d'une capture à l'autre : à 2 fois la résolution la plus grossière des deux images
      var Sf = nbSamples(A, Math.max(T.s, B.s) * 2, T.s, 6000), q = nbNcc(Sf, B, T);
      return { X: T.X, Y: T.Y, s: T.s, ncc: q.ncc, cov: q.cov, coarse: c0.ncc, rho: last };
    }
    /* job : { a: { px, w, h, band }, nbs: [{ id, px, w, h, band, tf (pixels de nb -> monde) }], sMin, sMax (unités monde par pixel de a) } */
    function nbMatch(job, progress) {
      var t0 = Date.now(), A = nbGrad(job.a.px, job.a.w, job.a.h, job.a.band), NC = job.nc || 256, all = [];
      var Bs = job.nbs.map(function (n) { var B = nbGrad(n.px, n.w, n.h, n.band); B.tf = n.tf; B.id = n.id; return nbPrepB(B); });
      var total = 0, done = 0, step = Math.log(1.06);
      var plans = Bs.map(function (B) {
        var lo = Math.log(Math.max(job.sMin || 0, B.E / 4 / Math.max(A.ww, A.hh))), hi = Math.log(Math.min(job.sMax || 1e9, B.E * 4 / Math.max(A.ww, A.hh)));
        var L2 = []; for (var x = lo; x <= hi + 1e-9; x += step) L2.push(Math.exp(x));
        total += L2.length; return L2;
      });
      Bs.forEach(function (B, bi) {
        var out = [];
        plans[bi].forEach(function (s) { nbCoarseAt(A, B, s, NC, out); done++; if (progress && done % 4 === 0) progress(0.7 * done / Math.max(1, total)); });
        out.sort(function (p, q) { return q.ncc - p.ncc; });
        // candidats distincts (position / échelle)
        var pick = [];
        out.forEach(function (c) {
          if (pick.length >= 4) return;
          var far = pick.every(function (p) { return Math.abs(Math.log(c.s / p.s)) > 0.12 || Math.hypot(c.X - p.X, c.Y - p.Y) > 0.1 * c.s * Math.max(A.ww, A.hh); });
          if (far) pick.push(c);
        });
        pick.forEach(function (c) { var R = nbRefine(A, B, c); R.id = B.id; R.bi = bi; all.push(R); });
      });
      if (progress) progress(0.98);
      all.sort(function (p, q) { return q.ncc - p.ncc; });
      var best = all[0];
      if (!best) return { ok: false, ms: Date.now() - t0, cands: [] };
      var second = -1;
      all.forEach(function (c) {
        if (c === best) return;
        var far = Math.abs(Math.log(c.s / best.s)) > 0.1 || Math.hypot(c.X - best.X, c.Y - best.Y) > 0.08 * best.s * Math.max(A.ww, A.hh);
        if (far) second = Math.max(second, c.ncc);
      });
      var T = best;
      return { ok: true, ms: Date.now() - t0, id: best.id, ncc: best.ncc, margin: best.ncc - second, cov: best.cov, s: best.s, aw: A.w, ah: A.h,
        tf: { a: T.s, b: 0, c: T.X - T.s * A.uc, d: 0, e: -T.s, f: T.Y + T.s * A.vc },
        cands: all.map(function (c) { return { id: c.id, ncc: +c.ncc.toFixed(3), coarse: +c.coarse.toFixed(3), x: Math.round(c.X), y: Math.round(c.Y), s: +c.s.toFixed(3), cov: +c.cov.toFixed(2) }; }) };
    }


    /* -- Icônes du jeu sur une capture / photo (pastilles claires ou colorées de taille fixe à l'écran) et appariement
       de leur constellation avec les marqueurs « visibles en jeu » autour du point (vote de Hough sur l'échelle et la
       position, nord en haut, puis moindres carrés). -- */
    function icSat(M, w, h) { // tableau cumulé (somme) d'un masque 0/1
      var S = new Int32Array((w + 1) * (h + 1));
      for (var j = 0; j < h; j++) { var row = 0; for (var i = 0; i < w; i++) { row += M[j * w + i]; S[(j + 1) * (w + 1) + i + 1] = S[j * (w + 1) + i + 1] + row; } }
      return S;
    }
    function icMorph(M, w, h, r, erode) {
      var S = icSat(M, w, h), out = new Uint8Array(w * h), W1 = w + 1;
      for (var j = 0; j < h; j++) {
        var y0 = Math.max(0, j - r), y1 = Math.min(h, j + r + 1);
        for (var i = 0; i < w; i++) {
          var x0 = Math.max(0, i - r), x1 = Math.min(w, i + r + 1);
          var s = S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
          out[j * w + i] = erode ? (s === (x1 - x0) * (y1 - y0) ? 1 : 0) : (s > 0 ? 1 : 0);
        }
      }
      return out;
    }
    // pastilles : (1) pictogramme sombre entouré de blanc (icônes blanches) ; (2) pastille colorée non bleue (icônes vertes, roses…)
    function icDetect(px, w, h, S, band) {
      var N = w * h, Lm = new Float32Array(N), Dk = new Uint8Array(N), Cl = new Uint8Array(N), Br = new Uint8Array(N), i, j, k;
      var v0 = Math.round((band ? band[0] : 0) * h), v1 = Math.round((band ? band[1] : 1) * h);
      for (k = 0; k < N; k++) {
        var r = px[4 * k], g = px[4 * k + 1], b = px[4 * k + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
        var L0 = 0.299 * r + 0.587 * g + 0.114 * b, blue = b >= r && b >= g; Lm[k] = L0;
        j = (k / w) | 0; if (j < v0 || j >= v1) continue;
        if (L0 < 105 && !(blue && sat > 0.3)) Dk[k] = 1;
        if (L0 > 185 && sat < 0.3) Br[k] = 1;
        if (sat > 0.42 && mx > 110 && !blue) Cl[k] = 1;
      }
      var out = [], lab = new Int32Array(N), st = [];
      var comps = function (M, fn) {
        lab.fill(0);
        for (var p = 0; p < N; p++) {
          if (!M[p] || lab[p]) continue;
          lab[p] = 1; st.length = 0; st.push(p);
          var area = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
          while (st.length) {
            var q = st.pop(), qx = q % w, qy = (q / w) | 0;
            area++; sx += qx; sy += qy; if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
            if (qx > 0 && M[q - 1] && !lab[q - 1]) { lab[q - 1] = 1; st.push(q - 1); }
            if (qx < w - 1 && M[q + 1] && !lab[q + 1]) { lab[q + 1] = 1; st.push(q + 1); }
            if (qy > 0 && M[q - w] && !lab[q - w]) { lab[q - w] = 1; st.push(q - w); }
            if (qy < h - 1 && M[q + w] && !lab[q + w]) { lab[q + w] = 1; st.push(q + w); }
          }
          fn({ area: area, cx: sx / area + 0.5, cy: sy / area + 0.5, x0: x0, x1: x1, y0: y0, y1: y1, bw: x1 - x0 + 1, bh: y1 - y0 + 1 });
        }
      };
      // (1) pictogramme sombre : petit, et entouré d'un anneau surtout clair
      comps(Dk, function (c) {
        if (c.bw > 0.85 * S || c.bh > 0.85 * S || Math.max(c.bw, c.bh) < 0.18 * S || c.area < 4) return;
        var m = Math.max(2, Math.round(0.22 * S)), X0 = Math.max(0, c.x0 - m), X1 = Math.min(w - 1, c.x1 + m), Y0 = Math.max(0, c.y0 - m), Y1 = Math.min(h - 1, c.y1 + m);
        var n = 0, nb = 0, nd = 0;
        for (var y = Y0; y <= Y1; y++) for (var x = X0; x <= X1; x++) {
          if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1) continue;
          n++; if (Br[y * w + x]) nb++; if (Dk[y * w + x]) nd++;
        }
        if (n && nb / n > 0.55 && nd / n < 0.12) out.push({ u: (c.x0 + c.x1 + 1) / 2, v: (c.y0 + c.y1 + 1) / 2, a: c.area, t: 1 });
      });
      // (2) pastille colorée (fermeture pour remplir le pictogramme clair)
      var rc = Math.max(1, Math.round(S * 0.25));
      Cl = icMorph(icMorph(Cl, w, h, rc, false), w, h, rc, true);
      comps(Cl, function (c) {
        if (c.area < 0.25 * S * S || c.area > 2.4 * S * S || c.bw < 0.5 * S || c.bh < 0.5 * S || c.bw > 1.7 * S || c.bh > 1.9 * S) return;
        if (Math.max(c.bw, c.bh) / Math.min(c.bw, c.bh) > 1.8 || c.area / (c.bw * c.bh) < 0.45) return;
        if (!out.some(function (o) { return Math.abs(o.u - c.cx) < 0.6 * S && Math.abs(o.v - c.cy) < 0.6 * S; })) out.push({ u: c.cx, v: c.cy, a: c.area, t: 2 });
      });
      return out;
    }
    // job : { px, w, h, band, S (taille d'une icône en px), K: [x, y, …] (icônes du jeu, monde), sMin, sMax, near: { x, y } }
    function icMatch(job) {
      var t0 = Date.now(), D = icDetect(job.px, job.w, job.h, job.S, job.band), K = job.K, nk = K.length >> 1, w = job.w, h = job.h;
      var res = { ok: false, dets: D.map(function (d) { return [Math.round(d.u * 10) / 10, Math.round(d.v * 10) / 10]; }), nk: nk, ms: 0 };
      if (D.length < 3 || nk < 3) { res.ms = Date.now() - t0; return res; }
      var near = job.near, cands = [];
      for (var ls = Math.log(job.sMin); ls <= Math.log(job.sMax) + 1e-9; ls += Math.log(1.035)) {
        var s = Math.exp(ls), bin = Math.max(12, 0.7 * job.S * s), acc = {}, best = 0, bk = null;
        for (var a = 0; a < D.length; a++) {
          var du = s * D[a].u, dv = s * D[a].v;
          for (var b = 0; b < nk; b++) {
            var ox = K[2 * b] - du, oy = K[2 * b + 1] + dv;
            // le point cherché doit tomber dans l'image
            var pu = (near.x - ox) / s, pv = (oy - near.y) / s;
            if (pu < 0 || pu > w || pv < 0 || pv > h) continue;
            var kx = Math.floor(ox / bin), ky = Math.floor(oy / bin);
            for (var ddx = 0; ddx <= 1; ddx++) for (var ddy = 0; ddy <= 1; ddy++) {
              var key = (kx - ddx) + ',' + (ky - ddy), v = (acc[key] || 0) + 1; acc[key] = v;
              if (v > best) { best = v; bk = [(kx - ddx + 1) * bin, (ky - ddy + 1) * bin]; }
            }
          }
        }
        if (best >= 3) cands.push({ s: s, ox: bk[0], oy: bk[1], votes: best });
      }
      cands.sort(function (p, q) { return q.votes - p.votes; });
      var fits = [];
      cands.slice(0, 12).forEach(function (c) {
        var T = { s: c.s, ox: c.ox, oy: c.oy }, inl = [];
        for (var it = 0; it < 4; it++) {
          var tol = Math.max(15, 0.6 * job.S * T.s);
          inl = []; var used = {};
          D.forEach(function (d, di) {
            var x = T.ox + T.s * d.u, y = T.oy - T.s * d.v, bd = tol, bj = -1;
            for (var b2 = 0; b2 < nk; b2++) { var e = Math.hypot(K[2 * b2] - x, K[2 * b2 + 1] - y); if (e < bd) { bd = e; bj = b2; } }
            if (bj >= 0 && !used[bj]) { used[bj] = 1; inl.push({ di: di, k: bj, e: bd }); }
          });
          if (inl.length < 3) break;
          // moindres carrés : x = s u + ox ; y = -s v + oy
          var mu = 0, mv = 0, mx = 0, my = 0, n = inl.length;
          inl.forEach(function (q) { mu += D[q.di].u; mv += D[q.di].v; mx += K[2 * q.k]; my += K[2 * q.k + 1]; });
          mu /= n; mv /= n; mx /= n; my /= n;
          var num = 0, den = 0;
          inl.forEach(function (q) { var du2 = D[q.di].u - mu, dv2 = D[q.di].v - mv; num += du2 * (K[2 * q.k] - mx) - dv2 * (K[2 * q.k + 1] - my); den += du2 * du2 + dv2 * dv2; });
          if (!(den > 0) || !(num > 0)) break;
          var s2 = num / den; if (s2 < job.sMin * 0.8 || s2 > job.sMax * 1.25) break;
          T = { s: s2, ox: mx - s2 * mu, oy: my + s2 * mv };
        }
        if (inl.length < 3) return;
        var rs = 0; inl.forEach(function (q) { var x = T.ox + T.s * D[q.di].u, y = T.oy - T.s * D[q.di].v; rs += Math.pow(Math.hypot(K[2 * q.k] - x, K[2 * q.k + 1] - y), 2); });
        // nombre d'appariements dus au hasard : densité des icônes dans l'emprise de l'image x surface de tolérance x détections
        var X0 = T.ox, X1 = T.ox + T.s * w, Y0 = T.oy - T.s * h, Y1 = T.oy, kin = 0;
        for (var b3 = 0; b3 < nk; b3++) if (K[2 * b3] >= X0 && K[2 * b3] <= X1 && K[2 * b3 + 1] >= Y0 && K[2 * b3 + 1] <= Y1) kin++;
        var tol2 = Math.max(15, 0.6 * job.S * T.s), lam = D.length * kin * Math.PI * tol2 * tol2 / ((X1 - X0) * (Y1 - Y0));
        fits.push({ T: T, n: inl.length, rms: Math.sqrt(rs / inl.length), lam: lam, kin: kin, inl: inl });
      });
      if (!fits.length) { res.ms = Date.now() - t0; return res; }
      var zsc = function (f) { return (f.n - f.lam) / Math.sqrt(f.lam + 1); };
      fits.sort(function (p, q) { return zsc(q) - zsc(p); });
      var B = fits[0], second = 0, n2 = 0;
      // autre solution = qui placerait le point cherché ailleurs sur la photo (à plus d'une icône et demie)
      var ptOf = function (T) { return [(near.x - T.ox) / T.s, (T.oy - near.y) / T.s]; }, pB = ptOf(B.T);
      fits.forEach(function (f) { var q = ptOf(f.T); if (f !== B && Math.hypot(q[0] - pB[0], q[1] - pB[1]) > 1.5 * job.S) { second = Math.max(second, zsc(f)); n2 = Math.max(n2, f.n); } });
      res.ok = true; res.n = B.n; res.lam = B.lam; res.z = zsc(B); res.z2 = second; res.n2 = n2; res.rms = B.rms; res.kin = B.kin; res.s = B.T.s;
      res.tf = { a: B.T.s, b: 0, c: B.T.ox, d: 0, e: -B.T.s, f: B.T.oy };
      res.pairs = B.inl.map(function (q) { return [Math.round(D[q.di].u), Math.round(D[q.di].v), K[2 * q.k], K[2 * q.k + 1]]; });
      res.ms = Date.now() - t0;
      return res;
    }

    return { run: run, detectScreen: detectScreen, screenGeom: screenGeom, warp: warp, prep: prep, textLines: textLines, nbMatch: nbMatch, icMatch: icMatch, icDetect: icDetect };
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
      ' if (d.op === "prep") { self.postMessage({ id: d.id, r: { rect: CORE.prep(d.px, d.w, d.h) } }); return; }' +
      ' if (d.op === "text") { self.postMessage({ id: d.id, r: { lines: CORE.textLines(d.px, d.w, d.h) } }); return; }' +
      ' if (d.op === "icons") { self.postMessage({ id: d.id, r: CORE.icMatch(d) }); return; }' +
      ' if (d.op === "nb") { self.postMessage({ id: d.id, r: CORE.nbMatch(d, function (p) { self.postMessage({ id: d.id, p: p }); }) }); return; }' +
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
          if (job.op === 'prep') { res({ rect: autoLocal.prep(job.px, job.w, job.h) }); return; }
          if (job.op === 'text') { res({ lines: autoLocal.textLines(job.px, job.w, job.h) }); return; }
          if (job.op === 'icons') { var ri = autoLocal.icMatch(job); ri.local = true; res(ri); return; }
          if (job.op === 'nb') { var rn = autoLocal.nbMatch(job, prog); rn.local = true; res(rn); return; }
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
  /* ---------- Lecture des noms de lieux (OCR hors ligne) ----------
     Tesseract.js (vendor/ocr/ : bibliothèque, moteur WebAssembly, modèles « fast » eng + fra), chargé seulement au premier
     calage automatique, pré-caché par le service worker. Rien n'est envoyé sur Internet. */
  var OCRDIR = 'vendor/ocr/';
  var OCR = { p: null, w: null, bad: false, idle: null, log: null };
  var OCR_UI = ['jason', 'lucia', 'carte', 'infos', 'progression', 'recentrer', 'vue', '2d', 'vue2d', 'ajouter', 'un', 'repere', 'definir', 'une',
    'destination', 'quitter', 'legende', 'filtres', 'missions', 'mission', 'allez', 'objectif', 'zoom'];
  // noms affichés par le jeu -> lieux de nos données (le premier trouvé donne la position)
  var OCR_ALIAS = [
    ['Starfish', ['Starfish Island']],
    ['Aéroport de Vice City', ['Vice City International Airport', 'Aéroport international de Vice City']],
    ['Aéroport international de Vice City', ['Vice City International Airport', 'Aéroport international de Vice City']],
    ['Centre-ville', ['Downtown']],
    ['Vice Dale County', ['Vice-Dale County']],
    ['Comté de Vice-Dale', ['Vice-Dale County']]
  ];
  var DICT = null;
  function ocrKey(s) { return X.norm(s).replace(/[^a-z0-9]+/g, ''); }
  function buildDict() {
    if (DICT) return DICT;
    // écart type de nos positions (unités monde) selon le genre de libellé : quartiers et lieux précis, régions / mers vagues
    var SIG = { district: 260, poi: 280, city: 650, region: 1200, water: 1200 };
    var pos = {}, lk = {};
    (X.labels || []).forEach(function (l) { lk[ocrKey(l.n)] = l.k; if (l.fr) lk[ocrKey(l.fr)] = l.k; });
    var put = function (n, x, y, k, rank, sg) {
      var key = ocrKey(n); if (key.length < 4 || !isFinite(x) || !isFinite(y)) return;
      var kk = lk[key] || k, o = pos[key];
      if (!o || o.rank > rank) pos[key] = { n: n, key: key, x: x, y: y, k: kk, sig: sg || SIG[kk] || 300, rank: rank };
    };
    // noms : ceux des libellés de la carte (+ alias) ; positions : villes et lieux célèbres relevés dans le jeu (gta6map)
    // quand le nom correspond, sinon nos libellés (estimés)
    var mk = {}, qd = {};
    X.markers.forEach(function (m) {
      if (m.src !== 'gta6map') return;
      if (m.c === 'city-town' || m.c === 'landmark') { var k = ocrKey(m.n); if (!mk[k] || m.c === 'city-town') mk[k] = m; }
      // lieux nommés « … – Quartier » ou « … (Quartier) » : leur centre (médiane) situe bien le quartier
      var q = /\(([^()]+)\)\s*$/.exec(m.n) || /\s[–-]\s*([^–-]+?)(\s+n°\s*\d+|\s+\d+)?\s*$/.exec(m.n);
      if (q) { var kq = ocrKey(q[1]); (qd[kq] = qd[kq] || []).push(m); }
    });
    var med = function (a) { a = a.slice().sort(function (p, q) { return p - q; }); return a[a.length >> 1]; };
    (X.labels || []).forEach(function (l) {
      // (les villes et lieux célèbres de gta6map ne sont pas placés comme les noms affichés par le jeu : on garde nos libellés)
      var x = l.x, y = l.y, rank = 1, sg = 0, Q = qd[ocrKey(l.n)];
      if (Q && Q.length >= 3 && l.k === 'district') {
        var mx = med(Q.map(function (o) { return o.x; })), my = med(Q.map(function (o) { return o.y; }));
        var sp = med(Q.map(function (o) { return Math.hypot(o.x - mx, o.y - my); }));
        if (sp <= 320) { x = mx; y = my; sg = Math.max(180, 120 + 0.6 * sp); }      // quartier compact : la médiane
        else { x = (mx + l.x) / 2; y = (my + l.y) / 2; sg = Math.max(320, 0.6 * sp); } // quartier étendu : entre les deux
        rank = 0.8;
      }
      put(l.n, x, y, l.k, rank, sg); if (l.fr) put(l.fr, x, y, l.k, rank, sg);
    });
    OCR_ALIAS.forEach(function (al) {
      for (var i = 0; i < al[1].length; i++) {
        var k = ocrKey(al[1][i]), o = pos[k] || (mk[k] && { x: mk[k].x, y: mk[k].y, k: 'poi', sig: SIG.poi });
        if (o) { var key = ocrKey(al[0]); pos[key] = { n: al[0], key: key, x: o.x, y: o.y, k: o.k, sig: o.sig, rank: 0.5 }; return; }
      }
    });
    DICT = Object.keys(pos).map(function (k) {
      var o = pos[k], ws = X.norm(o.n).split(/[^a-z0-9]+/).filter(Boolean);
      o.id = Math.round(o.x) + ',' + Math.round(o.y);
      if (ws.length > 1 && ws[0].length >= 6) o.w1 = ws[0];
      return o;
    });
    // premier mot propre à un seul lieu ?
    var cnt = {};
    DICT.forEach(function (o) { if (o.w1) cnt[o.w1] = (cnt[o.w1] || {}), cnt[o.w1][o.id] = 1; });
    DICT.forEach(function (o) { if (o.w1) o.w1u = Object.keys(cnt[o.w1]).length === 1 && !pos[o.w1]; });
    return DICT;
  }
  function lev(a, b, max) { // distance d'édition (arrêt dès qu'elle dépasse max)
    var la = a.length, lb = b.length, i, j;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev = [], cur = [];
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i; var mn = i;
      for (j = 1; j <= lb; j++) {
        var c = prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1);
        if (prev[j] + 1 < c) c = prev[j] + 1;
        if (cur[j - 1] + 1 < c) c = cur[j - 1] + 1;
        cur[j] = c; if (c < mn) mn = c;
      }
      if (mn > max) return max + 1;
      var t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }
  function maxEd(n) { return n <= 5 ? 0 : n <= 8 ? 1 : n <= 12 ? 2 : 3; }
  function ocrTok(raw) { return X.norm(String(raw || '').replace(/[|]/g, 'l')).replace(/0/g, 'o').replace(/1/g, 'l').replace(/[^a-z0-9]+/g, ''); }
  // lignes lues -> libellés reconnus { e (lieu), u, v (centre dans l'image), w (poids), sig, txt }
  function ocrMatch(lines, W, H) {
    var D = buildDict(), found = [];
    lines.forEach(function (ln) {
      var T = ln.filter(function (t) { return t.k && OCR_UI.indexOf(t.k) < 0; });
      if (!T.length) return;
      var cands = [];
      for (var i = 0; i < T.length; i++) {
        var s = '', u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9, raw = [];
        for (var j = i; j < T.length && j < i + 5; j++) {
          var tk = T[j]; s += tk.k; raw.push(tk.raw);
          u0 = Math.min(u0, tk.u0); v0 = Math.min(v0, tk.v0); u1 = Math.max(u1, tk.u1); v1 = Math.max(v1, tk.v1);
          if (s.length > 44) break;
          var box = [u0, v0, u1, v1], cutL = i === 0 && u0 < 0.02 * W, cutR = j === T.length - 1 && u1 > 0.98 * W, ls = s.length;
          for (var q = 0; q < D.length; q++) {
            var e = D[q], L = e.key.length, d, me = maxEd(L);
            if (Math.abs(L - ls) <= me) { d = lev(s, e.key, me); if (d <= me) cands.push({ e: e, i: i, j: j, box: box, sc: L - d, cut: 0, nch: ls, raw: raw.join(' ') }); }
            // premier mot seul d'un nom de plusieurs mots (« Waxman » pour Waxman Island, la suite mal lue), s'il n'y a pas d'ambiguïté
            if (e.w1 && i === j && ls >= 6 && Math.abs(e.w1.length - ls) <= 1) { d = lev(s, e.w1, maxEd(e.w1.length)); if (d <= maxEd(e.w1.length) && e.w1u) cands.push({ e: e, i: i, j: j, box: box, sc: 0.8 * (ls - d), cut: 1, nch: ls, raw: raw.join(' '), part: 1 }); }
            if ((cutL || cutR) && ls >= 6 && ls >= 0.35 * L && L - ls >= 2) {
              var m2 = maxEd(ls - 2);
              if (cutL) { d = lev(s, e.key.slice(L - ls), m2); if (d <= m2) cands.push({ e: e, i: i, j: j, box: box, sc: 0.9 * (ls - d), cut: -1, nch: ls, raw: raw.join(' ') }); }
              if (cutR) { d = lev(s, e.key.slice(0, ls), m2); if (d <= m2) cands.push({ e: e, i: i, j: j, box: box, sc: 0.9 * (ls - d), cut: 1, nch: ls, raw: raw.join(' ') }); }
            }
          }
        }
      }
      cands.sort(function (a, b) { return b.sc - a.sc; });
      var used = {};
      // mots « de phrase » hors du nom : texte d'interface (mission, aide), pas un libellé de carte
      var wordy = function (c) { var n = 0; for (var k = 0; k < T.length; k++) if ((k < c.i || k > c.j) && T[k].k.length >= 3 && /^[a-z]+$/.test(T[k].k)) n++; return n >= 2; };
      cands.forEach(function (c) {
        if (wordy(c)) return;
        for (var k = c.i; k <= c.j; k++) if (used[k]) return;
        for (k = c.i; k <= c.j; k++) used[k] = 1;
        var b = c.box, u = (b[0] + b[2]) / 2, v = (b[1] + b[3]) / 2;
        if (c.cut) { var fw = (b[2] - b[0]) / c.nch * c.e.key.length; u = c.cut < 0 ? b[2] - fw / 2 : b[0] + fw / 2; }
        found.push({ e: c.e, u: u, v: v, box: b, w: c.cut ? 0.5 : 1, sig: c.e.sig * (c.cut ? 1.3 : 1), cut: c.cut, sc: c.sc, txt: c.raw });
      });
    });
    // doublons (même lieu au même endroit, lu par plusieurs passes) : on garde la meilleure lecture
    found.sort(function (a, b) { return b.sc - a.sc; });
    var out = [];
    found.forEach(function (f) {
      var hb = Math.max(8, f.box[3] - f.box[1]), b = f.box;
      if (out.some(function (o) {
        if (o.e.id === f.e.id && Math.abs(o.u - f.u) < 3 * hb && Math.abs(o.v - f.v) < 1.5 * hb) return true;
        // deux lieux lus au même endroit (ex. « rt de Vice City » dans « Aéroport de Vice City ») : on garde la meilleure lecture
        var c = o.box, iw = Math.min(b[2], c[2]) - Math.max(b[0], c[0]), ih = Math.min(b[3], c[3]) - Math.max(b[1], c[1]);
        return iw > 0 && ih > 0 && iw * ih > 0.4 * Math.min((b[2] - b[0]) * (b[3] - b[1]), (c[2] - c[0]) * (c[3] - c[1]));
      })) return;
      out.push(f);
    });
    return out;
  }
  /* Similitude image -> monde sans rotation (x = s u + c ; y = -s v + f), robuste : RANSAC sur les paires de libellés,
     puis moindres carrés pondérés (1 / écart type²) sur les libellés cohérents. */
  function ocrFit(M, W, H) {
    var diag = Math.hypot(W, H), best = null, i, j;
    var lsq = function (P) {
      var sw = 0, um = 0, vm = 0, xm = 0, ym = 0, num = 0, den = 0;
      P.forEach(function (p) { var o = p.w / (p.sig * p.sig); sw += o; um += o * p.u; vm += o * p.v; xm += o * p.e.x; ym += o * p.e.y; });
      um /= sw; vm /= sw; xm /= sw; ym /= sw;
      P.forEach(function (p) { var o = p.w / (p.sig * p.sig), du = p.u - um, dv = p.v - vm; num += o * (du * (p.e.x - xm) - dv * (p.e.y - ym)); den += o * (du * du + dv * dv); });
      var s = den > 0 ? num / den : 0;
      return s > 0 ? { s: s, c: xm - s * um, f: ym + s * vm } : null;
    };
    var resid = function (T, p) { return Math.hypot(T.s * p.u + T.c - p.e.x, -T.s * p.v + T.f - p.e.y); };
    var inliers = function (T) {
      var by = {};
      M.forEach(function (p) {
        var r = resid(T, p), z = r / p.sig;
        if (z > 2.5 || (by[p.e.id] && by[p.e.id].z <= z)) return;
        by[p.e.id] = { p: p, z: z, r: r };
      });
      return Object.keys(by).map(function (k) { return by[k]; });
    };
    var plaus = function (T) { return T && T.s * W > 400 && T.s * W < 30000; };
    for (i = 0; i < M.length; i++) for (j = i + 1; j < M.length; j++) {
      var A = M[i], B = M[j];
      if (A.e.id === B.e.id) continue;
      var du = B.u - A.u, dv = -(B.v - A.v), dpx = Math.hypot(du, dv), dx = B.e.x - A.e.x, dy = B.e.y - A.e.y, dW = Math.hypot(dx, dy);
      if (dpx < 0.06 * diag || dW < 50) continue;
      var ang = Math.abs(Math.atan2(du * dy - dv * dx, du * dx + dv * dy)), tol = Math.min(0.6, Math.atan((A.sig + B.sig) / dW) + 0.06);
      if (ang > tol) continue;
      var T = lsq([A, B]);
      if (!plaus(T)) continue;
      var I = inliers(T), sc = 0, zs = 0;
      I.forEach(function (q) { sc += q.p.w * (q.p.sig < 500 ? 1 : 0.4); zs += q.z; });
      if (!best || sc > best.sc + 1e-9 || (Math.abs(sc - best.sc) < 1e-9 && zs < best.zs)) best = { sc: sc, zs: zs, T: T, ang: ang / tol };
    }
    if (!best) return null;
    var T2 = best.T, I2 = inliers(T2);
    for (var it = 0; it < 4; it++) {
      var T3 = I2.length >= 2 ? lsq(I2.map(function (q) { return q.p; })) : null;
      if (!plaus(T3)) break;
      var I3 = inliers(T3);
      if (I3.length < 2) break;
      T2 = T3; I2 = I3;
    }
    if (I2.length < 2) return null;
    var pts = I2.filter(function (q) { return q.p.sig < 500; }).length, rs = 0, iw = 0;
    I2.forEach(function (q) { rs += q.r; iw += q.p.w / (q.p.sig * q.p.sig); });
    // assez sûr pour un simple raffinement local : 2 lieux précis, ou 1 lieu précis + 1 ville, cohérents
    var strong = (pts >= 2 || (pts >= 1 && I2.filter(function (q) { return q.p.sig <= 700; }).length >= 2)) && (I2.length >= 3 || best.ang < 0.8);
    // incertitude du calage : position (unités monde) et échelle (relative)
    var sigPos = 1 / Math.sqrt(iw), spread = 0, cu = 0, cv = 0;
    I2.forEach(function (q) { cu += q.p.u / I2.length; cv += q.p.v / I2.length; });
    I2.forEach(function (q) { spread += T2.s * T2.s * ((q.p.u - cu) * (q.p.u - cu) + (q.p.v - cv) * (q.p.v - cv)); });
    var sigScale = sigPos * Math.sqrt(I2.length) / Math.max(1, Math.sqrt(spread));
    return { tf: { a: T2.s, b: 0, c: T2.c, d: 0, e: -T2.s, f: T2.f }, s: T2.s, inl: I2.map(function (q) { return q.p; }), n: I2.length, pts: pts,
      strong: strong, res: rs / I2.length, angRel: best.ang, sigPos: sigPos, sigScale: sigScale };
  }

  function ocrSupported() {
    try {
      // WebAssembly avec SIMD (moteur fourni : variante SIMD seulement) et Web Workers
      return typeof WebAssembly === 'object' && typeof Worker !== 'undefined' && !!window.Promise &&
        WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch (e) { return false; }
  }
  function ocrOn() { return !OCR.bad && X.store.get('mybgOcr', true) !== false && ocrSupported(); }
  function withTimeout(p, ms) { return new Promise(function (res, rej) { var t = setTimeout(function () { rej(new Error('trop long')); }, ms); p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); }); }); }
  function ocrLoad() {
    if (OCR.w) return Promise.resolve(OCR.w);
    if (OCR.p) return OCR.p;
    var base = new URL(OCRDIR, document.baseURI).href;
    OCR.p = withTimeout(new Promise(function (res, rej) {
      if (window.Tesseract && window.Tesseract.createWorker) { res(); return; }
      var s = document.createElement('script');
      s.src = base + 'tesseract.min.js'; s.async = true;
      s.onload = function () { if (window.Tesseract && window.Tesseract.createWorker) res(); else rej(new Error('ocr')); };
      s.onerror = function () { rej(new Error('ocr')); };
      document.head.appendChild(s);
    }).then(function () {
      return window.Tesseract.createWorker(['eng', 'fra'], 1, {
        workerPath: base + 'worker.min.js', corePath: base + 'tesseract-core-simd-lstm.js', langPath: base.replace(/\/$/, ''),
        workerBlobURL: false, cacheMethod: 'none', gzip: true,
        logger: function (m) { if (OCR.log && m && typeof m.progress === 'number') OCR.log(m.status, m.progress); },
        errorHandler: function () { /* signalé par la promesse */ }
      });
    }).then(function (w) {
      return w.setParameters({ user_defined_dpi: '300', debug_file: '/dev/null' }).then(function () { return w; });
    }), 30000).then(function (w) { OCR.w = w; OCR.p = null; return w; }, function (e) { OCR.p = null; OCR.bad = true; throw e; });
    return OCR.p;
  }
  function ocrIdle() {
    clearTimeout(OCR.idle);
    OCR.idle = setTimeout(function () { var w = OCR.w; OCR.w = null; if (w) { try { w.terminate(); } catch (e) { /* */ } } }, 120000); // libère la mémoire
  }
  function loadImg(url) {
    return new Promise(function (res, rej) { var img = new Image(); img.onload = function () { res(img); }; img.onerror = function () { rej(new Error('image illisible')); }; img.src = url; });
  }
  // mots reconnus -> lignes (même hauteur, alignés, rapprochés)
  function wordsToLines(W2) {
    W2.sort(function (a, b) { return a.u0 - b.u0; });
    var lines = [];
    W2.forEach(function (w) {
      var h = w.v1 - w.v0, best = null;
      lines.forEach(function (L) {
        var l = L[L.length - 1], hl = l.v1 - l.v0, ov = Math.min(l.v1, w.v1) - Math.max(l.v0, w.v0);
        if (ov < 0.5 * Math.min(h, hl) || Math.max(h, hl) > 1.8 * Math.min(h, hl)) return;
        var gap = w.u0 - l.u1;
        if (gap > 1.6 * Math.max(h, hl) || gap < -0.5 * h) return;
        if (!best || gap < best.gap) best = { L: L, gap: gap };
      });
      if (best) best.L.push(w); else lines.push([w]);
    });
    return lines;
  }
  function tessWords(r) {
    var out = [];
    ((r && r.data && r.data.blocks) || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (w) {
      if (w && w.bbox && w.text && w.confidence >= 15) out.push({ raw: w.text, k: ocrTok(w.text), conf: w.confidence, b: w.bbox });
    }); }); }); });
    return out;
  }
  /* Lit les noms de lieux de l'image stockée : 1) page entière ; 2) lignes de texte repérées (lettres seules, noir sur blanc) ;
     3) mêmes lignes en niveaux de gris contrastés. Renvoie les lignes de mots (coordonnées de l'image stockée). */
  function ocrRead(it, pg) {
    var t0 = Date.now(), info = {};
    return ocrLoad().then(function (wk) {
      clearTimeout(OCR.idle);
      return loadImg(it.url).then(function (img) {
        var W = img.naturalWidth, H = img.naturalHeight, kd = Math.max(0.5, Math.min(1.6, 930 / H));
        var dw = Math.round(W * kd), dh = Math.round(H * kd), cv = document.createElement('canvas'); cv.width = dw; cv.height = dh;
        var g = cv.getContext('2d', { willReadFrequently: true }); try { g.imageSmoothingQuality = 'high'; } catch (e) { /* */ }
        g.drawImage(img, 0, 0, dw, dh);
        var id = g.getImageData(0, 0, dw, dh);
        info.loadMs = Date.now() - t0;
        return runCore({ op: 'text', px: id.data, w: dw, h: dh }, function () { /* */ }).then(function (r) {
          var TL = (r && r.lines) || [];
          info.detLines = TL.length; info.detMs = Date.now() - t0 - info.loadMs;
          // planches : chaque ligne repérée, mise à 32 px de haut, empilées
          var TH = 32, gap = 26, y = gap, wmax = 0, strips = [];
          TL.forEach(function (l) {
            var lh = l.y1 - l.y0, k = TH / lh, pw = Math.round(0.45 * lh);
            var sx0 = Math.max(0, l.x0 - pw), sy0 = Math.max(0, l.y0 - pw), sx1 = Math.min(dw, l.x1 + pw), sy1 = Math.min(dh, l.y1 + pw);
            var ow = Math.round((sx1 - sx0) * k), oh = Math.round((sy1 - sy0) * k);
            if (y + oh + gap > 16000 || ow > 3000) return;
            strips.push({ l: l, sx0: sx0, sy0: sy0, sx1: sx1, sy1: sy1, k: k, y0: y, ow: ow, oh: oh });
            y += oh + gap; wmax = Math.max(wmax, ow);
          });
          var SWd = wmax + 2 * gap, SHd = y, cm = null, cg = null;
          if (strips.length) {
            cm = document.createElement('canvas'); cm.width = SWd; cm.height = SHd;
            cg = document.createElement('canvas'); cg.width = SWd; cg.height = SHd;
            var gm = cm.getContext('2d'), gg = cg.getContext('2d', { willReadFrequently: true });
            gm.fillStyle = '#fff'; gm.fillRect(0, 0, SWd, SHd); gg.fillStyle = '#fff'; gg.fillRect(0, 0, SWd, SHd);
            var tmp = document.createElement('canvas'), gt = tmp.getContext('2d', { willReadFrequently: true });
            strips.forEach(function (s) {
              var l = s.l, bw = l.x1 - l.x0, bh = l.y1 - l.y0;
              tmp.width = bw; tmp.height = bh;
              var im = gt.createImageData(bw, bh);
              for (var q = 0; q < bw * bh; q++) { var v = l.bits[q] ? 0 : 255; im.data[4 * q] = v; im.data[4 * q + 1] = v; im.data[4 * q + 2] = v; im.data[4 * q + 3] = 255; }
              gt.putImageData(im, 0, 0);
              gm.drawImage(tmp, 0, 0, bw, bh, gap + (l.x0 - s.sx0) * s.k, s.y0 + (l.y0 - s.sy0) * s.k, bw * s.k, bh * s.k);
              gg.drawImage(cv, s.sx0, s.sy0, s.sx1 - s.sx0, s.sy1 - s.sy0, gap, s.y0, s.ow, s.oh);
              var gi = gg.getImageData(gap, s.y0, s.ow, s.oh), d = gi.data, n = s.ow * s.oh, hist = new Uint32Array(256), lo = 0, hi = 255, acc = 0;
              for (q = 0; q < n; q++) { var L = (0.3 * d[4 * q] + 0.59 * d[4 * q + 1] + 0.11 * d[4 * q + 2]) | 0; d[4 * q] = L; hist[L]++; }
              for (q = 0; q < 256; q++) { acc += hist[q]; if (acc > 0.01 * n) { lo = q; break; } }
              for (acc = 0, q = 255; q >= 0; q--) { acc += hist[q]; if (acc > 0.01 * n) { hi = q; break; } }
              var sc = 255 / Math.max(1, hi - lo);
              for (q = 0; q < n; q++) { var v2 = 255 - Math.max(0, Math.min(255, (d[4 * q] - lo) * sc)); d[4 * q] = d[4 * q + 1] = d[4 * q + 2] = v2; }
              gg.putImageData(gi, gap, s.y0);
            });
            tmp.width = 1; tmp.height = 1;
          }
          info.strips = strips.length;
          var lines = [], P = [[cv, 'page']];
          if (cm) { P.push([cm, 'mask']); P.push([cg, 'gray']); }
          var k0 = 0;
          OCR.log = function (st, p) { if (st === 'recognizing text') pg((k0 + p) / P.length); };
          var step = function (k) {
            if (k >= P.length) return Promise.resolve();
            k0 = k;
            return wk.setParameters({ tessedit_pageseg_mode: '11' }).then(function () {
              return wk.recognize(P[k][0], {}, { blocks: true, text: false });
            }).then(function (res) {
              var ws = tessWords(res), kind = P[k][1];
              if (kind === 'page') {
                var wl = ws.map(function (w) { return { raw: w.raw, k: w.k, u0: w.b.x0 / kd, v0: w.b.y0 / kd, u1: w.b.x1 / kd, v1: w.b.y1 / kd }; });
                wordsToLines(wl).forEach(function (L) { lines.push(L); });
              } else {
                var by = strips.map(function () { return []; });
                ws.forEach(function (w) {
                  var cy = (w.b.y0 + w.b.y1) / 2;
                  for (var q = 0; q < strips.length; q++) {
                    var s = strips[q];
                    if (cy >= s.y0 && cy < s.y0 + s.oh) {
                      var f = function (X2, Y2) { return [(s.sx0 + (X2 - gap) / s.k) / kd, (s.sy0 + (Y2 - s.y0) / s.k) / kd]; };
                      var p0 = f(w.b.x0, w.b.y0), p1 = f(w.b.x1, w.b.y1);
                      by[q].push({ raw: w.raw, k: w.k, u0: p0[0], v0: p0[1], u1: p1[0], v1: p1[1] });
                      break;
                    }
                  }
                });
                // regroupées en lignes dans l'image (une ligne de texte coupée en deux par le repérage est recollée)
                var all = []; by.forEach(function (L) { all = all.concat(L); });
                wordsToLines(all).forEach(function (L) { lines.push(L); });
              }
              info[kind + 'Ms'] = Date.now() - t0;
              return step(k + 1);
            });
          };
          return step(0).then(function () {
            OCR.log = null;
            cv.width = 1; cv.height = 1; if (cm) { cm.width = 1; cm.height = 1; cg.width = 1; cg.height = 1; }
            info.ms = Date.now() - t0;
            info.text = lines.map(function (L) { return L.map(function (w) { return w.raw; }).join(' '); }).filter(function (t) { return /[A-Za-zÀ-ÿ]{4}/.test(t); });
            ocrIdle();
            return { lines: lines, W: W, H: H, info: info };
          });
        });
      });
    }).catch(function (e) { OCR.log = null; ocrKill(); throw e; });
  }
  function ocrKill() { // moteur dans un état inconnu (erreur, trop long) : on le relance la prochaine fois
    clearTimeout(OCR.idle); OCR.log = null;
    var w = OCR.w; OCR.w = null;
    if (w) { try { w.terminate(); } catch (e) { /* */ } }
  }
  // calage par les noms lus : { tf (pixels de l'image stockée), strong, names, ... } ou null
  function ocrCalibrate(it, pg) {
    return withTimeout(ocrRead(it, pg), 60000).catch(function (e) { ocrKill(); throw e; }).then(function (R) {
      var M = ocrMatch(R.lines, R.W, R.H), F = M.length >= 2 ? ocrFit(M, R.W, R.H) : null;
      var out = { info: R.info, read: M.map(function (m) { return { n: m.e.n, x: m.e.x, y: m.e.y, u: m.u, v: m.v, box: m.box, txt: m.txt, cut: m.cut, k: m.e.k }; }), fit: null };
      if (F) {
        out.fit = F; out.tf = F.tf; out.strong = F.strong;
        out.names = []; F.inl.forEach(function (p) { if (out.names.indexOf(p.e.n) < 0) out.names.push(p.e.n); });
        out.inl = F.inl.map(function (p) { return { n: p.e.n, x: p.e.x, y: p.e.y, u: p.u, v: p.v, box: p.box, sig: p.sig, k: p.e.k, cut: p.cut }; });
      }
      return out;
    });
  }

  /* ---------- Calage « par voisinage » : sur une capture déjà calée qui chevauche la nouvelle ----------
     Utile pour les vues larges sans noms de lieux précis. Les deux images sont comparées par leurs contours (module du
     gradient), dans le Web Worker : recherche multi-échelle par corrélation de phase, puis raffinement. */
  var NB_PX = 512, nbCache = {}, ICON_H = 0.022; // ICON_H : taille d'une icône du jeu / hauteur de l'écran
  function bandOf(w, h) { return Math.abs(w / h - 16 / 9) < 0.08 ? [0.085, 0.9] : [0, 1]; } // capture 16:9 : bandeaux du jeu ignorés
  function smallPixels(url, maxpx) {
    return loadImg(url).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, maxpx / Math.max(w, h));
      var cw = Math.max(16, Math.round(w * k)), ch = Math.max(16, Math.round(h * k));
      var c = document.createElement('canvas'); c.width = cw; c.height = ch;
      var g = c.getContext('2d');
      try { g.imageSmoothingQuality = 'high'; } catch (e) { /* */ }
      g.drawImage(img, 0, 0, cw, ch);
      var d = g.getImageData(0, 0, cw, ch); c.width = 1; c.height = 1;
      return { px: d.data, w: cw, h: ch };
    });
  }
  function nbPixels(it) {
    var key = it.id + '|' + it.url;
    if (nbCache[it.id] && nbCache[it.id].key === key) return Promise.resolve(nbCache[it.id].p);
    return smallPixels(it.url, NB_PX).then(function (p) { nbCache[it.id] = { key: key, p: p }; return p; });
  }
  function worldBox(it) {
    var t = it.tf, xs = [], ys = [];
    [[0, 0], [it.w, 0], [0, it.h], [it.w, it.h]].forEach(function (p) { var q = apply(t, p[0], p[1]); xs.push(q[0]); ys.push(q[1]); });
    return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }
  function boxInter(a, b) { return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])); }
  // captures déjà calées susceptibles de chevaucher la nouvelle (au plus 3) : dans la zone de l'assistant si on la connaît
  function nbCandidates(it, zone) {
    var c = items.filter(function (x) { return x !== it && !x.tmp && x.tf && x.url && isFinite(scaleOf(x.tf)); });
    if (zone) {
      var zb = zoneBox(zone, 1.6);
      c = c.filter(function (x) { return boxInter(worldBox(x), zb) > 0; });
      c.sort(function (p, q) { return boxInter(worldBox(q), zb) - boxInter(worldBox(p), zb); });
    } else c.sort(function (p, q) { return q.created - p.created; });
    return c.slice(0, 3);
  }
  function nbCalibrate(it, zone, prog) {
    var nbs = nbCandidates(it, zone);
    if (!nbs.length) return Promise.resolve(null);
    return Promise.all([smallPixels(it.url, NB_PX)].concat(nbs.map(nbPixels))).then(function (arr) {
      var A = arr[0], job = { op: 'nb', a: { px: A.px, w: A.w, h: A.h, band: bandOf(A.w, A.h) }, nbs: [] };
      nbs.forEach(function (n, i) {
        var P = arr[i + 1], kx = n.w / P.w, ky = n.h / P.h, t = n.tf;
        job.nbs.push({ id: n.id, px: P.px, w: P.w, h: P.h, band: bandOf(P.w, P.h), tf: { a: t.a * kx, b: t.b * ky, c: t.c, d: t.d * kx, e: t.e * ky, f: t.f } });
      });
      if (zone) { var zw = zone.w; job.sMin = zw / 3.5 / A.w; job.sMax = zw * 3.5 / A.w; }
      return runCore(job, prog || function () { /* */ }).then(function (r) {
        if (!r || !r.ok || !r.tf) return { conf: 'bad', tf: null, info: r };
        var q = A.w / it.w, q2 = A.h / it.h, t = r.tf;
        var tf = { a: t.a * q, b: t.b * q2, c: t.c, d: t.d * q, e: t.e * q2, f: t.f, kind: 'sim' };
        var ctr = apply(tf, it.w / 2, it.h / 2), b = X.land && X.land.bbox, inState = !b || (ctr[0] > b[0] - 3000 && ctr[0] < b[2] + 3000 && ctr[1] > b[1] - 3000 && ctr[1] < b[3] + 3000);
        var conf = !inState || !isFinite(tf.a + tf.c + tf.f) ? 'bad' : r.ncc >= 0.5 && r.margin >= 0.18 ? 'good' : r.ncc >= 0.38 && r.margin >= 0.1 ? 'mid' : 'bad';
        var src = items.filter(function (x) { return x.id === r.id; })[0];
        return { conf: conf, tf: conf === 'bad' ? null : tf, ncc: r.ncc, margin: r.margin, worker: !r.local, name: src ? src.name : '',
          info: { id: r.id, ncc: r.ncc, margin: r.margin, cov: r.cov, ms: r.ms, cands: r.cands, conf: conf, tf: tf } };
      });
    });
  }

  /* Calage par les icônes du jeu (mode « Où est-ce sur ma photo ? ») : { K: [x, y, …], near: { x, y } } */
  function icCalibrate(it, icons, prog) {
    return smallPixels(it.url, 1280).then(function (A) {
      var job = { op: 'icons', px: A.px, w: A.w, h: A.h, band: bandOf(A.w, A.h), S: A.h * ICON_H, K: icons.K, near: icons.near, sMin: 500 / A.w, sMax: 9000 / A.w };
      if (prog) prog(0.2);
      return runCore(job, function () { /* */ }).then(function (r) {
        if (prog) prog(1);
        if (!r || !r.ok || !r.tf) return { conf: 'bad', tf: null, info: r && { dets: r.dets ? r.dets.length : 0, nk: r.nk, ms: r.ms } };
        var q = A.w / it.w, q2 = A.h / it.h, t = r.tf;
        var tf = { a: t.a * q, b: 0, c: t.c, d: 0, e: t.e * q2, f: t.f, kind: 'sim' };
        // sûr : assez d'icônes appariées, bien au-dessus du hasard, et nettement mieux que toute autre position / échelle
        var conf = r.n >= 6 && r.z >= 6 && (r.z2 < 0.6 * r.z || r.n2 <= 0.55 * r.n) ? 'good' : r.n >= 4 && r.z >= 3.5 && (r.z2 < 0.8 * r.z || r.n2 <= 0.75 * r.n) ? 'mid' : 'bad';
        return { conf: conf, tf: conf === 'bad' ? null : tf, worker: !r.local, sig: Math.max(12, 1.5 * r.rms),
          info: { n: r.n, n2: r.n2, z: r.z, z2: r.z2, lam: r.lam, rms: r.rms, dets: r.dets.length, nk: r.nk, kin: r.kin, ms: r.ms, conf: conf, pairs: r.pairs, detList: r.dets, sa: A.w / it.w } };
      });
    });
  }

  /* Calage automatique d'une capture : renvoie { conf: 'good'|'mid'|'bad', tf (pixels de l'image stockée), r (détails) }.
     Si c'est une photo d'écran, l'image de la capture est remplacée par l'écran redressé (même si le calage échoue :
     le calage à la main est alors plus facile). */
  function autoCalibrate(it, prog, opt) {
    opt = opt || {};
    var land = flatLand();
    if (!land.polys.length) return Promise.resolve({ conf: 'bad', tf: null, r: { why: 'land' } });
    var t0 = Date.now(), pg = prog || function () { /* */ }, msg = function (m) { if (pg.msg) pg.msg(m); }, noop = function () { /* */ };
    return analysisPixels(it).then(function (a) {
      var rectify = !it.rectified, inList = items.indexOf(it) >= 0;
      // 1. photo d'une télé : l'écran est redressé tout de suite (la lecture des noms se fait sur l'image redressée)
      var pre = rectify ? runCore({ op: 'prep', px: a.px, w: a.w, h: a.h }, noop).catch(function () { return null; }) : Promise.resolve(null);
      return pre.then(function (pr) {
        var rect = pr && pr.rect;
        var after = rect && inList ? rectifyItem(it, a, rect).catch(function () { return null; }) : Promise.resolve(null);
        return after.then(function (k) {
          pg(0.05);
          // pixels d'analyse (écran redressé à 360 px de haut, ou image réduite) <-> pixels de l'image stockée
          var kx = a.w / it.w, ky = a.h / it.h;
          var toStored = function (t) {
            if (k) { var q = 1 / k.kout; return { a: t.a * q, b: t.b * q, c: t.c, d: t.d * q, e: t.e * q, f: t.f }; }
            return { a: t.a * kx, b: t.b * ky, c: t.c, d: t.d * kx, e: t.e * ky, f: t.f };
          };
          var toRun = function (t) {
            if (k) { var q = k.kout; return { a: t.a * q, b: t.b * q, c: t.c, d: t.d * q, e: t.e * q, f: t.f }; }
            return { a: t.a / kx, b: t.b / ky, c: t.c, d: t.d / kx, e: t.e / ky, f: t.f };
          };
          // 2. lecture des noms de lieux (si possible ; sinon on passe directement au recalage terre / eau)
          var useOcr = ocrOn() && (!rect || !!k);
          if (useOcr) msg('Calage automatique : lecture des noms de lieux…');
          var oc = useOcr ? ocrCalibrate(it, function (p) { pg(0.05 + 0.5 * p); }).catch(function (e) { return { err: String((e && e.message) || e) }; }) : Promise.resolve(null);
          return oc.then(function (o) {
            var strong = !!(o && o.tf && o.strong), p0 = useOcr ? 0.56 : 0.05;
            // 2b. icônes du jeu (mode « Où est-ce sur ma photo ? ») : constellation des pastilles appariée aux marqueurs visibles en jeu
            var icP = opt.icons && inList && (!rect || !!k) ? icCalibrate(it, opt.icons, function (p) { pg(p0 + 0.1 * p); }).catch(function () { return null; }) : Promise.resolve(null);
            return icP.then(function (ic) {
            if (opt.icons) p0 += 0.1;
            var icRes = function (r0) {
              var r = { method: 'icones', score: ic.z, kind: 'sim', conf: ic.conf, ic: ic.info, ocr: o, rectified: !!k, aw: a.w, ah: a.h, worker: ic.worker,
                totalMs: Date.now() - t0, rect: rect || null, other: r0 ? { method: r0.method, conf: r0.conf } : null };
              pg(1);
              return { conf: ic.conf, tf: copyT(ic.tf), best: copyT(ic.tf), r: r, sig: ic.sig };
            };
            if (ic && ic.conf === 'good') return icRes(null);
            // 3. pas de noms précis : calage « par voisinage » sur une capture déjà calée qui chevauche celle-ci
            var nbOk = !strong && opt.nb !== false && inList && (!rect || !!k) && nbCandidates(it, opt.zone).length > 0;
            if (nbOk) msg('Calage automatique : comparaison avec tes autres captures…');
            var nbP = nbOk ? nbCalibrate(it, opt.zone, function (p) { pg(p0 + 0.25 * p); }).catch(function () { return null; }) : Promise.resolve(null);
            return nbP.then(function (nbr) {
              if (nbOk) p0 += 0.25;
              var nbRes = function (r0) {
                var r = { method: 'voisin', score: nbr.ncc, margin: nbr.margin, kind: 'sim', conf: nbr.conf, nb: nbr.info, ocr: o, rectified: !!k,
                  aw: a.w, ah: a.h, worker: nbr.worker, totalMs: Date.now() - t0, rect: rect || null, coast: r0 ? { conf: r0.conf, score: r0.score } : null };
                pg(1);
                return { conf: nbr.conf, tf: copyT(nbr.tf), best: copyT(nbr.tf), r: r, nbName: nbr.name };
              };
              if (nbr && nbr.conf === 'good') return nbRes(null);
              msg(strong ? 'Calage automatique : vérification avec les côtes…' : 'Calage automatique de ta capture…');
              // 4. recalage terre / eau : local autour des noms lus (fenêtre), sinon recherche complète (les noms lus servent d'indice)
              var job = { px: a.px, w: a.w, h: a.h, polys: land.polys, holes: land.holes, rectify: rectify };
              if (strong) {
                // fenêtre : au moins ± 300 unités et ± 15 %, plus si les noms lus situent mal la capture (villes, lieux peu précis)
                job.win = toRun(o.tf); job.win.dt = Math.max(300, Math.min(900, 1.5 * o.fit.sigPos)); job.win.ds = Math.max(0.15, Math.min(0.4, 1.5 * o.fit.sigScale));
                var kp = k ? 1 / k.kout : kx;
                job.win.pts = o.fit.inl.map(function (p) { return { u: p.u * kp, v: p.v * (k ? kp : ky), x: p.e.x, y: p.e.y, sig: p.sig, w: p.w }; });
              }
              else if (o && o.tf) job.seedTf = toRun(o.tf);
              else if (nbr && nbr.conf === 'mid') job.seedTf = toRun(nbr.tf);
              var run = runCore(job, function (p) { pg(p0 + (0.98 - p0) * p); });
              if (strong) run = run.catch(function () { return { ok: false, why: 'err', local: false }; });
              return run.then(function (r) {
                r.aw = a.w; r.ah = a.h; r.worker = !r.local; r.ocr = o; r.rectified = !!k; r.totalMs = Date.now() - t0;
                if (nbr) r.nb = nbr.info;
                if (ic) r.ic = ic.info;
                if (rect && !r.rect) r.rect = rect;
                pg(1);
                if (rect && !k) return { conf: 'bad', tf: null, r: r };
                if (strong) {
                  var tfo = copyT(o.tf), tfl = r.ok && r.tf ? toStored(r.tf) : null;
                  var better = !!(tfl && isFinite(tfl.a + tfl.c + tfl.e + tfl.f) && r.gain >= 0.015);
                  var tf = better ? tfl : tfo;
                  tf.kind = 'sim';
                  r.method = better ? 'noms+cotes' : 'noms';
                  r.kind = 'sim';
                  // sûr : au moins 2 lieux précis cohérents (3 noms, ou 2 bien alignés, ou confirmés par les côtes) ; sinon « à vérifier »
                  var conf = o.fit.pts >= 2 && (o.fit.n >= 3 || better || o.fit.angRel < 0.5) ? 'good' : 'mid';
                  r.conf = conf;
                  return { conf: conf, tf: tf, best: tf, r: r, names: o.names };
                }
                r.method = 'cotes';
                var coastOk = r.ok && r.tf && r.conf !== 'bad';
                // voisinage « à vérifier » : préféré à un échec (ou à un calage par les côtes lui aussi douteux)
                if (nbr && nbr.conf === 'mid' && (!coastOk || r.conf !== 'good')) return nbRes(r);
                if (ic && ic.conf === 'mid' && (!coastOk || r.conf !== 'good')) return icRes(r);
                if (!r.ok || !r.tf) return { conf: 'bad', tf: null, r: r };
                var tf2 = toStored(r.tf);
                tf2.kind = r.kind === 'affine' ? 'affine' : 'sim';
                if (!isFinite(tf2.a + tf2.b + tf2.c + tf2.d + tf2.e + tf2.f)) return { conf: 'bad', tf: null, r: r };
                return { conf: r.conf, tf: r.conf === 'bad' ? null : tf2, best: tf2, r: r };
              });
            });
            });
          });
        });
      });
    });
  }
  function autoInfo(it, o) {
    var r = o.r || {};
    return { id: it.id, conf: o.conf, score: r.score, margin: r.margin, ms: r.totalMs, worker: r.worker, kind: r.kind, rectified: !!r.rectified,
      method: r.method, names: o.names || null, ocr: r.ocr || null, seedScore: r.seedScore, nb: r.nb || null, nbName: o.nbName || null, ic: r.ic || null,
      rect: r.rect ? { H: r.rect.H, u0: r.rect.u0, SH: r.rect.SH, aw: r.aw, ah: r.ah } : null, info: r.info, tf: copyT(o.tf), best: copyT(o.best) };
  }
  function namesMsg(names) {
    var n = (names || []).slice(0, 4);
    return 'Calage par les noms lus : ' + n.join(', ') + ((names || []).length > n.length ? '…' : '');
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
    var pg = function (p) { busyProg(p); };
    pg.msg = function (m) { if (!$('busy').hidden) busyShow(m); };
    autoCalibrate(it, pg).then(function (o) {
      lastAuto = autoInfo(it, o); autoLog.push(lastAuto);
      if (items.indexOf(it) < 0) { busyShow(''); busyProg(null); return; }
      if (o.conf === 'bad' || !o.tf) { fail('bad'); return; }
      busyShow(''); busyProg(null);
      it.tf = copyT(o.tf); it.pts = []; it.show = true;
      saveMeta(it); syncLayers(); renderList();
      adjOpen(it, true, { auto: o.conf, prev: prev, names: o.names, nb: o.nbName });
      fitTo(it);
      X.toast(o.names ? namesMsg(o.names) + (o.conf === 'good' ? ' ✔' : ' : vérifie-le') : o.nbName ? 'Calée sur ta capture « ' + o.nbName + ' »' + (o.conf === 'good' ? ' ✔' : ' : vérifie-la') :
        o.conf === 'good' ? 'Calage automatique ✔' : 'Calage automatique fait : vérifie-le');
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
        var pgk = function (p) { busyProg((k + p) / n); };
        pgk.msg = function (m) { busyShow(lab + ' : ' + (/^Calage automatique : /.test(m) ? m.replace(/^Calage automatique : /, '') : 'calage automatique…')); };
        return autoCalibrate(o.it, pgk).then(function (a) {
          lastAuto = autoInfo(o.it, a); autoLog.push(lastAuto);
          if (a.tf && a.conf !== 'bad') { o.it.tf = copyT(a.tf); o.it.pts = []; o.it.show = true; saveMeta(o.it); }
          done.push({ it: o.it, conf: a.tf && a.conf !== 'bad' ? a.conf : 'bad', names: a.names || null });
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
        adjOpen(first.it, true, { auto: first.conf === 'mid' ? 'mid' : 'good', prev: null, names: first.names });
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

  function calOpen(it, isNew, note, opt) {
    if (!REP.length) resolveReperes();
    X.closeSheet(); X.closePanel();
    if (adj) adjClose(false);
    var zone = opt && opt.zone, tgt = defaultTargets(it);
    if (zone && zone.rep && zone.rep.length >= 2) tgt = [zone.rep[0], zone.rep[1], zone.rep[2] || tgt[2]]; // repères de la zone de l'assistant
    cal = { it: it, isNew: isNew, pts: [null, null], tgt: tgt, k: 0, touched: false, want3: false, note: note || '', zone: zone || null };
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
    if (wiz.watch) setTimeout(wizBack, 0);
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
    if (cal.zone && cal.zone.rep && cal.zone.rep.length) {
      head('Dans la zone « ' + cal.zone.n + ' »');
      cal.zone.rep.forEach(function (r) { box.appendChild(row(r)); });
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
      auto: auto ? auto.auto : '', prev: auto ? auto.prev : undefined, names: auto ? auto.names : null, nb: auto ? auto.nb : null };
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
      if (adj.nb) {
        $('adjText').textContent = 'Calée en la comparant à ta capture « ' + adj.nb + ' »' + (adj.auto === 'good' ? ' ✔ ' : '. ') +
          'Vérifie que les routes et les côtes se raccordent bien. Un petit décalage ? « Bouger la capture ». Complètement faux ? « Caler à la main ».';
      }
      if (adj.names && adj.names.length) {
        $('adjText').textContent = namesMsg(adj.names) + (adj.auto === 'good' ? ' ✔ ' : '. ') +
          'Vérifie que les points de l\'app tombent au bon endroit sur ta capture (nos contours bleus des côtes sont approximatifs). Un petit décalage ? « Bouger la capture ». Complètement faux ? « Caler à la main ».';
      }
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
    if (keep && wiz.watch && wiz.watch.id === it.id) wiz.watch.ok = true;
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
    if (wiz.watch) setTimeout(wizBack, 0);
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

  /* ---------- Assistant « Ma carte du jeu en 6 photos » ----------
     6 zones qui couvrent tout l'État (avec chevauchement), cadrage 16:9 comme l'écran du jeu. Pour chaque zone : schéma,
     consigne, import d'une photo, calage automatique (noms lus, voisinage, côtes) ou calage à la main avec les repères de la zone.
     État mémorisé (X.store « mbw ») : zone -> capture. Rien n'est envoyé sur Internet. */
  var ZONES = [
    { id: 'vc', n: 'Vice City (centre)', x: -800, y: 700, w: 7200, on: 'le centre-ville de Vice City', a: 'l\'aéroport (à gauche)', b: 'Vice Beach (à droite)',
      rq: [['Aéroport international de Vice City', 'Vice City International Airport'], ['Ocean View Hotel'], ['Fleeca Field'], ['Grande roue de Vice City'], ['Port de Vice City'], ['Pont Rivo']] },
    { id: 'west', n: 'Port Gellhorn & Capri (ouest)', x: -6300, y: 2200, w: 8800, on: 'Gellhorn', a: 'Port Gellhorn (en haut)', b: 'Capri (en bas)',
      rq: [['Port Gellhorn'], ['Capri'], ['Gellhorn International Raceway'], ['Pont Bocamar', 'Bocamar Bridge'], ['Wild Hog Airfield'], ['Belpoint Lighthouse'], ['Emerald Bridge']] },
    { id: 'lake', n: 'Ambrosia, lac Leonida & Waning Sands', x: -2600, y: 5000, w: 8800, on: 'le lac Leonida', a: 'Ambrosia (à gauche)', b: 'Waning Sands (à droite)',
      rq: [['Ambrosia'], ['Waning Sands'], ['Lac Leonida', 'Lake Leonida'], ['Belville'], ['Sundown Private Airfield'], ['Ambrosia Raceway Park'], ['Vice City Casino']] },
    { id: 'north', n: 'Mount Kalaga & le nord', x: -4300, y: 7500, w: 8800, on: 'Mount Kalaga National Park', a: 'Grayson (à gauche)', b: 'Moreau (en haut)',
      rq: [['Grayson'], ['Moreau'], ['Millport'], ['Bonanza Giant'], ['Dawson Dam'], ['Hoffman Observatory']] },
    { id: 'south', n: 'Grassrivers (sud de Vice City)', x: -3600, y: -2900, w: 9200, on: 'Grassrivers', a: 'Watson Bay (à gauche)', b: 'Bluegrass (à droite)',
      rq: [['Henry J Edwards Airport'], ['Phare de Catalan Key', 'Catalan Key Lighthouse'], ['Leonida Penitentiary'], ['Boone Speedway'], ['Fuzzard Power Station'], ['Bluegrass'], ['Watson Bay']] },
    { id: 'keys', n: 'Leonida Keys', x: -4600, y: -6300, w: 9200, on: 'les îles des Keys', a: 'Southwind (à gauche)', b: 'Key Lento (à droite)',
      rq: [['Base aérienne de Mile Zero', 'Mile Zero Air Station'], ['Key Lento'], ['Seven Mile Bridge'], ['Southpoint Airfield'], ['Southwind'], ['Lento Causeway']] }
  ];
  ZONES.forEach(function (z) { z.h = z.w * 9 / 16; });
  function zoneBox(z, k) { k = k || 1; return [z.x - k * z.w / 2, z.y - k * z.h / 2, z.x + k * z.w / 2, z.y + k * z.h / 2]; }
  function zoneById(id) { return ZONES.filter(function (z) { return z.id === id; })[0] || null; }
  function resolveZoneReps(byName) {
    ZONES.forEach(function (z) {
      var b = zoneBox(z, 1.05);
      z.rep = [];
      z.rq.forEach(function (q, i) {
        for (var j = 0; j < q.length; j++) {
          var f = byName[X.norm(q[j])];
          if (f && f.x >= b[0] && f.x <= b[2] && f.y >= b[1] && f.y <= b[3]) { z.rep.push({ key: 'z' + z.id + i, n: f.n, x: f.x, y: f.y, h: 'Repère de la zone « ' + z.n + ' ».', z: 'zone' }); return; }
        }
      });
    });
  }

  var wiz = { st: null, el: null, file: null, zone: null, watch: null, open: false, msg: {} };
  function wizState() {
    if (!wiz.st) { var s = X.store.get('mbw', null); wiz.st = s && typeof s === 'object' && s.z ? s : { z: {} }; }
    return wiz.st;
  }
  function wizSave() { X.store.set('mbw', wizState()); }
  function itemById(id) { return items.filter(function (x) { return x.id === id; })[0] || null; }
  // met l'état en accord avec les captures existantes (une capture supprimée libère sa zone)
  function wizSync() {
    if (!X || !wiz.loaded) return;
    var S = wizState(), ch = false;
    Object.keys(S.z).forEach(function (k) {
      var e = S.z[k], it = itemById(e.id);
      if (!zoneById(k) || !it) { delete S.z[k]; ch = true; return; }
      var st = it.tf ? (e.st === 'fail' ? 'ok' : e.st) : 'fail';
      if (st !== e.st) { e.st = st; ch = true; }
    });
    if (ch) wizSave();
    wizCta();
    if (wiz.open) wizRender();
  }
  function wizDone() { var S = wizState(); return ZONES.filter(function (z) { var e = S.z[z.id]; return e && e.st !== 'fail'; }).length; }

  function wizCss() {
    if (document.getElementById('mbwStyle')) return;
    var st = document.createElement('style'); st.id = 'mbwStyle';
    st.textContent = [
      '.mbw-cta{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;margin:4px 0 10px;padding:10px 12px;border-radius:16px;text-align:left;color:var(--text,#eef3ff);',
      'border:1px solid rgba(255,46,151,.6);background:linear-gradient(135deg,rgba(255,46,151,.22),rgba(34,230,255,.10));box-shadow:0 0 18px rgba(255,46,151,.25)}',
      '.mbw-cta:active{transform:scale(.99)}',
      '.mbw-cta .mbw-ci{flex:0 0 40px;width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:var(--pink,#ff2e97);color:#fff;font-weight:800;font-size:18px}',
      '.mbw-cta b{display:block;font-size:17px;line-height:1.15}.mbw-cta small{display:block;color:var(--muted,#a3acd6);font-size:13px;font-weight:600;margin-top:2px}',
      '.mbw-cta .mbw-cbar{display:block;height:5px;border-radius:3px;background:rgba(255,255,255,.12);margin-top:6px;overflow:hidden}.mbw-cta .mbw-cbar i{display:block;height:100%;background:var(--ok,#4dffa6)}',
      '.mbw{position:absolute;inset:0;z-index:2400;display:flex;flex-direction:column;background:var(--bg,#070b1f);color:var(--text,#eef3ff)}',
      '@media (min-width:700px){.mbw{background:rgba(3,5,18,.78);align-items:center}.mbw>.mbw-in{width:min(600px,100%);border-left:1px solid rgba(255,46,151,.35);border-right:1px solid rgba(255,46,151,.35)}}',
      '.mbw>.mbw-in{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--bg,#070b1f)}',
      'body.mbw-open #toast{z-index:2450}',
      '.mbw-head{padding:calc(8px + var(--sat,0px)) 10px 10px 16px;border-bottom:1px solid var(--line,rgba(120,140,255,.18))}',
      '.mbw-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.mbw-top h2{margin:0;font-size:20px;line-height:1.15;color:var(--cyan,#22e6ff)}',
      '.mbw-prog{display:flex;align-items:center;gap:10px;margin-top:8px;font-weight:700}.mbw-bar{flex:1;height:10px;border-radius:5px;background:rgba(255,255,255,.1);overflow:hidden}',
      '.mbw-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--ok,#4dffa6),var(--cyan,#22e6ff));transition:width .3s}',
      '.mbw-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:10px 12px 16px}',
      '.mbw-intro{margin:2px 4px 10px;color:var(--muted,#a3acd6);font-size:15px;line-height:1.35}',
      '.mbw-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}',
      '.mbw-z{border:1px solid rgba(160,170,255,.28);border-radius:16px;padding:10px;background:rgba(255,255,255,.03)}',
      '.mbw-z.ok{border-color:rgba(77,255,166,.6);background:rgba(77,255,166,.06)}.mbw-z.mid{border-color:rgba(255,225,77,.6)}.mbw-z.fail{border-color:rgba(255,90,130,.6)}',
      '.mbw-z.cur{box-shadow:0 0 0 1px rgba(34,230,255,.5),0 0 16px rgba(34,230,255,.2)}',
      '.mbw-zh{display:flex;gap:10px;align-items:flex-start}',
      '.mbw-map{flex:0 0 76px;width:76px;height:auto}.mbw-map path{fill:#1c1648;stroke:#33e1ff;stroke-width:.8}',
      '.mbw-map .zr{fill:rgba(255,46,151,.35);stroke:var(--pink,#ff2e97);stroke-width:2}.mbw-map .zd{fill:rgba(77,255,166,.22);stroke:none}',
      '.mbw-zt{flex:1;min-width:0}.mbw-zt b{display:block;font-size:17px;line-height:1.2}',
      '.mbw-num{display:inline-grid;place-items:center;width:24px;height:24px;margin-right:6px;border-radius:50%;background:rgba(255,255,255,.12);font-size:14px;vertical-align:1px}',
      '.mbw-z.ok .mbw-num{background:var(--ok,#4dffa6);color:#04220f}.mbw-z.mid .mbw-num{background:#ffe14d;color:#2a2200}.mbw-z.fail .mbw-num{background:#ff5a82;color:#fff}',
      '.mbw-st{display:block;margin-top:3px;font-size:14px;font-weight:700;color:var(--muted,#a3acd6)}.mbw-z.ok .mbw-st{color:var(--ok,#4dffa6)}.mbw-z.mid .mbw-st{color:#ffe14d}.mbw-z.fail .mbw-st{color:#ff7b9c}',
      '.mbw-th{flex:0 0 78px;width:78px;height:52px;object-fit:cover;border-radius:8px;border:1px solid rgba(77,255,166,.6)}',
      '.mbw-how{margin:8px 2px 0;font-size:15px;line-height:1.4}.mbw-how b{color:var(--cyan,#22e6ff)}',
      '.mbw-note{margin:8px 2px 0;font-size:14px;line-height:1.35;color:#ffe14d}.mbw-z.fail .mbw-note{color:#ff9fb6}.mbw-z.ok .mbw-note{color:var(--ok,#4dffa6)}',
      '.mbw-z .btn{width:100%;margin-top:8px;min-height:48px}',
      '.mbw-foot{padding:10px 12px calc(10px + var(--sab,0px));border-top:1px solid var(--line,rgba(120,140,255,.18))}',
      '.mbw-foot .btn{width:100%;min-height:52px;font-size:17px}.mbw-foot .btn[disabled]{opacity:.45}',
      '.mbw-offer{position:absolute;inset:0;z-index:2350;display:grid;place-items:end center;background:rgba(3,5,18,.55);padding:12px 12px calc(12px + var(--sab,0px))}',
      '@media (min-width:700px){.mbw-offer{place-items:center}}',
      '.mbw-ob{width:min(460px,100%);border-radius:20px;padding:16px;background:var(--bg2,#0d1235);border:1px solid rgba(255,46,151,.55);box-shadow:0 0 40px rgba(255,46,151,.3)}',
      '.mbw-ob h2{margin:0 0 6px;font-size:20px;color:var(--cyan,#22e6ff)}.mbw-ob p{margin:0 0 12px;font-size:15px;line-height:1.4;color:var(--text,#eef3ff)}',
      '.mbw-ob .rowbtns{display:flex;gap:8px}.mbw-ob .btn{flex:1;min-height:50px}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function zoneSvg(z) {
    if (!miniBox) return '';
    var m = miniBox, S = wizState(), d = '';
    var R = function (zz, cls) {
      var b = zoneBox(zz), x = (b[0] - m.b[0]) * m.sx, y = (m.b[3] - b[3]) * m.sy;
      return '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + ((b[2] - b[0]) * m.sx).toFixed(1) + '" height="' + ((b[3] - b[1]) * m.sy).toFixed(1) + '" rx="2"/>';
    };
    ZONES.forEach(function (zz) { var e = S.z[zz.id]; if (zz !== z && e && e.st !== 'fail') d += R(zz, 'zd'); });
    return '<svg class="mbw-map" viewBox="-4 -4 ' + (m.W + 8) + ' ' + (m.H + 8) + '" aria-hidden="true">' + d + '<path d="' + miniPath + '"/>' + R(z, 'zr') + '</svg>';
  }
  function wizCta() {
    var sec = $('mybgSec');
    if (!sec) return;
    var b = $('mbwOpen');
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.id = 'mbwOpen'; b.className = 'mbw-cta';
      var ref = sec.querySelector('#mybgList') || sec.querySelector('#mybgImport');
      if (ref) sec.insertBefore(b, ref); else sec.appendChild(b);
      b.addEventListener('click', function () { wizOpen(); });
    }
    var n = wizDone();
    b.innerHTML = '<span class="mbw-ci">6</span><span style="flex:1;min-width:0"><b>Ma carte du jeu en 6 photos</b><small>' +
      (n ? (n >= ZONES.length ? 'Carte complète ✓ · ' : 'Reprendre · ') + n + '/' + ZONES.length + ' zones' : 'Assistant guidé : la vraie carte du jeu sous tes points') +
      '</small>' + (n ? '<span class="mbw-cbar"><i style="width:' + Math.round(100 * n / ZONES.length) + '%"></i></span>' : '') + '</span>';
  }
  function wizBuild() {
    if (wiz.el) return;
    wizCss();
    var el = document.createElement('div');
    el.id = 'mbw'; el.className = 'mbw'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'mbwT');
    el.innerHTML = '<div class="mbw-in"><div class="mbw-head"><div class="mbw-top"><h2 id="mbwT">Ma carte du jeu en 6 photos</h2>' +
      '<button id="mbwX" class="iconbtn" type="button" aria-label="Fermer l\'assistant">' + ICONS.use('ui_close') + '</button></div>' +
      '<div class="mbw-prog"><div class="mbw-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + ZONES.length + '"><i></i></div><span id="mbwN">0/' + ZONES.length + '</span></div></div>' +
      '<div class="mbw-body"><p class="mbw-intro">Pour chaque zone : ouvre la carte dans le jeu, cadre-la comme indiqué, fais une capture (bouton <b>Create</b> de la manette, ou photo de la télé <b>bien de face</b>), puis importe-la ici. L\'app la place toute seule. Tes photos restent sur ton téléphone.</p>' +
      '<ol class="mbw-list" id="mbwList"></ol></div>' +
      '<div class="mbw-foot"><button id="mbwGo" class="btn primary" type="button">' + ICONS.use('ui_check') + '<span>Voir ma carte</span></button></div></div>';
    var f = document.createElement('input');
    f.type = 'file'; f.accept = 'image/*'; f.id = 'mbwFile'; f.className = 'vh'; f.tabIndex = -1; f.setAttribute('aria-hidden', 'true');
    el.appendChild(f);
    document.body.appendChild(el);
    wiz.el = el; wiz.file = f;
    $('mbwX').addEventListener('click', function () { wizClose(); });
    $('mbwGo').addEventListener('click', wizShowMap);
    f.addEventListener('change', function () { var z = wiz.zone, fl = this.files && this.files[0]; if (z && fl) wizImport(z, fl); });
    $('mbwList').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-a]') : null; if (!b) return;
      var z = zoneById(b.getAttribute('data-z')), a = b.getAttribute('data-a'); if (!z) return;
      if (a === 'imp') { wiz.zone = z; wiz.file.value = ''; wiz.file.click(); }
      else if (a === 'man') wizManual(z);
      else if (a === 'chk') wizCheck(z);
    });
  }
  function wizRender() {
    if (!wiz.el) return;
    var S = wizState(), n = wizDone(), cur = null, h = '';
    ZONES.forEach(function (z) { var e = S.z[z.id]; if (!cur && (!e || e.st === 'fail')) cur = z; });
    ZONES.forEach(function (z, i) {
      var e = S.z[z.id], it = e ? itemById(e.id) : null, st = e ? e.st : 'todo', m = wiz.msg[z.id] || '';
      var lab = st === 'ok' ? 'Calée ✓' : st === 'mid' ? 'Calée : à vérifier' : st === 'fail' ? 'Pas encore calée' : 'À faire';
      h += '<li class="mbw-z ' + st + (z === cur ? ' cur' : '') + '" data-z="' + z.id + '"><div class="mbw-zh">' + zoneSvg(z) +
        '<div class="mbw-zt"><b><span class="mbw-num">' + (st === 'ok' || st === 'mid' ? '✓' : i + 1) + '</span>' + X.esc(z.n) + '</b><span class="mbw-st">' + lab + '</span></div>' +
        (it && it.tf ? '<img class="mbw-th" alt="" src="' + X.esc(it.url) + '">' : '') + '</div>';
      if (st !== 'ok' && st !== 'mid') {
        h += '<p class="mbw-how">Dans le jeu, centre la carte sur <b>' + X.esc(z.on) + '</b>, zoome jusqu\'à voir à la fois <b>' + X.esc(z.a) + '</b> et <b>' + X.esc(z.b) +
          '</b>, puis capture avec le bouton <b>Create</b> (ou prends une photo bien de face).</p>';
      }
      if (m) h += '<p class="mbw-note">' + X.esc(m) + '</p>';
      if (st === 'fail' && it) h += '<button type="button" class="btn primary" data-a="man" data-z="' + z.id + '">' + ICONS.use('ui_center') + 'Caler à la main (repères de cette zone)</button>';
      if (st === 'mid') h += '<button type="button" class="btn" data-a="chk" data-z="' + z.id + '">' + ICONS.use('ui_move') + 'Vérifier le calage</button>';
      h += '<button type="button" class="btn' + (st === 'todo' ? ' primary' : '') + '" data-a="imp" data-z="' + z.id + '">' + ICONS.use('ui_upload') +
        (st === 'todo' ? 'Importer la photo de cette zone' : st === 'fail' ? 'Importer une autre photo' : 'Remplacer la photo') + '</button></li>';
    });
    $('mbwList').innerHTML = h;
    $('mbwN').textContent = n + '/' + ZONES.length + ' zones';
    var bar = wiz.el.querySelector('.mbw-bar'); bar.setAttribute('aria-valuenow', n);
    bar.firstChild.style.width = Math.round(100 * n / ZONES.length) + '%';
    var go = $('mbwGo'); go.disabled = !n;
    go.lastChild.textContent = n >= ZONES.length ? 'Voir ma carte complète' : 'Voir ma carte';
  }
  function wizOpen() {
    if (!X) return;
    wizBuild(); wizSync();
    X.closeSheet(); if (!X.isWide()) X.closePanel();
    wiz.open = true; wiz.el.hidden = false; document.body.classList.add('mbw-open');
    var o = $('mbwOffer'); if (o) o.remove();
    wizRender();
    var c = wiz.el.querySelector('.mbw-z.cur'); if (c && c.scrollIntoView) { try { c.scrollIntoView({ block: 'nearest' }); } catch (e) { /* */ } }
  }
  function wizHide() { if (wiz.el) wiz.el.hidden = true; document.body.classList.remove('mbw-open'); }
  function wizClose() { wiz.open = false; wiz.watch = null; wizHide(); wizCta(); }
  // quitte l'assistant et montre tout l'État avec toutes les captures de l'assistant
  function wizShowMap() {
    var S = wizState();
    Object.keys(S.z).forEach(function (k) { var it = itemById(S.z[k].id); if (it && it.tf && !it.show) { it.show = true; saveMeta(it); } });
    syncLayers(); renderList();
    wizClose();
    X.closeSheet(); if (!X.isWide()) X.closePanel();
    var b = X.land && X.land.bbox;
    if (b) X.map.fitBounds(L.latLngBounds([[b[1], b[0]], [b[3], b[2]]]), { padding: [12, 12], animate: false });
    var n = wizDone();
    X.toast(n >= ZONES.length ? 'Ta carte du jeu est complète ✓' : 'Ta carte du jeu : ' + n + '/' + ZONES.length + ' zones. Reprends l\'assistant quand tu veux.');
  }
  function zoneCovers(z, it) {
    var b = worldBox(it), zb = zoneBox(z), c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], zb2 = zoneBox(z, 1.3);
    return (c[0] >= zb2[0] && c[0] <= zb2[2] && c[1] >= zb2[1] && c[1] <= zb2[3]) || boxInter(b, zb) >= 0.35 * (zb[2] - zb[0]) * (zb[3] - zb[1]);
  }
  function zoneOf(it) {
    var b = worldBox(it), best = null, bi = 0;
    ZONES.forEach(function (z) { var v = boxInter(b, zoneBox(z)) / (z.w * z.h); if (v > bi) { bi = v; best = z; } });
    return best;
  }
  function quietRemove(it) {
    if (it.layer && X.map.hasLayer(it.layer)) X.map.removeLayer(it.layer);
    items = items.filter(function (x) { return x !== it; });
    delete nbCache[it.id];
    try { if (String(it.url).indexOf('blob:') === 0) URL.revokeObjectURL(it.url); } catch (e) { /* */ }
    removeStored(it.id);
  }
  function wizImport(z, file) {
    if (file.type && file.type.indexOf('image/') !== 0) { wiz.msg[z.id] = 'Ce fichier n\'est pas une image.'; wizRender(); return; }
    var lab = z.n;
    busyShow(lab + ' : préparation…'); busyProg(0);
    importFile(file).then(function (o) {
      var it = o.it;
      it.name = z.n; saveMeta(it);
      if (o.pre) return { it: it, conf: 'good' };
      if (!autoOn()) return { it: it, conf: 'bad' };
      busyShow(lab + ' : calage automatique…');
      var pg = function (p) { busyProg(p); };
      pg.msg = function (m) { busyShow(lab + ' : ' + (/^Calage automatique : /.test(m) ? m.replace(/^Calage automatique : /, '') : 'calage automatique…')); };
      return autoCalibrate(it, pg, { zone: z }).then(function (a) {
        lastAuto = autoInfo(it, a); autoLog.push(lastAuto);
        var ok = a.tf && a.conf !== 'bad';
        if (ok) { it.tf = copyT(a.tf); it.pts = []; it.show = true; saveMeta(it); }
        return { it: it, conf: ok ? a.conf : 'bad', a: a };
      }, function () { return { it: it, conf: 'bad' }; });
    }).then(function (r) {
      busyShow(''); busyProg(null);
      var S = wizState(), it = r.it, target = z, note = '';
      if (it.tf && !zoneCovers(z, it)) {
        var z2 = zoneOf(it);
        if (z2 && z2 !== z) { target = z2; note = 'Cette photo montre plutôt « ' + z2.n + ' » : elle a été rangée dans cette zone.'; it.name = z2.n; saveMeta(it); }
      }
      var prev = S.z[target.id], old = prev ? itemById(prev.id) : null;
      S.z[target.id] = { id: it.id, st: it.tf ? (r.conf === 'mid' ? 'mid' : 'ok') : 'fail' };
      // nouvelle photo bien calée pour la même zone : l'ancienne est remplacée
      if (it.tf && old && old !== it && target === z) quietRemove(old);
      wizSave();
      var how = r.a && r.a.r ? r.a.r.method : '';
      wiz.msg[z.id] = ''; wiz.msg[target.id] = '';
      if (note) wiz.msg[z.id] = note;
      if (!it.tf) wiz.msg[target.id] = 'L\'app n\'a pas réussi à placer cette photo toute seule. Touche « Caler à la main » : elle te propose les repères de cette zone.';
      else if (r.conf === 'mid') wiz.msg[target.id] = (note ? note + ' ' : '') + 'Placée, mais l\'app n\'est pas sûre d\'elle : touche « Vérifier le calage ».';
      else if (note) wiz.msg[target.id] = note;
      else wiz.msg[target.id] = how === 'voisin' ? 'Placée en la comparant à ta capture « ' + ((r.a && r.a.nbName) || 'voisine') + ' » ✓' : how && how.indexOf('noms') === 0 ? 'Placée grâce aux noms de lieux lus ✓' : 'Placée automatiquement ✓';
      syncLayers(); renderList(); wizCta(); wizRender();
      var c = wiz.el.querySelector('.mbw-z[data-z="' + target.id + '"]'); if (c && c.scrollIntoView) { try { c.scrollIntoView({ block: 'nearest' }); } catch (e) { /* */ } }
    }).catch(function () {
      busyShow(''); busyProg(null);
      wiz.msg[z.id] = 'Impossible de lire cette image. Essaie une capture en JPEG ou PNG.'; wizRender();
    });
  }
  function wizManual(z) {
    var e = wizState().z[z.id], it = e ? itemById(e.id) : null; if (!it) return;
    wiz.watch = { z: z.id, id: it.id, ok: false };
    wizHide();
    calOpen(it, false, 'Place 2 repères de la zone « ' + z.n + ' » sur ta photo.', { zone: z });
  }
  function wizCheck(z) {
    var e = wizState().z[z.id], it = e ? itemById(e.id) : null; if (!it || !it.tf) return;
    wiz.watch = { z: z.id, id: it.id, ok: false };
    wizHide();
    adjOpen(it, true, { auto: 'mid', prev: copyT(it.tf) });
    fitTo(it);
  }
  // retour dans l'assistant quand le calage à la main / la vérification est terminé
  function wizBack() {
    if (!wiz.watch || cal || adj) return;
    var w = wiz.watch, S = wizState(), e = S.z[w.z], it = itemById(w.id);
    wiz.watch = null;
    if (e && it && e.id === it.id) {
      if (it.tf && (w.ok || e.st === 'fail')) { e.st = w.ok ? 'ok' : 'mid'; wiz.msg[w.z] = w.ok ? 'Calée ✓' : 'Placée : vérifie-la si besoin.'; }
      wizSave();
    }
    syncLayers(); renderList();
    if (wiz.open) { wiz.el.hidden = false; document.body.classList.add('mbw-open'); wizCta(); wizRender(); }
  }
  // proposé une fois à l'ouverture, s'il n'y a encore aucune capture
  function wizOffer() {
    if (items.length || X.store.get('mbwOffer', false) || (navigator.webdriver && !window.__MBW_OFFER)) return;
    var tries = 0;
    var go = function () {
      if (items.length || X.store.get('mbwOffer', false)) return;
      var busy = !document.body.classList.contains('ready') || cal || adj || wiz.open || !$('busy').hidden || (document.querySelector('.modal:not([hidden])'));
      if (busy) { if (++tries < 40) setTimeout(go, 500); return; }
      wizCss();
      var d = document.createElement('div');
      d.id = 'mbwOffer'; d.className = 'mbw-offer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'mbwOfferT');
      d.innerHTML = '<div class="mbw-ob"><h2 id="mbwOfferT">Voir la vraie carte du jeu ?</h2><p>Avec <b>6 photos</b> de la carte du jeu (captures ou photos de ta télé), l\'app affiche la vraie carte sous tes points. L\'assistant te guide zone par zone ; tout reste sur ton téléphone.</p>' +
        '<div class="rowbtns"><button type="button" class="btn" id="mbwLater">Plus tard</button><button type="button" class="btn primary" id="mbwStart">Commencer</button></div></div>';
      document.body.appendChild(d);
      X.store.set('mbwOffer', true);
      $('mbwLater').addEventListener('click', function () { d.remove(); X.toast('L\'assistant reste dans le menu, rubrique « Mon fond de carte ».'); });
      $('mbwStart').addEventListener('click', function () { d.remove(); wizOpen(); });
    };
    setTimeout(go, 900);
  }

  /* ---------- « Où est-ce sur ma photo ? » ----------
     L'utilisateur photographie (ou capture) la carte du jeu centrée sur la zone d'un point ; l'app cale la photo autour de ce
     point (redressement, noms lus, icônes du jeu, voisinage, côtes) et montre SA photo avec un repère clignotant à l'endroit
     exact du point. Si l'app n'est pas sûre : mode guidé (toucher 2 icônes du jeu sur la photo). */
  var loc = null, locMap = null, locLayers = null, mById = null;
  function markerById(id) {
    if (!mById) { mById = {}; X.markers.forEach(function (m) { mById[m.id] = m; }); }
    return mById[id] || null;
  }
  function ingameCat(c) { var A = window.GTA6_APP; try { return !!(A && A.inGame && A.inGame(c)); } catch (e) { return false; } }
  // icônes permanentes de la carte du jeu (magasins, services) : affichées par défaut et bien placées dans les données.
  // Les catégories très nombreuses (distributeurs, cascades, véhicules, objets à ramasser…) brouilleraient l'appariement.
  var ICON_CATS = ['ammu-nation-standard', 'ammu-nation-high-end', 'ammu-nation-hunting', 'ammu-nation-pawn', 'casual-street', 'sportswear', 'formal',
    'souvenir-swimwear', 'thrift', 'footwear', 'haircut', 'tattoo', 'electronics', 'gym', 'pay-n-spray', 'vehicle-mod-shop', 'car-wash', 'gas-station',
    'bank', 'big-bank', 'payday-loan', 'nightclub', 'convenience-store', 'liquor-store', 'bar', 'cafe-takeout', 'food-and-drink', 'garage', 'safehouse',
    'impound', 'golf', 'shooting-range', 'fence', 'train-station'];
  function iconsAround(x, y, R) {
    var pick = function (all) {
      var K = [], seen = [];
      X.markers.forEach(function (m) {
        if (Math.abs(m.x - x) > R || Math.abs(m.y - y) > R || !ingameCat(m.c) || (!all && ICON_CATS.indexOf(m.c) < 0)) return;
        for (var i = 0; i < seen.length; i += 2) if (Math.abs(seen[i] - m.x) < 25 && Math.abs(seen[i + 1] - m.y) < 25) return;
        seen.push(m.x, m.y); K.push(m.x, m.y);
      });
      return K;
    };
    var K = pick(false);
    return K.length >= 16 ? K : pick(true); // campagne : peu de magasins, on prend toutes les icônes visibles en jeu
  }
  var DIRS = ['est', 'nord-est', 'nord', 'nord-ouest', 'ouest', 'sud-ouest', 'sud', 'sud-est'];
  function dirName(dx, dy) { var a = Math.atan2(dy, dx); return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]; }
  function rnd10(d) { return d < 100 ? Math.round(d / 10) * 10 : Math.round(d / 50) * 50; }
  // 2 icônes du jeu pour le mode guidé : les repères « r » du point, sinon les icônes visibles en jeu les plus proches
  function locRefs(m) {
    var out = [];
    // repères « r » du point : résolus par app.js (m.refs : { m, x, y, label }) ou bruts (m.r0 / m.r : { id, label })
    (Array.isArray(m.refs) ? m.refs.map(function (r) { return { id: r.m && r.m.id, label: r.label, t: r.m || null }; }) : (m.r0 || m.r || [])).forEach(function (r) {
      var t = r && (r.t || markerById(r.id));
      if (t && out.length < 2 && !out.some(function (o) { return Math.hypot(o.x - t.x, o.y - t.y) < 60; })) {
        out.push({ x: t.x, y: t.y, n: (r.label || ('icône ' + (X.cats[t.c] ? X.cats[t.c].n : ''))).replace(/^icône /, ''), dir: dirName(m.x - t.x, m.y - t.y), dist: rnd10(Math.hypot(m.x - t.x, m.y - t.y)) });
      }
    });
    if (out.length < 2) {
      var C = X.markers.filter(function (t) { return t !== m && ingameCat(t.c) && Math.hypot(t.x - m.x, t.y - m.y) < 1500; });
      C.sort(function (p, q) { return Math.hypot(p.x - m.x, p.y - m.y) - Math.hypot(q.x - m.x, q.y - m.y); });
      for (var i = 0; i < C.length && out.length < 2; i++) {
        var t = C[i];
        if (out.some(function (o) { return Math.hypot(o.x - t.x, o.y - t.y) < 150; })) continue;
        out.push({ x: t.x, y: t.y, n: (X.cats[t.c] ? X.cats[t.c].n : 'icône') + ' (« ' + t.n + ' »)', dir: dirName(m.x - t.x, m.y - t.y), dist: rnd10(Math.hypot(m.x - t.x, m.y - t.y)) });
      }
    }
    return out;
  }
  function locCss() {
    if (document.getElementById('mblStyle')) return;
    var st = document.createElement('style'); st.id = 'mblStyle';
    st.textContent = [
      '.mbl{position:absolute;inset:0;z-index:2420;display:flex;flex-direction:column;background:#03050f;color:var(--text,#eef3ff)}',
      'body.mbl-open #toast{z-index:2450}',
      '.mbl-top{display:flex;align-items:center;gap:10px;padding:calc(8px + var(--sat,0px)) 10px 8px 14px;background:var(--bg,#070b1f);border-bottom:1px solid rgba(255,46,151,.45)}',
      '.mbl-top div{flex:1;min-width:0}.mbl-top b{display:block;font-size:18px;line-height:1.15;color:var(--cyan,#22e6ff);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mbl-top small{display:block;color:var(--muted,#a3acd6);font-size:13px;font-weight:600}',
      '.mbl-map{flex:1;min-height:0;background:#03050f}',
      '.mbl-card{padding:10px 12px calc(12px + var(--sab,0px));background:var(--panel,rgba(11,15,40,.96));border-top:1px solid rgba(34,230,255,.5)}',
      '.mbl-card p{margin:0 2px 8px;font-size:15px;line-height:1.4}.mbl-card p b{color:var(--cyan,#22e6ff)}.mbl-card p.ok b.q{color:var(--ok,#4dffa6)}.mbl-card p.mid b.q{color:#ffe14d}',
      '.mbl-card .rowbtns{display:flex;gap:8px;flex-wrap:wrap}.mbl-card .btn{flex:1 1 140px;min-height:48px}',
      '@media (min-width:900px){.mbl-card{display:flex;align-items:center;gap:12px}.mbl-card p{flex:1;margin:0}}',
      '.mbl-pt{pointer-events:none}.mbl-pt i{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:var(--pink,#ff2e97);border:3px solid #fff;box-shadow:0 0 0 2px #000,0 0 16px var(--pink,#ff2e97);animation:mblBlink 1s steps(2,start) infinite}',
      '.mbl-pt b{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:4px solid var(--pink,#ff2e97);box-shadow:0 0 0 2px rgba(0,0,0,.6);animation:mblPulse 1.3s ease-out infinite}',
      '.mbl-pt span{position:absolute;left:50%;top:50%;width:2px;height:100px;margin:-50px 0 0 -1px;background:rgba(255,255,255,.9);box-shadow:0 0 0 1px #000}.mbl-pt span+span{width:100px;height:2px;margin:-1px 0 0 -50px}',
      '@keyframes mblBlink{to{visibility:hidden}}@keyframes mblPulse{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.4);opacity:0}}',
      '.mbl-tap{pointer-events:none}.mbl-tap span{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--cyan,#22e6ff);color:#04122a;font-weight:800;border:2px solid #fff;box-shadow:0 0 0 2px #000}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function locBuild() {
    if ($('mbl')) return;
    locCss();
    var el = document.createElement('div');
    el.id = 'mbl'; el.className = 'mbl'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'mblT');
    el.innerHTML = '<div class="mbl-top"><div><b id="mblT"></b><small id="mblSub">sur ta photo</small></div>' +
      '<button id="mblX" class="iconbtn" type="button" aria-label="Fermer">' + ICONS.use('ui_close') + '</button></div>' +
      '<div class="mbl-map" id="mblMap"></div><div class="mbl-card" id="mblCard"></div>';
    var f = document.createElement('input');
    f.type = 'file'; f.accept = 'image/*'; f.id = 'mblFile'; f.className = 'vh'; f.tabIndex = -1; f.setAttribute('aria-hidden', 'true');
    el.appendChild(f);
    document.body.appendChild(el);
    $('mblX').addEventListener('click', locClose);
    f.addEventListener('change', function () { var m = loc && loc.m, fl = this.files && this.files[0]; if (m && fl) locRun(m, fl); });
    L.DomEvent.disableClickPropagation($('mblCard'));
  }
  // point d'entrée : fiche d'un point -> « Trouver ce point sur ma photo »
  function locateOnPhoto(m) {
    if (!X || !m || typeof m.x !== 'number' || typeof m.y !== 'number') return;
    locBuild();
    if (loc && loc.it && !loc.kept) quietRemove(loc.it);
    loc = { m: m, it: null };
    var f = $('mblFile'); f.value = ''; f.click();
  }
  function locRun(m, file) {
    var lab = '« ' + m.n + ' »';
    X.closeSheet();
    busyShow(lab + ' : préparation de ta photo…'); busyProg(0);
    importFile(file).then(function (o) {
      var it = o.it; it.tmp = true; it.name = 'Photo : ' + m.n; loc.it = it;
      if (o.pre) return { conf: 'good', tf: copyT(it.tf), r: { method: 'preset' }, sig: 60 };
      it.tf = null;
      var pg = function (p) { busyProg(p); };
      pg.msg = function (m2) { busyShow(lab + ' : ' + (/^Calage automatique : /.test(m2) ? m2.replace(/^Calage automatique : /, '') : 'recherche sur ta photo…')); };
      busyShow(lab + ' : recherche sur ta photo…');
      return autoCalibrate(it, pg, { zone: { id: 'loc', n: m.n, x: m.x, y: m.y, w: 4000, h: 2250 }, icons: { K: iconsAround(m.x, m.y, 3000), near: { x: m.x, y: m.y } } });
    }).then(function (a) {
      busyShow(''); busyProg(null);
      var it = loc.it;
      lastAuto = autoInfo(it, a); autoLog.push(lastAuto);
      var tf = a.tf && a.conf !== 'bad' ? a.tf : null, pt = null;
      if (tf) {
        pt = invPt(tf, m.x, m.y);
        if (!(pt[0] > -0.02 * it.w && pt[0] < 1.02 * it.w && pt[1] > -0.02 * it.h && pt[1] < 1.02 * it.h)) { tf = null; pt = null; } // le point doit être sur la photo
      }
      var r = a.r || {}, s = tf ? scaleOf(tf) : 0;
      loc.tf = tf; loc.conf = tf ? a.conf : 'bad'; loc.method = r.method || ''; loc.pt = pt;
      loc.sig = tf ? (a.sig || (r.method === 'voisin' ? 4 * s : r.method && r.method.indexOf('noms') === 0 ? 60 : 0.006 * s * it.w)) : 0;
      loc.refs = locRefs(m); loc.taps = []; loc.step = -1;
      locShow();
      if (!tf) locGuide();
    }).catch(function () {
      busyShow(''); busyProg(null);
      X.toast('Impossible de lire cette photo. Essaie une capture en JPEG ou PNG.');
      if (loc && loc.it) quietRemove(loc.it);
      loc = null; renderList();
    });
  }
  function invPt(t, x, y) { var det = t.a * t.e - t.b * t.d, X2 = x - t.c, Y2 = y - t.f; return [(t.e * X2 - t.b * Y2) / det, (-t.d * X2 + t.a * Y2) / det]; }
  function locShow() {
    var it = loc.it, el = $('mbl');
    el.hidden = false; document.body.classList.add('mbl-open');
    $('mblT').textContent = loc.m.n;
    if (!locMap) {
      locMap = L.map('mblMap', { crs: L.CRS.Simple, zoomControl: false, attributionControl: false, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: -6, maxZoom: 3, bounceAtZoomLimits: false, tapTolerance: 12 });
      locMap.on('click', function (e) { locTap(e.latlng.lng, -e.latlng.lat); });
    }
    if (locLayers) locLayers.remove();
    locLayers = L.layerGroup().addTo(locMap);
    L.imageOverlay(it.url, [[-it.h, 0], [0, it.w]]).addTo(locLayers);
    locMap.invalidateSize();
    locMap.setMinZoom(-6);
    locMap.fitBounds([[-it.h, 0], [0, it.w]], { animate: false, padding: [4, 4] });
    var z0 = locMap.getZoom();
    locMap.setMinZoom(z0 - 1);
    // zoom sur le point (la photo est souvent en paysage sur un téléphone en portrait)
    if (loc.pt) locMap.setView([-loc.pt[1], loc.pt[0]], z0 + (X.isWide() ? 0.75 : 1.5), { animate: false });
    locDraw();
  }
  function locDraw() {
    if (!loc || !locMap) return;
    if (loc.marks) loc.marks.remove();
    loc.marks = L.layerGroup().addTo(locLayers);
    var it = loc.it, tf = loc.tf, m = loc.m;
    if (tf && loc.pt) {
      var s = scaleOf(tf);
      // les autres points proches (petits)
      var near = X.markers.filter(function (o) { return o !== m && Math.abs(o.x - m.x) < s * it.w && Math.abs(o.y - m.y) < s * it.h; }).map(function (o) {
        var q = invPt(tf, o.x, o.y); return { o: o, u: q[0], v: q[1], d: Math.hypot(q[0] - loc.pt[0], q[1] - loc.pt[1]) };
      }).filter(function (q) { return q.u >= 0 && q.u <= it.w && q.v >= 0 && q.v <= it.h; });
      near.sort(function (p, q) { return p.d - q.d; });
      var drawn = [], minD = 0.012 * Math.max(it.w, it.h);
      near.forEach(function (q) {
        if (drawn.length >= 12 || q.d < 2 * minD || drawn.some(function (p) { return Math.hypot(p.u - q.u, p.v - q.v) < minD; })) return;
        drawn.push(q);
        var c = X.cats[q.o.c];
        L.circleMarker([-q.v, q.u], { radius: 4, weight: 1, color: '#fff', fillColor: c ? c.color : '#ccc', fillOpacity: 0.85, opacity: 0.9, interactive: true })
          .bindTooltip(X.esc(q.o.n), { direction: 'top' }).addTo(loc.marks);
      });
      L.circle([-loc.pt[1], loc.pt[0]], { radius: Math.max(6, loc.sig / s), color: '#ff2e97', weight: 2, dashArray: '6 5', fillColor: '#ff2e97', fillOpacity: 0.12, interactive: false }).addTo(loc.marks);
      L.marker([-loc.pt[1], loc.pt[0]], { interactive: false, keyboard: false, zIndexOffset: 1000,
        icon: L.divIcon({ className: 'mbl-pt', iconSize: [0, 0], html: '<span></span><span></span><b></b><i></i>' }) }).addTo(loc.marks);
    }
    loc.taps.forEach(function (p, i) {
      L.marker([-p.v, p.u], { interactive: false, icon: L.divIcon({ className: 'mbl-tap', iconSize: [30, 30], html: '<span>' + (i + 1) + '</span>' }) }).addTo(loc.marks);
    });
    locCard();
  }
  var METHOD_TXT = { icones: 'aux icônes du jeu', noms: 'aux noms lus', 'noms+cotes': 'aux noms lus et aux côtes', voisin: 'à tes autres captures', cotes: 'aux côtes', preset: 'à la carte entière', main: 'à tes 2 icônes' };
  function locCard() {
    var c = $('mblCard'), h = '', s = loc.tf ? scaleOf(loc.tf) : 0;
    if (loc.step >= 0) {
      var r = loc.refs[loc.step];
      h = '<p>Étape ' + (loc.step + 1) + ' sur 2 : touche sur ta photo <b>l\'icône ' + X.esc(r.n) + '</b>' + (r.dist ? ' (le point est à ~' + r.dist + ' m ' + (/^[aeiou]/.test(r.dir) ? 'à l\'' : 'au ') + r.dir + ' de cette icône)' : '') +
        '. Zoome avec deux doigts si besoin.</p>' + (loc.step === 0 && !loc.tf ? '<p class="mid">Tu ne vois pas cette icône ? Ta photo est sans doute trop dézoomée : sur la PS5, zoome jusqu\'à voir les icônes des magasins autour du point, puis reprends la photo.</p>' : '') +
        '<div class="rowbtns"><button type="button" class="btn" id="mblCancel">' + ICONS.use('ui_undo') + 'Annuler</button>' + '<button type="button" class="btn" id="mblRetake">' + ICONS.use('ui_image') + 'Reprendre une photo</button>' + '</div>';
    } else if (loc.tf) {
      var acc = Math.max(5, Math.round(loc.sig / 5) * 5);
      h = '<p class="' + (loc.conf === 'good' || loc.conf === 'main' ? 'ok' : 'mid') + '">' + (loc.conf === 'good' || loc.conf === 'main' ?
        '<b class="q">Le point est ici ✓</b> (repère rose qui clignote, précision ~' + acc + ' m), trouvé grâce ' + (METHOD_TXT[loc.method] || 'à ta photo') + '.' :
        '<b class="q">Position probable</b> (à ~' + acc + ' m près) : vérifie que les petits points tombent sur les icônes du jeu. Sinon, montre 2 icônes.') + '</p>' +
        '<div class="rowbtns">' + (loc.refs.length >= 2 ? '<button type="button" class="btn" id="mblGuide">' + ICONS.use('ui_center') + 'Montrer 2 icônes</button>' : '') +
        (loc.kept ? '<button type="button" class="btn" disabled>' + ICONS.use('ui_check') + 'Gardée comme fond</button>' :
          '<button type="button" class="btn primary" id="mblKeep">' + ICONS.use('ui_image') + 'Garder comme fond de carte</button>') + '<button type="button" class="btn" id="mblRetake">' + ICONS.use('ui_image') + 'Reprendre une photo</button>' + '</div>';
    } else {
      h = '<p>L\'app n\'a pas trouvé ce point sur ta photo' + (loc.refs.length >= 2 ? '. Montre-lui 2 icônes, ou reprends une photo plus zoomée (on doit voir les icônes des magasins autour du point).' : ' et il n\'y a pas d\'icône du jeu connue à côté. Reprends une photo plus zoomée, centrée sur le point.') + '</p>' +
        '<div class="rowbtns">' + (loc.refs.length >= 2 ? '<button type="button" class="btn primary" id="mblGuide">' + ICONS.use('ui_center') + 'Montrer 2 icônes</button>' : '') +
        '<button type="button" class="btn" id="mblRetake">' + ICONS.use('ui_image') + 'Reprendre une photo</button>' + '<button type="button" class="btn" id="mblClose2">' + ICONS.use('ui_close') + 'Fermer</button></div>';
    }
    c.innerHTML = h;
    var on = function (id, fn) { var e = $(id); if (e) e.addEventListener('click', fn); };
    on('mblGuide', locGuide); on('mblCancel', function () { loc.step = -1; loc.taps = []; locDraw(); }); on('mblKeep', locKeep); on('mblClose2', locClose); on('mblRetake', locRetake);
  }
  function locRetake() {
    if (!loc) return;
    var m = loc.m;
    if (loc.it && !loc.kept) quietRemove(loc.it);
    loc = { m: m, it: null };
    var f = $('mblFile'); f.value = ''; f.click();
  }
  function locGuide() {
    if (!loc || loc.refs.length < 2) { locCard(); return; }
    loc.step = 0; loc.taps = []; locDraw();
  }
  function locTap(u, v) {
    if (!loc || loc.step < 0) return;
    var it = loc.it;
    if (u < 0 || v < 0 || u > it.w || v > it.h) return;
    if (loc.step === 1 && Math.hypot(u - loc.taps[0].u, v - loc.taps[0].v) < 0.02 * Math.max(it.w, it.h)) { X.toast('Trop près de la première icône : touche l\'autre icône.'); return; }
    var r = loc.refs[loc.step];
    loc.taps.push({ u: u, v: v, x: r.x, y: r.y, n: r.n });
    if (loc.step === 0) { loc.step = 1; locDraw(); return; }
    var t = fitSim(loc.taps);
    loc.step = -1;
    if (!t || !(scaleOf(t) > 0.05 && scaleOf(t) < 60)) { loc.taps = []; X.toast('Ces 2 icônes ne collent pas : recommence.'); locDraw(); return; }
    t.kind = 'sim';
    loc.tf = t; loc.conf = 'main'; loc.method = 'main'; loc.pt = invPt(t, loc.m.x, loc.m.y);
    loc.sig = Math.max(10, 0.3 * ICON_H * it.h * scaleOf(t)); // précision d'un toucher (~1/3 d'icône)
    loc.taps = [];
    locDraw();
    var pt = loc.pt;
    if (pt[0] >= 0 && pt[0] <= it.w && pt[1] >= 0 && pt[1] <= it.h) locMap.panTo([-pt[1], pt[0]]);
    else X.toast('Le point est en dehors de ta photo : reprends une photo centrée sur cette zone.');
  }
  function locKeep() {
    if (!loc || !loc.tf || loc.kept) return;
    var it = loc.it;
    it.tf = copyT(loc.tf); it.pts = []; it.show = true; it.tmp = false; it.name = 'Photo : ' + loc.m.n;
    loc.kept = true;
    saveMeta(it); syncLayers(); renderList();
    X.toast('Photo ajoutée à « Mon fond de carte » ✓');
    locCard();
  }
  function locClose() {
    if (!loc) return;
    if (loc.it && !loc.kept) quietRemove(loc.it);
    loc = null;
    var el = $('mbl'); if (el) el.hidden = true;
    document.body.classList.remove('mbl-open');
    renderList();
  }

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
      if (loc && $('mbl') && !$('mbl').hidden && $('busy').hidden) { if (loc.step >= 0) { loc.step = -1; loc.taps = []; locDraw(); } else locClose(); return; }
      if (wiz.open && !cal && !adj && wiz.el && !wiz.el.hidden && $('busy').hidden) { wizClose(); return; }
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
    wizCta();
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
      wiz.loaded = true;
      syncLayers(); renderList();
      wizOffer();
    }).catch(function () { wiz.loaded = true; wizCta(); /* la carte reste utilisable */ });
  }

  window.GTA6_MYBG = {
    init: init,
    busy: function () { return !!(cal || adj || wiz.open || (loc && $('mbl') && !$('mbl').hidden)); },
    // fiche d'un point : « Trouver ce point sur ma photo » (à appeler depuis un clic : ouvre le sélecteur de photo)
    locateOnPhoto: function (m) { locateOnPhoto(m); },
    openWizard: function () { wizOpen(); },
    setAuto: function (on) { if (X) X.store.set('mybgAuto', !!on); },
    setOcr: function (on) { if (X) X.store.set('mybgOcr', !!on); }, // lecture des noms de lieux (activée par défaut)
    // pour les tests automatisés
    _debug: function () {
      return { memOnly: memOnly, hasDb: !!db, calMap: calMap, cal: cal, adj: adj, rep: REP, auto: lastAuto, autoLog: autoLog, autoOn: autoOn(),
        ocr: { on: X ? ocrOn() : false, supported: ocrSupported(), loaded: !!OCR.w, bad: OCR.bad, lib: !!window.Tesseract },
        items: items.map(function (it) { return { id: it.id, name: it.name, w: it.w, h: it.h, tf: copyT(it.tf), rectified: !!it.rectified, url: it.url, pts: it.pts, show: it.show, op: it.op, onMap: !!(it.layer && X.map.hasLayer(it.layer)), z: it.layer ? it.layer.options.zIndex : 0, bytes: it.blob ? it.blob.size : 0 }; }) };
    },
    // tests : calage automatique d'une image (URL) sans interface ; suppression d'une capture
    _autoTest: function (url, w, h) { return autoCalibrate({ url: url, w: w, h: h }).then(function (o) { return { conf: o.conf, tf: o.tf, r: o.r }; }); },
    _ocr: function (url) { return ocrCalibrate({ url: url }, function () { /* */ }); },
    _wiz: function () { if (!REP.length) resolveReperes(); return { open: wiz.open, state: JSON.parse(JSON.stringify(wizState())), done: wizDone(), zones: ZONES.map(function (z) { return { id: z.id, n: z.n, x: z.x, y: z.y, w: z.w, h: z.h, rep: (z.rep || []).map(function (r) { return r.n; }) }; }), watch: wiz.watch }; },
    _nbTest: function (url, w, h, ids, zoneId) {
      var it = { id: 'test', url: url, w: w, h: h };
      var keep = items; items = items.filter(function (x) { return !ids || ids.indexOf(x.id) >= 0; }).concat([it]);
      var p = nbCalibrate(it, zoneId ? zoneById(zoneId) : null);
      items = keep;
      return p;
    },
    _loc: function () { return loc && { m: { id: loc.m.id, n: loc.m.n, x: loc.m.x, y: loc.m.y }, itemId: loc.it && loc.it.id, w: loc.it && loc.it.w, h: loc.it && loc.it.h,
      tf: copyT(loc.tf), conf: loc.conf, method: loc.method, pt: loc.pt, sig: loc.sig, step: loc.step, refs: loc.refs, kept: !!loc.kept, open: !!($('mbl') && !$('mbl').hidden) }; },
    // tests : position écran (dans la page) d'un pixel de la photo affichée
    _locScreen: function (u, v) { var p = locMap.latLngToContainerPoint([-v, u]), r = locMap.getContainer().getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; },
    _remove: function (id) { var it = items.filter(function (x) { return x.id === id; })[0]; if (it) removeItem(it); }
  };
})();
