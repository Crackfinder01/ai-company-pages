/* Carte GTA 6 — application (Leaflet + markercluster, CRS.Simple, latlng = [y, x]) */
(function () {
  'use strict';

  var ICONS = window.GTA6_ICONS;
  var $ = function (id) { return document.getElementById(id); };
  var DATA_FILES = ['markers', 'categories', 'groups', 'land', 'labels', 'roads'];
  var MIN_Z = -6, MAX_Z = 2;

  // Préréglages : listes d'id de catégories et/ou groupes entiers. Les id absents des données sont ignorés.
  // Une catégorie peut aussi déclarer "presets": ["braquer", ...] dans categories.json.
  var PRESETS = [
    { id: 'braquer', n: 'Braquer', cats: ['heist', 'bank', 'big-bank', 'payday-loan', 'safe', 'smash-n-grab', 'atm', 'gang-operation', 'gang-compound', 'fence', 'home-invasion', 'valuable-loot-box', 'valuable-luxury-watch', 'valuable-treasure'] },
    { id: 'voitures', n: 'Voler des voitures', cats: ['vehicle-request-randy', 'vehicle-request-moses', 'standout-vehicle', 'rare-car', 'classic-car', 'rare-boat', 'rare-aircraft', 'other-military'], groups: ['steal-vehicles'] },
    { id: 'valeur', n: 'Objets de valeur', cats: ['valuable', 'valuable-loot-box', 'valuable-luxury-watch', 'valuable-treasure', 'valuable-scoop', 'valuable-meteorite', 'safe', 'hidden-package', 'weapon-pickup'] },
    { id: 'collect', n: 'Collectibles', groups: ['collectibles'] },
    { id: 'activ', n: 'Activités', groups: ['activities'] },
    { id: 'tout', n: 'Tout', all: true }
  ];
  var DEFAULT_PRESETS = ['braquer', 'voitures'];

  /* ---------- Stockage sûr (localStorage peut être interdit : iframe sandbox, navigation privée) ---------- */
  var mem = {};
  var store = {
    get: function (k, def) {
      var v = null;
      try { v = window.localStorage.getItem('gta6.' + k); } catch (e) { v = Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }
      if (v === null || v === undefined) return def;
      try { return JSON.parse(v); } catch (e) { return def; }
    },
    set: function (k, val) {
      var s = JSON.stringify(val);
      mem[k] = s;
      try { window.localStorage.setItem('gta6.' + k, s); } catch (e) { /* mémoire seulement */ }
    }
  };

  /* ---------- Utilitaires ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    s = String(s || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* vieux navigateur */ }
    return s.replace(/[''`]/g, "'");
  }
  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function fmtDist(u) {
    if (u < 1000) return '≈ ' + (Math.round(u / 10) * 10) + ' m';
    return '≈ ' + (Math.round(u / 100) / 10).toFixed(1).replace('.', ',') + ' km';
  }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
  }
  var toastT;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function fillIcons(root) {
    var els = (root || document).querySelectorAll('[data-ic]');
    for (var i = 0; i < els.length; i++) { if (!els[i].firstChild) els[i].innerHTML = ICONS.use(els[i].getAttribute('data-ic')); }
  }
  function isWide() { return window.matchMedia && window.matchMedia('(min-width: 900px)').matches; }

  /* ---------- État ---------- */
  var D = {};               // données brutes
  var cats = {};            // id -> catégorie (+ list, total)
  var catOrder = [];
  var groups = [];          // [{id,n,cats:[]}]
  var markers = [];         // marqueurs de données
  var byId = {};
  var visible = {};         // cat id -> bool
  var done = {}; var fav = {};
  var hideDone = false;
  var map, cluster, labelLayer, labelItems = [], meMarker = null, meLine = null;
  var selected = null, placingMe = false;
  var iconCache = {};

  /* ---------- Chargement des données ---------- */
  function fetchJSON(name) {
    return fetch('data/' + name + '.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(name + ' : HTTP ' + r.status);
      return r.json();
    });
  }
  function loadBundle() {
    return new Promise(function (res, rej) {
      if (window.GTA6_DATA) return res(window.GTA6_DATA);
      var s = document.createElement('script');
      s.src = 'data/bundle.js';
      s.onload = function () { window.GTA6_DATA ? res(window.GTA6_DATA) : rej(new Error('bundle vide')); };
      s.onerror = function () { rej(new Error('bundle absent')); };
      document.head.appendChild(s);
    });
  }
  function loadData() {
    // iframe sandbox sans same-origin ou fichier local : fetch serait bloqué -> bundle.js directement
    var opaque = false;
    try { opaque = window.origin === 'null' || location.protocol === 'file:'; } catch (e) { opaque = true; }
    if (opaque) return loadBundle();
    var opt = { groups: [], land: null, labels: [], roads: [] };
    var p = typeof fetch === 'function' ? Promise.all(DATA_FILES.map(function (n) {
      return fetchJSON(n).catch(function (e) { if (n in opt) return opt[n]; throw e; });
    })).then(function (arr) {
      var o = {}; DATA_FILES.forEach(function (n, i) { o[n] = arr[i]; }); return o;
    }) : Promise.reject(new Error('fetch indisponible'));
    return p.catch(function () { return loadBundle(); });
  }

  function showError(msg) {
    var l = $('loader'); l.classList.add('err'); l.classList.remove('hide');
    $('loaderMsg').textContent = msg;
    $('btnRetry').hidden = false;
  }

  /* ---------- Préparation ---------- */
  function prepare(data) {
    if (!data || !Array.isArray(data.markers) || !data.markers.length || !Array.isArray(data.categories) || !data.categories.length) {
      throw new Error('donnees');
    }
    D = data;
    var gList = Array.isArray(data.groups) ? data.groups.slice() : [];
    var gIdx = {};
    gList.forEach(function (g) { gIdx[g.id] = { id: g.id, n: g.n || g.id, cats: [] }; });
    data.categories.forEach(function (c) {
      if (!c || !c.id || cats[c.id]) return;
      var cc = { id: c.id, g: c.g || 'autres', n: c.n || c.id, color: c.color || '#cccccc', icon: ICONS.has(c.icon) ? c.icon : 'pin', hidden: !!c.hidden, presets: Array.isArray(c.presets) ? c.presets : [], list: [], ndone: 0 };
      cats[c.id] = cc; catOrder.push(c.id);
    });
    data.markers.forEach(function (m) {
      if (!m || m.id == null || typeof m.x !== 'number' || typeof m.y !== 'number' || !isFinite(m.x) || !isFinite(m.y)) return;
      if (byId[m.id]) return;
      if (!cats[m.c]) {
        cats[m.c] = { id: m.c, g: 'autres', n: String(m.c || 'Autres'), color: '#cccccc', icon: 'pin', hidden: false, presets: [], list: [], ndone: 0 };
        catOrder.push(m.c);
      }
      var o = { id: String(m.id), c: m.c, x: m.x, y: m.y, n: m.n || 'Sans nom', d: m.d || '', g: typeof m.g === 'string' ? m.g.trim() : '', approx: !!m.approx, src: m.src || '', mk: null, on: false };
      o.key = norm(o.n);
      o.full = o.key + ' ' + norm(o.d) + ' ' + norm(o.g) + ' ' + norm(cats[m.c].n);
      markers.push(o); byId[o.id] = o; cats[m.c].list.push(o);
    });
    catOrder.forEach(function (id) {
      var c = cats[id];
      if (!c.list.length) return;
      if (!gIdx[c.g]) { gIdx[c.g] = { id: c.g, n: c.g === 'autres' ? 'Autres' : c.g, cats: [] }; gList.push({ id: c.g }); }
      gIdx[c.g].cats.push(c);
    });
    groups = gList.map(function (g) { return gIdx[g.id]; }).filter(function (g) { return g && g.cats.length; });
    // labels
    D.labels = (Array.isArray(data.labels) ? data.labels : []).filter(function (l) { return l && l.n && isFinite(l.x) && isFinite(l.y); });
    // progression mémorisée
    (store.get('done', []) || []).forEach(function (id) { if (byId[id]) { done[id] = true; cats[byId[id].c].ndone++; } });
    (store.get('fav', []) || []).forEach(function (id) { if (byId[id]) fav[id] = true; });
    hideDone = !!store.get('hideDone', false);
    var vis = store.get('vis', null);
    if (Array.isArray(vis)) vis.forEach(function (id) { if (cats[id]) visible[id] = true; });
    else DEFAULT_PRESETS.forEach(function (p) { presetCats(p).forEach(function (id) { visible[id] = true; }); });
  }

  function presetCats(pid) {
    var p = PRESETS.filter(function (x) { return x.id === pid; })[0];
    if (!p) return [];
    var out = [];
    catOrder.forEach(function (id) {
      var c = cats[id];
      if (!c.list.length) return;
      if ((p.all && !c.hidden) || (p.cats && p.cats.indexOf(id) >= 0) || (p.groups && p.groups.indexOf(c.g) >= 0) || c.presets.indexOf(pid) >= 0) out.push(id);
    });
    return out;
  }

  /* ---------- Carte ---------- */
  function bboxOf() {
    var b = D.land && Array.isArray(D.land.bbox) && D.land.bbox.length === 4 ? D.land.bbox : null;
    if (!b) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      markers.forEach(function (m) { if (m.x < x0) x0 = m.x; if (m.y < y0) y0 = m.y; if (m.x > x1) x1 = m.x; if (m.y > y1) y1 = m.y; });
      b = [x0, y0, x1, y1];
    }
    return b;
  }

  function initMap() {
    var b = bboxOf();
    var bounds = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
    var padX = (b[2] - b[0]) * 0.35, padY = (b[3] - b[1]) * 0.35, gpx = padX * 3, gpy = padY * 3;
    map = L.map('map', {
      crs: L.CRS.Simple, minZoom: MIN_Z, maxZoom: MAX_Z, zoomSnap: 0.5, zoomDelta: 1,
      zoomControl: false, attributionControl: true, preferCanvas: false,
      maxBounds: L.latLngBounds([b[1] - padY, b[0] - padX], [b[3] + padY, b[2] + padX]), maxBoundsViscosity: 0.8,
      tapTolerance: 15, bounceAtZoomLimits: false, wheelPxPerZoomLevel: 90
    });
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Carte non officielle · fond dessiné · <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.createPane('labels').style.zIndex = 450;
    map.createPane('me').style.zIndex = 700;
    map.createPane('base').style.zIndex = 300;   // fond dessiné (grille, terre)
    map.createPane('mybg').style.zIndex = 350;   // « Mon fond de carte » (captures de l'utilisateur)
    map.createPane('mybgline').style.zIndex = 360; // contours de contrôle pendant le calage

    var bg = L.canvas({ padding: 0.5, pane: 'base' });
    // grille néon (repère visuel, tous les 1000 m)
    var gx0 = Math.floor((b[0] - gpx) / 1000) * 1000, gx1 = Math.ceil((b[2] + gpx) / 1000) * 1000;
    var gy0 = Math.floor((b[1] - gpy) / 1000) * 1000, gy1 = Math.ceil((b[3] + gpy) / 1000) * 1000;
    var lines = [];
    for (var gx = gx0; gx <= gx1; gx += 1000) lines.push([[gy0, gx], [gy1, gx]]);
    for (var gy = gy0; gy <= gy1; gy += 1000) lines.push([[gy, gx0], [gy, gx1]]);
    L.polyline(lines, { renderer: bg, color: '#22e6ff', weight: 1, opacity: 0.07, interactive: false }).addTo(map);

    // terre
    var polys = D.land && Array.isArray(D.land.polygons) ? D.land.polygons.concat(Array.isArray(D.land.holes) ? D.land.holes : []) : [];
    var rings = polys.filter(function (p) { return Array.isArray(p) && p.length > 2; }).map(function (p) {
      return p.map(function (pt) { return [pt[1], pt[0]]; });
    });
    if (rings.length) {
      L.polygon(rings, { renderer: bg, stroke: true, color: '#ff2e97', weight: 7, opacity: 0.16, fill: false, interactive: false, smoothFactor: 1.5 }).addTo(map);
      L.polygon(rings, { renderer: bg, stroke: true, color: '#33e1ff', weight: 1.3, opacity: 0.75, fill: true, fillColor: '#1c1648', fillOpacity: 1, interactive: false, smoothFactor: 1.5 }).addTo(map);
    }

    // routes principales (approximatives)
    var roads = Array.isArray(D.roads) ? D.roads : [];
    roads.forEach(function (r) {
      if (!r || !Array.isArray(r.pts) || r.pts.length < 2) return;
      var ll = r.pts.map(function (pt) { return [pt[1], pt[0]]; });
      var hw = r.k === 'highway';
      L.polyline(ll, { renderer: bg, color: '#0e0b2a', weight: hw ? 5 : 3.5, opacity: 0.9, interactive: false, smoothFactor: 1.5 }).addTo(map);
      L.polyline(ll, { renderer: bg, color: hw ? '#ffb3e0' : '#b9b3ff', weight: hw ? 2.2 : 1.4, opacity: hw ? 0.55 : 0.4, interactive: false, smoothFactor: 1.5 }).addTo(map);
    });

    // libellés
    labelLayer = L.layerGroup().addTo(map);
    labelItems = D.labels.map(function (l) {
      var k = l.k === 'region' || l.k === 'district' ? l.k : 'city';
      var minZ = typeof l.minZoom === 'number' ? l.minZoom : (k === 'region' ? MIN_Z : k === 'city' ? -4.5 : -2);
      var maxZ = typeof l.maxZoom === 'number' ? l.maxZoom : (k === 'region' ? -3.5 : MAX_Z);
      var mk = L.marker([l.y, l.x], { pane: 'labels', interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'lbl ' + k, html: '<span>' + esc(l.n) + '</span>', iconSize: [0, 0] }) });
      return { l: l, k: k, minZ: minZ, maxZ: maxZ, mk: mk, on: false };
    });
    map.on('zoomend', updateLabels);

    // clusters
    cluster = L.markerClusterGroup({
      chunkedLoading: true, chunkInterval: 120, chunkDelay: 20,
      showCoverageOnHover: false, spiderfyOnMaxZoom: true, zoomToBoundsOnClick: true, removeOutsideVisibleBounds: true,
      animate: true, animateAddingMarkers: false, spiderfyDistanceMultiplier: 1.6,
      maxClusterRadius: function (z) { return z >= 1 ? 30 : z >= -1 ? 45 : 60; },
      disableClusteringAtZoom: null,
      iconCreateFunction: clusterIcon
    });
    map.addLayer(cluster);

    // vue initiale
    var v = store.get('view', null);
    if (v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z)) map.setView([v.y, v.x], Math.max(MIN_Z, Math.min(MAX_Z, v.z)));
    else map.fitBounds(bounds, { padding: [10, 10] });
    map.on('moveend', debounce(function () {
      var c = map.getCenter(); store.set('view', { x: Math.round(c.lng), y: Math.round(c.lat), z: map.getZoom() });
    }, 400));
    updateLabels();

    map.on('click', function (e) {
      if (mybgBusy()) return;
      if (placingMe) { setMe(e.latlng); setPlacing(false); return; }
      closeResults();
      if (selected) closeSheet();
      else if (document.body.classList.contains('panel-open') && !isWide()) closePanel();
    });
    map.on('contextmenu', function (e) { if (mybgBusy()) return; setMe(e.latlng); setPlacing(false); });
  }

  function mybgBusy() { return !!(window.GTA6_MYBG && window.GTA6_MYBG.busy()); }

  function updateLabels() {
    var z = map.getZoom();
    labelItems.forEach(function (it) {
      var want = z >= it.minZ && z <= it.maxZ;
      if (want && !it.on) { labelLayer.addLayer(it.mk); it.on = true; }
      else if (!want && it.on) { labelLayer.removeLayer(it.mk); it.on = false; }
    });
  }

  /* ---------- Marqueurs ---------- */
  function iconFor(m) {
    var c = cats[m.c];
    var cls = 'mk' + (m.approx ? ' ap' : '') + (done[m.id] ? ' dn' : '') + (fav[m.id] ? ' fv' : '') + (selected === m ? ' sel' : '');
    var key = m.c + '|' + cls;
    var ic = iconCache[key];
    if (!ic) {
      ic = iconCache[key] = L.divIcon({
        className: cls, iconSize: [44, 44], iconAnchor: [22, 22],
        html: '<div style="--c:' + esc(c.color) + '">' + ICONS.use(c.icon) + '</div>'
      });
    }
    return ic;
  }
  function makeMarker(m) {
    var mk = L.marker([m.y, m.x], { icon: iconFor(m), keyboard: false, riseOnHover: false });
    mk.on('click', function (e) { if (e.originalEvent) L.DomEvent.stop(e.originalEvent); if (placingMe) { setMe(mk.getLatLng()); setPlacing(false); return; } openSheet(m, false); });
    mk._gta = m;
    m.mk = mk;
  }
  function refreshIcon(m) { if (m.mk) m.mk.setIcon(iconFor(m)); }

  function clusterIcon(cl) {
    var n = cl.getChildCount();
    var color = '#ff2e97';
    if (n <= 400) {
      var cnt = {}, best = 0, ch = cl.getAllChildMarkers();
      for (var i = 0; i < ch.length; i++) {
        var c = ch[i]._gta && ch[i]._gta.c; if (!c) continue;
        cnt[c] = (cnt[c] || 0) + 1;
        if (cnt[c] > best) { best = cnt[c]; color = cats[c].color; }
      }
    }
    var size = n < 10 ? 's' : n < 100 ? 'm' : 'l';
    var px = size === 's' ? 36 : size === 'm' ? 44 : 52;
    return L.divIcon({ className: 'cl ' + size, iconSize: [px, px], html: '<div style="--c:' + color + '">' + fmtInt(n) + '</div>' });
  }

  function wanted(m) {
    if (!visible[m.c]) return false;
    if (hideDone && done[m.id]) return false;
    return true;
  }
  function applyVisibility() {
    var add = [], rem = [];
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      if (m.solo) continue; // point sélectionné : affiché hors clusters
      var w = wanted(m);
      if (w && !m.on) { if (!m.mk) makeMarker(m); add.push(m.mk); m.on = true; }
      else if (!w && m.on) { rem.push(m.mk); m.on = false; }
    }
    if (rem.length) cluster.removeLayers(rem);
    if (add.length) cluster.addLayers(add);
    updateCounts();
    store.set('vis', catOrder.filter(function (id) { return visible[id]; }));
  }

  /* ---------- Panneau calques ---------- */
  function buildPanel() {
    var pres = $('presets');
    pres.innerHTML = '';
    PRESETS.forEach(function (p) {
      var ids = presetCats(p.id);
      if (!ids.length) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip' + (p.all ? ' all' : ''); b.textContent = p.n; b.setAttribute('data-preset', p.id);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        var on = ids.every(function (id) { return visible[id]; });
        if (p.all) { on = false; catOrder.forEach(function (id) { visible[id] = !cats[id].hidden; }); }
        else ids.forEach(function (id) { visible[id] = !on; });
        applyVisibility();
        toast(p.all ? 'Tous les calques affichés' : on ? '« ' + p.n + ' » masqué' : '« ' + p.n + ' » affiché');
      });
      pres.appendChild(b);
    });
    var none = document.createElement('button');
    none.type = 'button'; none.className = 'chip ghost'; none.id = 'btnNone'; none.textContent = 'Rien';
    pres.appendChild(none);

    var openG = store.get('openGroups', null);
    if (!Array.isArray(openG)) openG = ['robberies', 'steal-vehicles'];
    var wrap = $('groups');
    wrap.innerHTML = '';
    groups.forEach(function (g) {
      var el = document.createElement('div');
      el.className = 'grp' + (openG.indexOf(g.id) >= 0 ? ' open' : '');
      el.setAttribute('data-g', g.id);
      var h = '<div class="ghead"><button type="button" class="cbx" role="checkbox" aria-checked="false" aria-label="Tout afficher : ' + esc(g.n) + '"><i>' + ICONS.use('ui_check') + '</i></button>' +
        '<button type="button" class="gtoggle" aria-expanded="' + (openG.indexOf(g.id) >= 0) + '">' + esc(g.n) + '<span class="gcount"></span>' + ICONS.use('ui_chev') + '</button></div><div class="glist">';
      g.cats.forEach(function (c) {
        h += '<button type="button" class="cat" role="checkbox" aria-checked="false" data-c="' + esc(c.id) + '" style="--c:' + esc(c.color) + '">' +
          '<span class="dot">' + ICONS.use(c.icon) + '</span><span class="cn">' + esc(c.n) + '<small><b></b></small></span><span class="cc"></span><span class="ck">' + ICONS.use('ui_check') + '</span></button>';
      });
      el.innerHTML = h + '</div>';
      wrap.appendChild(el);
      el.querySelector('.gtoggle').addEventListener('click', function () {
        var open = el.classList.toggle('open');
        this.setAttribute('aria-expanded', open);
        store.set('openGroups', Array.prototype.map.call(document.querySelectorAll('.grp.open'), function (x) { return x.getAttribute('data-g'); }));
      });
      el.querySelector('.cbx').addEventListener('click', function () {
        var all = g.cats.every(function (c) { return visible[c.id]; });
        g.cats.forEach(function (c) { visible[c.id] = !all; });
        applyVisibility();
      });
      Array.prototype.forEach.call(el.querySelectorAll('.cat'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-c'); visible[id] = !visible[id]; applyVisibility();
        });
      });
    });

    $('btnNone').addEventListener('click', function () { catOrder.forEach(function (id) { visible[id] = false; }); applyVisibility(); toast('Tous les calques masqués'); });
    var hd = $('hideDone');
    hd.checked = hideDone;
    hd.addEventListener('change', function () { hideDone = hd.checked; store.set('hideDone', hideDone); applyVisibility(); });
    var resetArmed = false, resetT;
    $('btnResetProgress').addEventListener('click', function () {
      var b = this;
      if (!resetArmed) { resetArmed = true; b.textContent = 'Appuyez encore pour confirmer'; resetT = setTimeout(function () { resetArmed = false; b.textContent = 'Remettre à zéro ma progression'; }, 4000); return; }
      clearTimeout(resetT); resetArmed = false; b.textContent = 'Remettre à zéro ma progression';
      var ids = Object.keys(done); done = {};
      catOrder.forEach(function (id) { cats[id].ndone = 0; });
      store.set('done', []);
      ids.forEach(function (id) { if (byId[id]) refreshIcon(byId[id]); });
      applyVisibility(); if (selected) renderSheet();
      toast('Progression remise à zéro');
    });
  }

  function updateCounts() {
    var shown = 0;
    groups.forEach(function (g) {
      var el = document.querySelector('.grp[data-g="' + g.id + '"]');
      if (!el) return;
      var nOn = 0, tot = 0, dn = 0;
      g.cats.forEach(function (c) {
        if (visible[c.id]) { nOn++; shown += hideDone ? c.list.length - c.ndone : c.list.length; }
        tot += c.list.length; dn += c.ndone;
        var b = el.querySelector('.cat[data-c="' + c.id + '"]');
        if (!b) return;
        b.setAttribute('aria-checked', visible[c.id] ? 'true' : 'false');
        var cc = b.querySelector('.cc');
        cc.textContent = c.ndone + ' / ' + c.list.length;
        cc.classList.toggle('full', c.ndone === c.list.length);
        b.querySelector('small b').style.width = (100 * c.ndone / c.list.length) + '%';
      });
      el.querySelector('.cbx').setAttribute('aria-checked', nOn === 0 ? 'false' : nOn === g.cats.length ? 'true' : 'mixed');
      el.querySelector('.gcount').textContent = dn + ' / ' + tot;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.chip[data-preset]'), function (b) {
      var ids = presetCats(b.getAttribute('data-preset'));
      var on = ids.length && ids.every(function (id) { return visible[id]; });
      b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('visibleCount').textContent = shown ? fmtInt(shown) + ' point' + (shown > 1 ? 's' : '') + ' affiché' + (shown > 1 ? 's' : '') + ' sur ' + fmtInt(markers.length) : 'Aucun calque affiché : choisissez un préréglage ou une catégorie.';
    renderFavs();
  }

  function renderFavs() {
    var ids = Object.keys(fav).filter(function (id) { return byId[id]; });
    $('favSec').hidden = !ids.length;
    var box = $('favList'); box.innerHTML = '';
    ids.forEach(function (id) { box.appendChild(resultRow(byId[id])); });
  }

  function openPanel() {
    document.body.classList.add('panel-open');
    $('panel').setAttribute('aria-hidden', 'false'); $('btnLayers').setAttribute('aria-expanded', 'true');
    if (!isWide()) $('scrim').hidden = false;
    closeResults();
  }
  function closePanel() {
    document.body.classList.remove('panel-open');
    $('panel').setAttribute('aria-hidden', 'true'); $('btnLayers').setAttribute('aria-expanded', 'false');
    $('scrim').hidden = true;
  }

  /* ---------- Recherche ---------- */
  function resultRow(m) {
    var c = cats[m.c];
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'res'; b.setAttribute('role', 'option');
    b.innerHTML = '<span class="dot" style="--c:' + esc(c.color) + '">' + ICONS.use(c.icon) + '</span><span class="rt"><span class="rn">' + esc(m.n) + '</span><span class="rc">' + esc(c.n) +
      (done[m.id] ? ' · fait ✓' : '') + (!visible[m.c] ? ' · <span class="off">calque masqué</span>' : '') + '</span></span>';
    b.addEventListener('click', function () { focusMarker(m); });
    return b;
  }
  function search(q) {
    var box = $('results');
    var nq = norm(q).trim();
    $('qClear').hidden = !q;
    if (nq.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    var toks = nq.split(/\s+/);
    var catHits = catOrder.filter(function (id) {
      var c = cats[id]; if (!c.list.length) return false; var k = norm(c.n);
      return toks.every(function (t) { return k.indexOf(t) >= 0; });
    }).slice(0, 3);
    var res = [];
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i], ok = true;
      for (var j = 0; j < toks.length; j++) { if (m.full.indexOf(toks[j]) < 0) { ok = false; break; } }
      if (!ok) continue;
      var s = m.key.indexOf(nq) === 0 ? 0 : m.key.indexOf(nq) > 0 ? 1 : toks.every(function (t) { return m.key.indexOf(t) >= 0; }) ? 2 : 3;
      if (!visible[m.c]) s += 0.5;
      res.push([s, m]);
    }
    res.sort(function (a, b) { return a[0] - b[0] || (a[1].n < b[1].n ? -1 : 1); });
    box.innerHTML = '';
    catHits.forEach(function (id) {
      var c = cats[id];
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'res'; b.setAttribute('role', 'option');
      b.innerHTML = '<span class="dot" style="--c:' + esc(c.color) + '">' + ICONS.use(c.icon) + '</span><span class="rt"><span class="rn">Calque : ' + esc(c.n) + '</span><span class="rc">' + c.list.length + ' points · ' + (visible[id] ? 'affiché — toucher pour cadrer' : 'toucher pour afficher') + '</span></span>';
      b.addEventListener('click', function () {
        visible[id] = true; applyVisibility(); closeResults(); $('q').blur();
        var bb = L.latLngBounds(c.list.map(function (m) { return [m.y, m.x]; }));
        map.fitBounds(bb, { padding: [60, 60], maxZoom: 0 });
        toast('Calque « ' + c.n + ' » affiché');
      });
      box.appendChild(b);
    });
    res.slice(0, 50).forEach(function (r) { box.appendChild(resultRow(r[1])); });
    if (!res.length && !catHits.length) box.innerHTML = '<div class="res-empty">Aucun résultat pour « ' + esc(q) + ' ».</div>';
    else if (res.length > 50) box.insertAdjacentHTML('beforeend', '<div class="res-empty small">' + (res.length - 50) + ' autres résultats : précisez la recherche.</div>');
    box.hidden = false;
    box.scrollTop = 0;
  }
  function closeResults() { $('results').hidden = true; }

  function focusMarker(m) {
    closeResults(); $('q').blur();
    if (!isWide()) closePanel();
    if (!visible[m.c]) { visible[m.c] = true; applyVisibility(); toast('Calque « ' + cats[m.c].n + ' » affiché'); }
    openSheet(m, true);
  }

  /* ---------- Fiche ---------- */
  var nearLabels = null;
  function zoneOf(m) {
    if (!nearLabels) nearLabels = D.labels.filter(function (l) { return l.k !== 'region'; });
    var best = null, bd = Infinity, bestD = null, bdD = Infinity;
    nearLabels.forEach(function (l) {
      var d = Math.hypot(l.x - m.x, l.y - m.y);
      if (l.k === 'district') { if (d < bdD) { bdD = d; bestD = l; } }
      else if (d < bd) { bd = d; best = l; }
    });
    if (bestD && bdD < 1200) return bestD.n + (best && bd < 3500 && best.n !== bestD.n ? ', ' + best.n : '');
    if (best && bd < 3500) return (bd > 1200 ? 'Environs de ' : '') + best.n;
    return 'Leonida';
  }

  function unsolo(m) {
    if (!m || !m.solo) return;
    map.removeLayer(m.mk); m.solo = false; m.mk.setZIndexOffset(0);
    refreshIcon(m);
    if (wanted(m)) { cluster.addLayer(m.mk); m.on = true; }
  }
  function openSheet(m, fly) {
    var prev = selected;
    selected = m;
    if (prev && prev !== m) unsolo(prev);
    if (!m.mk) makeMarker(m);
    if (!m.solo) {
      if (m.on) { cluster.removeLayer(m.mk); m.on = false; }
      m.solo = true; m.mk.setZIndexOffset(1000); map.addLayer(m.mk);
    }
    refreshIcon(m);
    clearLine();
    renderSheet();
    document.body.classList.add('sheet-open');
    $('sheet').setAttribute('aria-hidden', 'false');
    var sh = isWide() ? 0 : $('sheet').offsetHeight;
    document.body.style.setProperty('--sheeth', sh + 'px');
    var go = function () {
      var size = map.getSize();
      var pt = map.latLngToContainerPoint([m.y, m.x]);
      var tx = isWide() ? (size.x - 430) / 2 + (document.body.classList.contains('panel-open') ? 190 : 0) : size.x / 2;
      var ty = isWide() ? size.y / 2 : Math.max(90, (size.y - sh) / 2);
      map.panBy([pt.x - tx, pt.y - ty], { animate: true });
      flash(m);
    };
    if (fly) map.setView([m.y, m.x], Math.max(map.getZoom(), 0), { animate: false });
    go();
  }
  function flash(m) {
    var el = m.mk && m.mk.getElement && m.mk.getElement();
    if (!el) return;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 2100);
  }
  function closeSheet() {
    var m = selected; selected = null;
    document.body.classList.remove('sheet-open');
    $('sheet').setAttribute('aria-hidden', 'true');
    clearLine();
    unsolo(m);
    updateCounts();
  }

  function renderSheet() {
    var m = selected; if (!m) return;
    var c = cats[m.c];
    var me = store.get('me', null);
    var h = '<div class="shd"><span class="dot" style="--c:' + esc(c.color) + '">' + ICONS.use(c.icon) + '</span><div><h2>' + esc(m.n) + '</h2>' +
      '<span class="pill" style="--c:' + esc(c.color) + '"><i></i>' + esc(c.n) + '</span></div></div>' +
      (m.g ? '<div class="howto"><span class="hti">' + ICONS.use('ui_compass') + '</span><div><b>Comment le trouver dans le jeu</b><p>' + esc(m.g) + '</p></div></div>' : '') +
      '<div class="meta"><span>Zone : <b>' + esc(zoneOf(m)) + '</b></span></div>';
    if (m.approx) h += '<div class="approx">◌ Position approximative</div>';
    h += m.d ? '<p class="desc">' + esc(m.d) + '</p>' : '<p class="desc empty">Pas encore de description pour ce point.</p>';
    if (me) h += '<div class="dist">' + fmtDist(Math.hypot(me[0] - m.x, me[1] - m.y)) + ' de « Je suis ici » (à vol d\'oiseau)</div>';
    h += '<div class="acts">' +
      '<button type="button" class="btn tog done" id="actDone" aria-pressed="' + !!done[m.id] + '">' + ICONS.use('ui_check') + (done[m.id] ? 'Fait' : 'Trouvé / fait') + '</button>' +
      '<button type="button" class="btn tog fav" id="actFav" aria-pressed="' + !!fav[m.id] + '">' + ICONS.use('ui_star') + (fav[m.id] ? 'En favori' : 'Favori') + '</button>' +
      '<button type="button" class="btn" id="actCopy">' + ICONS.use('ui_copy') + 'Copier coord.</button>' +
      (me ? '<button type="button" class="btn" id="actLine">' + ICONS.use('ui_ruler') + (meLine ? 'Effacer le tracé' : 'Tracer depuis moi') + '</button>' : '') +
      '</div>';
    $('sheetBody').innerHTML = h;
    $('actDone').addEventListener('click', function () { toggleDone(m); });
    $('actFav').addEventListener('click', function () { toggleFav(m); });
    $('actCopy').addEventListener('click', function () { copyCoords(m); });
    var al = $('actLine'); if (al) al.addEventListener('click', function () { toggleLine(m); });
    if (document.body.classList.contains('sheet-open') && !isWide()) document.body.style.setProperty('--sheeth', $('sheet').offsetHeight + 'px');
  }

  function toggleDone(m) {
    if (done[m.id]) { delete done[m.id]; cats[m.c].ndone--; } else { done[m.id] = true; cats[m.c].ndone++; }
    store.set('done', Object.keys(done));
    refreshIcon(m); renderSheet(); updateCounts();
    var c = cats[m.c];
    toast(done[m.id] ? 'Fait ✓  ' + c.n + ' : ' + c.ndone + ' / ' + c.list.length : 'Marqué comme non fait');
  }
  function toggleFav(m) {
    if (fav[m.id]) delete fav[m.id]; else fav[m.id] = true;
    store.set('fav', Object.keys(fav));
    refreshIcon(m); renderSheet(); renderFavs();
    toast(fav[m.id] ? 'Ajouté aux favoris ★' : 'Retiré des favoris');
  }
  function copyCoords(m) {
    var txt = m.n + ' — X ' + Math.round(m.x) + ', Y ' + Math.round(m.y);
    var fallback = function () {
      try {
        var ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
        var ok = document.execCommand && document.execCommand('copy'); document.body.removeChild(ta);
        toast(ok ? 'Coordonnées copiées' : txt);
      } catch (e) { toast(txt); }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { toast('Coordonnées copiées'); }, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  /* ---------- « Je suis ici » ---------- */
  function setPlacing(on) {
    placingMe = on;
    $('btnPlaceMe').classList.toggle('active', on);
    var h = $('modeHint');
    h.hidden = !on;
    h.textContent = 'Touchez la carte pour poser « Je suis ici »';
  }
  function setMe(ll) {
    var x = Math.round(ll.lng), y = Math.round(ll.lat);
    store.set('me', [x, y]);
    drawMe();
    toast('Repère « Je suis ici » posé');
    if (selected) { clearLine(); renderSheet(); }
  }
  function drawMe() {
    var me = store.get('me', null);
    $('btnGoMe').disabled = !me;
    if (!me) { if (meMarker) { map.removeLayer(meMarker); meMarker = null; } return; }
    if (!meMarker) {
      meMarker = L.marker([me[1], me[0]], { pane: 'me', draggable: true, keyboard: false, zIndexOffset: 2000,
        icon: L.divIcon({ className: 'me', iconSize: [44, 44], html: '<div></div><span>Je suis ici</span>' }) }).addTo(map);
      meMarker.on('dragend', function () { var ll = meMarker.getLatLng(); store.set('me', [Math.round(ll.lng), Math.round(ll.lat)]); if (selected) { clearLine(); renderSheet(); } toast('Repère déplacé'); });
      meMarker.on('click', function () {
        toast('Glissez le repère pour le déplacer · appui long ailleurs pour le reposer');
      });
    } else meMarker.setLatLng([me[1], me[0]]);
  }
  function toggleLine(m) {
    if (meLine) { clearLine(); renderSheet(); return; }
    var me = store.get('me', null); if (!me) return;
    meLine = L.polyline([[me[1], me[0]], [m.y, m.x]], { color: '#22e6ff', weight: 3, opacity: 0.9, dashArray: '8 8', interactive: false }).addTo(map);
    var pad = isWide() ? { paddingTopLeft: [60, 80], paddingBottomRight: [460, 60] } : { paddingTopLeft: [40, 90], paddingBottomRight: [40, $('sheet').offsetHeight + 30] };
    map.fitBounds(meLine.getBounds(), pad);
    renderSheet();
  }
  function clearLine() { if (meLine) { map.removeLayer(meLine); meLine = null; } }

  /* ---------- Interface ---------- */
  function bindUI() {
    $('btnLayers').addEventListener('click', function () { document.body.classList.contains('panel-open') ? closePanel() : openPanel(); });
    $('btnPanelClose').addEventListener('click', closePanel);
    $('scrim').addEventListener('click', closePanel);
    $('sheetClose').addEventListener('click', closeSheet);
    $('btnZoomIn').addEventListener('click', function () { map.zoomIn(); });
    $('btnZoomOut').addEventListener('click', function () { map.zoomOut(); });
    $('btnPlaceMe').addEventListener('click', function () { setPlacing(!placingMe); });
    $('btnGoMe').addEventListener('click', function () {
      var me = store.get('me', null); if (!me) return;
      map.setView([me[1], me[0]], Math.max(map.getZoom(), -1));
    });
    var q = $('q');
    var ds = debounce(function () { search(q.value); }, 120);
    q.addEventListener('input', ds);
    q.addEventListener('focus', function () { if (q.value.trim().length >= 2) search(q.value); if (!isWide()) closePanel(); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var f = $('results').querySelector('.res'); if (f) f.click(); }
      else if (e.key === 'Escape') { e.stopPropagation(); closeResults(); q.blur(); }
    });
    $('qClear').addEventListener('click', function () { q.value = ''; search(''); q.focus(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (mybgBusy()) return;
      if (placingMe) setPlacing(false);
      else if (!$('results').hidden) closeResults();
      else if (selected) closeSheet();
      else if (document.body.classList.contains('panel-open')) closePanel();
    });
    // glisser la fiche vers le bas pour la fermer
    var sheet = $('sheet'), y0 = null;
    sheet.addEventListener('touchstart', function (e) { y0 = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    sheet.addEventListener('touchend', function (e) { if (y0 !== null && e.changedTouches[0].clientY - y0 > 70) closeSheet(); y0 = null; }, { passive: true });
    L.DomEvent.disableClickPropagation($('topbar'));
    L.DomEvent.disableScrollPropagation($('results'));
  }

  /* ---------- Service worker (facultatif) ---------- */
  function registerSW() {
    try {
      if (!/^https?:$/.test(location.protocol)) return;
      if (window.self !== window.top) return; // iframe : pas de SW
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.register('sw.js').catch(function () { /* ignoré */ });
    } catch (e) { /* SW refusé (sandbox) : la page marche sans */ }
  }

  /* ---------- Démarrage ---------- */
  function start() {
    $('loader').classList.remove('err', 'hide');
    $('btnRetry').hidden = true;
    $('loaderMsg').textContent = 'Chargement de la carte…';
    if (!window.L || !L.markerClusterGroup) { showError('Les fichiers de la carte sont introuvables (dossier vendor). Réinstallez l\'app.'); return; }
    loadData().then(function (data) {
      try { prepare(data); } catch (e) {
        showError('Aucune donnée de carte trouvée. Vérifiez que le dossier « data » contient markers.json et categories.json, puis réessayez.');
        return;
      }
      initMap();
      buildPanel();
      bindUI();
      drawMe();
      applyVisibility();
      if (window.GTA6_MYBG) {
        try {
          window.GTA6_MYBG.init({ map: map, land: D.land, labels: D.labels, markers: markers, cats: cats, store: store, toast: toast, esc: esc, norm: norm,
            fmtDist: fmtDist, isWide: isWide, openPanel: openPanel, closePanel: closePanel, closeSheet: function () { if (selected) closeSheet(); } });
        } catch (e) { /* la carte reste utilisable sans « Mon fond de carte » */ }
      }
      if (isWide()) openPanel();
      document.body.classList.add('ready');
      var l = $('loader'); l.classList.add('hide');
      setTimeout(function () { l.hidden = true; }, 400);
      window.GTA6_APP = { map: map, markers: markers, cats: cats, visible: visible, cluster: cluster, openSheet: openSheet, closeSheet: closeSheet, focusMarker: focusMarker, applyVisibility: applyVisibility };
    }, function () {
      showError('Données de la carte introuvables ou illisibles. Vérifiez votre connexion (ou le dossier « data »), puis réessayez.');
    });
  }

  ICONS.buildSprite();
  fillIcons();
  $('btnRetry').addEventListener('click', function () { location.reload(); });
  start();
  if (document.readyState === 'complete') registerSW(); else window.addEventListener('load', registerSW);
})();
