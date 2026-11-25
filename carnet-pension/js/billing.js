/*
 * Stable billing core logic (pure functions, no DOM).
 * Works in the browser (window.Billing) and in Node (module.exports) for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Billing = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UNITS = ['once', 'day', 'month'];

  /** Swiss rounding to 5 centimes (Rappenrundung). */
  function round05(x) {
    return Math.round((Number(x) + Number.EPSILON) * 20) / 20;
  }

  /** Round to 2 decimals (for intermediate amounts). */
  function round2(x) {
    return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 'YYYY-MM' -> number of days in month. */
  function daysInMonth(month) {
    var p = parseMonth(month);
    return new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  }

  function parseMonth(month) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    if (!m) throw new Error('Invalid month: ' + month);
    var y = Number(m[1]);
    var mo = Number(m[2]);
    if (mo < 1 || mo > 12) throw new Error('Invalid month: ' + month);
    return { y: y, m: mo };
  }

  function isDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  }

  function monthOf(date) {
    return String(date).slice(0, 7);
  }

  /**
   * Number of days a horse is present in the given month, using optional
   * start/end dates (inclusive). Returns 0..daysInMonth.
   */
  function daysPresent(horse, month) {
    var dim = daysInMonth(month);
    var first = month + '-01';
    var last = month + '-' + pad2(dim);
    var start = horse && isDate(horse.start) ? horse.start : first;
    var end = horse && isDate(horse.end) ? horse.end : last;
    if (start < first) start = first;
    if (end > last) end = last;
    if (end < start) return 0;
    return Number(end.slice(8, 10)) - Number(start.slice(8, 10)) + 1;
  }

  function byId(list, id) {
    for (var i = 0; i < (list || []).length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /** Amount for a monthly item, prorated by days present. */
  function proratedMonthly(price, present, dim) {
    if (present >= dim) return round2(price);
    return round2((price * present) / dim);
  }

  /**
   * Build the invoice lines of one owner for one month.
   * - board (horse.boardServiceId) and recurring monthly extras (horse.recurring)
   *   are prorated by days present;
   * - logged entries of that month are added with their price snapshot.
   */
  function invoiceForOwner(data, ownerId, month) {
    var dim = daysInMonth(month);
    var lines = [];
    var horses = (data.horses || []).filter(function (h) { return h.ownerId === ownerId; });

    horses.forEach(function (h) {
      var present = daysPresent(h, month);
      var monthlyIds = [];
      if (h.boardServiceId) monthlyIds.push(h.boardServiceId);
      (h.recurring || []).forEach(function (id) {
        if (monthlyIds.indexOf(id) === -1) monthlyIds.push(id);
      });
      if (present > 0) {
        monthlyIds.forEach(function (sid) {
          var s = byId(data.services, sid);
          if (!s) return;
          var amount = proratedMonthly(Number(s.price) || 0, present, dim);
          lines.push({
            kind: sid === h.boardServiceId ? 'board' : 'recurring',
            horseId: h.id,
            horseName: h.name,
            serviceId: s.id,
            label: s.name,
            date: null,
            qty: present >= dim ? 1 : round2(present / dim),
            days: present,
            unitPrice: Number(s.price) || 0,
            amount: amount
          });
        });
      }
    });

    var horseIds = horses.map(function (h) { return h.id; });
    (data.entries || [])
      .filter(function (e) { return horseIds.indexOf(e.horseId) !== -1 && monthOf(e.date) === month; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .forEach(function (e) {
        var h = byId(data.horses, e.horseId);
        var s = byId(data.services, e.serviceId);
        var unitPrice = typeof e.price === 'number' ? e.price : (s ? Number(s.price) || 0 : 0);
        var qty = Number(e.qty) || 0;
        lines.push({
          kind: 'extra',
          entryId: e.id,
          horseId: e.horseId,
          horseName: h ? h.name : '?',
          serviceId: e.serviceId,
          label: e.label || (s ? s.name : '?'),
          note: e.note || '',
          date: e.date,
          qty: qty,
          days: null,
          unitPrice: unitPrice,
          amount: round2(qty * unitPrice)
        });
      });

    var subtotal = round2(lines.reduce(function (sum, l) { return sum + l.amount; }, 0));
    return {
      ownerId: ownerId,
      month: month,
      lines: lines,
      subtotal: subtotal,
      total: round05(subtotal)
    };
  }

  /** All non-empty invoices of a month, sorted by owner name. */
  function invoicesForMonth(data, month) {
    var owners = (data.owners || []).slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
    return owners
      .map(function (o) { return invoiceForOwner(data, o.id, month); })
      .filter(function (inv) { return inv.lines.length > 0; });
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function fmtNum(n) {
    return (Math.round(Number(n) * 100) / 100).toFixed(2);
  }

  /**
   * CSV (semicolon separated, as Swiss Excel expects) of all lines of a month.
   * headers: array of 9 column labels (translated by the caller).
   */
  function monthToCSV(data, month, headers) {
    var head = headers || ['month', 'owner', 'horse', 'date', 'item', 'qty', 'unit_price', 'amount', 'invoice_total'];
    var rows = [head.map(csvCell).join(';')];
    invoicesForMonth(data, month).forEach(function (inv) {
      var owner = byId(data.owners, inv.ownerId);
      inv.lines.forEach(function (l) {
        rows.push([
          month,
          owner ? owner.name : '?',
          l.horseName,
          l.date || '',
          l.label,
          l.qty,
          fmtNum(l.unitPrice),
          fmtNum(l.amount),
          fmtNum(inv.total)
        ].map(csvCell).join(';'));
      });
    });
    return rows.join('\r\n') + '\r\n';
  }

  /** Validate a service definition. Returns an array of error codes. */
  function validateService(s) {
    var errors = [];
    if (!s || !String(s.name || '').trim()) errors.push('name');
    var p = Number(s && s.price);
    if (!isFinite(p) || p < 0) errors.push('price');
    if (!s || UNITS.indexOf(s.unit) === -1) errors.push('unit');
    return errors;
  }

  /** Validate an entry before saving. Returns an array of error codes. */
  function validateEntry(data, e) {
    var errors = [];
    if (!e || !isDate(e.date)) errors.push('date');
    if (!e || !byId(data.horses, e.horseId)) errors.push('horse');
    if (!e || !byId(data.services, e.serviceId)) errors.push('service');
    var q = Number(e && e.qty);
    if (!isFinite(q) || q <= 0) errors.push('qty');
    return errors;
  }

  /** Very small id generator (unique enough for a single device). */
  function newId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function emptyData() {
    return {
      version: 1,
      settings: {
        stableName: '', address: '', iban: '', currency: 'CHF', lang: 'fr', paymentDays: 30,
        street: '', buildingNo: '', postalCode: '', town: '', country: 'CH', contact: '',
        refType: 'SCOR', qrrPrefix: ''
      },
      services: [],
      owners: [],
      horses: [],
      entries: [],
      status: {}
    };
  }

  var ADDRESS_FIELDS = ['street', 'buildingNo', 'postalCode', 'town', 'country'];

  /**
   * Best-effort split of a free-text Swiss address ("Rue A 12\n1700 Fribourg") into
   * { street, buildingNo, postalCode, town, country }. Returns null when no "NPA localité" line is found.
   */
  function parseAddress(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    for (var i = lines.length - 1; i >= 0; i--) {
      var m = /^(?:([A-Z]{2})\s*-\s*)?(\d{4,5})\s+(.+)$/.exec(lines[i]);
      if (!m) continue;
      var res = { street: '', buildingNo: '', postalCode: m[2], town: m[3].trim(), country: m[1] || (m[2].length === 4 ? 'CH' : '') };
      if (i > 0) {
        var st = /^(.*?\S)\s+(\d+[a-zA-Z]?(?:\s?[-\/]\s?\d+[a-zA-Z]?)?)$/.exec(lines[i - 1]);
        if (st) { res.street = st[1]; res.buildingNo = st[2]; } else { res.street = lines[i - 1]; }
      }
      return res;
    }
    return null;
  }

  /** Fill empty structured address fields of obj from its legacy free-text address (if it can be parsed). */
  function migrateAddress(obj) {
    if (!obj || obj.postalCode || obj.town || !obj.address) return obj;
    var parsed = parseAddress(obj.address);
    if (!parsed) return obj;
    ADDRESS_FIELDS.forEach(function (k) {
      if (parsed[k] && (!obj[k] || k === 'country')) obj[k] = parsed[k];
    });
    return obj;
  }

  /** Address lines for the invoice header: structured if available, otherwise the legacy text. */
  function addressLines(obj) {
    if (!obj) return [];
    if (obj.postalCode || obj.town) {
      var lines = [];
      var street = ((obj.street || '') + ' ' + (obj.buildingNo || '')).trim();
      if (street) lines.push(street);
      var country = String(obj.country || 'CH').toUpperCase();
      lines.push(((country !== 'CH' ? country + '-' : '') + (obj.postalCode || '') + ' ' + (obj.town || '')).trim());
      return lines;
    }
    return String(obj.address || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  }

  /** Position (1-based) of the owner in the owner list, used in the invoice number. */
  function invoiceSeq(data, ownerId) {
    return (data.owners || []).map(function (o) { return o.id; }).indexOf(ownerId) + 1;
  }

  /** Invoice number "YYYYMM-NN" (unchanged format). */
  function invoiceNumber(data, inv) {
    return inv.month.replace('-', '') + '-' + pad2(invoiceSeq(data, inv.ownerId));
  }

  /** Normalise imported data (from backup file); throws on invalid shape. */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('invalid');
    var d = emptyData();
    if (raw.settings && typeof raw.settings === 'object') {
      Object.keys(d.settings).forEach(function (k) {
        if (raw.settings[k] !== undefined) d.settings[k] = raw.settings[k];
      });
    }
    ['services', 'owners', 'horses', 'entries'].forEach(function (k) {
      if (raw[k] !== undefined && !Array.isArray(raw[k])) throw new Error('invalid');
      d[k] = (raw[k] || []).filter(function (x) { return x && typeof x === 'object' && x.id; });
    });
    if (raw.status && typeof raw.status === 'object') d.status = raw.status;
    migrateAddress(d.settings);
    d.owners.forEach(migrateAddress);
    return d;
  }

  return {
    UNITS: UNITS,
    round05: round05,
    round2: round2,
    daysInMonth: daysInMonth,
    daysPresent: daysPresent,
    invoiceForOwner: invoiceForOwner,
    invoicesForMonth: invoicesForMonth,
    monthToCSV: monthToCSV,
    validateService: validateService,
    validateEntry: validateEntry,
    newId: newId,
    emptyData: emptyData,
    normalize: normalize,
    monthOf: monthOf,
    isDate: isDate,
    fmtNum: fmtNum,
    parseAddress: parseAddress,
    migrateAddress: migrateAddress,
    addressLines: addressLines,
    invoiceSeq: invoiceSeq,
    invoiceNumber: invoiceNumber
  };
});
