/* Carte GTA 6 — application (Leaflet + markercluster, CRS.Simple, latlng = [y, x]) */
(function () {
  'use strict';

  var ICONS = window.GTA6_ICONS;
  var $ = function (id) { return document.getElementById(id); };
  // fichiers de données : les 2 premiers sont obligatoires, les autres optionnels (absents = fonction masquée)
  var DATA_FILES = ['markers', 'categories', 'groups', 'land', 'labels', 'roads', 'routes', 'zones', 'landuse', 'anchors', 'blips'];
  var OPTIONAL = { groups: [], land: null, labels: [], roads: [], routes: [], zones: [], landuse: null, anchors: [], blips: null };
  var MIN_Z = -6, MAX_Z = 2;
  var AMT_Z = -0.5;          // zoom à partir duquel les montants s'affichent sous les icônes

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

  // Prérequis (champ i.req) : code -> [icône, libellé FR]
  var REQ = {
    'key-cloner': ['rq_keyclone', 'Cloneur de clés'],
    'perceuse': ['rq_drill', 'Perceuse'],
    'chalumeau': ['rq_torch', 'Chalumeau'],
    'brouilleur': ['rq_jammer', 'Brouilleur'],
    'piratage': ['rq_hack', 'Piratage'],
    'arme': ['rq_gun', 'Arme'],
    'explosifs': ['rq_bomb', 'Explosifs'],
    'masque': ['mask', 'Masque'],
    'vehicule-rapide': ['rq_fast', 'Véhicule rapide'],
    'moto': ['rq_moto', 'Moto'],
    'bateau': ['boat', 'Bateau'],
    'avion': ['plane', 'Avion'],
    'helico': ['rq_heli', 'Hélico'],
    'plongee': ['rq_dive', 'Plongée'],
    'nuit': ['rq_moon', 'De nuit'],
    'jour': ['rq_sun', 'De jour'],
    'mission': ['rq_mission', 'Mission à faire avant'],
    'equipe': ['rq_team', 'En équipe'],
    'receleur': ['rq_fence', 'Receleur'],
    'telephone-waink': ['rq_waink', 'Appli WAiNK']
  };
  var DIFF = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile' };
  // Paliers de montant (couleur des étiquettes / taille des icônes)
  var TIERS = [
    { max: 1000, c: '#9fb4ff', n: 'moins de 1 k$' },
    { max: 5000, c: '#4dffa6', n: '1 à 5 k$' },
    { max: 25000, c: '#ffe14d', n: '5 à 25 k$' },
    { max: 100000, c: '#ff9f1c', n: '25 à 100 k$' },
    { max: Infinity, c: '#ff2e97', n: '100 k$ et plus' }
  ];
  var MIN_STEPS = [0, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
  var KINDS = {
    braquage: { n: 'Braquages', c: '#ff3d71', rgb: '255,61,113', icon: 'mask' },
    vehicules: { n: 'Véhicules', c: '#22e6ff', rgb: '34,230,255', icon: 'car' },
    butin: { n: 'Butin', c: '#ffd23f', rgb: '255,210,63', icon: 'moneybag' }
  };
  var KIND_OTHER = { n: 'Autres', c: '#b48cff', rgb: '180,140,255', icon: 'moneybag' };

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
  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function fmtDist(u) {
    if (u < 1000) return '≈ ' + (Math.round(u / 10) * 10) + ' m';
    return '≈ ' + (Math.round(u / 100) / 10).toFixed(1).replace('.', ',') + ' km';
  }
  function fmtKm(u) { return u < 1000 ? (Math.round(u / 10) * 10) + ' m' : (Math.round(u / 100) / 10).toFixed(1).replace('.', ',') + ' km'; }
  // montant compact : 850 $, 4,2 k$, 135 k$, 1,2 M$
  function fmtK(n) {
    if (!(n > 0)) return '0 $';
    if (n < 1000) return Math.round(n) + ' $';
    if (n < 10000) return (Math.round(n / 100) / 10).toFixed(1).replace('.0', '').replace('.', ',') + ' k$';
    if (n < 1e6) return Math.round(n / 1000) + ' k$';
    return (Math.round(n / 1e5) / 10).toFixed(1).replace('.0', '').replace('.', ',') + ' M$';
  }
  function fmtRangeK(a, b) {
    if (!(a > 0) || !(b > 0)) return fmtK(b || a);
    var A = fmtK(a), B = fmtK(b);
    if (A === B) return B;
    var ua = A.split('\u00a0')[1], ub = B.split('\u00a0')[1];
    return (ua === ub ? A.split('\u00a0')[0] : A) + ' – ' + B;
  }
  function tierOf(n) { for (var i = 0; i < TIERS.length; i++) { if (n < TIERS[i].max) return i; } return TIERS.length - 1; }
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
  function kindOf(k) { return KINDS[k] || KIND_OTHER; }

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
  var routes = [], zones = [];
  var F = { min: 0, diff: {}, notrack: false, unlocked: false };   // filtres
  var opt = { amt: true, size: false, zones: true, zk: {}, grid: false, chap: true };         // options d'affichage
  var has = { amt: false, diff: false, notrack: false, unlocked: false };
  var zoneLayer = null, zoneRenderer = null;
  var route = null;         // tournée en cours : { r, pts, idx, line, glow, nums }
  var bm = null;            // fond de carte dessiné (js/basemap.js)
  var THEMES = { game: 'Jeu', neon: 'Néon' };
  var theme = 'game';
  var blips = null;         // catégorie -> { ingame, note } (blips.json)
  var psMode = false;       // « Mode PlayStation »
  var anchors = [];

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
    var p = typeof fetch === 'function' ? Promise.all(DATA_FILES.map(function (n) {
      return fetchJSON(n).catch(function (e) { if (n in OPTIONAL) return OPTIONAL[n]; throw e; });
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
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null); }
  function parseInfo(i) {
    if (!i || typeof i !== 'object') return null;
    var o = {}, n = 0;
    var d = num(i.diff); if (d !== null && d >= 1 && d <= 3) { o.diff = Math.round(d); n++; }
    var w = num(i.wanted); if (w !== null && w >= 0 && w <= 5) { o.wanted = Math.round(w); n++; }
    if (Array.isArray(i.req)) {
      o.req = i.req.filter(function (r, k, a) { return typeof r === 'string' && r && a.indexOf(r) === k; });
      if (o.req.length) n++; else delete o.req;
    }
    var c = num(i.chap); if (c !== null && c > 0) { o.chap = Math.round(c); n++; }
    if (typeof i.time === 'string' && i.time.trim()) { o.time = i.time.trim(); n++; }
    if (Array.isArray(i.tips)) {
      o.tips = i.tips.filter(function (t) { return typeof t === 'string' && t.trim(); }).slice(0, 5);
      if (o.tips.length) n++; else delete o.tips;
    }
    if (typeof i.tracker === 'boolean') o.tracker = i.tracker;
    if (typeof i.locked === 'boolean') o.locked = i.locked;
    return n || 'tracker' in o || 'locked' in o ? o : null;
  }
  // gain d'un point (butin, revente, récompense, paie) : jamais les prix/coûts
  function computeAmount(o) {
    var l = o.l, v = o.v;
    o.amt = 0; o.amtLo = 0; o.amtHi = 0; o.amtEst = false;
    if (l && l.kind !== 'price' && (l.min > 0 || l.max > 0)) {
      o.amtLo = l.min > 0 ? l.min : l.max; o.amtHi = l.max > 0 ? l.max : l.min;
      if (l.min > 0 && !(l.max > 0)) o.amtHi = l.min;
      o.amt = (o.amtLo + o.amtHi) / 2; o.amtEst = o.amtLo !== o.amtHi;
    }
    if (v) {
      var r = v.pay > 0 ? v.pay : v.sell > 0 ? v.sell : 0;
      if (r > o.amt) { o.amt = r; o.amtLo = o.amtHi = r; o.amtEst = false; }
    }
    if (o.amt > 0) {
      o.tier = tierOf(o.amt);
      o.amtLbl = (o.amtEst ? '~' : '') + fmtK(o.amt);
    } else { o.tier = -1; o.amtLbl = ''; }
  }
  // sécurité d'un véhicule : champ i.tracker / i.locked, sinon déduite de la description
  function security(o) {
    var s = { notrack: null, unlocked: null };
    if (o.i && typeof o.i.tracker === 'boolean') s.notrack = !o.i.tracker;
    if (o.i && typeof o.i.locked === 'boolean') s.unlocked = !o.i.locked;
    var d = norm(o.d);
    if (s.notrack === null) {
      if (/sans traceur|ni traceur|aucun traceur/.test(d)) s.notrack = true;
      else if (/traceur (standard|avance)|avec traceur|et traceur|mais avec traceur/.test(d)) s.notrack = false;
    }
    if (s.unlocked === null) {
      if (/non verrouill|pas verrouill|deverrouill/.test(d)) s.unlocked = true;
      else if (/verrouill|key cloner requis/.test(d)) s.unlocked = false;
    }
    return s;
  }

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
      var o = { id: String(m.id), c: m.c, x: m.x, y: m.y, n: m.n || 'Sans nom', d: m.d || '', g: typeof m.g === 'string' ? m.g.trim() : '', approx: !!m.approx, src: m.src || '', v: (m.v && typeof m.v === 'object') ? m.v : null, l: (m.l && typeof m.l === 'object') ? m.l : null, i: parseInfo(m.i), ch: Array.isArray(m.ch) && m.ch.length ? m.ch : null, mk: null, on: false };
      computeAmount(o);
      o.sec = security(o);
      if (o.amt > 0) has.amt = true;
      if (o.i && o.i.diff) has.diff = true;
      if (o.sec.notrack !== null) has.notrack = true;
      if (o.sec.unlocked !== null) has.unlocked = true;
      o.key = norm(o.n);
      o.full = o.key + ' ' + norm(o.d) + ' ' + norm(o.g) + ' ' + norm(cats[m.c].n) + (o.i && o.i.tips ? ' ' + norm(o.i.tips.join(' ')) : '');
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
    // tournées et zones (optionnelles)
    routes = (Array.isArray(data.routes) ? data.routes : []).map(function (r, k) {
      if (!r || !Array.isArray(r.ids)) return null;
      var pts = r.ids.map(function (id) { return byId[String(id)]; }).filter(Boolean);
      if (!pts.length) return null;
      var lo = num(r.total_min), hi = num(r.total_max);
      if (lo === null && hi === null) { lo = 0; hi = 0; pts.forEach(function (m) { lo += m.amtLo; hi += m.amtHi; }); }
      var dist = num(r.dist_m);
      if (dist === null) { dist = 0; for (var i = 1; i < pts.length; i++) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); }
      return { id: String(r.id != null ? r.id : 'r' + k), n: r.n || 'Tournée ' + (k + 1), zone: r.zone || '', kind: r.kind || '', pts: pts, lo: lo || 0, hi: hi || lo || 0, dist: dist, note: typeof r.note === 'string' ? r.note : '' };
    }).filter(Boolean);
    zones = (Array.isArray(data.zones) ? data.zones : []).filter(function (z) {
      return z && isFinite(z.x) && isFinite(z.y) && num(z.r) > 0;
    }).map(function (z) {
      var sc = num(z.score); sc = sc === null ? 0.5 : Math.max(0, Math.min(1, sc));
      return { n: z.n || 'Zone', x: z.x, y: z.y, r: num(z.r), score: sc, kind: z.kind || '', lo: num(z.total_min) || 0, hi: num(z.total_max) || num(z.total_min) || 0, count: num(z.count) || 0 };
    }).sort(function (a, b) { return a.score - b.score; });   // les plus rentables dessinées au-dessus
    // repérage : icônes visibles en jeu, grands repères, thème (optionnels)
    blips = data.blips && typeof data.blips === 'object' && !Array.isArray(data.blips) ? data.blips : null;
    var an = Array.isArray(data.anchors) ? data.anchors : (data.anchors && Array.isArray(data.anchors.anchors) ? data.anchors.anchors : []);
    anchors = an.filter(function (a) { return a && (a.n || a.fr) && isFinite(a.x) && isFinite(a.y); });
    if (!Array.isArray(data.roads)) D.roads = [];
    var th = store.get('theme', 'game'); theme = THEMES[th] ? th : 'game';
    psMode = !!store.get('ps', false) && hasBlips();
    // progression mémorisée
    (store.get('done', []) || []).forEach(function (id) { if (byId[id]) { done[id] = true; cats[byId[id].c].ndone++; } });
    (store.get('fav', []) || []).forEach(function (id) { if (byId[id]) fav[id] = true; });
    hideDone = !!store.get('hideDone', false);
    var vis = store.get('vis', null);
    if (Array.isArray(vis)) vis.forEach(function (id) { if (cats[id]) visible[id] = true; });
    else DEFAULT_PRESETS.forEach(function (p) { presetCats(p).forEach(function (id) { visible[id] = true; }); });
    // filtres et options mémorisés
    var f = store.get('filters', null);
    if (f && typeof f === 'object') {
      F.min = MIN_STEPS.indexOf(f.min) >= 0 ? f.min : 0;
      if (f.diff && typeof f.diff === 'object') Object.keys(f.diff).forEach(function (k) { if (DIFF[k] && f.diff[k]) F.diff[k] = true; });
      F.notrack = !!f.notrack; F.unlocked = !!f.unlocked;
    }
    var o = store.get('opts', null);
    if (o && typeof o === 'object') {
      opt.amt = o.amt !== false; opt.size = !!o.size; opt.zones = o.zones !== false; opt.grid = !!o.grid; opt.chap = o.chap !== false;
      if (o.zk && typeof o.zk === 'object') opt.zk = o.zk;
    }
    if (!has.amt) F.min = 0;
    if (!has.diff) F.diff = {};
    if (!has.notrack) F.notrack = false;
    if (!has.unlocked) F.unlocked = false;
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

  /* ---------- Fond dessiné ---------- */
  // Rendu canvas avec effets : ombre portée, composition (« source-atop » = peindre seulement sur la terre), dégradé radial
  var FxCanvas = L.Canvas.extend({
    _fillStroke: function (ctx, layer) {
      var o = layer.options, fx = o.fx;
      if (!fx) { L.Canvas.prototype._fillStroke.call(this, ctx, layer); return; }
      var r = L.Browser.retina ? 2 : 1;
      ctx.save();
      if (fx.comp) ctx.globalCompositeOperation = fx.comp;
      if (fx.shadow) { ctx.shadowColor = fx.shadow[0]; ctx.shadowBlur = fx.shadow[1] * r; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = (fx.shadow[2] || 0) * r; }
      if (fx.radial && layer._point) {
        var p = layer._point, rad = Math.max(1, layer._radius);
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
        for (var i = 0; i < fx.radial.length; i++) g.addColorStop(fx.radial[i][0], fx.radial[i][1]);
        ctx.globalAlpha = o.fillOpacity == null ? 1 : o.fillOpacity;
        ctx.fillStyle = g; ctx.fill();
        if (o.stroke && o.weight) {
          if (ctx.setLineDash) ctx.setLineDash(o._dashArray || []);
          ctx.shadowColor = 'transparent';
          ctx.globalAlpha = o.opacity; ctx.lineWidth = o.weight; ctx.strokeStyle = o.color; ctx.stroke();
        }
      } else L.Canvas.prototype._fillStroke.call(this, ctx, layer);
      ctx.restore();
    }
  });

  function tintFor(l) {
    var n = norm(l.n);
    if (/swamp|marsh|grassrivers|everglade|bayou|marais/.test(n)) return { r: l.k === 'region' ? 2600 : 1300, c: '46,214,170', a: 0.30 };
    if (/park|forest|mount|kalaga|woods|parc/.test(n)) return { r: 2600, c: '92,214,120', a: 0.20 };
    if (/keys|beach|island|islands|sands/.test(n)) return { r: l.k === 'region' ? 2400 : 700, c: '80,226,255', a: 0.14 };
    if (/lake|lac/.test(n)) return { r: 1800, c: '60,140,255', a: 0.16 };
    if (l.k === 'city') return { r: (typeof l.minZoom === 'number' && l.minZoom <= -5.5) ? 2300 : 1150, c: '214,120,255', a: 0.22 };
    if (l.k === 'district') return { r: 520, c: '190,170,255', a: 0.14 };
    return null;
  }

  // teintes radiales du thème « Néon » (villes plus claires, marais vert-bleu…)
  function neonTints() {
    var out = [];
    D.labels.forEach(function (l) { var t = tintFor(l); if (t) out.push({ x: l.x, y: l.y, r: t.r, c: t.c, a: t.a }); });
    return out;
  }
  function drawBase() {
    bm = window.GTA6_BASEMAP.create(map, { land: D.land, landuse: D.landuse, roads: D.roads }, { theme: theme, tints: neonTints() });
    bm.addTo();
    if (opt.grid) bm.setGrid(true);
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
    var padX = (b[2] - b[0]) * 0.35, padY = (b[3] - b[1]) * 0.35;
    map = L.map('map', {
      crs: L.CRS.Simple, minZoom: MIN_Z, maxZoom: MAX_Z, zoomSnap: 0.5, zoomDelta: 1,
      zoomControl: false, attributionControl: true, preferCanvas: false,
      maxBounds: L.latLngBounds([b[1] - padY, b[0] - padX], [b[3] + padY, b[2] + padX]), maxBoundsViscosity: 0.8,
      tapTolerance: 15, bounceAtZoomLimits: false, wheelPxPerZoomLevel: 90
    });
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Données : gta6map.io, gtabase.com, gta6info.app, gameta.gg, gtadb.org (<a href="https://creativecommons.org/licenses/by/4.0/deed.fr" target="_blank" rel="noopener">CC BY 4.0</a>) · carte non officielle, fond dessiné · <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.createPane('base').style.zIndex = 300;     // fond dessiné (grille, terre)
    map.createPane('mybg').style.zIndex = 350;     // « Mon fond de carte » (captures de l'utilisateur)
    map.createPane('mybgline').style.zIndex = 360; // contours de contrôle pendant le calage
    map.createPane('zones').style.zIndex = 380;    // halos des zones rentables
    map.createPane('route').style.zIndex = 420;    // tracé de la tournée
    map.createPane('streetlbl').style.zIndex = 440; // noms de rues (canvas)
    map.createPane('labels').style.zIndex = 450;
    map.createPane('routenum').style.zIndex = 640; // numéros de la tournée (au-dessus des marqueurs)
    map.createPane('me').style.zIndex = 700;

    drawBase();

    // libellés des lieux (avec anti-collision) ; « fr » prioritaire sur « n »
    labelLayer = L.layerGroup().addTo(map);
    labelItems = D.labels.map(function (l) {
      var k = LBL_KINDS[l.k] ? l.k : 'city';
      var minZ = typeof l.minZoom === 'number' ? l.minZoom : LBL_KINDS[k].minZ;
      var maxZ = typeof l.maxZoom === 'number' ? l.maxZoom : Math.max(LBL_KINDS[k].maxZ, minZ + 2);
      var txt = labelText(l);
      var mk = L.marker([l.y, l.x], { pane: 'labels', interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'lbl ' + k, html: '<span>' + esc(txt) + '</span>', iconSize: [0, 0] }) });
      return { l: l, k: k, t: txt, minZ: minZ, maxZ: maxZ, mk: mk, on: false, w: 0, h: 0, prio: LBL_KINDS[k].prio + minZ * 10 };
    }).sort(function (a, b2) { return a.prio - b2.prio; });
    sizeLabels();
    map.on('moveend', updateLabels);      // avant les noms de rues (qui évitent les libellés de lieux)
    map.on('zoomend', updateZoomClass);
    bm.obstacles = function () { return placedBoxes; };
    bm.addLabels();
    initLocate();

    // zones rentables
    drawZones();

    // clusters
    cluster = L.markerClusterGroup({
      chunkedLoading: true, chunkInterval: 120, chunkDelay: 20,
      showCoverageOnHover: false, spiderfyOnMaxZoom: true, zoomToBoundsOnClick: true, removeOutsideVisibleBounds: true,
      animate: true, animateAddingMarkers: false, spiderfyDistanceMultiplier: 1.6,
      maxClusterRadius: function (z) { return z >= 1 ? 30 : z >= -1 ? 45 : z >= -3.5 ? 60 : 72; },
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
    updateZoomClass();
    bm.labels.redraw();

    map.on('click', function (e) {
      if (mybgBusy()) return;
      if (placingMe) { setMe(e.latlng); setPlacing(false); return; }
      closeResults(); closeLegend();
      if (selected) closeSheet();
      else if (document.body.classList.contains('panel-open') && !isWide()) closePanel();
    });
    map.on('contextmenu', function (e) { if (mybgBusy()) return; setMe(e.latlng); setPlacing(false); });
  }

  function mybgBusy() { return !!(window.GTA6_MYBG && window.GTA6_MYBG.busy()); }

  // types de libellés : zoom mini/maxi par défaut et priorité (plus petit = plus important)
  var LBL_KINDS = {
    city: { minZ: -4.5, maxZ: MAX_Z, prio: 0 },
    region: { minZ: MIN_Z, maxZ: -3.5, prio: 1000 },
    district: { minZ: -2, maxZ: MAX_Z, prio: 2000 },
    water: { minZ: -4.5, maxZ: MAX_Z, prio: 2500 },
    poi: { minZ: 0, maxZ: MAX_Z, prio: 3000 }
  };
  function labelText(l) { return typeof l.fr === 'string' && l.fr.trim() ? l.fr.trim() : l.n; }
  // police de chaque type de libellé selon le thème (doit correspondre à css/app.css)
  function labelFont(k) {
    var neon = theme === 'neon';
    if (k === 'city') return neon ? ['700 15px Orbitron, sans-serif', 0.08, true] : ['700 17px Rajdhani, sans-serif', 0.1, true];
    if (k === 'region') return neon ? ['700 13px Orbitron, sans-serif', 0.22, true] : ['700 14px Rajdhani, sans-serif', 0.26, true];
    if (k === 'district') return ['700 13px Rajdhani, sans-serif', 0.12, true];
    if (k === 'water') return ['italic 600 14px Rajdhani, sans-serif', 0.06, false];
    return ['600 12.5px Rajdhani, sans-serif', 0.02, false];
  }
  var measureCtx = null;
  function labelSize(txt, k) {
    var f = labelFont(k), fs = parseFloat(f[0].match(/(\d+(?:\.\d+)?)px/)[1]);
    var t = f[2] ? String(txt).toUpperCase() : String(txt), w = t.length * fs * 0.62;
    try {
      if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = f[0]; w = measureCtx.measureText(t).width;
    } catch (e) { /* estimation */ }
    return [w + t.length * fs * f[1] + 8, fs + 6];
  }
  function sizeLabels() { labelItems.forEach(function (it) { var sz = labelSize(it.t, it.k); it.w = sz[0]; it.h = sz[1]; }); }
  // n'affiche un libellé que s'il ne chevauche pas un libellé plus important (positions écran, vue courante + marge)
  var placedBoxes = [];
  function updateLabels() {
    var z = map.getZoom(), placed = [], size = map.getSize();
    var tl = map.containerPointToLayerPoint([-250, -150]), br = map.containerPointToLayerPoint([size.x + 250, size.y + 150]);
    labelItems.forEach(function (it) {
      var want = z >= it.minZ && z <= it.maxZ;
      if (want) {
        var p = map.latLngToLayerPoint([it.l.y, it.l.x]);
        if (p.x < tl.x || p.x > br.x || p.y < tl.y || p.y > br.y) want = false;
        else {
          var bx = [p.x - it.w / 2, p.y - it.h / 2, p.x + it.w / 2, p.y + it.h / 2];
          for (var i = 0; i < placed.length; i++) {
            var q = placed[i];
            if (bx[0] < q[2] + 6 && bx[2] > q[0] - 6 && bx[1] < q[3] + 3 && bx[3] > q[1] - 3) { want = false; break; }
          }
          if (want) placed.push(bx);
        }
      }
      if (want && !it.on) { labelLayer.addLayer(it.mk); it.on = true; }
      else if (!want && it.on) { labelLayer.removeLayer(it.mk); it.on = false; }
    });
    placedBoxes = placed;
  }
  function updateZoomClass() {
    var c = map.getContainer();
    var z = map.getZoom();
    c.classList.toggle('zhi', opt.amt && z >= AMT_Z);
    c.classList.toggle('zfar', z < -3.5);
    c.classList.toggle('zmid', z >= -3.5 && z < -1.5);
    c.classList.toggle('znear', z >= -1.5);
  }

  /* ---------- Repérage : thème, grille, échelle, boussole, « Mode PlayStation » ---------- */
  function inGame(id) { return !!(blips && blips[id] && blips[id].ingame === true); }
  function hasBlips() { return !!blips && Object.keys(blips).some(function (k) { return blips[k] && typeof blips[k].ingame === 'boolean'; }); }
  function applyTheme() {
    document.body.classList.toggle('th-game', theme === 'game');
    document.body.classList.toggle('th-neon', theme === 'neon');
    var mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute('content', theme === 'game' ? '#1d3346' : '#070b1f');
  }
  function setTheme(t) {
    if (!THEMES[t]) t = 'game';
    theme = t; store.set('theme', t); applyTheme();
    if (bm) { bm.setTheme(t); sizeLabels(); updateLabels(); bm.labels.redraw(); }
    Array.prototype.forEach.call(document.querySelectorAll('#themeSeg button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-th') === t ? 'true' : 'false'); });
  }
  function setGrid(on) {
    opt.grid = !!on; saveOpts();
    document.body.classList.toggle('grid-on', opt.grid);
    if (bm) bm.setGrid(opt.grid);
    var g = $('optGrid'); if (g) g.checked = opt.grid;
    updateGridEdges();
  }
  // PlayStation : seulement les catégories qui ont une icône sur la carte du jeu + celles des préréglages actifs
  function setPS(on) {
    on = !!on && hasBlips();
    if (on === psMode) return;
    if (on) {
      store.set('visBeforePS', catOrder.filter(function (id) { return visible[id]; }));
      var keep = {};
      PRESETS.forEach(function (p) {
        if (p.all) return;
        var ids = presetCats(p.id);
        if (ids.length && ids.every(function (id) { return visible[id]; })) ids.forEach(function (id) { keep[id] = true; });
      });
      catOrder.forEach(function (id) { visible[id] = !!((inGame(id) && !cats[id].hidden) || keep[id]); });
    } else {
      var prev = store.get('visBeforePS', null);
      if (Array.isArray(prev)) { catOrder.forEach(function (id) { visible[id] = false; }); prev.forEach(function (id) { if (cats[id]) visible[id] = true; }); }
    }
    psMode = on; store.set('ps', on);
    document.body.classList.toggle('ps', on);
    var c = $('optPS'); if (c) c.checked = on;
    applyVisibility();
    toast(on ? 'Mode PlayStation : seulement les icônes de la carte du jeu (+ ton préréglage)' : 'Mode PlayStation désactivé');
  }
  function buildGameSec() {
    var seg = $('themeSeg');
    seg.innerHTML = Object.keys(THEMES).map(function (k) {
      return '<button type="button" data-th="' + k + '" aria-pressed="' + (theme === k) + '">' + ICONS.use(k === 'game' ? 'ui_map' : 'disco') + THEMES[k] + '</button>';
    }).join('');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { setTheme(b.getAttribute('data-th')); toast('Style de carte : ' + THEMES[theme]); });
    });
    $('psRow').hidden = !hasBlips();
    var ps = $('optPS'); ps.checked = psMode;
    ps.addEventListener('change', function () { setPS(ps.checked); });
    var g = $('optGrid'); g.checked = opt.grid;
    g.addEventListener('change', function () { setGrid(g.checked); });
  }

  // bandeaux de repères de la grille (lettres en haut, chiffres à gauche), échelle et boussole
  var gridRaf = 0;
  function initLocate() {
    var gx = document.createElement('div'); gx.id = 'gridX'; gx.className = 'gedge gx'; gx.setAttribute('aria-hidden', 'true');
    var gy = document.createElement('div'); gy.id = 'gridY'; gy.className = 'gedge gy'; gy.setAttribute('aria-hidden', 'true');
    var mi = document.createElement('div'); mi.id = 'mapinfo'; mi.className = 'mapinfo';
    mi.innerHTML = '<span class="compass" title="Nord en haut, comme sur la carte du jeu" aria-label="Boussole : nord en haut"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5"/><path class="n" d="M16 4l4.2 12h-8.4z"/><path class="s" d="M16 28l-4.2-12h8.4z"/><text x="16" y="12.6">N</text></svg></span>' +
      '<span class="scale" aria-label="Échelle"><i id="scaleBar"></i><b id="scaleTxt"></b></span>';
    var app = $('app'), anchor = $('legend');
    app.insertBefore(gx, anchor); app.insertBefore(gy, anchor); app.insertBefore(mi, anchor);
    var G = bm.G;
    for (var c = 0; c < G.cols; c++) gx.insertAdjacentHTML('beforeend', '<span>' + G.colName(c) + '</span>');
    for (var r = 0; r < G.rows; r++) gy.insertAdjacentHTML('beforeend', '<span>' + (r + 1) + '</span>');
    var sched = function () { if (!gridRaf) gridRaf = requestAnimationFrame(function () { gridRaf = 0; updateGridEdges(); }); };
    map.on('move zoom viewreset resize', sched);
    map.on('zoomend', updateScale);
    document.body.classList.toggle('grid-on', !!opt.grid);
    L.DomEvent.disableClickPropagation(mi);
  }
  function updateGridEdges() {
    if (!opt.grid || !map || !bm) return;
    var G = bm.G, size = map.getSize(), s = Math.pow(2, map.getZoom()), cell = G.size * s;
    var step = cell < 16 ? 3 : cell < 30 ? 2 : 1;
    var xs = $('gridX').children, ys = $('gridY').children;
    for (var c = 0; c < xs.length; c++) {
      var px = map.latLngToContainerPoint([0, G.x0 + (c + 0.5) * G.size]).x;
      var on = px > 22 && px < size.x - 22 && c % step === 0;
      xs[c].style.display = on ? '' : 'none';
      if (on) xs[c].style.transform = 'translateX(' + Math.round(px) + 'px)';
    }
    for (var r = 0; r < ys.length; r++) {
      var py = map.latLngToContainerPoint([G.y1 - (r + 0.5) * G.size, 0]).y;
      var on2 = py > 20 && py < size.y - 20 && r % step === 0;
      ys[r].style.display = on2 ? '' : 'none';
      if (on2) ys[r].style.transform = 'translateY(' + Math.round(py) + 'px)';
    }
  }
  function updateScale() {
    var s = Math.pow(2, map.getZoom()), maxM = 90 / s, p = Math.pow(10, Math.floor(Math.log(maxM) / Math.LN10)), d = maxM / p;
    var nice = (d >= 5 ? 5 : d >= 2 ? 2 : 1) * p;
    $('scaleBar').style.width = Math.round(nice * s) + 'px';
    $('scaleTxt').textContent = nice >= 1000 ? (nice / 1000) + ' km' : nice + ' m';
  }

  /* ---------- « Où est-ce sur la carte du jeu ? » ---------- */
  var DIRS = ['à l\'est', 'au nord-est', 'au nord', 'au nord-ouest', 'à l\'ouest', 'au sud-ouest', 'au sud', 'au sud-est'];
  function dirWord(dx, dy) { var a = Math.atan2(dy, dx); var k = Math.round(a / (Math.PI / 4)); return DIRS[(k + 8) % 8]; }
  var anchorCache = null;
  function anchorList() {
    if (anchorCache) return anchorCache;
    var src = anchors.length ? anchors : D.labels.filter(function (l) { return l.k === 'city' || l.k === 'poi' || l.k === 'district'; });
    anchorCache = src.map(function (a) { return { n: labelText(a), x: a.x, y: a.y, k: a.k || 'landmark', d: typeof a.d === 'string' && anchors.length ? a.d : '' }; });
    return anchorCache;
  }
  function nearestAnchors(m, n) {
    var list = anchorList().map(function (a) { var d = Math.hypot(a.x - m.x, a.y - m.y); return { a: a, d: d, sc: d * (a.k === 'city' ? 0.85 : 1) }; })
      .sort(function (p, q) { return p.sc - q.sc; });
    var out = [];
    for (var i = 0; i < list.length && out.length < n; i++) {
      var c = list[i];
      if (out.some(function (o) { return o.a.n === c.a.n || Math.hypot(o.a.x - c.a.x, o.a.y - c.a.y) < 350; })) continue;
      if (out.length && c.d > 7000) break;
      out.push(c);
    }
    return out;
  }
  function openWhere(m) {
    var box = $('where'); box.hidden = false;
    var near = nearestAnchors(m, 3);
    var pts = [[m.x, m.y]].concat(near.map(function (o) { return [o.a.x, o.a.y]; }));
    var x0 = Math.min.apply(null, pts.map(function (p) { return p[0]; })), x1 = Math.max.apply(null, pts.map(function (p) { return p[0]; }));
    var y0 = Math.min.apply(null, pts.map(function (p) { return p[1]; })), y1 = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
    var wrap = $('whereMap'), w = wrap.clientWidth || 320, h = wrap.clientHeight || 240;
    var s = Math.min((w - 90) / Math.max(1, x1 - x0), (h - 70) / Math.max(1, y1 - y0));
    var z = Math.max(-5.5, Math.min(-1.5, Math.log(s) / Math.LN2, Math.log(w / 2500) / Math.LN2));
    var cv = $('whereCv');
    var P = bm.renderMini(cv, (x0 + x1) / 2, (y0 + y1) / 2, z, w, h);
    var ctx = cv.getContext('2d'), game = theme === 'game';
    // repères : trait pointillé vers le point + pastille + nom
    near.forEach(function (o, k) {
      var a = P(o.a.x, o.a.y), b = P(m.x, m.y);
      ctx.save(); ctx.setLineDash([5, 5]); ctx.lineWidth = 2; ctx.strokeStyle = game ? 'rgba(30,40,60,.55)' : 'rgba(255,255,255,.5)';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore();
    });
    near.forEach(function (o, k) {
      var a = P(o.a.x, o.a.y);
      ctx.beginPath(); ctx.arc(a[0], a[1], 9, 0, Math.PI * 2); ctx.fillStyle = '#1d2433'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.font = '700 11px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(String(k + 1), a[0], a[1] + 0.5);
      ctx.font = '700 13px Rajdhani, sans-serif'; ctx.lineJoin = 'round';
      var bp = P(m.x, m.y), tw2 = ctx.measureText(o.a.n).width / 2 + 6;
      var tx = Math.max(tw2, Math.min(w - tw2, a[0])), ty = a[1] + (a[1] > h - 30 ? -18 : 19);
      if (Math.abs(ty - bp[1]) < 22 && Math.abs(tx - bp[0]) < tw2 + 16) ty = a[1] + (ty > a[1] ? -19 : 19);   // ne cache pas le point
      if (Math.abs(ty - bp[1]) < 22 && Math.abs(tx - bp[0]) < tw2 + 16) tx = bp[0] + (a[0] >= bp[0] ? 1 : -1) * (tw2 + 20);
      ctx.lineWidth = 4; ctx.strokeStyle = game ? 'rgba(255,255,255,.95)' : 'rgba(10,7,32,.95)'; ctx.strokeText(o.a.n, tx, ty);
      ctx.fillStyle = game ? '#1f2633' : '#e6e0ff'; ctx.fillText(o.a.n, tx, ty);
    });
    var c = cats[m.c], p = P(m.x, m.y);
    ctx.beginPath(); ctx.arc(p[0], p[1], 22, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,46,151,.22)'; ctx.fill();
    ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, Math.PI * 2); ctx.fillStyle = c.color; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(p[0], p[1], 13.5, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = '#ff2e97'; ctx.stroke();
    // consignes
    var cell = bm.G.cellOf(m.x, m.y), street = bm.nearestStreet(m.x, m.y, 140), h2 = '';
    if (near.length) {
      var f = near[0];
      h2 += '<li><span class="wn">1</span><p>Sur la carte du jeu, repère <b>' + esc(f.a.n) + '</b>.' + (f.a.d ? '<small class="wd">' + esc(f.a.d) + '</small>' : '') + '</p></li>';
      h2 += '<li><span class="wn pt">' + ICONS.use('ui_target') + '</span><p>' + (f.d < 90 ? 'Le point est <b>juste à côté</b>.' : 'Le point est à <b>' + esc(fmtKm(f.d)) + ' ' + dirWord(m.x - f.a.x, m.y - f.a.y) + '</b> de ce repère.') + '</p></li>';
      if (near.length > 1) h2 += '<li><span class="wn">' + (near.length > 2 ? '2·3' : '2') + '</span><p>Pour vérifier : ' + near.slice(1).map(function (o) { return esc(fmtKm(o.d)) + ' ' + dirWord(m.x - o.a.x, m.y - o.a.y) + ' de <b>' + esc(o.a.n) + '</b>'; }).join(', ') + '.</p></li>';
    }
    var extra = [];
    if (street) extra.push('près de <b>' + esc(street) + '</b>');
    extra.push('quartier : <b>' + esc(zoneOf(m)) + '</b>');
    if (cell) extra.push('case <b>' + cell + '</b> de la grille');
    h2 += '<li><span class="wn">' + ICONS.use('ui_grid') + '</span><p>' + extra.join(' · ') + '.</p></li>';
    if (blips && blips[m.c]) h2 += '<li><span class="wn">' + ICONS.use(inGame(m.c) ? 'eye' : 'ui_eyeoff') + '</span><p>' + (inGame(m.c) ? 'Ce type de lieu a une <b>icône sur la carte du jeu</b>.' : 'Ce point n\'a <b>pas d\'icône</b> sur la carte du jeu : vise l\'endroit avec les repères.') + '</p></li>';
    $('whereSteps').innerHTML = h2;
    $('whereT').textContent = 'Où est-ce sur la carte du jeu ?';
    $('whereSub').textContent = m.n;
    $('whereGo').onclick = function () { closeWhere(); map.setView([m.y, m.x], Math.max(map.getZoom(), -1)); flash(m); };
  }
  function closeWhere() { $('where').hidden = true; }

  /* ---------- Zones rentables ---------- */
  function drawZones() {
    if (!zones.length) return;
    zoneRenderer = new FxCanvas({ padding: 0.3, pane: 'zones' });
    zoneLayer = L.layerGroup();
    zones.forEach(function (z) {
      var K = kindOf(z.kind), s = z.score;
      var c = L.circle([z.y, z.x], {
        renderer: zoneRenderer, radius: z.r, interactive: true, bubblingMouseEvents: false,
        stroke: true, color: K.c, weight: 1.2, opacity: 0.2 + 0.4 * s, dashArray: '4 8',
        fill: true, fillOpacity: 1,
        fx: { radial: [[0, 'rgba(' + K.rgb + ',' + (0.10 + 0.30 * s).toFixed(3) + ')'], [0.6, 'rgba(' + K.rgb + ',' + (0.06 + 0.22 * s).toFixed(3) + ')'], [0.85, 'rgba(' + K.rgb + ',' + (0.08 + 0.3 * s).toFixed(3) + ')'], [1, 'rgba(' + K.rgb + ',0)']] }
      });
      c._zone = z;
      c.on('click', function (e) { L.DomEvent.stopPropagation(e); if (placingMe) { setMe(e.latlng); setPlacing(false); return; } zonePopup(z); });
      z.layer = c;
    });
    map.on('zoomend', styleZones);
    styleZones();
    applyZones();
  }
  var zoneNear = null;
  function styleZones() {
    var near = map.getZoom() >= -3;
    if (near === zoneNear) return;
    zoneNear = near;
    zones.forEach(function (z) { z.layer.setStyle({ stroke: near }); });
  }
  function applyZones() {
    if (!zoneLayer) return;
    zoneLayer.clearLayers();
    if (opt.zones) zones.forEach(function (z) { if (opt.zk[z.kind] !== false) zoneLayer.addLayer(z.layer); });
    if (opt.zones && !map.hasLayer(zoneLayer)) zoneLayer.addTo(map);
    else if (!opt.zones && map.hasLayer(zoneLayer)) map.removeLayer(zoneLayer);
  }
  function routesForZone(z) {
    return routes.filter(function (r) { return r.zone && norm(r.zone) === norm(z.n) && (!r.kind || !z.kind || r.kind === z.kind); });
  }
  function zonePopup(z) {
    var K = kindOf(z.kind);
    var el = document.createElement('div');
    el.className = 'zp';
    var rs = routesForZone(z);
    el.innerHTML = '<div class="zp-h" style="--c:' + K.c + '"><span class="dot">' + ICONS.use(K.icon) + '</span><div><small>Zone rentable · ' + esc(K.n) + '</small><b>' + esc(z.n) + '</b></div></div>' +
      '<div class="zp-g"><div><small>Points</small><strong>' + fmtInt(z.count || 0) + '</strong></div><div><small>Total estimé</small><strong>' + esc(fmtRangeK(z.lo, z.hi)) + '</strong></div></div>' +
      '<div class="zp-s"><small>Rentabilité</small><span class="meter"><i style="width:' + Math.round(z.score * 100) + '%;background:' + K.c + '"></i></span></div>' +
      (rs.length ? '<button type="button" class="btn primary zp-go">' + ICONS.use('ui_route') + 'Lancer la tournée</button>' : '');
    var go = el.querySelector('.zp-go');
    if (go) go.addEventListener('click', function () { map.closePopup(); startRoute(rs[0]); });
    L.popup({ className: 'zpop', maxWidth: 280, minWidth: 220, autoPanPaddingTopLeft: [20, 80], autoPanPaddingBottomRight: [20, 40] })
      .setLatLng([z.y, z.x]).setContent(el).openOn(map);
  }

  /* ---------- Marqueurs ---------- */
  function iconFor(m) {
    var c = cats[m.c];
    var cls = 'mk' + (m.approx ? ' ap' : '') + (done[m.id] ? ' dn' : '') + (fav[m.id] ? ' fv' : '') + (selected === m ? ' sel' : '') + (m.tier >= 0 ? ' t' + m.tier : '') + (m.rt ? ' rt' : '') + (blips && !inGame(m.c) ? ' ng' : '');
    var key = m.c + '|' + cls + '|' + m.amtLbl;
    var ic = iconCache[key];
    if (!ic) {
      ic = iconCache[key] = L.divIcon({
        className: cls, iconSize: [44, 44], iconAnchor: [22, 22],
        html: '<div style="--c:' + esc(c.color) + '">' + ICONS.use(c.icon) + '</div>' + (m.amtLbl ? '<b class="amt">' + esc(m.amtLbl) + '</b>' : '')
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

  function filtersActive() { return F.min > 0 || Object.keys(F.diff).length > 0 || F.notrack || F.unlocked; }
  function passFilters(m) {
    if (F.min > 0 && !(m.amt >= F.min)) return false;
    if (Object.keys(F.diff).length && !(m.i && m.i.diff && F.diff[m.i.diff])) return false;
    if (F.notrack && m.sec.notrack !== true) return false;
    if (F.unlocked && m.sec.unlocked !== true) return false;
    return true;
  }
  function wanted(m) {
    if (!visible[m.c]) return false;
    if (hideDone && done[m.id]) return false;
    return passFilters(m);
  }
  function applyVisibility() {
    var add = [], rem = [];
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      if (m.pinned) continue; // point sélectionné ou de la tournée : affiché hors clusters
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
    var tv = $('btnTopVal');
    if (tv && !tv.dataset.bound) {
      tv.dataset.bound = '1';
      tv.hidden = !markers.some(function (m) { return mainValue(m.v) > 0; });
      tv.addEventListener('click', showTopValue);
    }
    var tl = $('btnTopLoot');
    if (tl && !tl.dataset.bound) {
      tl.dataset.bound = '1';
      tl.hidden = !markers.some(function (m) { return lootScore(m.l) > 0; });
      tl.addEventListener('click', showTopLoot);
    }
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
          '<span class="dot">' + ICONS.use(c.icon) + '</span><span class="cn">' + esc(c.n) + (inGame(c.id) ? '<i class="ig" title="Icône visible sur la carte du jeu">' + ICONS.use('gamepad') + '</i>' : '') + '<small><b></b></small></span><span class="cc"></span><span class="ck">' + ICONS.use('ui_check') + '</span></button>';
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
      if (route) drawRouteNums();
      toast('Progression remise à zéro');
    });
    buildFilters();
    buildDisplay();
    buildGameSec();
    buildTabs();
  }

  /* ---------- Filtres ---------- */
  function saveFilters() { store.set('filters', { min: F.min, diff: F.diff, notrack: F.notrack, unlocked: F.unlocked }); }
  function minLabel(v) { return v > 0 ? '≥ ' + fmtK(v) : 'Tous'; }
  function buildFilters() {
    $('amtRow').hidden = !has.amt;
    var sl = $('minAmt');
    sl.max = String(MIN_STEPS.length - 1);
    sl.value = String(Math.max(0, MIN_STEPS.indexOf(F.min)));
    $('minAmtOut').textContent = minLabel(F.min);
    var setMin = function (commit) {
      F.min = MIN_STEPS[+sl.value] || 0;
      $('minAmtOut').textContent = minLabel(F.min);
      sl.style.setProperty('--p', (100 * sl.value / (MIN_STEPS.length - 1)) + '%');
      if (commit) { saveFilters(); applyVisibility(); }
    };
    sl.addEventListener('input', function () { setMin(false); applyDebounced(); });
    sl.addEventListener('change', function () { setMin(true); });
    setMin(false);
    var applyDebounced = debounce(function () { saveFilters(); applyVisibility(); }, 160);

    $('diffRow').hidden = !has.diff;
    var dc = $('diffChips'); dc.innerHTML = '';
    [1, 2, 3].forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip sm d' + k; b.setAttribute('data-diff', k);
      b.innerHTML = '<span class="gauge g' + k + '"><i></i><i></i><i></i></span>' + DIFF[k];
      b.addEventListener('click', function () {
        if (F.diff[k]) delete F.diff[k]; else F.diff[k] = true;
        saveFilters(); applyVisibility();
      });
      dc.appendChild(b);
    });
    $('secRow').hidden = !(has.notrack || has.unlocked);
    var sc = $('secChips'); sc.innerHTML = '';
    [['notrack', 'Sans traceur', has.notrack], ['unlocked', 'Non verrouillé', has.unlocked]].forEach(function (d) {
      if (!d[2]) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip sm'; b.setAttribute('data-sec', d[0]); b.textContent = d[1];
      b.addEventListener('click', function () { F[d[0]] = !F[d[0]]; saveFilters(); applyVisibility(); });
      sc.appendChild(b);
    });
    $('filtSec').hidden = !(has.amt || has.diff || has.notrack || has.unlocked);
    $('filtReset').addEventListener('click', resetFilters);
    $('filtPill').addEventListener('click', function () { resetFilters(); toast('Filtres retirés'); });
  }
  function resetFilters() {
    F.min = 0; F.diff = {}; F.notrack = false; F.unlocked = false;
    var sl = $('minAmt'); sl.value = '0'; sl.style.setProperty('--p', '0%'); $('minAmtOut').textContent = minLabel(0);
    saveFilters(); applyVisibility();
  }
  function filterSummary() {
    var p = [];
    if (F.min > 0) p.push('≥ ' + fmtK(F.min));
    var d = Object.keys(F.diff).map(function (k) { return DIFF[k]; });
    if (d.length) p.push(d.join(' / '));
    if (F.notrack) p.push('sans traceur');
    if (F.unlocked) p.push('non verrouillé');
    return p.join(' · ');
  }
  function updateFilterUI() {
    var act = filtersActive();
    $('filtReset').hidden = !act;
    Array.prototype.forEach.call(document.querySelectorAll('#diffChips .chip'), function (b) {
      var on = !!F.diff[b.getAttribute('data-diff')]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#secChips .chip'), function (b) {
      var on = !!F[b.getAttribute('data-sec')]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
    $('btnLayers').classList.toggle('filt', act);
    $('filtPill').hidden = !act;
    $('filtPillTxt').textContent = act ? 'Filtre : ' + filterSummary() : '';
    var n = $('filtNote');
    if (act) {
      var k = 0; for (var i = 0; i < markers.length; i++) if (visible[markers[i].c] && passFilters(markers[i])) k++;
      n.hidden = false; n.textContent = k ? fmtInt(k) + ' point' + (k > 1 ? 's' : '') + ' correspond' + (k > 1 ? 'ent' : '') + ' aux filtres dans les calques affichés.' : 'Aucun point ne correspond : élargis les filtres ou affiche d\'autres calques.';
    } else n.hidden = true;
  }

  /* ---------- Options d'affichage + légende ---------- */
  function saveOpts() { store.set('opts', opt); }
  function buildDisplay() {
    var oa = $('optAmt'), os = $('optSize');
    oa.checked = opt.amt; os.checked = opt.size;
    $('dispSec').hidden = !has.amt;
    oa.addEventListener('change', function () { opt.amt = oa.checked; saveOpts(); updateZoomClass(); });
    os.addEventListener('change', function () { opt.size = os.checked; saveOpts(); document.body.classList.toggle('vsize', opt.size); });
    document.body.classList.toggle('vsize', opt.size);
    // zones
    $('zoneSec').hidden = !zones.length;
    if (zones.length) {
      var oz = $('optZones'); oz.checked = opt.zones;
      oz.addEventListener('change', function () { opt.zones = oz.checked; saveOpts(); applyZones(); updateZoneChips(); });
      var kinds = []; zones.forEach(function (z) { if (kinds.indexOf(z.kind) < 0) kinds.push(z.kind); });
      var box = $('zoneKinds'); box.innerHTML = '';
      if (kinds.length > 1) kinds.forEach(function (k) {
        var K = kindOf(k);
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'chip sm zk'; b.setAttribute('data-k', k); b.style.setProperty('--c', K.c);
        b.innerHTML = '<i></i>' + esc(K.n);
        b.addEventListener('click', function () { opt.zk[k] = opt.zk[k] === false; if (!opt.zones) { opt.zones = true; oz.checked = true; } saveOpts(); applyZones(); updateZoneChips(); });
        box.appendChild(b);
      });
      updateZoneChips();
    }
    buildLegend();
  }
  function updateZoneChips() {
    Array.prototype.forEach.call(document.querySelectorAll('#zoneKinds .chip'), function (b) {
      var on = opt.zones && opt.zk[b.getAttribute('data-k')] !== false;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
  }
  function buildLegend() {
    var box = $('legendBox');
    var h = '';
    if (has.amt) {
      h += '<h4>Ce que rapporte un point</h4><ul class="lg-t">' + TIERS.map(function (t) {
        return '<li><span class="sw-t" style="--t:' + t.c + '">' + '$' + '</span>' + esc(t.n) + '</li>';
      }).join('') + '</ul><p class="lg-n">Le montant s\'affiche sous l\'icône en zoomant. « ~ » = moyenne d\'une fourchette.</p>';
    }
    if (zones.length) {
      var kinds = []; zones.forEach(function (z) { if (kinds.indexOf(z.kind) < 0) kinds.push(z.kind); });
      h += '<h4>Zones rentables</h4><ul class="lg-z">' + kinds.map(function (k) {
        var K = kindOf(k); return '<li><span class="halo" style="--c:' + K.rgb + '"></span>' + esc(K.n) + '</li>';
      }).join('') + '</ul><p class="lg-n">Plus le halo est intense, plus la zone rapporte. Touche un halo pour le détail.</p>';
    }
    h += '<h4>Symboles</h4><ul class="lg-s">' +
      '<li><span class="mk-s ap"></span>Position approximative</li>' +
      '<li><span class="mk-s dn"></span>Déjà fait</li>' +
      '<li><span class="mk-s fv"></span>Favori</li>' +
      (routes.length ? '<li><span class="rnum-s">3</span>Étape d\'une tournée</li>' : '') + '</ul>';
    box.innerHTML = h;
  }
  function toggleLegend() {
    var open = $('legendBox').hidden;
    $('legendBox').hidden = !open;
    $('btnLegend').setAttribute('aria-expanded', open);
    $('legend').classList.toggle('open', open);
  }
  function closeLegend() { if (!$('legendBox').hidden) toggleLegend(); }

  /* ---------- Onglets du panneau ---------- */
  var curTab = 'layers';
  function buildTabs() {
    $('tabRoutes').hidden = !routes.length;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [role=tab]'), function (b) {
      b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
    });
    var t = store.get('tab', 'layers');
    setTab(t === 'routes' && !routes.length ? 'layers' : t, true);
  }
  function setTab(t, quiet) {
    curTab = t;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [role=tab]'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === t ? 'true' : 'false'); });
    Array.prototype.forEach.call(document.querySelectorAll('.tabp'), function (p) { p.hidden = p.getAttribute('data-tab') !== t; });
    if (t === 'routes') renderRouteList();
    if (t === 'stats') renderStats();
    if (!quiet) store.set('tab', t);
    var pb = document.querySelector('.pbody'); if (pb) pb.scrollTop = 0;
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
    if (filtersActive()) { shown = 0; for (var i = 0; i < markers.length; i++) if (markers[i].on || markers[i].pinned && wanted(markers[i])) shown++; }
    $('visibleCount').textContent = shown ? fmtInt(shown) + ' point' + (shown > 1 ? 's' : '') + ' affiché' + (shown > 1 ? 's' : '') + ' sur ' + fmtInt(markers.length) + (filtersActive() ? ' (filtres actifs)' : '') : 'Aucun point affiché : choisissez un préréglage, une catégorie ou élargissez les filtres.';
    updateFilterUI();
    renderFavs();
    if (curTab === 'stats' && document.body.classList.contains('panel-open')) renderStats();
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
    closeResults(); closeLegend();
    if (curTab === 'stats') renderStats();
    if (curTab === 'routes') renderRouteList();
  }
  function closePanel() {
    document.body.classList.remove('panel-open');
    $('panel').setAttribute('aria-hidden', 'true'); $('btnLayers').setAttribute('aria-expanded', 'false');
    $('scrim').hidden = true;
  }

  /* ---------- Recherche ---------- */
  function amtChip(m) {
    if (!(m.amt > 0)) return '';
    return '<b class="rv" style="--t:' + TIERS[m.tier].c + '">' + esc(m.amtEst ? fmtRangeK(m.amtLo, m.amtHi) : fmtK(m.amt)) + '</b>';
  }
  function resultRow(m) {
    var c = cats[m.c];
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'res'; b.setAttribute('role', 'option');
    var extra = amtChip(m) || (valueTag(m.v) ? '<b class="rv">' + esc(valueTag(m.v)) + '</b>' : lootRange(m.l) ? '<b class="rv">' + esc(lootRange(m.l)) + '</b>' : '');
    b.innerHTML = '<span class="dot" style="--c:' + esc(c.color) + '">' + ICONS.use(c.icon) + '</span><span class="rt"><span class="rn">' + esc(m.n) + '</span><span class="rc">' + esc(c.n) +
      (done[m.id] ? ' · fait ✓' : '') + (!visible[m.c] ? ' · <span class="off">calque masqué</span>' : '') + '</span></span>' + (extra ? '<span class="ra">' + extra + '</span>' : '');
    b.addEventListener('click', function () { focusMarker(m); });
    return b;
  }
  var sortVal = !!store.get('sortVal', false);
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
    if (sortVal) res.sort(function (a, b) { return (b[1].amt || 0) - (a[1].amt || 0) || a[0] - b[0] || (a[1].n < b[1].n ? -1 : 1); });
    else res.sort(function (a, b) { return a[0] - b[0] || (a[1].n < b[1].n ? -1 : 1); });
    box.innerHTML = '';
    if (res.length && has.amt) {
      var tools = document.createElement('div');
      tools.className = 'res-tools';
      tools.innerHTML = '<span>' + fmtInt(res.length) + ' résultat' + (res.length > 1 ? 's' : '') + '</span><button type="button" class="sortb" aria-pressed="' + sortVal + '">' + ICONS.use('ui_sort') + (sortVal ? 'Triés par valeur' : 'Trier par valeur') + '</button>';
      tools.querySelector('.sortb').addEventListener('click', function () { sortVal = !sortVal; store.set('sortVal', sortVal); search($('q').value); });
      box.appendChild(tools);
    }
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
    // lieux (quartiers, villes, plans d'eau…) et rues
    var KN = { region: 'Région', city: 'Ville', district: 'Quartier', poi: 'Lieu', water: 'Eau' };
    var placeHits = D.labels.filter(function (l) {
      var k = norm(labelText(l)) + ' ' + norm(l.n);
      return toks.every(function (t) { return k.indexOf(t) >= 0; });
    }).slice(0, 3);
    placeHits.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'res place'; b.setAttribute('role', 'option');
      b.innerHTML = '<span class="dot plc">' + ICONS.use(l.k === 'water' ? 'drop' : 'ui_map') + '</span><span class="rt"><span class="rn">' + esc(labelText(l)) + '</span><span class="rc">' + (KN[l.k] || 'Lieu') + (labelText(l) !== l.n ? ' · ' + esc(l.n) : '') + (bm ? ' · case ' + bm.G.cellOf(l.x, l.y) : '') + '</span></span>';
      b.addEventListener('click', function () {
        closeResults(); $('q').blur(); if (!isWide()) closePanel();
        var zz = { region: -4, city: -2.5, district: -1, water: -2.5, poi: 0 }[l.k];
        map.setView([l.y, l.x], Math.max(map.getZoom(), zz == null ? -1 : zz, typeof l.minZoom === 'number' ? l.minZoom + 0.5 : -6));
        pulseAt(l.x, l.y);
      });
      box.appendChild(b);
    });
    if (bm && nq.length >= 3) bm.findStreets(function (n) { var k = norm(n); return toks.every(function (t) { return k.indexOf(t) >= 0; }); }, 3).forEach(function (st) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'res place'; b.setAttribute('role', 'option');
      var mid = st.pts[Math.floor(st.pts.length / 2)];
      b.innerHTML = '<span class="dot plc">' + ICONS.use('ui_road') + '</span><span class="rt"><span class="rn">' + esc(st.n) + '</span><span class="rc">Rue · ' + esc(zoneOf({ x: mid[0], y: mid[1] })) + '</span></span>';
      b.addEventListener('click', function () {
        closeResults(); $('q').blur(); if (!isWide()) closePanel();
        map.fitBounds(L.latLngBounds([st.bb[1], st.bb[0]], [st.bb[3], st.bb[2]]), { padding: [70, 70], maxZoom: 0.5 });
        showStreet(st.pts);
      });
      box.appendChild(b);
    });
    res.slice(0, 50).forEach(function (r) { box.appendChild(resultRow(r[1])); });
    if (!res.length && !catHits.length && !box.querySelector('.place')) box.innerHTML = '<div class="res-empty">Aucun résultat pour « ' + esc(q) + ' ».</div>';
    else if (res.length > 50) box.insertAdjacentHTML('beforeend', '<div class="res-empty small">' + (res.length - 50) + ' autres résultats : précisez la recherche.</div>');
    box.hidden = false;
    box.scrollTop = 0;
  }
  function closeResults() { $('results').hidden = true; }
  // surbrillance temporaire d'une rue ou d'un lieu trouvé par la recherche
  var hiLayer = null, hiT = 0;
  function clearHi() { if (hiLayer) { map.removeLayer(hiLayer); hiLayer = null; } clearTimeout(hiT); }
  function showStreet(pts) {
    clearHi();
    var ll = pts.map(function (p) { return [p[1], p[0]]; });
    hiLayer = L.layerGroup([
      L.polyline(ll, { pane: 'route', color: '#ff2e97', weight: 12, opacity: 0.35, interactive: false, lineCap: 'round' }),
      L.polyline(ll, { pane: 'route', color: '#ff2e97', weight: 4, opacity: 0.95, interactive: false, lineCap: 'round' })
    ]).addTo(map);
    hiT = setTimeout(clearHi, 6000);
  }
  function pulseAt(x, y) {
    clearHi();
    hiLayer = L.marker([y, x], { pane: 'route', interactive: false, keyboard: false, icon: L.divIcon({ className: 'pulse', iconSize: [0, 0], html: '<i></i>' }) }).addTo(map);
    hiT = setTimeout(clearHi, 3500);
  }
  function showTopValue() {
    var real = markers.filter(function (m) { return realValue(m.v) > 0; }).sort(function (a, b) { return realValue(b.v) - realValue(a.v); });
    var est = markers.filter(function (m) { return !realValue(m.v) && m.v && m.v.base; }).sort(function (a, b) { return b.v.base - a.v.base; });
    var box = $('results');
    box.innerHTML = '<div class="res-empty small">Ce qu\'ils rapportent vraiment (paie de Randy/Moses ou revente) — ' + real.length + ' véhicules</div>';
    real.forEach(function (m) { box.appendChild(resultRow(m)); });
    if (est.length) {
      box.insertAdjacentHTML('beforeend', '<div class="res-empty small">Valeur exacte inconnue — classés par prix du modèle de série (' + est.length + ')</div>');
      est.forEach(function (m) { box.appendChild(resultRow(m)); });
    }
    if (!isWide()) closePanel();
    box.hidden = false; box.scrollTop = 0;
  }

  function focusMarker(m) {
    closeResults(); $('q').blur();
    if (!isWide()) closePanel();
    if (!visible[m.c]) { visible[m.c] = true; applyVisibility(); toast('Calque « ' + cats[m.c].n + ' » affiché'); }
    openSheet(m, true);
  }

  /* ---------- Fiche ---------- */
  var nearLabels = null;
  function zoneOf(m) {
    if (!nearLabels) nearLabels = D.labels.filter(function (l) { return l.k === 'city' || l.k === 'district'; });
    var best = null, bd = Infinity, bestD = null, bdD = Infinity;
    nearLabels.forEach(function (l) {
      var d = Math.hypot(l.x - m.x, l.y - m.y);
      if (l.k === 'district') { if (d < bdD) { bdD = d; bestD = l; } }
      else if (d < bd) { bd = d; best = l; }
    });
    if (bestD && bdD < 1200) return labelText(bestD) + (best && bd < 3500 && best.n !== bestD.n ? ', ' + labelText(best) : '');
    if (best && bd < 3500) return (bd > 1200 ? 'Environs de ' : '') + labelText(best);
    return 'Leonida';
  }

  // un point « épinglé » est affiché hors des clusters (point sélectionné ou étape de la tournée)
  function pin(m) {
    if (!m.mk) makeMarker(m);
    if (m.on) { cluster.removeLayer(m.mk); m.on = false; }
    if (!m.pinned) { map.addLayer(m.mk); m.pinned = true; }
  }
  function unpinIfFree(m) {
    if (!m.pinned || m.solo || m.rt) return;
    map.removeLayer(m.mk); m.pinned = false;
    if (wanted(m)) { cluster.addLayer(m.mk); m.on = true; }
  }
  function unsolo(m) {
    if (!m || !m.solo) return;
    m.solo = false; m.mk.setZIndexOffset(m.rt ? 500 : 0);
    refreshIcon(m);
    unpinIfFree(m);
  }
  // fly : true = recentre et zoome au moins à minZ ; 'none' = ne bouge pas la carte
  function openSheet(m, fly, minZ) {
    var prev = selected;
    selected = m;
    if (prev && prev !== m) unsolo(prev);
    m.solo = true; pin(m); m.mk.setZIndexOffset(1000);
    if (route) { var k = route.pts.indexOf(m); if (k >= 0 && k !== route.idx) { route.idx = k; drawRouteNums(); } }
    refreshIcon(m);
    clearLine();
    renderSheet();
    document.body.classList.add('sheet-open');
    $('sheet').setAttribute('aria-hidden', 'false');
    $('sheet').scrollTop = 0;
    var sh = isWide() ? 0 : $('sheet').offsetHeight;
    document.body.style.setProperty('--sheeth', sh + 'px');
    updateRoutePill();
    closeLegend();
    if (fly === 'none') return;
    var go = function () {
      var size = map.getSize();
      var pt = map.latLngToContainerPoint([m.y, m.x]);
      var tx = isWide() ? (size.x - 430) / 2 + (document.body.classList.contains('panel-open') ? 190 : 0) : size.x / 2;
      var ty = isWide() ? size.y / 2 : Math.max(90, (size.y - sh) / 2);
      map.panBy([pt.x - tx, pt.y - ty], { animate: true });
      flash(m);
    };
    if (fly) map.setView([m.y, m.x], Math.max(map.getZoom(), minZ == null ? 0 : minZ), { animate: false });
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
    updateRoutePill();
  }

  function money(n) { return typeof n === 'number' && isFinite(n) && n > 0 ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' $' : ''; }
  function moneyRange(a, b) { return a && b && a !== b ? money(a) + ' – ' + money(b) : money(b || a); }
  function mainValue(v) { return v ? (v.pay || v.sell || v.base || 0) : 0; }
  function realValue(v) { return v ? (v.pay || v.sell || 0) : 0; }
  function valueTag(v) {
    if (!v) return '';
    if (v.pay) return 'paie ' + money(v.pay);
    if (v.sell) return 'revente ' + money(v.sell);
    if (v.base) return 'modèle de série ' + money(v.base);
    return '';
  }

  var LOOT_LBL = { cash: 'Butin', resale: 'Valeur à la revente', reward: 'Récompense', price: 'Prix à payer' };
  function lootRange(l) {
    if (!l || !(l.max || l.min)) return '';
    if (l.min && !l.max) return 'plus de ' + money(l.min);
    return l.min && l.max && l.min !== l.max ? money(l.min) + ' – ' + money(l.max) : money(l.max || l.min);
  }
  function lootScore(l) { return l ? ((l.min || 0) + (l.max || l.min || 0)) / 2 : 0; }
  function showTopLoot() {
    var list = markers.filter(function (m) { return lootScore(m.l) > 0 && m.l.kind !== 'price'; }).sort(function (a, b) { return lootScore(b.l) - lootScore(a.l) || (a.l.rule ? 1 : 0) - (b.l.rule ? 1 : 0); });
    var box = $('results');
    box.innerHTML = '<div class="res-empty small">Braquages, planques et objets classés par ce qu\'ils rapportent (' + list.length + ')</div>';
    list.slice(0, 150).forEach(function (m) { box.appendChild(resultRow(m)); });
    if (!isWide()) closePanel();
    box.hidden = false; box.scrollTop = 0;
  }

  // badges de montant (butin / valeur / récompense / coûts)
  function moneyBadges(m) {
    var out = [], l = m.l, v = m.v;
    var badge = function (lbl, val, n, cls) {
      var t = n > 0 && cls !== 'cost' && cls !== 'est' ? tierOf(n) : -1;
      out.push('<div class="mb' + (cls ? ' ' + cls : '') + '"' + (t >= 0 ? ' style="--t:' + TIERS[t].c + '"' : '') + '><small>' + esc(lbl) + '</small><strong>' + esc(val) + '</strong></div>');
    };
    if (l && (l.min || l.max)) {
      var isPrice = l.kind === 'price', lo = l.min > 0 ? l.min : l.max, hi = l.max > 0 ? l.max : l.min;
      badge(LOOT_LBL[l.kind] || 'Valeur', lootRange(l), (lo + hi) / 2, isPrice ? 'cost' : '');
    }
    if (v) {
      if (v.pay) badge('Paie du commanditaire', money(v.pay), v.pay);
      if (v.sell) badge('Revente', money(v.sell), v.sell);
      if (v.base && !v.sell && !v.pay) badge('Modèle de série', money(v.base), v.base, 'est');
      if (v.reg) badge('Pour la garder', money(v.reg), v.reg, 'cost');
    }
    return out.length ? '<div class="mbs">' + out.join('') + '</div>' : '';
  }
  function moneyNote(m) {
    var l = m.l, v = m.v, p = [];
    if (l && l.note) p.push(esc(l.note));
    if (l && l.rule) p.push('<em>Montant habituel pour ce type de lieu.</em>');
    else if ((l && l.conf === 'moyenne') || (v && v.conf === 'moyenne')) p.push('<em>Valeur indicative (source unique).</em>');
    if (v && v.base && !v.sell && !v.pay) p.push('<em>Valeur exacte inconnue : prix du modèle de série.</em>');
    return p.length ? '<p class="vnote">' + p.join(' ') + '</p>' : '';
  }
  function infoBlock(m) {
    var i = m.i; if (!i) return '';
    var h = '', cells = [];
    if (i.diff) cells.push('<div class="ic-c d' + i.diff + '"><small>Difficulté</small><span class="gauge g' + i.diff + '"><i></i><i></i><i></i></span><b>' + DIFF[i.diff] + '</b></div>');
    if (typeof i.wanted === 'number') {
      var st = '';
      for (var k = 1; k <= 5; k++) st += '<span class="st' + (k <= i.wanted ? ' on' : '') + '">' + ICONS.use('ui_star') + '</span>';
      cells.push('<div class="ic-c wst"><small>Recherche</small><span class="stars" aria-label="' + i.wanted + ' étoile' + (i.wanted > 1 ? 's' : '') + ' sur 5">' + st + '</span><b>' + (i.wanted ? i.wanted + ' / 5' : 'Aucune') + '</b></div>');
    }
    if (i.chap) cells.push('<div class="ic-c"><small>Débloqué</small><span class="ib">' + ICONS.use('ui_book') + '</span><b>Chapitre ' + i.chap + '</b></div>');
    if (i.time) cells.push('<div class="ic-c wide"><small>Horaire</small><span class="ib">' + ICONS.use('ui_clock') + '</span><b>' + esc(i.time) + '</b></div>');
    if (cells.length) h += '<div class="icells">' + cells.join('') + '</div>';
    if (i.req && i.req.length) {
      h += '<div class="reqs"><h4>Il te faut</h4><ul>' + i.req.map(function (r) {
        var q = REQ[r] || ['pin', r.replace(/-/g, ' ')];
        return '<li>' + ICONS.use(q[0]) + '<span>' + esc(q[1]) + '</span></li>';
      }).join('') + '</ul></div>';
    }
    if (i.tips && i.tips.length) {
      h += '<div class="tips"><h4>Astuces</h4><ul>' + i.tips.map(function (t) { return '<li>' + ICONS.use('ui_bulb') + '<span>' + esc(t) + '</span></li>'; }).join('') + '</ul></div>';
    }
    return h;
  }
  function secLine(m) {
    var s = m.sec, p = [];
    if (!cats[m.c] || cats[m.c].g !== 'steal-vehicles') return '';
    if (s.unlocked !== null) p.push('<span class="sec ' + (s.unlocked ? 'ok' : 'ko') + '">' + (s.unlocked ? 'Non verrouillé' : 'Verrouillé') + '</span>');
    if (s.notrack !== null) p.push('<span class="sec ' + (s.notrack ? 'ok' : 'ko') + '">' + (s.notrack ? 'Sans traceur' : 'Traceur') + '</span>');
    return p.length ? '<div class="secs">' + p.join('') + '</div>' : '';
  }

  function routeStrip(m) {
    if (!route) return '';
    var k = route.pts.indexOf(m); if (k < 0) return '';
    var n = route.pts.length, nd = route.pts.filter(function (p) { return done[p.id]; }).length;
    var K = kindOf(route.r.kind);
    return '<div class="rstrip" style="--c:' + K.c + '"><div class="rs-h"><span class="rnum-s cur">' + (k + 1) + '</span><div class="rs-t"><b>' + esc(route.r.n) + '</b><small>Étape ' + (k + 1) + ' sur ' + n + ' · ' + nd + ' fait' + (nd > 1 ? 's' : '') + '</small></div>' +
      '<button type="button" class="rs-x" id="rtQuit">Quitter</button></div>' +
      '<div class="rs-bar"><i style="width:' + (100 * nd / n) + '%"></i></div>' +
      '<div class="rs-btns"><button type="button" class="btn" id="rtPrev"' + (k === 0 ? ' disabled' : '') + ' aria-label="Étape précédente">' + ICONS.use('ui_prev') + '</button>' +
      '<button type="button" class="btn primary" id="rtDone">' + ICONS.use('ui_check') + (done[m.id] ? 'Déjà fait · suivant' : 'Marquer fait') + '</button>' +
      '<button type="button" class="btn" id="rtNext"' + (k === n - 1 ? ' disabled' : '') + ' aria-label="Étape suivante">' + ICONS.use('ui_next') + '</button></div></div>';
  }

  function renderSheet() {
    var m = selected; if (!m) return;
    var c = cats[m.c];
    var me = store.get('me', null);
    var h = routeStrip(m) +
      '<div class="shd" style="--c:' + esc(c.color) + '"><span class="bigdot">' + ICONS.use(c.icon) + '</span><div class="sht"><h2>' + esc(m.n) + '</h2>' +
      '<div class="shm"><span class="pill"><i></i>' + esc(c.n) + '</span><span class="zn">' + ICONS.use('ui_me') + esc(zoneOf(m)) + '</span>' + gameBadge(m) + (m.ch ? '<span class="chapbadge">Planque du chapitre ' + m.ch.join(' et ') + '</span>' : '') + '</div></div>' +
      moneyBadges(m) + secLine(m) + '</div>' +
      (m.g ? '<div class="howto"><span class="hti">' + ICONS.use('ui_compass') + '</span><div><b>Comment le trouver dans le jeu</b><p>' + esc(m.g) + '</p></div></div>' : '') +
      infoBlock(m) + moneyNote(m);
    if (m.approx) h += '<div class="approx">◌ Position approximative</div>';
    h += m.d ? '<p class="desc">' + esc(m.d) + '</p>' : '<p class="desc empty">Pas encore de description pour ce point.</p>';
    if (me) h += '<div class="dist">' + fmtDist(Math.hypot(me[0] - m.x, me[1] - m.y)) + ' de « Je suis ici » (à vol d\'oiseau)</div>';
    h += '<button type="button" class="btn wherebtn" id="actWhere">' + ICONS.use('gamepad') + '<span>Où est-ce sur la carte du jeu ?<small>' + esc(whereHint(m)) + '</small></span>' + ICONS.use('ui_chev') + '</button>';
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
    $('actWhere').addEventListener('click', function () { openWhere(m); });
    var al = $('actLine'); if (al) al.addEventListener('click', function () { toggleLine(m); });
    if ($('rtQuit')) {
      $('rtQuit').addEventListener('click', function () { stopRoute(); });
      $('rtPrev').addEventListener('click', function () { goStep(route.idx - 1); });
      $('rtNext').addEventListener('click', function () { goStep(route.idx + 1); });
      $('rtDone').addEventListener('click', routeDoneNext);
    }
    if (document.body.classList.contains('sheet-open') && !isWide()) document.body.style.setProperty('--sheeth', $('sheet').offsetHeight + 'px');
  }

  function gameBadge(m) {
    if (!blips || !blips[m.c] || typeof blips[m.c].ingame !== 'boolean') return '';
    var on = blips[m.c].ingame, note = typeof blips[m.c].note === 'string' ? blips[m.c].note : '';
    return '<span class="gbadge ' + (on ? 'on' : 'off') + '"' + (note ? ' title="' + esc(note) + '"' : '') + '>' + ICONS.use(on ? 'eye' : 'ui_eyeoff') + (on ? 'Visible sur la carte du jeu' : 'Caché en jeu') + '</span>';
  }
  function whereHint(m) {
    var n = nearestAnchors(m, 1)[0], cell = bm ? bm.G.cellOf(m.x, m.y) : '';
    var t = n ? (n.d < 90 ? 'Juste à côté de ' + n.a.n : fmtKm(n.d) + ' ' + dirWord(m.x - n.a.x, m.y - n.a.y) + ' de ' + n.a.n) : '';
    return t + (cell ? (t ? ' · ' : '') + 'case ' + cell : '');
  }
  function toggleDone(m, quiet) {
    if (done[m.id]) { delete done[m.id]; cats[m.c].ndone--; } else { done[m.id] = true; cats[m.c].ndone++; }
    store.set('done', Object.keys(done));
    refreshIcon(m); renderSheet(); updateCounts();
    if (route && route.pts.indexOf(m) >= 0) drawRouteNums();
    var c = cats[m.c];
    if (!quiet) toast(done[m.id] ? 'Fait ✓  ' + c.n + ' : ' + c.ndone + ' / ' + c.list.length : 'Marqué comme non fait');
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

  /* ---------- Tournées ---------- */
  function routeDone(r) { var k = 0; r.pts.forEach(function (m) { if (done[m.id]) k++; }); return k; }
  function renderRouteList() {
    var box = $('routeList'); if (!box) return;
    box.innerHTML = '';
    routes.forEach(function (r) {
      var K = kindOf(r.kind), nd = routeDone(r), n = r.pts.length, act = route && route.r === r;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'rcard' + (act ? ' act' : '') + (nd === n ? ' fin' : ''); b.style.setProperty('--c', K.c);
      b.setAttribute('data-route', r.id);
      b.innerHTML = '<div class="rc-h"><span class="dot">' + ICONS.use(K.icon) + '</span><div class="rc-t"><b>' + esc(r.n) + '</b><small>' + esc(K.n) + (r.zone ? ' · ' + esc(r.zone) : '') + '</small></div>' +
        (act ? '<span class="rc-badge">En cours</span>' : nd === n ? '<span class="rc-badge ok">Terminée</span>' : '') + '</div>' +
        '<div class="rc-g"><div><small>Gain</small><strong style="--t:' + TIERS[tierOf(r.hi || 1)].c + '">' + esc(fmtRangeK(r.lo, r.hi)) + '</strong></div><div><small>Distance</small><strong>' + esc(fmtKm(r.dist)) + '</strong></div><div><small>Points</small><strong>' + n + '</strong></div></div>' +
        '<div class="rc-p"><span class="meter"><i style="width:' + (100 * nd / n) + '%"></i></span><small>' + nd + ' / ' + n + ' faits</small></div>' +
        (r.note ? '<p class="rc-n">' + esc(r.note) + '</p>' : '');
      b.addEventListener('click', function () { startRoute(r); });
      box.appendChild(b);
    });
  }
  function startRoute(r) {
    if (route) clearRoute();
    var pts = r.pts;
    // affiche les calques des points de la tournée
    var shownCats = false;
    pts.forEach(function (m) { if (!visible[m.c]) { visible[m.c] = true; shownCats = true; } });
    if (shownCats) applyVisibility();
    var ll = pts.map(function (m) { return [m.y, m.x]; });
    var K = kindOf(r.kind);
    route = { r: r, pts: pts, idx: 0, nums: [] };
    pts.forEach(function (m) { m.rt = true; pin(m); if (!m.solo) m.mk.setZIndexOffset(500); refreshIcon(m); });
    route.glow = L.polyline(ll, { pane: 'route', color: K.c, weight: 10, opacity: 0.22, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    route.line = L.polyline(ll, { pane: 'route', color: '#ffffff', weight: 2.5, opacity: 0.9, dashArray: '10 8', interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    pts.forEach(function (m, k) {
      var mk = L.marker([m.y, m.x], { pane: 'routenum', keyboard: false, zIndexOffset: 0, icon: numIcon(k, '') });
      mk.on('click', function (e) { if (e.originalEvent) L.DomEvent.stop(e.originalEvent); goStep(k); });
      mk.addTo(map); route.nums.push(mk);
    });
    document.body.classList.add('route-on');
    var first = 0; for (var i = 0; i < pts.length; i++) { if (!done[pts[i].id]) { first = i; break; } }
    route.idx = first;
    drawRouteNums();
    if (!isWide()) closePanel();
    if (curTab === 'routes') renderRouteList();
    openSheet(pts[first], 'none');
    var sh = isWide() ? 0 : $('sheet').offsetHeight;
    var pad = isWide() ? { paddingTopLeft: [(document.body.classList.contains('panel-open') ? 400 : 40), 80], paddingBottomRight: [460, 40] } : { paddingTopLeft: [30, 80], paddingBottomRight: [30, sh + 20] };
    map.fitBounds(route.line.getBounds(), L.extend(pad, { maxZoom: 0.5 }));
  }
  function numIcon(k, cls) {
    return L.divIcon({ className: 'rnum' + cls, iconSize: [26, 26], iconAnchor: [-3, 31], html: '<span>' + (k + 1) + '</span>' });
  }
  function drawRouteNums() {
    if (!route) return;
    route.nums.forEach(function (mk, k) {
      var m = route.pts[k];
      var cls = (k === route.idx ? ' cur' : '') + (done[m.id] ? ' dn' : '');
      if (mk._cls !== cls) { mk._cls = cls; mk.setIcon(numIcon(k, cls)); }
      mk.setZIndexOffset(k === route.idx ? 1000 : 0);
    });
  }
  function goStep(k) {
    if (!route || k < 0 || k >= route.pts.length) return;
    route.idx = k;
    drawRouteNums();
    openSheet(route.pts[k], true, -1);
  }
  function routeDoneNext() {
    if (!route) return;
    var m = route.pts[route.idx];
    if (!done[m.id]) toggleDone(m, true);
    var n = route.pts.length, nxt = -1;
    for (var i = 1; i <= n; i++) { var k = (route.idx + i) % n; if (!done[route.pts[k].id]) { nxt = k; break; } }
    if (nxt < 0) {
      var r = route.r;
      toast('Tournée terminée ! ' + (r.hi ? 'Gain estimé : ' + fmtRangeK(r.lo, r.hi) : ''));
      renderSheet(); renderRouteList();
      return;
    }
    goStep(nxt);
  }
  function clearRoute() {
    if (!route) return;
    map.removeLayer(route.glow); map.removeLayer(route.line);
    route.nums.forEach(function (mk) { map.removeLayer(mk); });
    var pts = route.pts;
    route = null;
    pts.forEach(function (m) { m.rt = false; if (m.mk && !m.solo) m.mk.setZIndexOffset(0); refreshIcon(m); unpinIfFree(m); });
    document.body.classList.remove('route-on');
  }
  function stopRoute() {
    clearRoute();
    if (selected) renderSheet();
    updateRoutePill();
    if (curTab === 'routes') renderRouteList();
    toast('Tournée arrêtée');
  }
  function updateRoutePill() {
    var show = !!route && !selected;
    $('routePill').hidden = !show;
    if (show) $('rpTxt').textContent = route.r.n + ' · étape ' + (route.idx + 1) + ' / ' + route.pts.length;
  }

  /* ---------- Statistiques ---------- */
  function renderStats() {
    var box = $('statsBody'); if (!box) return;
    var tot = markers.length, nd = Object.keys(done).filter(function (id) { return byId[id]; }).length;
    var potLo = 0, potHi = 0, potN = 0, gotLo = 0, gotHi = 0, top = [];
    markers.forEach(function (m) {
      if (!(m.amt > 0)) return;
      if (done[m.id]) { gotLo += m.amtLo; gotHi += m.amtHi; }
      else { potLo += m.amtLo; potHi += m.amtHi; potN++; top.push(m); }
    });
    top.sort(function (a, b) { return b.amt - a.amt; });
    var pct = tot ? Math.round(1000 * nd / tot) / 10 : 0;
    var pctTxt = nd && pct < 0.1 ? '< 0,1' : String(pct).replace('.', ',');
    var h = '<section class="psec"><h3>Progression globale</h3><div class="st-big"><strong>' + pctTxt + ' %</strong><span>' + fmtInt(nd) + ' / ' + fmtInt(tot) + ' points faits</span></div>' +
      '<span class="meter big"><i style="width:' + pct + '%"></i></span></section>';
    if (has.amt) {
      h += '<section class="psec"><h3>Argent potentiel restant</h3><div class="st-money"><strong>' + esc(fmtRangeK(potLo, potHi)) + '</strong><span>à récupérer sur ' + fmtInt(potN) + ' point' + (potN > 1 ? 's' : '') + ' rentable' + (potN > 1 ? 's' : '') + ' non fait' + (potN > 1 ? 's' : '') + '</span></div>' +
        (gotHi > 0 ? '<p class="muted small">Déjà empoché (estimation) : <b class="okc">' + esc(fmtRangeK(gotLo, gotHi)) + '</b></p>' : '') + '</section>';
    }
    h += '<section class="psec"><h3>Par groupe</h3><ul class="st-g">' + groups.map(function (g) {
      var t = 0, d = 0; g.cats.forEach(function (c) { t += c.list.length; d += c.ndone; });
      return '<li><div class="st-gl"><span>' + esc(g.n) + '</span><b' + (d === t ? ' class="okc"' : '') + '>' + fmtInt(d) + ' / ' + fmtInt(t) + '</b></div><span class="meter"><i style="width:' + (t ? 100 * d / t : 0) + '%"></i></span></li>';
    }).join('') + '</ul></section>';
    if (routes.length) {
      var fin = routes.filter(function (r) { return routeDone(r) === r.pts.length; }).length;
      h += '<section class="psec"><h3>Tournées</h3><p class="st-line">Tournées terminées : <b' + (fin === routes.length ? ' class="okc"' : '') + '>' + fin + ' / ' + routes.length + '</b></p></section>';
    }
    if (top.length) h += '<section class="psec"><h3>Top 10 à faire (les plus rentables)</h3><div id="statsTop" class="favlist"></div></section>';
    box.innerHTML = h;
    var tb = $('statsTop');
    if (tb) top.slice(0, 10).forEach(function (m, k) {
      var row = resultRow(m); row.classList.add('top'); row.insertAdjacentHTML('afterbegin', '<span class="rk">' + (k + 1) + '</span>'); tb.appendChild(row);
    });
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
    $('btnLegend').addEventListener('click', toggleLegend);
    $('whereClose').addEventListener('click', closeWhere);
    $('where').addEventListener('click', function (e) { if (e.target === this) closeWhere(); });
    $('rpResume').addEventListener('click', function () { if (route) goStep(route.idx); });
    $('rpQuit').addEventListener('click', stopRoute);
    var q = $('q');
    var ds = debounce(function () { search(q.value); }, 120);
    q.addEventListener('input', ds);
    q.addEventListener('focus', function () { if (q.value.trim().length >= 2) search(q.value); if (!isWide()) closePanel(); closeLegend(); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var f = $('results').querySelector('.res'); if (f) f.click(); }
      else if (e.key === 'Escape') { e.stopPropagation(); closeResults(); q.blur(); }
    });
    $('qClear').addEventListener('click', function () { q.value = ''; search(''); q.focus(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (mybgBusy()) return;
      if (!$('where').hidden) closeWhere();
      else if (placingMe) setPlacing(false);
      else if (!$('results').hidden) closeResults();
      else if (!$('legendBox').hidden) closeLegend();
      else if (selected) closeSheet();
      else if (document.body.classList.contains('panel-open')) closePanel();
    });
    // glisser la fiche vers le bas pour la fermer
    var sheet = $('sheet'), y0 = null;
    sheet.addEventListener('touchstart', function (e) { y0 = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    sheet.addEventListener('touchend', function (e) { if (y0 !== null && e.changedTouches[0].clientY - y0 > 70) closeSheet(); y0 = null; }, { passive: true });
    L.DomEvent.disableClickPropagation($('topbar'));
    L.DomEvent.disableScrollPropagation($('results'));
    ['legend', 'routePill', 'filtPill'].forEach(function (id) { L.DomEvent.disableClickPropagation($(id)); L.DomEvent.disableScrollPropagation($(id)); });
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
  // Planques de Jason & Lucia par chapitre : étiquettes « Ch. N » toujours visibles + trajet en pointillés
  var chapLayer = null;
  function drawChapters() {
    var hs = markers.filter(function (m) { return m.ch; }).sort(function (a, b) { return Math.min.apply(null, a.ch) - Math.min.apply(null, b.ch); });
    var row = $('chapRow'); if (row) row.hidden = !hs.length;
    if (!hs.length) return;
    chapLayer = L.layerGroup();
    L.polyline(hs.map(function (m) { return [m.y, m.x]; }), { pane: 'routenum', color: '#ff2e97', weight: 2.5, opacity: 0.75, dashArray: '6 7', interactive: false }).addTo(chapLayer);
    hs.forEach(function (m) {
      var short = m.n.replace(/\s*\(.*\)\s*$/, '');
      var mk = L.marker([m.y, m.x], { pane: 'routenum', keyboard: false, title: m.n,
        icon: L.divIcon({ className: 'chapmk', html: '<b>CH.\u00a0' + m.ch.join('–') + '</b><span>' + esc(short) + '</span>', iconSize: [0, 0] }) });
      mk.on('click', function () { openSheet(m, true); });
      mk.addTo(chapLayer);
    });
    if (opt.chap) chapLayer.addTo(map);
    var c = $('optChap');
    if (c) { c.checked = opt.chap; c.addEventListener('change', function () { opt.chap = c.checked; saveOpts(); if (opt.chap) chapLayer.addTo(map); else map.removeLayer(chapLayer); }); }
  }

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
      applyTheme();
      document.body.classList.toggle('ps', psMode);
      initMap();
      buildPanel();
      try { drawChapters(); } catch (e) { /* calque facultatif */ }
      bindUI();
      drawMe();
      applyVisibility();
      fillIcons();
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
      window.GTA6_APP = { map: map, markers: markers, cats: cats, visible: visible, cluster: cluster, openSheet: openSheet, closeSheet: closeSheet, focusMarker: focusMarker, applyVisibility: applyVisibility,
        routes: routes, zones: zones, startRoute: startRoute, stopRoute: stopRoute, goStep: goStep, setTab: setTab, openPanel: openPanel, closePanel: closePanel,
        filters: F, opts: opt, route: function () { return route; }, labels: function () { return labelItems.filter(function (it) { return it.on; }).map(function (it) { return it.t; }); },
        basemap: function () { return bm; }, setTheme: setTheme, setGrid: setGrid, setPS: setPS, ps: function () { return psMode; }, openWhere: openWhere, inGame: inGame };
      updateScale(); updateGridEdges();
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
