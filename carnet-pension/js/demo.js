/* Example data (fictional) to try the prototype. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./billing.js'));
  } else {
    root.Demo = factory(root.Billing);
  }
})(typeof self !== 'undefined' ? self : this, function (Billing) {
  'use strict';

  var NAMES = {
    fr: {
      stable: 'Écurie Exemple',
      address: ['Chemin de l’Exemple', '1', '1700', 'Exempleville'],
      services: [
        ['board_box', 'Pension box', 750, 'month'],
        ['board_paddock', 'Pension box + paddock', 850, 'month'],
        ['rug', 'Service couvertures', 30, 'month'],
        ['shavings', 'Litière copeaux', 100, 'month'],
        ['lunge', 'Longe', 25, 'once'],
        ['farrier', 'Tenir pour le maréchal', 10, 'once'],
        ['vet', 'Tenir pour le vétérinaire', 15, 'once'],
        ['turnout', 'Sortie paddock en plus', 5, 'once'],
        ['wash', 'Douche / lavage', 10, 'once'],
        ['mash', 'Mash', 5, 'once']
      ],
      owners: [['o1', 'Client A (exemple)', ['Rue A', '1', '1700', 'Exempleville']], ['o2', 'Client B (exemple)', ['Rue B', '2', '1630', 'Exempleville']]]
    },
    de: {
      stable: 'Beispielstall',
      address: ['Beispielweg', '1', '3000', 'Beispielstadt'],
      services: [
        ['board_box', 'Pension Box', 750, 'month'],
        ['board_paddock', 'Pension Box + Paddock', 850, 'month'],
        ['rug', 'Deckenservice', 30, 'month'],
        ['shavings', 'Späne-Einstreu', 100, 'month'],
        ['lunge', 'Longieren', 25, 'once'],
        ['farrier', 'Halten für Hufschmied', 10, 'once'],
        ['vet', 'Halten für Tierarzt', 15, 'once'],
        ['turnout', 'Zusätzlicher Paddockgang', 5, 'once'],
        ['wash', 'Abspritzen / Waschen', 10, 'once'],
        ['mash', 'Mash', 5, 'once']
      ],
      owners: [['o1', 'Kunde A (Beispiel)', ['Strasse A', '1', '3000', 'Beispielstadt']], ['o2', 'Kunde B (Beispiel)', ['Strasse B', '2', '3001', 'Beispielstadt']]]
    }
  };

  // Sample IBAN published by SIX in the QR-bill Implementation Guidelines (Annex A), for the demo only.
  var DEMO_IBAN = 'CH5800791123000889012';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function addr(a) { return { street: a[0], buildingNo: a[1], postalCode: a[2], town: a[3], country: 'CH' }; }

  function build(lang, today) {
    var n = NAMES[lang] || NAMES.fr;
    var d = Billing.emptyData();
    var now = today || new Date();
    var month = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
    d.settings.stableName = n.stable;
    Object.assign(d.settings, addr(n.address));
    d.settings.iban = DEMO_IBAN;
    d.settings.refType = 'SCOR';
    d.settings.lang = lang;
    d.services = n.services.map(function (s) {
      return { id: s[0], name: s[1], price: s[2], unit: s[3] };
    });
    d.owners = n.owners.map(function (o) { return Object.assign({ id: o[0], name: o[1] }, addr(o[2])); });
    d.horses = [
      { id: 'h1', name: 'Bijou', ownerId: 'o1', boardServiceId: 'board_box', recurring: ['rug'], start: '', end: '' },
      { id: 'h2', name: 'Quarz', ownerId: 'o1', boardServiceId: 'board_paddock', recurring: [], start: '', end: '' },
      { id: 'h3', name: 'Fleur', ownerId: 'o2', boardServiceId: 'board_box', recurring: ['shavings'], start: month + '-11', end: '' }
    ];
    var day = Math.max(1, Math.min(now.getDate(), 28));
    function dt(x) { return month + '-' + pad2(Math.min(x, day)); }
    var raw = [
      ['h1', 'lunge', 1, 2], ['h1', 'farrier', 1, 3], ['h2', 'turnout', 3, 4],
      ['h3', 'vet', 1, 12], ['h3', 'wash', 1, 14], ['h1', 'mash', 2, 15]
    ];
    d.entries = raw.map(function (r, i) {
      var s = d.services.filter(function (x) { return x.id === r[1]; })[0];
      return { id: 'e' + i, horseId: r[0], serviceId: r[1], qty: r[2], date: dt(r[3]), price: s.price, note: '' };
    });
    return d;
  }

  return { build: build };
});
