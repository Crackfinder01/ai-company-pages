/* UI of the stable billing prototype. Vanilla JS, data kept in localStorage only. */
(function () {
  'use strict';

  var STORAGE_KEY = 'stableBilling.v1';
  var B = window.Billing;
  var I = window.I18N;
  var Q = window.QRBill;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) {
    var parts = B.fmtNum(n).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '’');
    return parts.join('.');
  }

  // ---------- storage ----------
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return B.normalize(JSON.parse(raw));
    } catch (e) { /* fall through */ }
    var d = B.emptyData();
    var nav = (navigator.language || 'fr').slice(0, 2);
    d.settings.lang = nav === 'de' ? 'de' : 'fr';
    return d;
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* storage full or blocked */ }
  }

  var data = load();
  var ui = {
    tab: 'log',
    date: todayStr(),
    horseId: null,
    serviceId: null,
    qty: 1,
    note: '',
    month: todayStr().slice(0, 7)
  };

  function t(key, vars) { return I.t(data.settings.lang, key, vars); }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; }

  // ---------- toast ----------
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  // ---------- static texts ----------
  function applyStaticTexts() {
    document.documentElement.lang = data.settings.lang;
    document.querySelectorAll('[data-t]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-t'));
    });
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === data.settings.lang);
    });
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === ui.tab);
    });
    ['log', 'month', 'setup'].forEach(function (k) {
      document.getElementById('tab-' + k).hidden = k !== ui.tab;
    });
  }

  function render() {
    applyStaticTexts();
    if (ui.tab === 'log') renderLog();
    if (ui.tab === 'month') renderMonth();
    if (ui.tab === 'setup') renderSetup();
  }

  // ---------- tab: log ----------
  function loggableServices() {
    return data.services.filter(function (s) { return s.unit !== 'month'; });
  }

  function renderLog() {
    var el = document.getElementById('tab-log');
    var services = loggableServices();
    if (!data.horses.length || !services.length) {
      el.innerHTML = '<div class="card"><p>' + esc(t('setupFirst')) + '</p>' +
        '<button type="button" class="btn primary" data-action="demo">' + esc(t('demo')) + '</button></div>';
      return;
    }
    var html = '';
    html += '<div class="card row-inline"><label>' + esc(t('date')) +
      ' <input type="date" id="log-date" value="' + esc(ui.date) + '"></label></div>';

    html += '<div class="card"><h2>' + esc(t('pickHorse')) + '</h2><div class="grid">';
    data.horses.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
      .forEach(function (h) {
        html += '<button type="button" class="pick' + (ui.horseId === h.id ? ' selected' : '') +
          '" data-pick-horse="' + esc(h.id) + '">' + esc(h.name || '?') + '</button>';
      });
    html += '</div></div>';

    html += '<div class="card"><h2>' + esc(t('pickService')) + '</h2><div class="grid">';
    services.forEach(function (s) {
      html += '<button type="button" class="pick' + (ui.serviceId === s.id ? ' selected' : '') +
        '" data-pick-service="' + esc(s.id) + '">' + esc(s.name || '?') +
        '<small>CHF ' + money(s.price) + ' ' + esc(t('unit_' + s.unit)) + '</small></button>';
    });
    html += '</div></div>';

    html += '<div class="card"><div class="row-inline">' +
      '<span>' + esc(t('qty')) + '</span>' +
      '<button type="button" class="btn step" data-qty="-1" aria-label="-1">−</button>' +
      '<input type="number" id="log-qty" min="0.5" step="0.5" inputmode="decimal" value="' + esc(ui.qty) + '">' +
      '<button type="button" class="btn step" data-qty="1" aria-label="+1">+</button></div>' +
      '<label class="block">' + esc(t('note')) + '<input type="text" id="log-note" maxlength="120" value="' + esc(ui.note) + '"></label>' +
      '<button type="button" class="btn primary big" data-action="save-entry">' + esc(t('save')) + '</button></div>';

    var todays = data.entries.filter(function (e) { return e.date === ui.date; });
    html += '<div class="card"><h2>' + esc(t('todayList')) + '</h2>';
    if (!todays.length) {
      html += '<p class="muted">' + esc(t('nothingToday')) + '</p>';
    } else {
      html += '<ul class="list">';
      todays.forEach(function (e) {
        var h = byId(data.horses, e.horseId);
        var s = byId(data.services, e.serviceId);
        html += '<li><span><strong>' + esc(h ? h.name : '?') + '</strong> · ' + esc(s ? s.name : '?') +
          ' × ' + esc(e.qty) + ' = CHF ' + money(B.round2(e.qty * e.price)) +
          (e.note ? ' <em>(' + esc(e.note) + ')</em>' : '') + '</span>' +
          '<button type="button" class="btn danger small" data-del-entry="' + esc(e.id) + '">' + esc(t('remove')) + '</button></li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  function saveEntry() {
    var s = byId(data.services, ui.serviceId);
    var entry = {
      id: B.newId('e'),
      date: ui.date,
      horseId: ui.horseId,
      serviceId: ui.serviceId,
      qty: Number(ui.qty),
      price: s ? Number(s.price) : 0,
      note: String(ui.note || '').trim()
    };
    var errors = B.validateEntry(data, entry);
    if (errors.length) { toast(t('err_' + errors[0])); return; }
    data.entries.push(entry);
    save();
    ui.serviceId = null;
    ui.qty = 1;
    ui.note = '';
    render();
    toast(t('saved') + ' ✓');
  }

  // ---------- tab: month ----------
  function invoiceNumber(inv) { return B.invoiceNumber(data, inv); }

  // ---------- Swiss QR-bill ----------
  function qrFor(inv) {
    var owner = byId(data.owners, inv.ownerId);
    var horses = [];
    inv.lines.forEach(function (l) { if (horses.indexOf(l.horseName) === -1) horses.push(l.horseName); });
    return Q.fromInvoice(data.settings, owner, inv.total, {
      month: inv.month, seq: B.invoiceSeq(data, inv.ownerId), number: invoiceNumber(inv),
      horses: horses, lang: data.settings.lang
    });
  }

  /** Errors that block the QR-bill for every invoice (settings), as short texts. */
  function qrSetupProblems() {
    var res = Q.fromInvoice(data.settings, null, 1, { month: '2026-01', seq: 1, number: '202601-01', horses: [], lang: data.settings.lang });
    var seen = {};
    return res.errors.map(function (code) {
      if (code.indexOf('iban_') === 0) return t('ibanErr_' + code.slice(5));
      var key = 'qrErr_' + code;
      return I.T.fr[key] ? t(key) : t('qrErr_other');
    }).filter(function (msg) { if (seen[msg]) return false; seen[msg] = true; return true; });
  }

  function ibanStatus() {
    var v = Q.validateIban(data.settings.iban);
    if (!v.valid) return { ok: false, text: t('ibanErr_' + v.error) };
    if (v.qr) return { ok: true, text: t('ibanOkQr') };
    return { ok: true, text: t(data.settings.refType === 'NON' ? 'ibanOkNon' : 'ibanOkScor') };
  }

  function renderMonth() {
    var el = document.getElementById('tab-month');
    var invoices = B.invoicesForMonth(data, ui.month);
    var html = '<div class="card row-inline"><label>' + esc(t('month')) +
      ' <input type="month" id="month-pick" value="' + esc(ui.month) + '"></label>' +
      '<button type="button" class="btn" data-action="csv">' + esc(t('exportCsv')) + '</button>' +
      '<button type="button" class="btn" data-action="print-all"' + (invoices.length ? '' : ' disabled') + '>' + esc(t('printAll')) + '</button></div>';
    if (!invoices.length) {
      html += '<div class="card"><p class="muted">' + esc(t('noInvoices')) + '</p></div>';
    } else {
      var problems = qrSetupProblems();
      if (problems.length) {
        html += '<div class="card warn"><p>' + esc(t('qrMissing', { what: problems.join(' · ') })) + '</p>' +
          '<button type="button" class="btn" data-tab="setup">' + esc(t('goSetup')) + '</button></div>';
      } else {
        html += '<p class="small muted">' + esc(t('qrPrintHint')) + '</p>';
      }
    }
    var grand = 0;
    invoices.forEach(function (inv) {
      var o = byId(data.owners, inv.ownerId);
      var key = inv.month + ':' + inv.ownerId;
      var st = data.status[key] || 'open';
      grand += inv.total;
      var extras = inv.lines.filter(function (l) { return l.kind === 'extra'; }).length;
      html += '<div class="card invoice-card"><div class="row-between"><div><strong>' + esc(o ? o.name : '?') + '</strong>' +
        '<div class="muted small">' + esc(t('invoice')) + ' ' + esc(invoiceNumber(inv)) + ' · ' + inv.lines.length + ' ' + esc(t('lines')) + ' · ' + extras + ' ' + esc(t('extrasShort')) + '</div></div>' +
        '<div class="total">CHF ' + money(inv.total) + '</div></div>' +
        '<div class="row-inline"><select data-status="' + esc(key) + '">' +
        ['open', 'sent', 'paid'].map(function (s) {
          var label = t(s === 'open' ? 'statusOpen' : s === 'sent' ? 'statusSent' : 'statusPaid');
          return '<option value="' + s + '"' + (st === s ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('') + '</select>' +
        '<button type="button" class="btn" data-print-owner="' + esc(inv.ownerId) + '">' + esc(t('viewInvoice')) + '</button></div></div>';
    });
    if (invoices.length) {
      html += '<div class="card row-between"><strong>' + esc(t('total')) + '</strong><strong>CHF ' + money(grand) + '</strong></div>';
    }
    el.innerHTML = html;
  }

  function linesHTML(lines) {
    return lines.map(esc).join('<br>');
  }

  function invoiceHTML(inv) {
    var o = byId(data.owners, inv.ownerId) || { name: '?', address: '' };
    var s = data.settings;
    var dim = B.daysInMonth(inv.month);
    var rows = inv.lines.map(function (l) {
      var label = esc(l.label);
      if (l.kind !== 'extra' && l.days !== null && l.days < dim) {
        label += ' <span class="muted">(' + l.days + '/' + dim + ' ' + esc(t('days')) + ')</span>';
      }
      if (l.note) label += ' <span class="muted">– ' + esc(l.note) + '</span>';
      return '<tr><td>' + esc(l.date ? l.date.split('-').reverse().join('.') : '') + '</td><td>' + esc(l.horseName) + '</td><td>' + label + '</td>' +
        '<td class="num">' + esc(l.qty) + '</td><td class="num">' + money(l.unitPrice) + '</td><td class="num">' + money(l.amount) + '</td></tr>';
    }).join('');
    return '<article class="invoice">' +
      '<header class="inv-head"><div><h1>' + esc(s.stableName || t('stable')) + '</h1><p class="addr">' + linesHTML(B.addressLines(s)) + '</p>' +
      (s.contact ? '<pre>' + esc(s.contact) + '</pre>' : '') + '</div>' +
      '<div class="inv-to"><div class="muted small">' + esc(t('invoiceFor')) + '</div><strong>' + esc(o.name) + '</strong><p class="addr">' + linesHTML(B.addressLines(o)) + '</p></div></header>' +
      '<h2>' + esc(t('invoice')) + ' ' + esc(invoiceNumber(inv)) + '</h2>' +
      '<p>' + esc(t('period')) + (data.settings.lang === 'fr' ? ' : ' : ': ') + esc(inv.month.split('-').reverse().join('.')) + '</p>' +
      '<table><thead><tr><th>' + esc(t('date')) + '</th><th>' + esc(t('horse')) + '</th><th>' + esc(t('item')) + '</th>' +
      '<th class="num">' + esc(t('qty')) + '</th><th class="num">' + esc(t('unitPrice')) + '</th><th class="num">' + esc(t('amount')) + '</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td colspan="5">' + esc(t('subtotal')) + '</td><td class="num">' + money(inv.subtotal) + '</td></tr>' +
      '<tr class="grand"><td colspan="5">' + esc(t('roundedTotal')) + ' (CHF)</td><td class="num">' + money(inv.total) + '</td></tr></tfoot></table>' +
      '<p>' + esc(t('payBy', { n: s.paymentDays || 30 })) + (s.iban ? ' · ' + esc(t('iban')) + ' ' + esc(Q.formatIban(s.iban)) : '') + '</p>' +
      '</article>';
  }

  // Space left above the QR-bill on an A4 page: 297 - 105 mm, minus a small safety margin.
  var BODY_MAX_MM = 189;

  function measureMm(html) {
    var box = document.createElement('div');
    box.className = 'invoice-measure';
    box.innerHTML = html;
    document.body.appendChild(box);
    var px = box.firstChild.getBoundingClientRect().height;
    var mm1 = box.querySelector('.mm-probe').getBoundingClientRect().height / 100;
    box.remove();
    return px / mm1;
  }

  /**
   * One A4 page per invoice with the QR-bill (210 x 105 mm) on the lower edge.
   * If the invoice is too long, its lines flow on normal pages and the QR-bill gets its own page.
   */
  function pageHTML(inv) {
    var body = invoiceHTML(inv);
    var qr = qrFor(inv);
    if (qr.errors.length) return '<div class="inv-flow">' + body + '</div>';
    var qrHTML = '<div class="qrb-wrap">' + Q.renderHTML(qr.bill, data.settings.lang) + '</div>';
    var tall = measureMm(body + '<div class="mm-probe"></div>') > BODY_MAX_MM;
    if (tall) return '<div class="inv-flow">' + body + '</div><div class="inv-page inv-page-qr">' + qrHTML + '</div>';
    return '<div class="inv-page">' + body + qrHTML + '</div>';
  }

  function printInvoices(invs) {
    document.getElementById('print-area').innerHTML = invs.map(pageHTML).join('');
    window.print();
  }

  function downloadFile(name, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  // ---------- tab: setup ----------
  function unitSelect(attrs, value) {
    return '<select ' + attrs + '>' + B.UNITS.map(function (u) {
      return '<option value="' + u + '"' + (value === u ? ' selected' : '') + '>' + esc(t('unit_' + u)) + '</option>';
    }).join('') + '</select>';
  }

  /** Structured address inputs (street, number, postcode, town, country). attr: attribute prefix for the field name. */
  function addressFields(attr, obj) {
    function input(field, extra) {
      return '<label class="af-' + field + '">' + esc(t(field)) + '<input ' + attr + '="' + field + '" value="' + esc(obj[field] || (field === 'country' ? 'CH' : '')) + '"' + (extra || '') + '></label>';
    }
    return '<div class="addr-grid">' +
      input('street', ' maxlength="70" autocomplete="off"') + input('buildingNo', ' maxlength="16"') +
      input('postalCode', ' maxlength="16" inputmode="numeric"') + input('town', ' maxlength="35"') +
      input('country', ' maxlength="2" autocapitalize="characters"') + '</div>';
  }

  function renderSetup() {
    var el = document.getElementById('tab-setup');
    var s = data.settings;
    var html = '';
    var ib = ibanStatus();
    var isQr = Q.validateIban(s.iban).qr;
    var legacyStable = s.address && !s.postalCode && !s.town;
    html += '<div class="card"><h2>' + esc(t('stable')) + '</h2>' +
      '<p class="small muted">' + esc(t('qrHelp')) + '</p>' +
      '<label class="block">' + esc(t('stableName')) + '<input data-setting="stableName" maxlength="70" autocomplete="organization" value="' + esc(s.stableName) + '"></label>' +
      (legacyStable ? '<p class="small">' + esc(t('legacyAddress')) + ' <em>' + esc(s.address) + '</em></p>' : '') +
      addressFields('data-setting', s) +
      '<label class="block">' + esc(t('contact')) + '<textarea rows="2" data-setting="contact">' + esc(s.contact) + '</textarea></label>' +
      '<label class="block">' + esc(t('ibanLabel')) + '<input data-setting="iban" autocomplete="off" spellcheck="false" value="' + esc(Q.formatIban(s.iban)) + '"></label>' +
      '<p class="small ' + (ib.ok ? 'ok' : 'bad') + '" id="iban-status">' + esc(ib.text) + '</p>' +
      (isQr
        ? '<label class="block">' + esc(t('qrrPrefix')) + '<input data-setting="qrrPrefix" inputmode="numeric" maxlength="16" value="' + esc(s.qrrPrefix) + '"></label>'
        : '<label class="block">' + esc(t('refType')) + '<select data-setting="refType">' +
          '<option value="SCOR"' + (s.refType !== 'NON' ? ' selected' : '') + '>' + esc(t('refScor')) + '</option>' +
          '<option value="NON"' + (s.refType === 'NON' ? ' selected' : '') + '>' + esc(t('refNon')) + '</option></select></label>') +
      '<label class="block">' + esc(t('paymentDays')) + '<input type="number" min="0" data-setting="paymentDays" value="' + esc(s.paymentDays) + '"></label></div>';

    html += '<div class="card"><h2>' + esc(t('services')) + '</h2><div class="table">';
    data.services.forEach(function (sv) {
      html += '<div class="trow">' +
        '<input aria-label="' + esc(t('serviceName')) + '" data-svc="' + esc(sv.id) + '" data-field="name" value="' + esc(sv.name) + '">' +
        '<input aria-label="' + esc(t('price')) + '" type="number" min="0" step="0.05" inputmode="decimal" data-svc="' + esc(sv.id) + '" data-field="price" value="' + esc(sv.price) + '">' +
        unitSelect('aria-label="' + esc(t('unit')) + '" data-svc="' + esc(sv.id) + '" data-field="unit"', sv.unit) +
        '<button type="button" class="btn danger small" data-del-svc="' + esc(sv.id) + '">×</button></div>';
    });
    html += '</div><button type="button" class="btn" data-action="add-svc">+ ' + esc(t('add')) + '</button></div>';

    html += '<div class="card"><h2>' + esc(t('owners')) + '</h2><p class="small muted">' + esc(t('ownerAddressHelp')) + '</p>';
    data.owners.forEach(function (o) {
      var legacy = o.address && !o.postalCode && !o.town;
      html += '<fieldset class="horse owner"><div class="trow">' +
        '<input aria-label="' + esc(t('ownerName')) + '" placeholder="' + esc(t('ownerName')) + '" maxlength="70" data-own="' + esc(o.id) + '" data-field="name" value="' + esc(o.name) + '">' +
        '<button type="button" class="btn danger small" data-del-own="' + esc(o.id) + '">×</button></div>' +
        (legacy ? '<p class="small">' + esc(t('legacyAddress')) + ' <em>' + esc(o.address) + '</em></p>' : '') +
        addressFields('data-own="' + esc(o.id) + '" data-field', o) + '</fieldset>';
    });
    html += '<button type="button" class="btn" data-action="add-own">+ ' + esc(t('add')) + '</button></div>';

    var monthly = data.services.filter(function (x) { return x.unit === 'month'; });
    html += '<div class="card"><h2>' + esc(t('horses')) + '</h2>';
    data.horses.forEach(function (h) {
      html += '<fieldset class="horse"><div class="trow">' +
        '<input aria-label="' + esc(t('horseName')) + '" placeholder="' + esc(t('horseName')) + '" data-hor="' + esc(h.id) + '" data-field="name" value="' + esc(h.name) + '">' +
        '<button type="button" class="btn danger small" data-del-hor="' + esc(h.id) + '">×</button></div>' +
        '<label class="block">' + esc(t('owner')) + '<select data-hor="' + esc(h.id) + '" data-field="ownerId"><option value="">' + esc(t('none')) + '</option>' +
        data.owners.map(function (o) { return '<option value="' + esc(o.id) + '"' + (h.ownerId === o.id ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') + '</select></label>' +
        '<label class="block">' + esc(t('board')) + '<select data-hor="' + esc(h.id) + '" data-field="boardServiceId"><option value="">' + esc(t('none')) + '</option>' +
        monthly.map(function (x) { return '<option value="' + esc(x.id) + '"' + (h.boardServiceId === x.id ? ' selected' : '') + '>' + esc(x.name) + ' (CHF ' + money(x.price) + ')</option>'; }).join('') + '</select></label>' +
        '<div class="row-inline"><label>' + esc(t('start')) + '<input type="date" data-hor="' + esc(h.id) + '" data-field="start" value="' + esc(h.start) + '"></label>' +
        '<label>' + esc(t('end')) + '<input type="date" data-hor="' + esc(h.id) + '" data-field="end" value="' + esc(h.end) + '"></label></div>' +
        (monthly.length ? '<div class="small">' + esc(t('recurring')) + '</div><div class="checks">' + monthly.filter(function (x) { return x.id !== h.boardServiceId; }).map(function (x) {
          var on = (h.recurring || []).indexOf(x.id) !== -1;
          return '<label><input type="checkbox" data-rec="' + esc(h.id) + '" value="' + esc(x.id) + '"' + (on ? ' checked' : '') + '> ' + esc(x.name) + '</label>';
        }).join('') + '</div>' : '') +
        '</fieldset>';
    });
    html += '<button type="button" class="btn" data-action="add-hor">+ ' + esc(t('add')) + '</button></div>';

    html += '<div class="card"><h2>' + esc(t('backup')) + '</h2><p class="small">' + esc(t('backupHelp')) + '</p>' +
      '<div class="row-inline"><button type="button" class="btn" data-action="backup">' + esc(t('download')) + '</button>' +
      '<label class="btn">' + esc(t('importFile')) + '<input type="file" accept="application/json,.json" id="import-file" hidden></label></div>' +
      '<div class="row-inline"><button type="button" class="btn" data-action="demo">' + esc(t('demo')) + '</button>' +
      '<button type="button" class="btn danger" data-action="reset">' + esc(t('reset')) + '</button></div></div>';
    el.innerHTML = html;
  }

  // ---------- events ----------
  document.addEventListener('click', function (ev) {
    var target = ev.target.closest('button, [data-tab], [data-lang]');
    if (!target) return;
    var d = target.dataset;

    if (d.tab) { ui.tab = d.tab; render(); return; }
    if (d.lang) { data.settings.lang = d.lang; save(); render(); return; }
    if (d.pickHorse) { ui.horseId = d.pickHorse; renderLog(); return; }
    if (d.pickService) { ui.serviceId = d.pickService; renderLog(); return; }
    if (d.qty) {
      var q = Math.max(0.5, (Number(ui.qty) || 0) + Number(d.qty));
      ui.qty = q;
      document.getElementById('log-qty').value = q;
      return;
    }
    if (d.delEntry) {
      var removed = byId(data.entries, d.delEntry);
      data.entries = data.entries.filter(function (e) { return e.id !== d.delEntry; });
      save(); renderLog();
      if (removed) toast(t('remove') + ' ✓');
      return;
    }
    if (d.printOwner) { printInvoices([B.invoiceForOwner(data, d.printOwner, ui.month)]); return; }
    if (d.delSvc) {
      if (!confirm(t('deleteConfirm'))) return;
      data.services = data.services.filter(function (x) { return x.id !== d.delSvc; });
      save(); renderSetup(); return;
    }
    if (d.delOwn) {
      if (!confirm(t('deleteConfirm'))) return;
      data.owners = data.owners.filter(function (x) { return x.id !== d.delOwn; });
      data.horses.forEach(function (h) { if (h.ownerId === d.delOwn) h.ownerId = ''; });
      save(); renderSetup(); return;
    }
    if (d.delHor) {
      if (!confirm(t('deleteConfirm'))) return;
      data.horses = data.horses.filter(function (x) { return x.id !== d.delHor; });
      save(); renderSetup(); return;
    }

    switch (d.action) {
      case 'save-entry': saveEntry(); break;
      case 'csv':
        downloadFile('pension-' + ui.month + '.csv', '﻿' + B.monthToCSV(data, ui.month, t('csvHeaders')), 'text/csv;charset=utf-8');
        break;
      case 'print-all': printInvoices(B.invoicesForMonth(data, ui.month)); break;
      case 'add-svc':
        data.services.push({ id: B.newId('s'), name: '', price: 0, unit: 'once' });
        save(); renderSetup(); break;
      case 'add-own':
        data.owners.push({ id: B.newId('o'), name: '', street: '', buildingNo: '', postalCode: '', town: '', country: 'CH' });
        save(); renderSetup(); break;
      case 'add-hor':
        data.horses.push({ id: B.newId('h'), name: '', ownerId: data.owners[0] ? data.owners[0].id : '', boardServiceId: '', recurring: [], start: '', end: '' });
        save(); renderSetup(); break;
      case 'backup':
        downloadFile('carnet-pension-sauvegarde-' + todayStr() + '.json', JSON.stringify(data, null, 2), 'application/json');
        break;
      case 'demo':
        if (data.horses.length && !confirm(t('demoConfirm'))) return;
        data = Demo.build(data.settings.lang);
        save(); ui.tab = 'log'; ui.date = todayStr(); render(); break;
      case 'reset':
        if (!confirm(t('resetConfirm'))) return;
        var lang = data.settings.lang;
        data = B.emptyData(); data.settings.lang = lang;
        save(); render(); break;
    }
  });

  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el.id === 'log-qty') { ui.qty = Number(el.value); return; }
    if (el.id === 'log-note') { ui.note = el.value; return; }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    var d = el.dataset;
    if (el.id === 'log-date') { if (B.isDate(el.value)) { ui.date = el.value; renderLog(); } return; }
    if (el.id === 'month-pick') { if (/^\d{4}-\d{2}$/.test(el.value)) { ui.month = el.value; renderMonth(); } return; }
    if (d.status) { data.status[d.status] = el.value; save(); return; }
    if (d.setting) {
      var v = el.value;
      if (d.setting === 'paymentDays') v = Math.max(0, Number(v) || 0);
      if (d.setting === 'iban') v = Q.cleanIban(v);
      if (d.setting === 'country') v = String(v).trim().toUpperCase();
      if (d.setting === 'qrrPrefix') v = String(v).replace(/\D/g, '');
      data.settings[d.setting] = v;
      save();
      if (d.setting === 'iban' || d.setting === 'refType' || d.setting === 'qrrPrefix' || d.setting === 'country') renderSetup();
      return;
    }
    if (d.svc) {
      var sv = byId(data.services, d.svc);
      if (!sv) return;
      var val = d.field === 'price' ? Number(el.value) : el.value;
      var copy = Object.assign({}, sv); copy[d.field] = val;
      var errs = B.validateService(copy).filter(function (x) { return x !== 'name' || d.field === 'name'; });
      if (errs.length) { toast(t('err_' + errs[0])); renderSetup(); return; }
      sv[d.field] = val; save();
      if (d.field === 'unit') renderSetup();
      return;
    }
    if (d.own) {
      var o = byId(data.owners, d.own);
      if (o) { o[d.field] = d.field === 'country' ? String(el.value).trim().toUpperCase() : el.value; save(); }
      return;
    }
    if (d.hor) {
      var h = byId(data.horses, d.hor);
      if (h) { h[d.field] = el.value; save(); if (d.field === 'boardServiceId') renderSetup(); }
      return;
    }
    if (d.rec) {
      var hr = byId(data.horses, d.rec);
      if (!hr) return;
      hr.recurring = (hr.recurring || []).filter(function (x) { return x !== el.value; });
      if (el.checked) hr.recurring.push(el.value);
      save(); return;
    }
    if (el.id === 'import-file' && el.files && el.files[0]) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          data = B.normalize(JSON.parse(reader.result));
          save(); render(); toast(t('importOk'));
        } catch (e) { toast(t('importBad')); }
      };
      reader.readAsText(el.files[0]);
    }
  });

  render();
})();
