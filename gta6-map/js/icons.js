/* Icônes SVG internes (dessinées pour l'app, trait 24x24). Clé -> tracé. */
(function () {
  'use strict';
  var C = function (cx, cy, r) {
    return 'M' + (cx - r) + ' ' + cy + 'a' + r + ' ' + r + ' 0 1 0 ' + (2 * r) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0';
  };
  var I = {
    pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z' + C(12, 9, 2.5),
    house: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
    bank: 'M3 9l9-5 9 5M4 9h16M6 9v8M10 9v8M14 9v8M18 9v8M3 20h18',
    moneybag: 'M9 3h6l-1.5 3h-3zM10.5 6C6 8 4 12 4 15a6 6 0 0 0 6 6h4a6 6 0 0 0 6-6c0-3-2-7-6.5-9M14 11.5h-3a1.25 1.25 0 0 0 0 2.5h2a1.25 1.25 0 0 1 0 2.5h-3M12 10v1.5M12 16.5V18',
    atm: 'M2 6h20v12H2z' + C(12, 12, 3) + 'M5.5 9.5v.01M18.5 14.5v.01',
    gem: 'M12 20L3 9l3-5h12l3 5zM3 9h18M12 20L8.5 9 10 4M12 20l3.5-11L14 4',
    safe: 'M4 4h16v15H4zM6 19v2M18 19v2' + C(12, 11.5, 3.5) + 'M12 8v1.5M12 13.5V15M8.5 11.5H10M14 11.5h1.5',
    skull: 'M12 3c-4.4 0-8 3.1-8 7.5 0 2.6 1.3 4.3 3 5.3V19h10v-3.2c1.7-1 3-2.7 3-5.3C20 6.1 16.4 3 12 3zM9 11h.01M15 11h.01M10 19v2M14 19v2',
    swap: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4',
    garage: 'M3 21V9l9-5 9 5v12M7 21v-8h10v8M7 16h10',
    car: 'M4.5 14l1.6-4.6A2 2 0 0 1 8 8h8a2 2 0 0 1 1.9 1.4L19.5 14M3 14h18v4H3zM6 18v2M18 18v2M7 16h.01M17 16h.01',
    boat: 'M3 15h18l-3 5H6zM12 3v12M12 4l6 9h-6',
    plane: 'M21 15.5l-8-4.5V5a1.5 1.5 0 0 0-3 0v6l-8 4.5v2l8-2.5v4l-2 1.5V22l3.5-1 3.5 1v-1.5l-2-1.5v-4l8 2.5z',
    mask: 'M3 9c0-2 2-3 4.5-3s3.5 1.5 4.5 1.5S14 6 16.5 6 21 7 21 9c0 4-2 7-5 7-2 0-3-2-4-2s-2 2-4 2c-3 0-5-3-5-7zM7 10.5h2.5M14.5 10.5H17',
    door: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18M15 12h.01',
    package: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7.5 5l9 4',
    card: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 9l2.2 3-2.2 3-2.2-3z',
    heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
    camera: 'M3 8h4l2-3h6l2 3h4v11H3z' + C(12, 13.5, 3.5),
    statue: C(12, 5, 2) + 'M8 21h8M10 21l1-9h2l1 9M7 10l5-2 5 2',
    eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z' + C(12, 12, 2.5),
    book: 'M4 19V5a2 2 0 0 1 2-2h14v14H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14v-4',
    magazine: 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5',
    ball: C(12, 12, 9) + 'M3 12h18M12 3v18M6 5.5c3 3.5 3 9.5 0 13M18 5.5c-3 3.5-3 9.5 0 13',
    music: 'M9 18V5l11-2v13' + C(6, 18, 3) + C(17, 16, 3),
    brush: 'M18 3l3 3-9 9-3-3zM9 12c-2 0-4 1.5-4 4 0 1.5-1 3-2 3 3 2 8 1 9-4',
    alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    flag: 'M5 21V4M5 4h13l-2.5 4.5L18 13H5',
    target: C(12, 12, 9) + C(12, 12, 5) + 'M12 12h.01',
    drone: 'M9 10h6v4H9zM4 6h6M14 6h6M7 6v1.5L9 10M17 6v1.5L15 10M9 14l-2 3M15 14l2 3',
    ramp: 'M3 20h18M3 20l14-9v9M15 7l5-4',
    parachute: 'M3 11a9 7 0 0 1 18 0zM3 11l9 8 9-8M8 11l4 8 4-8M12 19v2',
    dumbbell: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12',
    golf: 'M12 18V3l6 3-6 3M6 21c0-1.7 2.7-3 6-3s6 1.3 6 3',
    fish: 'M3 12c3-5 9-6 13-3l5-3v12l-5-3c-4 3-10 2-13-3zM8 11h.01',
    pool: C(12, 12, 9) + C(12, 10, 2) + C(12, 14.5, 2.5),
    gamepad: 'M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6L14 15h-4l-1 .6A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4zM7 10.5v3M5.5 12h3M16 11h.01M18 13h.01',
    disco: 'M12 2v3' + C(12, 12, 7) + 'M5 12h14M12 5c-2.5 2-2.5 12 0 14M12 5c2.5 2 2.5 12 0 14',
    wrench: 'M14.5 6.5a4 4 0 0 0-5.3 5.3L3 18l3 3 6.2-6.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z',
    spray: 'M9 9h6v12H9zM10 9V6h4v3M17 4h.01M20 3h.01M19 6.5h.01M21 8h.01',
    fuel: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M7 7h4v4H7zM14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3',
    drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
    bolt: 'M13 2L5 13h6l-1 9 8-11h-6z',
    bus: 'M5 4h14v13H5zM5 11h14M7 17v3M17 17v3M8 14h.01M16 14h.01',
    train: 'M6 3h12a1 1 0 0 1 1 1v11a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V4a1 1 0 0 1 1-1zM5 10h14M8 21l2-3M16 21l-2-3M9 14h.01M15 14h.01',
    ferry: 'M2 20c2 1 4 1 6 0s4-1 6 0 4 1 6 0M4 16l1-5h14l1 5M8 11V7h8v4',
    key: C(8, 15, 4) + 'M11 12l9-9M17 6l3 3M15 8l2 2',
    crosshair: C(12, 12, 7) + 'M12 2v5M12 17v5M2 12h5M17 12h5',
    shirt: 'M8 3L3 6l2 5 3-1.5V21h8V9.5l3 1.5 2-5-5-3a4 4 0 0 1-8 0z',
    shoe: 'M3 18V8l5 1 3 4 7 2a3 3 0 0 1 3 3v0H3zM3 18h18',
    scissors: C(6, 6, 3) + C(6, 18, 3) + 'M8.5 7.5L20 19M8.5 16.5L20 5',
    pen: 'M16 3l5 5-11 11H5v-5zM14 5l5 5',
    phone: 'M7 2h10v20H7zM11 18h2',
    store: 'M3 9l2-5h14l2 5M3 9h18v1.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 13v8h14v-8M10 21v-5h4v5',
    burger: 'M4 11a8 6 0 0 1 16 0zM3 14.5h18M5 18h14v1a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z',
    coffee: 'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v2M12 3v2',
    bottle: 'M10 2h4v4l2 3v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3zM8 13h8',
    glass: 'M4 4h16l-8 9zM12 13v8M8 21h8',
    truck: 'M2 17V7h12v10h-4M14 10h4l3 4v3h-2M8 17h6' + C(6, 17, 2) + C(17, 17, 2),
    city: 'M3 21h18M5 21V8h6v13M11 21V3h8v18M7 11h2M7 15h2M14 7h2M14 11h2M14 15h2',
    palm: 'M12 21V10M12 10C9 6 5 6 3 8M12 10c3-4 7-4 9-2M12 10c-1-4-4-6-7-6M12 10c1-4 4-6 7-6M8 21h8',
    anchor: C(12, 5, 2) + 'M12 7v14M5 13a7 7 0 0 0 14 0M8 11h8',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    flame: 'M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 2-6 2 1 3 3 3 3s1-4 1-8z',
    cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
    film: 'M3 4h18v16H3zM7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4',
    // icônes d'interface
    ui_layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
    ui_search: C(10.5, 10.5, 6.5) + 'M15.5 15.5L21 21',
    ui_close: 'M5 5l14 14M19 5L5 19',
    ui_me: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z' + C(12, 9, 2.5),
    ui_center: C(12, 12, 3) + C(12, 12, 8) + 'M12 1v3M12 20v3M1 12h3M20 12h3',
    ui_plus: 'M12 5v14M5 12h14',
    ui_minus: 'M5 12h14',
    ui_star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
    ui_check: 'M4 12.5l5 5L20 6.5',
    ui_copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
    ui_ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
    ui_chev: 'M9 6l6 6-6 6',
    ui_trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
    ui_home: 'M4 10.5L12 4l8 6.5V20H4z',
    ui_compass: C(12, 12, 9) + 'M15.5 8.5l-2 5-5 2 2-5z',
    ui_image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6' + C(16, 9, 1.5),
    ui_upload: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M4 15v5h16v-5',
    ui_arrow: 'M12 19V5M6 11l6-6 6 6',
    ui_rotl: 'M4 4v5h5M4.6 9A8 8 0 1 1 6 16.5',
    ui_rotr: 'M20 4v5h-5M19.4 9A8 8 0 1 0 18 16.5',
    ui_move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
    ui_undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
    ui_help: C(12, 12, 9) + 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01'
  };
  var NS = 'http://www.w3.org/2000/svg';
  function buildSprite() {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    var defs = document.createElementNS(NS, 'defs');
    Object.keys(I).forEach(function (k) {
      var s = document.createElementNS(NS, 'symbol');
      s.setAttribute('id', 'i-' + k);
      s.setAttribute('viewBox', '0 0 24 24');
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', I[k]);
      s.appendChild(p);
      defs.appendChild(s);
    });
    svg.appendChild(defs);
    document.body.insertBefore(svg, document.body.firstChild);
  }
  window.GTA6_ICONS = {
    has: function (k) { return Object.prototype.hasOwnProperty.call(I, k); },
    keys: function () { return Object.keys(I); },
    use: function (k, cls) {
      if (!Object.prototype.hasOwnProperty.call(I, k)) k = 'pin';
      return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-' + k + '"/></svg>';
    },
    buildSprite: buildSprite
  };
})();
