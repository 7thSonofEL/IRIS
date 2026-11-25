'use strict';
/* IRIS front end. Vanilla JS. Talks to the server through api.js (google.script.run shim). */
(function () {
  // ---------- tiny helpers ----------
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function fmtDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1] : (s || '—'); }
  function fmtShort(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] : (s || ''); }
  function icon(n, c) { return '<svg class="' + (c || '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); }
  var loads = 0;
  function busy(on) { loads = Math.max(0, loads + (on ? 1 : -1)); $('#loadbar').classList.toggle('on', loads > 0); }
  function api(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    busy(true);
    return new Promise(function (res, rej) {
      var r = google.script.run.withSuccessHandler(function (v) { busy(false); res(v); })
        .withFailureHandler(function (e) { busy(false); rej(new Error((e && e.message) || String(e))); });
      r[name].apply(r, args);
    });
  }
  function toast(msg, kind) {
    var t = document.createElement('div'); t.className = 'toast ' + (kind || '');
    t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    t.innerHTML = '<span>' + esc(msg) + '</span><button aria-label="Dismiss">×</button>';
    $('#toasts').appendChild(t);
    var kill = function () { if (t.parentNode) t.parentNode.removeChild(t); };
    t.querySelector('button').onclick = kill; setTimeout(kill, kind === 'err' ? 9000 : 4500);
  }
  function fail(e) { toast(e && e.message ? e.message.replace(/^Error:\s*/, '') : String(e), 'err'); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; }
  function download(name, mime, data, isB64) {
    var bytes = isB64 ? Uint8Array.from(atob(data), function (c) { return c.charCodeAt(0); }) : data;
    var url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  function spinBtn(b, on, label) { b.disabled = on; if (label) b.dataset.l = b.dataset.l || b.textContent; b.textContent = on ? label : (b.dataset.l || b.textContent); }

  var S = { user: null, init: null, view: 'dashboard', alertFilter: 'active', pat: { window: 28, basis: 'received', tab: 'trends', data: null },
    cases: { page: 1, sortBy: 'dateReceived', sortDir: 'desc' }, adminSheet: 'Analysts', report: null, alertCount: 0 };
  var isSup = function () { return ['supervisor', 'admin', 'superadmin'].indexOf(S.user.role) > -1; };
  var isAdm = function () { return ['admin', 'superadmin'].indexOf(S.user.role) > -1; };
  var ROLE_LABEL = { user: 'Analyst', supervisor: 'Supervisor', admin: 'Administrator', superadmin: 'Super administrator' };

  // ---------- chart primitives (SVG, token colours, tooltips) ----------
  function niceMax(v) { if (v <= 5) return Math.max(5, Math.ceil(v)); var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 5 ? 5 : 10) * p; }
  function lineChart(el, o) {
    var W = 760, H = o.h || 250, m = { l: 34, r: 14, t: 12, b: 28 };
    var fc = o.forecast, labels = o.labels.concat(fc ? fc.labels : []), n = labels.length, nA = o.labels.length;
    var mx = Math.max.apply(null, o.values.concat(fc ? fc.upper : [0], [1])); var top = niceMax(mx);
    var x = function (i) { return m.l + (n === 1 ? 0 : i * (W - m.l - m.r) / (n - 1)); }, y = function (v) { return m.t + (1 - v / top) * (H - m.t - m.b); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria || 'Line chart') + '"><g class="ax">';
    for (var g = 0; g <= 4; g++) { var gv = top * g / 4; s += '<line class="grid-line" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(gv) + '" y2="' + y(gv) + '"/><text x="' + (m.l - 6) + '" y="' + (y(gv) + 4) + '" text-anchor="end">' + (Math.round(gv * 10) / 10) + '</text>'; }
    var step = Math.max(1, Math.ceil(n / 8));
    labels.forEach(function (l, i) { if (i % step === 0 || i === n - 1) s += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(fmtShort(l)) + '</text>'; });
    s += '</g>';
    if (fc) {
      var up = fc.upper.map(function (v, i) { return x(nA + i) + ',' + y(v); }), lo = fc.lower.map(function (v, i) { return x(nA + i) + ',' + y(v); }).reverse();
      var join = x(nA - 1) + ',' + y(o.values[nA - 1]);
      s += '<polygon points="' + join + ' ' + up.join(' ') + ' ' + lo.join(' ') + '" fill="var(--series-1)" opacity=".14"/>';
      s += '<polyline fill="none" stroke="var(--series-1)" stroke-width="2" stroke-dasharray="5 4" points="' + join + ' ' + fc.values.map(function (v, i) { return x(nA + i) + ',' + y(v); }).join(' ') + '"/>';
    }
    var pts = o.values.map(function (v, i) { return x(i) + ',' + y(v); }).join(' ');
    s += '<polygon points="' + x(0) + ',' + y(0) + ' ' + pts + ' ' + x(nA - 1) + ',' + y(0) + '" fill="var(--series-1)" opacity=".08"/>';
    s += '<polyline fill="none" stroke="var(--series-1)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="' + pts + '"/>';
    s += '<line id="xh" class="grid-line" y1="' + m.t + '" y2="' + (H - m.b) + '" style="stroke:var(--ink-3);display:none"/><circle id="xd" r="5" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" style="display:none"/>';
    s += '<rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + (W - m.l - m.r) + '" height="' + (H - m.t - m.b) + '" fill="transparent"/></svg>';
    el.innerHTML = (fc ? '<div class="leg"><span><i style="background:var(--series-1)"></i>' + esc(o.name || 'Actual') + '</span><span><i style="background:var(--series-1);opacity:.35"></i>Forecast and likely range</span></div>' : '') + s;
    var svg = el.querySelector('svg'), hit = svg.querySelector('.hit'), xh = svg.querySelector('#xh'), xd = svg.querySelector('#xd');
    hit.addEventListener('mousemove', function (ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
      var i = Math.max(0, Math.min(n - 1, Math.round((px - m.l) / ((W - m.l - m.r) / (n - 1 || 1)))));
      var isF = i >= nA, v = isF ? fc.values[i - nA] : o.values[i];
      xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.style.display = ''; xd.setAttribute('cx', x(i)); xd.setAttribute('cy', y(v)); xd.style.display = '';
      var t = '<b>Week of ' + esc(fmtDate(labels[i])) + '</b><br>' + (isF ? 'Forecast ' + Math.round(v * 10) / 10 + ' (range ' + Math.round(fc.lower[i - nA]) + '–' + Math.round(fc.upper[i - nA]) + ')' : plural(v, 'case'));
      showTip(t, ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', function () { xh.style.display = 'none'; xd.style.display = 'none'; hideTip(); });
  }
  function columnChart(el, labels, values, o) {
    o = o || {}; var W = 560, H = o.h || 200, m = { l: 30, r: 8, t: 10, b: 26 }, n = labels.length, top = niceMax(Math.max.apply(null, values.concat([1])));
    var bw = (W - m.l - m.r) / n, s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria || 'Column chart') + '"><g class="ax">';
    for (var g = 0; g <= 4; g++) { var gv = top * g / 4, gy = m.t + (1 - gv / top) * (H - m.t - m.b); s += '<line class="grid-line" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + gy + '" y2="' + gy + '"/><text x="' + (m.l - 5) + '" y="' + (gy + 4) + '" text-anchor="end">' + Math.round(gv) + '</text>'; }
    var every = n > 14 ? 3 : 1;
    labels.forEach(function (l, i) { if (i % every === 0) s += '<text x="' + (m.l + bw * i + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(l) + '</text>'; });
    s += '</g>';
    var peak = values.indexOf(Math.max.apply(null, values));
    values.forEach(function (v, i) {
      var h = (v / top) * (H - m.t - m.b), w = Math.max(4, bw - 6), xx = m.l + bw * i + (bw - w) / 2, yy = H - m.b - h;
      s += '<path class="mark" tabindex="0" data-tip="' + esc('<b>' + labels[i] + '</b><br>' + plural(v, 'case')) + '" fill="' + (i === peak && v > 0 ? 'var(--series-2)' : 'var(--series-1)') + '" d="M' + xx + ' ' + (H - m.b) + 'V' + (yy + (h > 4 ? 4 : 0)) + (h > 4 ? 'a4 4 0 0 1 4 -4h' + (w - 8) + 'a4 4 0 0 1 4 4' : 'h' + w) + 'V' + (H - m.b) + 'Z"/>';
    });
    el.innerHTML = s + '</svg>';
  }
  function spark(vals, w, h) {
    w = w || 84; h = h || 24; if (!vals || !vals.length) return '';
    var mx = Math.max.apply(null, vals.concat([1])), n = vals.length;
    var pts = vals.map(function (v, i) { return (n === 1 ? w / 2 : i * (w - 4) / (n - 1) + 2) + ',' + (h - 3 - v / mx * (h - 6)); }).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline fill="none" stroke="var(--series-1)" stroke-width="1.8" stroke-linejoin="round" points="' + pts + '"/><circle cx="' + pts.split(' ').pop().split(',')[0] + '" cy="' + pts.split(' ').pop().split(',')[1] + '" r="2.4" fill="var(--series-1)"/></svg>';
  }
  function heatmap(el, hm, rowLabel) {
    if (!hm || !hm.rows || !hm.rows.length) { el.innerHTML = '<div class="empty"><b>Not enough data yet</b>Cases from the last ' + (hm && hm.days || 90) + ' days will appear here.</div>'; return; }
    var max = hm.max || 1, s = '<div class="heat" style="grid-template-columns:minmax(120px,auto) repeat(' + hm.cols.length + ',minmax(54px,1fr))"><div></div>';
    hm.cols.forEach(function (c) { s += '<div class="hh" title="' + esc(c) + '">' + esc(c.length > 14 ? c.slice(0, 13) + '…' : c) + '</div>'; });
    hm.rows.forEach(function (r, ri) {
      s += '<div class="hr">' + esc(r) + '</div>';
      hm.cols.forEach(function (c, ci) {
        var v = hm.values[ri][ci], lv = v <= 0 ? 0 : Math.max(1, Math.min(6, Math.ceil(v / max * 6)));
        s += '<div class="hc l' + lv + '" tabindex="0" data-tip="' + esc('<b>' + r + '</b> · ' + c + '<br>' + plural(v, 'case')) + '">' + (v || '') + '</div>';
      });
    });
    el.innerHTML = s + '</div><div class="heat-legend">Fewer<i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><i class="l5"></i><i class="l6"></i>More · last ' + (hm.days || 90) + ' days</div>';
  }
  var tipEl;
  function showTip(html, x, y) { tipEl = tipEl || $('#tip'); tipEl.innerHTML = html; tipEl.classList.add('on'); var w = tipEl.offsetWidth, h = tipEl.offsetHeight; tipEl.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px'; tipEl.style.top = Math.max(8, y - h - 12) + 'px'; }
  function hideTip() { tipEl = tipEl || $('#tip'); tipEl.classList.remove('on'); }
  document.addEventListener('mouseover', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t.getAttribute('data-tip'), e.clientX, e.clientY); });
  document.addEventListener('mousemove', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t.getAttribute('data-tip'), e.clientX, e.clientY); });
  document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
  document.addEventListener('focusin', function (e) { var t = e.target; if (t.getAttribute && t.getAttribute('data-tip')) { var r = t.getBoundingClientRect(); showTip(t.getAttribute('data-tip'), r.left + r.width / 2, r.top); } });
  document.addEventListener('focusout', hideTip);

  // ---------- shared renderers ----------
  var DIR = { Rising: { i: 'up', c: 'up', t: 'Rising' }, Falling: { i: 'dn', c: 'down', t: 'Falling' }, Stable: { i: '', c: 'flat', t: 'Stable' }, New: { i: 'up', c: 'up', t: 'New' } };
  function dirChip(r) {
    var d = DIR[r.direction] || DIR.Stable, pct = r.changePct == null ? '' : ' ' + (r.changePct > 0 ? '+' : '') + r.changePct + '%';
    return '<span class="delta ' + d.c + '">' + (d.i ? icon(d.i, '') : '') + d.t + pct + '</span>';
  }
  function slaCell(s) {
    if (!s) return '';
    var lab = { overdue: 'Overdue ' + (s.hoursOver != null ? s.hoursOver + 'h' : ''), 'at-risk': 'At risk · ' + s.hoursLeft + 'h left', 'on-track': s.hoursLeft + 'h left', unassigned: 'Unassigned', closed: s.compliant === false ? 'Closed late' : s.compliant ? 'Closed on time' : 'Closed' }[s.state] || s.state;
    var cls = s.state === 'overdue' ? 'crit' : s.state === 'at-risk' ? 'warn' : s.state === 'closed' ? (s.compliant === false ? 'crit' : 'good') : s.state === 'unassigned' ? 'info' : 'good';
    var meter = s.pct != null ? '<div class="sla-meter" aria-hidden="true"><i class="' + s.state + '" style="width:' + Math.min(100, s.pct) + '%"></i></div>' : '';
    return '<div class="sla"><span class="chip ' + cls + '">' + esc(lab.trim()) + '</span>' + meter + '</div>';
  }
  function prioChip(p) { var lv = String(p || '').slice(0, 2); return '<span class="chip ' + (lv === 'L1' ? 'crit' : lv === 'L2' ? 'warn' : '') + '">' + esc(p || 'Not set') + '</span>'; }
  function caseTable(rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<div class="empty"><b>' + esc(opts.emptyTitle || 'No cases found') + '</b>' + esc(opts.empty || 'Change the filters or log a new request.') + '</div>';
    var cols = [['caseNumber', 'Case'], ['dateReceived', 'Received'], ['crimeType', 'Crime type'], ['requestType', 'Request'], ['station', 'Station'], ['analyst', 'Analyst'], ['priorityLevel', 'Priority'], ['status', 'Status'], ['sla', 'SLA']];
    var s = '<table class="t"><thead><tr>' + cols.map(function (c) {
      if (!opts.sortable || c[0] === 'sla') return '<th scope="col">' + c[1] + '</th>';
      var on = S.cases.sortBy === c[0];
      return '<th scope="col"' + (on ? ' aria-sort="' + (S.cases.sortDir === 'asc' ? 'ascending' : 'descending') + '"' : '') + '><button data-sort="' + c[0] + '">' + c[1] + (on ? (S.cases.sortDir === 'asc' ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      s += '<tr class="click" tabindex="0" data-case="' + esc(r.caseNumber) + '"><td class="case-no">' + esc(r.caseNumber) + '</td><td class="num">' + esc(fmtDate(r.dateReceived)) + '</td><td>' + esc(r.crimeType) + '</td><td><span class="chip">' + esc(r.requestType) + '</span></td><td>' + esc(r.station) + '</td><td>' + esc(r.analyst) + '</td><td>' + prioChip(r.priority) + '</td><td>' + (r.status === 'Closed' ? '<span class="chip">Closed</span>' : '<span class="chip info">Open</span>') + '</td><td>' + slaCell(r.sla) + '</td></tr>';
    });
    return s + '</tbody></table>';
  }
  function moverList(rows, n, valLabel) {
    rows = (rows || []).slice(0, n || 6);
    if (!rows.length) return '<div class="empty">No activity in this window.</div>';
    return '<div class="movers">' + rows.map(function (r) { return '<div class="mover"><div><div class="nm" title="' + esc(r.name) + '">' + esc(r.name) + '</div><div class="ct num">' + r.current + ' now · ' + r.previous + ' before</div></div><div>' + spark(r.spark, 84, 24) + '</div><div class="r">' + dirChip(r) + '</div></div>'; }).join('') + '</div>';
  }
  function sevIcon(s) { return icon(s === 'critical' ? 'warn' : s === 'warning' ? 'warn' : 'info', 'sev-ico ' + s); }
  function sevLabel(s) { return { critical: 'Critical', warning: 'Warning', info: 'For information' }[s] || s; }
  function insightList(list) {
    if (!list || !list.length) return '<div class="empty"><b>Nothing unusual</b>No spikes or notable shifts at the moment.</div>';
    return list.map(function (i) { return '<div class="insight">' + sevIcon(i.severity) + '<p>' + esc(i.text) + '</p></div>'; }).join('');
  }

  // ---------- navigation ----------
  var TITLES = { dashboard: 'Dashboard', new: 'New request', cases: 'Cases', patterns: 'Crime patterns', alerts: 'Alert centre', reports: 'Reports', admin: 'Administration', audit: 'Audit log' };
  var GATE = { patterns: 'sup', reports: 'sup', admin: 'adm', audit: 'adm' };
  function allowed(v) { return !GATE[v] || (GATE[v] === 'sup' ? isSup() : isAdm()); }
  function go(v, push) {
    if (!TITLES[v]) v = 'dashboard';
    if (!allowed(v)) { toast('Your role does not have access to that page.', 'err'); v = 'dashboard'; }
    S.view = v;
    $$('.view').forEach(function (e) { e.classList.toggle('active', e.id === 'v-' + v); });
    $$('.nav-item').forEach(function (b) { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('#pageTitle').textContent = TITLES[v]; document.title = TITLES[v] + ' | IRIS';
    $('#sidebar').classList.remove('on'); $('#scrim').classList.remove('on');
    if (push !== false) { try { history.replaceState(null, '', '#' + v); } catch (e) { } }
    ({ dashboard: loadDashboard, cases: loadCases, patterns: loadPatterns, alerts: loadAlerts, reports: initReports, admin: loadAdmin, audit: loadAudit, new: initForm }[v] || function () { })();
    window.scrollTo(0, 0);
  }
  window.IRIS = { go: go, state: S };

  // ---------- dashboard ----------
  function loadDashboard() {
    if (navigator.onLine === false) return loadOfflineDashboard();
    api('getDashboardData').then(function (d) {
      if (d.error) throw new Error(d.error);
      var k = d.kpis, diff = k.createdThisWeek - k.createdPrevWeek;
      var tiles = [
        { l: 'Received, last 7 days', v: k.createdThisWeek, s: (diff === 0 ? 'Same as' : Math.abs(diff) + (diff > 0 ? ' more than' : ' fewer than')) + ' the 7 days before', go: 'cases' },
        { l: 'Closed, last 7 days', v: k.closedThisWeek, s: 'Cases finished this week', cls: 'good' },
        { l: 'Open cases', v: d.stats.openCases, s: 'of ' + d.stats.totalCases + ' logged', go: 'cases', f: { status: 'Open' } },
        { l: 'At risk of breach', v: k.atRisk, s: 'Past the SLA warning point', cls: k.atRisk ? 'warn' : '', go: 'cases', f: { slaState: 'at-risk', status: 'Open' } },
        { l: 'Overdue', v: k.overdue, s: k.overdue ? 'Past their SLA deadline' : 'Nothing overdue', cls: k.overdue ? 'crit' : 'good', go: 'cases', f: { slaState: 'overdue', status: 'Open' } },
        { l: 'SLA met, last 30 days', v: k.slaCompliance30 == null ? '—' : k.slaCompliance30 + '%', s: k.avgClosureDays30 == null ? 'No closures yet' : 'Average ' + k.avgClosureDays30 + ' days to close' }
      ];
      $('#kpis').innerHTML = tiles.map(function (t, i) {
        var inner = '<div class="k-label">' + esc(t.l) + '</div><div class="k-val">' + esc(t.v) + '</div><div class="k-sub">' + esc(t.s) + '</div>';
        return t.go ? '<button class="card kpi ' + (t.cls || '') + '" data-kpi="' + i + '">' + inner + '</button>' : '<div class="card kpi ' + (t.cls || '') + '">' + inner + '</div>';
      }).join('');
      $$('#kpis [data-kpi]').forEach(function (b) { b.onclick = function () { var t = tiles[+b.dataset.kpi]; applyFilters(t.f || {}); go(t.go); }; });
      $('#dashSub').textContent = 'Where the workload stands on ' + fmtDate(S.init.today) + '.';
      var total = d.weekly.values.reduce(function (a, b) { return a + b; }, 0);
      $('#weeklySub').textContent = plural(total, 'request') + ' in the last 12 weeks';
      lineChart($('#dashWeekly'), { labels: d.weekly.labels, values: d.weekly.values, aria: 'Requests received per week, last 12 weeks', name: 'Requests' });
      $('#dashUrgent').innerHTML = d.overdueTop.length ? '<table class="t"><thead><tr><th>Case</th><th>Analyst</th><th>Priority</th><th>Assigned</th><th class="r">Overdue by</th></tr></thead><tbody>' +
        d.overdueTop.map(function (o) { return '<tr class="click" tabindex="0" data-case="' + esc(o.caseNumber) + '"><td class="case-no">' + esc(o.caseNumber) + '</td><td>' + esc(o.analyst) + '</td><td>' + prioChip(o.priority) + '</td><td class="num">' + esc(fmtDate(o.dateAssigned)) + '</td><td class="r"><span class="chip crit">' + o.hoursOverdue + ' h</span></td></tr>'; }).join('') + '</tbody></table>'
        : '<div class="empty"><b>Nothing is overdue</b>Every open case is inside its SLA window.</div>';
      var pm = d.priorityMix, pmx = Math.max(1, pm.L1, pm.L2, pm.L3);
      $('#dashPriority').innerHTML = ['L1', 'L2', 'L3'].map(function (l) { return '<div class="bar-row"><span class="lab">' + l + ' · ' + ({ L1: '24 hours', L2: '48 hours', L3: '72 hours' })[l] + '</span><div class="bar-track"><div class="bar-fill' + (l === 'L1' ? ' alt' : '') + '" style="width:' + (pm[l] / pmx * 100) + '%"></div></div><span class="bar-val num">' + pm[l] + '</span></div>'; }).join('');
      renderRecent(d.recent || [], d.recentHours || 24, false);
      var pc = $('#dashPatternsCard'); pc.hidden = !d.patterns;
      if (d.patterns) {
        $('#dashPatterns').innerHTML = insightList(d.patterns.insights);
      }
    }).catch(fail);
  }

  // ---------- new request form ----------
  var formReady = false;
  function fillSelect(sel, items, ph) { sel.innerHTML = (ph != null ? '<option value="">' + esc(ph) + '</option>' : '') + items.map(function (v) { return '<option value="' + esc(v.v != null ? v.v : v) + '">' + esc(v.t != null ? v.t : v) + '</option>'; }).join(''); }
  function initForm() {
    var L = S.init.lookups, C = S.init.constants;
    if (!formReady) {
      formReady = true;
      fillSelect($('#f-analyst'), L.analysts, 'Select analyst'); fillSelect($('#f-mode'), C.modes, 'Select mode'); fillSelect($('#f-requestType'), C.requestTypes, 'Select type');
      fillSelect($('#f-station'), L.stations, 'Select station'); fillSelect($('#f-division'), L.divisions, 'Select division');
      $('#dl-crime').innerHTML = L.crimeTypes.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
      $('#f-priority').innerHTML = C.priorities.map(function (p, i) { return '<input type="radio" name="priority" id="pr' + i + '" value="' + p.value + '"' + (i === 0 ? ' required' : '') + '><label for="pr' + i + '">' + p.label + '<small>' + p.hours + ' hours</small></label>'; }).join('');
      var mine = S.user.name && L.analysts.filter(function (a) { return a.toLowerCase() === S.user.name.toLowerCase(); })[0]; if (mine) $('#f-analyst').value = mine;
      $('#f-dateReceived').max = S.init.today; $('#f-offenceDate').max = S.init.today;
      $('#caseForm').addEventListener('submit', submitCase);
      $('#caseForm').addEventListener('reset', function () { setTimeout(function () { clearErrors(); defaults(); }, 0); });
      $('#f-dateReceived').addEventListener('change', function () { if (!$('#f-dateAssigned').dataset.touched) $('#f-dateAssigned').value = this.value; });
      $('#f-dateAssigned').addEventListener('input', function () { this.dataset.touched = '1'; });
    }
    defaults();
  }
  function defaults() { $('#f-dateReceived').value = S.init.today; $('#f-dateAssigned').value = S.init.today; $('#f-dateAssigned').dataset.touched = ''; }
  function clearErrors() { $('#formErrors').hidden = true; $$('#caseForm [aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); }); }
  function submitCase(ev) {
    ev.preventDefault(); clearErrors();
    var f = $('#caseForm'), d = {}, bad = [];
    ['analyst', 'dateReceived', 'dateAssigned', 'mode', 'requestType', 'crimeType', 'station', 'division', 'requestor', 'caseDetails', 'offenceDate', 'offenceTime', 'location', 'latitude', 'longitude'].forEach(function (k) { d[k] = f.elements[k].value.trim(); });
    var pr = f.querySelector('input[name=priority]:checked'); d.priority = pr ? pr.value : '';
    ['analyst', 'dateReceived', 'dateAssigned', 'mode', 'priority', 'requestType', 'crimeType', 'station', 'division', 'requestor', 'caseDetails'].forEach(function (k) {
      if (!d[k]) { bad.push(k); var el = f.elements[k]; if (el && el.setAttribute) el.setAttribute('aria-invalid', 'true'); }
    });
    if (d.dateAssigned && d.dateReceived && d.dateAssigned < d.dateReceived) { bad.push('dates'); f.elements.dateAssigned.setAttribute('aria-invalid', 'true'); }
    if (bad.length) { var box = $('#formErrors'); box.hidden = false; box.textContent = bad.indexOf('dates') > -1 ? 'Date assigned cannot be before date received.' : 'Complete the highlighted fields: ' + bad.join(', ').replace(/([A-Z])/g, ' $1').toLowerCase() + '.'; var first = f.querySelector('[aria-invalid]'); if (first) first.focus(); return; }
    var btn = $('#saveBtn'); spinBtn(btn, true, 'Saving…');
    api('saveCase', d).then(function (r) {
      spinBtn(btn, false);
      if (!r.success) { var box = $('#formErrors'); box.hidden = false; box.textContent = r.error || 'Could not save the request.'; box.scrollIntoView({ block: 'center' }); return; }
      if (r.queued) { toast('Saved on this device. It will be sent when you are back online.', 'ok'); f.reset(); formReady = true; updateSync(); return; }
      toast('Request saved as ' + r.caseNumber, 'ok'); f.reset(); formReady = true; openCase(r.caseNumber);
    }).catch(function (e) { spinBtn(btn, false); fail(e); });
  }

  // ---------- cases list ----------
  var filtersReady = false, FILTER_KEYS = ['status', 'slaState', 'priorityLevel', 'requestType', 'crimeType', 'station', 'analyst', 'from', 'to'];
  function initFilters() {
    if (filtersReady) return; filtersReady = true; var L = S.init.lookups;
    fillSelect($('#fl-requestType'), S.init.constants.requestTypes, 'Any'); fillSelect($('#fl-crimeType'), L.crimeTypes, 'Any');
    fillSelect($('#fl-station'), L.stations, 'Any'); fillSelect($('#fl-analyst'), L.analysts, 'Any');
    var reload = function () { S.cases.page = 1; loadCases(); };
    $('#q').addEventListener('input', debounce(reload, 300));
    FILTER_KEYS.forEach(function (k) { $('#fl-' + k).addEventListener('change', reload); });
    $('#clearFilters').onclick = function () { applyFilters({}); loadCases(); };
    $('#exportBtn').onclick = exportCsv;
    $('#caseTable').addEventListener('click', function (e) { var b = e.target.closest('[data-sort]'); if (!b) return; var k = b.dataset.sort; if (S.cases.sortBy === k) S.cases.sortDir = S.cases.sortDir === 'asc' ? 'desc' : 'asc'; else { S.cases.sortBy = k; S.cases.sortDir = 'desc'; } loadCases(); });
  }
  function applyFilters(f) { initFilters(); $('#q').value = f.q || ''; FILTER_KEYS.forEach(function (k) { $('#fl-' + k).value = f[k] || (k === 'status' ? 'All' : ''); }); S.cases.page = 1; }
  function filterParams() { var p = { q: $('#q').value.trim() }; FILTER_KEYS.forEach(function (k) { var v = $('#fl-' + k).value; if (v && v !== 'All') p[k] = v; }); if ($('#fl-status').value !== 'All') p.status = $('#fl-status').value; return p; }
  function loadCases() {
    initFilters(); $('#exportBtn').hidden = !isSup();
    var p = filterParams(); p.sortBy = S.cases.sortBy; p.sortDir = S.cases.sortDir; p.page = S.cases.page; p.pageSize = 25;
    api('searchCasesPaged', p).then(function (r) {
      $('#casesSub').textContent = plural(r.total, 'case') + ' match' + (r.total === 1 ? 'es' : '') + ' your filters';
      $('#caseTable').innerHTML = caseTable(r.rows, { sortable: true });
      $('#casePager').innerHTML = '<span>Page ' + r.page + ' of ' + Math.max(1, r.pages) + '</span><span class="actions"><button class="btn btn-sm" id="pgPrev"' + (r.page <= 1 ? ' disabled' : '') + '>Previous</button><button class="btn btn-sm" id="pgNext"' + (r.page >= r.pages ? ' disabled' : '') + '>Next</button></span>';
      var pp = $('#pgPrev'), pn = $('#pgNext'); pp.onclick = function () { S.cases.page--; loadCases(); }; pn.onclick = function () { S.cases.page++; loadCases(); };
    }).catch(fail);
  }
  function exportCsv() {
    var b = $('#exportBtn'); b.disabled = true;
    api('exportCasesCSV', filterParams()).then(function (r) { b.disabled = false; if (r.error) throw new Error(r.error); download(r.fileName, 'text/csv;charset=utf-8', '﻿' + r.csv); toast('Exported ' + plural(r.count, 'case'), 'ok'); }).catch(function (e) { b.disabled = false; fail(e); });
  }

  // ---------- case drawer ----------
  var lastFocus = null;
  function openCase(no) {
    lastFocus = document.activeElement;
    api('getCaseByNumber', no).then(function (c) {
      if (!c) { toast('Case ' + no + ' was not found.', 'err'); return; }
      var open = c._status !== 'Closed', sla = c._sla || {};
      $('#drawerHead').innerHTML = '<div><div class="case-no" style="font-size:1.4rem">' + esc(c['Case Number']) + '</div><div class="muted" style="margin-top:4px">' + esc(c['Crime Type']) + ' · ' + esc(c['Request Type']) + '</div><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' + (open ? '<span class="chip info">Open</span>' : '<span class="chip">Closed</span>') + prioChip(c['Priority (SLA)']) + '</div></div><button class="icon-btn" id="drawerClose" aria-label="Close">' + icon('x') + '</button>';
      var fact = function (l, v) { return '<div class="fact"><dt>' + l + '</dt><dd>' + (v ? esc(v) : '<span class="muted">—</span>') + '</dd></div>'; };
      var hasGps = c['Latitude'] !== '' && c['Latitude'] != null;
      var h = '<div style="margin-bottom:6px">' + slaCell(sla) + '</div><dl class="facts">' + fact('Analyst', c['Analyst']) + fact('Requestor', c['Requestor']) + fact('Mode', c['Mode']) + fact('Station', c['Station']) + fact('Division', c['Division']) + fact('Date received', fmtDate(c['Date Received'])) + fact('Date assigned', fmtDate(c['Date Assigned'])) + fact('Date closed', c['Date Closed'] ? fmtDate(c['Date Closed']) : '') + '</dl>';
      h += '<h3 class="section-h">Offence information</h3><dl class="facts">' + fact('Offence date', c['Offence Date'] ? fmtDate(c['Offence Date']) : '') + fact('Offence time', c['Offence Time']) + fact('Location', c['Location']) + fact('Coordinates', hasGps ? c['Latitude'] + ', ' + c['Longitude'] : '') + '</dl>';
      h += recordFacts(c); h += '<h3 class="section-h">History</h3><div class="timeline">' + (c._updates || []).map(function (u) { return '<div class="tl-item ' + u.kind + '"><div class="tl-meta">' + (u.kind === 'initial' ? 'Original request' : esc((u.byName || u.by || 'Update') + (u.at ? ' · ' + u.at : ''))) + '</div><div class="tl-text">' + esc(u.text) + '</div></div>'; }).join('') + '</div>';
      h += '<form id="updForm" class="stack" style="margin-top:6px" novalidate><h3 class="section-h" style="margin:14px 0 0">Add to this case</h3>' +
        '<div class="field"><label for="u-note">Update note</label><textarea id="u-note" style="min-height:90px"></textarea></div>' +
        (open ? '' : '') +
        '<details><summary class="small strong" style="cursor:pointer;margin-bottom:10px">Offence date, time and location</summary><div class="form-grid"><div class="field"><label for="u-od">Offence date</label><input type="date" id="u-od" value="' + esc(c['Offence Date']) + '"></div><div class="field"><label for="u-ot">Offence time</label><input type="time" id="u-ot" value="' + esc(c['Offence Time']) + '"></div><div class="field span-all"><label for="u-loc">Location</label><input type="text" id="u-loc" value="' + esc(c['Location']) + '"></div><div class="field"><label for="u-lat">Latitude</label><input type="number" step="any" id="u-lat" value="' + esc(hasGps ? c['Latitude'] : '') + '"></div><div class="field"><label for="u-lng">Longitude</label><input type="number" step="any" id="u-lng" value="' + esc(hasGps ? c['Longitude'] : '') + '"></div></div></details>' +
        (open ? '<label class="check"><input type="checkbox" id="u-close">Close this case</label><div class="field" id="u-closeWrap" hidden><label for="u-cd">Date closed</label><input type="date" id="u-cd" value="' + esc(S.init.today) + '"></div>' : '') + '</form>';
      $('#drawerBody').innerHTML = h;
      $('#drawerFoot').innerHTML = '<button class="btn" id="drawerCancel">Close panel</button>' + (!open && isAdm() ? '<button class="btn" id="reopenBtn">Reopen case</button>' : '') + '<button class="btn btn-primary" id="updSave">Save changes</button>';
      var ro = $('#reopenBtn'); if (ro) ro.onclick = function () { reopenDialog(c); };
      var cl = $('#u-close'); if (cl) cl.onchange = function () { $('#u-closeWrap').hidden = !cl.checked; };
      $('#drawerClose').onclick = $('#drawerCancel').onclick = closeDrawer;
      $('#updSave').onclick = function () { saveUpdate(c); };
      $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on'); $('#drawerClose').focus();
    }).catch(fail);
  }
  function closeDrawer() { $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); if (!$('#modal').classList.contains('on')) $('#scrim').classList.remove('on'); if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { } }
  function saveUpdate(c) {
    var u = { caseDetails: $('#u-note').value.trim() }, cl = $('#u-close');
    if (cl && cl.checked) { u.dateClosed = $('#u-cd').value; if (!u.dateClosed) { toast('Choose the date closed.', 'err'); return; } }
    var off = { offenceDate: $('#u-od').value, offenceTime: $('#u-ot').value, location: $('#u-loc').value.trim(), latitude: $('#u-lat').value, longitude: $('#u-lng').value };
    var was = { offenceDate: c['Offence Date'] || '', offenceTime: c['Offence Time'] || '', location: c['Location'] || '', latitude: String(c['Latitude'] == null ? '' : c['Latitude']), longitude: String(c['Longitude'] == null ? '' : c['Longitude']) };
    if (Object.keys(off).some(function (k) { return String(off[k]) !== String(was[k]); })) u.offence = off;
    if (!u.caseDetails && !u.dateClosed && !u.offence) { toast('Nothing to save yet. Add a note, a closing date or offence details.', 'err'); return; }
    var b = $('#updSave'); spinBtn(b, true, 'Saving…');
    api('updateCase', c['Case Number'], u).then(function (r) {
      spinBtn(b, false); if (!r.success) { toast(r.error || 'Could not update the case.', 'err'); return; }
      toast('Case ' + c['Case Number'] + ' updated', 'ok'); closeDrawer(); refreshCurrent();
    }).catch(function (e) { spinBtn(b, false); fail(e); });
  }
  function refreshCurrent() { if (S.view !== 'new') go(S.view, false); pollAlerts(); }
  document.addEventListener('click', function (e) { var r = e.target.closest('[data-case]'); if (r) openCase(r.dataset.case); var g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var r = e.target.closest && e.target.closest('tr[data-case],div[data-case]'); if (r) openCase(r.dataset.case); } });

  // ---------- modal helper ----------
  var modalFocus = null;
  function openModal(html, opt) {
    opt = opt || {}; modalFocus = document.activeElement;
    var d = $('#dialog'); d.className = 'dialog' + (opt.cls ? ' ' + opt.cls : ''); d.innerHTML = html;
    $('#modal').classList.add('on'); $('#scrim').classList.add('on');
    var f = d.querySelector('input,select,textarea,button'); if (f) f.focus();
    $$('[data-close]', d).forEach(function (b) { b.onclick = closeModal; });
  }
  function closeModal() { warnOpen = false; IRISUI.hideAllPasswords($('#dialog')); $('#dialog').innerHTML = ''; $('#modal').classList.remove('on'); if (!$('#drawer').classList.contains('on')) $('#scrim').classList.remove('on'); if (modalFocus && modalFocus.focus) try { modalFocus.focus(); } catch (e) { } }
  $('#modal').addEventListener('mousedown', function (e) { if (e.target.id === 'modal') closeModal(); });

  // ---------- crime patterns ----------
  var patTables = {};
  function loadPatterns() {
    $('#patBody').innerHTML = '<div class="card card-pad"><div class="skel" style="width:40%"></div><div class="skel" style="margin-top:12px"></div><div class="skel" style="margin-top:12px;width:70%"></div></div>';
    api('getPatternAnalysis', { windowDays: S.pat.window, basis: S.pat.basis }).then(function (d) {
      if (d.error) throw new Error(d.error);
      S.pat.data = d;
      $('#patSub').textContent = 'Last ' + d.windowDays + ' days compared with the ' + d.windowDays + ' days before, as at ' + fmtDate(d.asOf) + '. Basis: ' + (d.basis === 'offence' ? 'offence date' : 'date received') + '.';
      $('#patInsights').innerHTML = insightList(d.insights);
      renderPatTab();
    }).catch(fail);
  }
  function dimTable(rows, label, n) {
    rows = (rows || []).slice(0, n || 12);
    if (!rows.length) return '<div class="empty">No cases in this window.</div>';
    return '<div class="table-wrap"><table class="t"><thead><tr><th>' + label + '</th><th class="r">Now</th><th class="r">Before</th><th>Change</th><th>12 weeks</th><th class="r" title="Cases in the last 7 days against the usual weekly level">Last 7 days</th></tr></thead><tbody>' +
      rows.map(function (r) { var hot = r.z != null && r.z >= (S.init.alertZ || 2) && r.last7 >= 3; return '<tr><td class="strong">' + esc(r.name) + (r.emerging ? ' <span class="chip info">Emerging</span>' : '') + '</td><td class="r num">' + r.current + '</td><td class="r num">' + r.previous + '</td><td>' + dirChip(r) + '</td><td>' + spark(r.spark) + '</td><td class="r num">' + r.last7 + ' <span class="muted small">vs ' + (Math.round(r.baselineWeekly * 10) / 10) + ' usual</span>' + (hot ? ' <span class="chip crit">Spike</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function card(title, sub, body, extra) { return '<div class="card"><div class="card-head"><div><h3>' + title + '</h3>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' + (extra || '') + '</div><div class="card-body">' + body + '</div></div>'; }
  function renderPatTab() {
    var d = S.pat.data, t = S.pat.tab, box = $('#patBody'); if (!d) return;
    $$('#patTabs .tab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'); });
    if (t === 'trends') {
      box.innerHTML = '<div class="stack">' + card('Weekly volume and forecast', 'Dashed line is a damped-trend forecast with its likely range', '<div class="chart" id="pw"></div>') +
        card('Crime types', 'Rising and falling compared with the previous ' + d.windowDays + ' days', dimTable(d.crimeTypes, 'Crime type', 14)) + '</div>';
      var wk = d.weekly; lineChart($('#pw'), { labels: wk.labels, values: wk.values, forecast: wk.forecast, aria: 'Weekly volume with forecast', name: 'Cases per week' });
    } else if (t === 'hotspots') {
      var sp = d.spikes || [];
      box.innerHTML = '<div class="stack">' + card('Spikes right now', 'Last 7 days against the normal weekly level', sp.length ? sp.slice(0, 8).map(function (s) { return '<div class="watch-item ' + s.severity + '" style="padding:10px 0 10px 12px"><div>' + sevIcon(s.severity) + '</div><div><b>' + esc(s.name) + ' <span class="chip">' + esc(({ crimeType: 'Crime type', station: 'Station', division: 'Division', requestType: 'Request type', crimeAtStation: 'Crime at station' })[s.dimension] || s.dimension) + '</span></b><span>' + s.last7 + ' cases in 7 days against ' + (Math.round(s.baselineWeekly * 10) / 10) + ' usual' + (s.changePct != null ? ' (' + (s.changePct > 0 ? '+' : '') + s.changePct + '%)' : '') + (s.emerging ? ', a pattern that was not present before' : '') + '</span></div></div>'; }).join('') : '<div class="empty"><b>No spikes</b>Every crime type, station and division is within its normal range.</div>') +
        '<div class="grid g2">' + card('Crime-at-place clusters', 'Largest in the last ' + d.windowDays + ' days', moverList(d.hotspots, 8)) + card('Stations', 'Busiest first', moverList(d.stations, 8)) + '</div>' +
        card('Crime type by station', 'Where each crime is concentrated', '<div id="hm1"></div>') + '</div>';
      heatmap($('#hm1'), d.heatmaps.crimeStation);
    } else if (t === 'demand') {
      var sg = d.surges || [];
      box.innerHTML = '<div class="stack">' + card('Request demand', 'CDR, social media, location, subscriber and NECMEC requests', dimTable(d.requestTypes, 'Request type', 10)) +
        card('Request type by crime type', 'What kinds of cases drive each request', '<div id="hm2"></div>') +
        (sg.length ? card('Station surges', 'Stations whose demand rose sharply', sg.map(function (s) { return '<div class="bar-row"><span class="lab">' + esc(s.name) + '</span><div class="bar-track"><div class="bar-fill alt" style="width:' + Math.min(100, s.changePct / 3) + '%"></div></div><span class="bar-val num">+' + s.changePct + '% (' + s.previous + ' to ' + s.current + ')</span></div>'; }).join('')) : '') + '</div>';
      heatmap($('#hm2'), d.heatmaps.requestCrime);
    } else if (t === 'time') {
      var se = d.seasonality;
      box.innerHTML = '<div class="grid g2"><div class="stack">' + card('Day of week', 'Requests by day received over the last year', '<div class="chart" id="c-dow"></div>') + card('Month of year', 'Last two years combined', '<div class="chart" id="c-moy"></div>') + '</div><div class="stack">' +
        (se.offenceHour ? card('Time of day', plural(se.offenceHourCount, 'offence') + ' with a recorded time', '<div class="chart" id="c-hr"></div>') : card('Time of day', '', '<div class="callout warn">At least 10 cases with an offence time are needed before the clock pattern is shown. ' + se.offenceHourCount + ' so far. Capture the offence time on intake.</div>')) +
        card('Offence day of week', 'By the day the offence happened', '<div class="chart" id="c-odw"></div>') + '</div></div>';
      columnChart($('#c-dow'), DOW, se.dayOfWeek, { aria: 'Requests by day of week' });
      columnChart($('#c-moy'), MON, se.monthOfYear, { aria: 'Requests by month' });
      if (se.offenceHour) columnChart($('#c-hr'), se.offenceHour.map(function (_, i) { return (i < 10 ? '0' : '') + i; }), se.offenceHour, { aria: 'Offences by hour of day' });
      columnChart($('#c-odw'), DOW, se.offenceDayOfWeek, { aria: 'Offences by day of week' });
    } else {
      var o = d.offence, dq = d.dataQuality || {};
      if (!o.available) { box.innerHTML = '<div class="card card-pad"><div class="empty"><b>No offence details recorded yet</b>Add offence date, location and coordinates when logging a request and the places view fills in.</div></div>'; return; }
      box.innerHTML = '<div class="grid g-main"><div class="stack">' + card('Offence locations', 'Each dot is a case with coordinates. Recent cases are highlighted.', '<div id="map"></div><div class="leg" style="margin-top:10px"><span><i style="background:var(--series-2)"></i>Last ' + d.windowDays + ' days</span><span><i style="background:var(--series-1)"></i>Earlier this year</span></div>') + '</div><div class="stack">' +
        card('Named locations', 'Most frequent', o.locations.length ? o.locations.map(function (l) { var mx = o.locations[0].count || 1; return '<div class="bar-row"><span class="lab" title="' + esc(l.name) + '">' + esc(l.name) + '</span><div class="bar-track"><div class="bar-fill" style="width:' + (l.count / mx * 100) + '%"></div></div><span class="bar-val num">' + l.count + (l.current ? ' · ' + l.current + ' recent' : '') + '</span></div>'; }).join('') : '<div class="empty">No locations recorded.</div>') +
        card('Data coverage', '', '<p class="small">' + o.withOffenceDate + ' cases have an offence date, ' + o.withLocation + ' a location and ' + o.withGps + ' coordinates.</p>' + (dq.totalRecent ? '<p class="small muted" style="margin-top:6px">' + Math.round((dq.withOffenceDate / dq.totalRecent) * 100) + '% of recent cases record an offence date.</p>' : '')) + '</div></div>';
      drawMap($('#map'), o.points, d.windowDays);
    }
  }
  function drawMap(el, pts, win) {
    var b = S.init.thresholds.ttBounds, W = 560, H = 420, pad = 14;
    var asOf = S.pat.data.asOf, cut = new Date(asOf); cut.setDate(cut.getDate() - win); var cutS = cut.toISOString().slice(0, 10);
    var sx = function (lng) { return pad + (lng - b.lngMin) / (b.lngMax - b.lngMin) * (W - 2 * pad); }, sy = function (lat) { return pad + (1 - (lat - b.latMin) / (b.latMax - b.latMin)) * (H - 2 * pad); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of offence locations across Trinidad and Tobago" style="width:100%;height:100%"><rect width="' + W + '" height="' + H + '" fill="var(--surface-2)"/>';
    for (var i = 1; i < 6; i++) { s += '<line class="grid-line" x1="' + (W * i / 6) + '" x2="' + (W * i / 6) + '" y1="0" y2="' + H + '"/><line class="grid-line" y1="' + (H * i / 6) + '" y2="' + (H * i / 6) + '" x1="0" x2="' + W + '"/>'; }
    var old = pts.filter(function (p) { return p.date < cutS; }), cur = pts.filter(function (p) { return p.date >= cutS; });
    function dot(p, c, op) { return '<circle class="mark" tabindex="0" cx="' + sx(p.lng).toFixed(1) + '" cy="' + sy(p.lat).toFixed(1) + '" r="5" fill="' + c + '" fill-opacity="' + op + '" stroke="var(--surface)" stroke-width="1.5" data-tip="' + esc('<b>' + p.caseNumber + '</b><br>' + p.crimeType + '<br>' + p.station + ' · ' + fmtDate(p.date)) + '"/>'; }
    s += old.map(function (p) { return dot(p, 'var(--series-1)', .6); }).join('') + cur.map(function (p) { return dot(p, 'var(--series-2)', .95); }).join('');
    el.innerHTML = s + '</svg>';
  }

  // ---------- alert centre ----------
  function loadAlerts() {
    api('getAlerts').then(function (r) {
      if (r.error) throw new Error(r.error);
      setAlertBadge(r.counts);
      var list = r.alerts.filter(function (a) { return S.alertFilter === 'all' || !a.ack; });
      $('#alertSub').textContent = r.counts.critical + ' critical, ' + r.counts.warning + ' warning, ' + r.counts.info + ' for information' + (r.counts.acknowledged ? ' · ' + r.counts.acknowledged + ' acknowledged' : '') + '. Updated ' + (r.generatedAt || '') + '.';
      if (!list.length) { $('#alertList').innerHTML = '<div class="card card-pad"><div class="empty"><b>All clear</b>No active alerts. Overdue cases, SLA risks, stale cases and unusual spikes will show up here.</div></div>'; return; }
      var typ = { SLA_OVERDUE: 'SLA overdue', SLA_RISK: 'SLA at risk', UNASSIGNED: 'Unassigned', STALE: 'No recent update', DATA_QUALITY: 'Data quality', SPIKE: 'Crime spike', SURGE: 'Demand surge' };
      $('#alertList').innerHTML = list.map(function (a, i) {
        return '<div class="card alert-card ' + a.severity + (a.ack ? ' acked' : '') + '">' + sevIcon(a.severity) + '<div style="flex:1;min-width:0"><h4>' + esc(a.title) + '</h4><p>' + esc(a.detail) + '</p><div class="alert-meta"><span class="chip ' + (a.severity === 'critical' ? 'crit' : a.severity === 'warning' ? 'warn' : 'info') + '">' + sevLabel(a.severity) + '</span><span class="chip">' + esc(typ[a.type] || a.type) + '</span>' + (a.analyst && a.scope === 'case' ? '<span>' + esc(a.analyst) + '</span>' : '') + (a.ack ? '<span>Acknowledged</span>' : '') + '</div></div><div class="actions" style="align-self:center">' + (a.caseNumber ? '<button class="btn btn-sm" data-case="' + esc(a.caseNumber) + '">Open case</button>' : '') + (r.canAcknowledge && !a.ack ? '<button class="btn btn-sm" data-ack="' + i + '">Acknowledge</button>' : '') + '</div></div>';
      }).join('');
      $$('#alertList [data-ack]').forEach(function (b) { b.onclick = function () { ackDialog(list[+b.dataset.ack]); }; });
    }).catch(fail);
  }
  function ackDialog(a) {
    openModal('<div class="dialog-head"><h2 id="modalTitle">Acknowledge alert</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><p class="strong">' + esc(a.title) + '</p><p class="muted" style="margin:6px 0 14px">' + esc(a.detail) + '</p><div class="field"><label for="ack-note">Note (optional)</label><textarea id="ack-note" style="min-height:80px" placeholder="What was done, or why no action is needed"></textarea></div></div><div class="dialog-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ack-ok">Acknowledge</button></div>', { cls: 'narrow' });
    $('#ack-ok').onclick = function () { var b = this; spinBtn(b, true, 'Saving…'); api('acknowledgeAlert', a.key, $('#ack-note').value).then(function (r) { if (!r.success) throw new Error(r.error); closeModal(); toast('Alert acknowledged', 'ok'); loadAlerts(); }).catch(function (e) { spinBtn(b, false); fail(e); }); };
  }
  function setAlertBadge(c) {
    var n = c ? c.critical + c.warning : 0; S.alertCount = n;
    [$('#navAlertCount'), $('#bellCount')].forEach(function (e) { e.hidden = !n; e.textContent = n > 99 ? '99+' : n; });
    $('#bellBtn').setAttribute('aria-label', n ? n + ' active alerts' : 'Alerts');
  }
  function pollAlerts() { if (navigator.onLine === false) return; api('getAlerts').then(function (r) { if (r && r.counts) setAlertBadge(r.counts); }).catch(function () { }); }

  // ---------- reports ----------
  var SECTIONS = [['requestType', 'Request types'], ['crimeType', 'Crime types'], ['station', 'Stations'], ['division', 'Divisions'], ['analyst', 'Analyst workload'], ['priority', 'Priority levels'], ['mode', 'Mode of request']];
  var reportReady = false;
  function initReports() {
    if (reportReady) return; reportReady = true;
    $('#r-sections').innerHTML = SECTIONS.map(function (s, i) { return '<label class="check"><input type="checkbox" value="' + s[0] + '"' + (i < 4 ? ' checked' : '') + '>' + s[1] + '</label>'; }).join('');
    var t = new Date(S.init.today + 'T00:00:00'), a = new Date(t); a.setDate(a.getDate() - 6);
    var iso = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
    $('#r-start').value = iso(a); $('#r-end').value = S.init.today;
    $('#reportForm').classList.add('no-print'); $('#reportForm').nextElementSibling.classList.add('no-print');
    $('#reportForm').addEventListener('submit', function (e) {
      e.preventDefault(); var b = $('#r-run'); spinBtn(b, true, 'Generating…');
      var secs = $$('#r-sections input:checked').map(function (c) { return c.value; });
      api('generateWeeklyReport', { startDate: $('#r-start').value, endDate: $('#r-end').value, selectedSections: secs, includeInsights: $('#r-insights').checked }).then(function (r) { spinBtn(b, false); S.report = r; renderReport(r); $('#r-pdf').disabled = false; $('#r-print').disabled = false; }).catch(function (e) { spinBtn(b, false); fail(e); });
    });
    $('#r-pdf').onclick = function () { var b = this; spinBtn(b, true, 'Preparing PDF…'); api('generatePDFAlternative', S.report, {}).then(function (r) { spinBtn(b, false); if (!r.success) throw new Error(r.error); download(r.fileName, r.mimeType, r.base64, true); toast('PDF downloaded', 'ok'); }).catch(function (e) { spinBtn(b, false); fail(e); }); };
    $('#r-print').onclick = function () { window.print(); };
  }
  function renderReport(r) {
    var s = r.summary, titles = {}; SECTIONS.forEach(function (x) { titles[x[0]] = x[1]; });
    var lg = 'img/logo.png', hasLg = true;
    var h = '<div class="report-doc">' + (hasLg ? '<div style="text-align:center"><img alt="" src="' + lg + '" style="width:90px;height:90px"></div>' : '') + '<h2>IRIS case management report</h2><p style="text-align:center;color:#556">' + esc(r.period) + ' · generated ' + esc(r.generatedAt) + '</p><h3>Summary</h3><table><tbody>' +
      [['Cases in period', s.periodTotal], ['Closed', s.periodClosed], ['Still open', s.periodOpen], ['Closure rate', s.closureRate + '%'], ['Average days to close', s.avgClosureTime], ['SLA met', s.slaComplianceRate + '%']].map(function (x) { return '<tr><th style="width:55%">' + x[0] + '</th><td><b>' + esc(x[1]) + '</b></td></tr>'; }).join('') + '</tbody></table>';
    if (r.insights && r.insights.length) h += '<h3>Key patterns</h3><ul>' + r.insights.map(function (i) { return '<li>' + esc(i.text) + '</li>'; }).join('') + '</ul>';
    Object.keys(r.breakdowns).forEach(function (k) { var d = r.breakdowns[k], keys = Object.keys(d).sort(function (a, b) { return d[b].count - d[a].count; }); if (!keys.length) return; h += '<h3>' + esc(titles[k] || k) + '</h3><table><thead><tr><th>Category</th><th>Cases</th><th>Share</th></tr></thead><tbody>' + keys.map(function (c) { return '<tr><td>' + esc(c) + '</td><td>' + d[c].count + '</td><td>' + d[c].percentage + '%</td></tr>'; }).join('') + '</tbody></table>'; });
    $('#reportOut').innerHTML = h + '</div>';
    $('#reportOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- admin ----------
  var ADMIN_TABS = ['Analysts', 'Stations', 'Divisions', 'CrimeTypes', 'Users', 'Settings', 'Broadcast'], ADMIN_LABEL = { Analysts: 'Analysts', Stations: 'Stations', Divisions: 'Divisions', CrimeTypes: 'Crime types', Users: 'Users', Settings: 'Detection settings', Broadcast: 'Messages' };
  function loadAdmin() {
    $('#adminTabs').innerHTML = ADMIN_TABS.map(function (t) { return '<button class="tab" role="tab" data-sheet="' + t + '" aria-selected="' + (t === S.adminSheet) + '">' + ADMIN_LABEL[t] + '</button>'; }).join('');
    $('#adminAdd').hidden = S.adminSheet === 'Settings' || S.adminSheet === 'Broadcast'; $('#adminAdd').lastChild.textContent = 'Add row';
    if (S.adminSheet === 'Users') return loadUsers();
    if (S.adminSheet === 'Broadcast') return loadBroadcast();
    api('getSheetData', S.adminSheet).then(function (r) {
      if (r.error) throw new Error(r.error); S.adminData = r;
      if (!r.data.length) { $('#adminTable').innerHTML = '<div class="empty"><b>Nothing here yet</b>Add the first row.</div>'; return; }
      var st = S.adminSheet === 'Settings';
      $('#adminTable').innerHTML = '<table class="t"><thead><tr>' + r.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '<th class="r">Actions</th></tr></thead><tbody>' +
        r.data.map(function (row, i) { return '<tr>' + row.map(function (v) { return '<td>' + (v === true ? '<span class="chip good">Active</span>' : v === false ? '<span class="chip">Inactive</span>' : esc(v)) + '</td>'; }).join('') + '<td class="r" style="white-space:nowrap"><button class="btn btn-sm" data-edit="' + i + '">' + icon('edit') + 'Edit</button>' + (st ? '' : ' <button class="btn btn-sm" data-del="' + i + '">Delete</button>') + '</td></tr>'; }).join('') + '</tbody></table>';
    }).catch(fail);
  }
  function rowDialog(idx) {
    var r = S.adminData, row = idx == null ? r.headers.map(function () { return ''; }) : r.data[idx], sheet = S.adminSheet, st = sheet === 'Settings';
    var fields = r.headers.map(function (h, i) {
      var v = row[i], id = 'ad' + i, lock = st && i !== 1;
      if (sheet === 'Users' && /role/i.test(h)) return '<div class="field"><label for="' + id + '">' + esc(h) + '</label><select id="' + id + '">' + ['user', 'supervisor', 'admin', 'superadmin'].map(function (x) { return '<option' + (x === v ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div>';
      if (sheet === 'Users' && /active/i.test(h)) return '<div class="field"><label for="' + id + '">' + esc(h) + '</label><select id="' + id + '"><option value="true"' + (v !== false ? ' selected' : '') + '>Active</option><option value="false"' + (v === false ? ' selected' : '') + '>Inactive</option></select></div>';
      return '<div class="field"><label for="' + id + '">' + esc(h) + '</label><input type="' + (st && i === 1 ? 'number' : 'text') + '" step="any" id="' + id + '" value="' + esc(v) + '"' + (lock ? ' readonly' : '') + '></div>';
    }).join('');
    openModal('<div class="dialog-head"><h2 id="modalTitle">' + (idx == null ? 'Add to ' : 'Edit ') + esc(ADMIN_LABEL[sheet]) + '</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><div class="form-grid" style="grid-template-columns:1fr">' + fields + '</div></div><div class="dialog-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ad-save">Save</button></div>', { cls: 'narrow' });
    $('#ad-save').onclick = function () {
      var vals = r.headers.map(function (h, i) { var e = $('#ad' + i), v = e.value; if (sheet === 'Users' && /active/i.test(h)) return v === 'true'; if (st && i === 1) return parseFloat(v); return v.trim(); });
      var b = this; spinBtn(b, true, 'Saving…');
      (idx == null ? api('addSheetRow', sheet, vals) : api('updateSheetRow', sheet, idx, vals, row[0])).then(function (x) { spinBtn(b, false); if (!x.success) throw new Error(x.error || 'Could not save'); closeModal(); toast('Saved', 'ok'); refreshInit().then(loadAdmin); }).catch(function (e) { spinBtn(b, false); fail(e); });
    };
  }
  function delDialog(i) {
    var row = S.adminData.data[i];
    openModal('<div class="dialog-head"><h2 id="modalTitle">Delete this row?</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><p><b>' + esc(row[0]) + '</b> will be removed from ' + esc(ADMIN_LABEL[S.adminSheet]) + '. Existing cases keep their text.</p></div><div class="dialog-foot"><button class="btn" data-close>Keep it</button><button class="btn btn-danger" id="ad-del">Delete row</button></div>', { cls: 'narrow' });
    $('#ad-del').onclick = function () { var b = this; spinBtn(b, true, 'Deleting…'); api('deleteSheetRow', S.adminSheet, i, row[0]).then(function (x) { spinBtn(b, false); if (!x.success) throw new Error(x.error); closeModal(); toast('Row deleted', 'ok'); refreshInit().then(loadAdmin); }).catch(function (e) { spinBtn(b, false); fail(e); }); };
  }
  function refreshInit() { return api('getInitData').then(function (d) { S.init = d; formReady = false; filtersReady = false; }); }
  $('#adminTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-sheet]'); if (b) { S.adminSheet = b.dataset.sheet; loadAdmin(); } });
  $('#adminAdd').onclick = function () { if (S.adminSheet === 'Users') userDialog(null); else rowDialog(null); };
  $('#adminTable').addEventListener('click', function (e) { var b = e.target.closest('[data-edit],[data-del]'); if (!b) return; if (b.dataset.edit != null) rowDialog(+b.dataset.edit); else delDialog(+b.dataset.del); });

  // ---------- audit ----------
  var auditPage = 1;
  function loadAudit() {
    api('getAuditLog', { q: $('#aq').value.trim(), page: auditPage, pageSize: 50 }).then(function (r) {
      $('#auditTable').innerHTML = r.rows.length ? '<table class="t"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Case</th><th>Field</th><th>Details</th></tr></thead><tbody>' + r.rows.map(function (x) { return '<tr><td class="num" style="white-space:nowrap">' + esc(x.at) + '</td><td>' + esc(x.user) + '</td><td><span class="chip">' + esc(x.action) + '</span></td><td class="case-no">' + esc(x.caseNumber) + '</td><td>' + esc(x.field) + '</td><td>' + esc(x.details) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty"><b>No entries</b>Nothing matches that search.</div>';
      var pages = Math.max(1, Math.ceil(r.total / 50));
      $('#auditPager').innerHTML = '<span>' + plural(r.total, 'entry', 'entries') + ' · page ' + auditPage + ' of ' + pages + '</span><span class="actions"><button class="btn btn-sm" id="apP"' + (auditPage <= 1 ? ' disabled' : '') + '>Previous</button><button class="btn btn-sm" id="apN"' + (auditPage >= pages ? ' disabled' : '') + '>Next</button></span>';
      $('#apP').onclick = function () { auditPage--; loadAudit(); }; $('#apN').onclick = function () { auditPage++; loadAudit(); };
    }).catch(fail);
  }
  $('#aq').addEventListener('input', debounce(function () { auditPage = 1; loadAudit(); }, 300));

  // ---------- quick find ----------
  var cmdItems = [], cmdSel = 0;
  function openCmd() { modalFocus = document.activeElement; $('#cmd').classList.add('on'); $('#scrim').classList.add('on'); $('#cmdInput').value = ''; cmdRender(''); $('#cmdInput').focus(); }
  function closeCmd() { $('#cmd').classList.remove('on'); if (!$('#drawer').classList.contains('on') && !$('#modal').classList.contains('on')) $('#scrim').classList.remove('on'); }
  function cmdRender(q) {
    var pages = Object.keys(TITLES).filter(allowed).filter(function (k) { return TITLES[k].toLowerCase().indexOf(q.toLowerCase()) > -1; }).map(function (k) { return { t: 'Go to ' + TITLES[k], k: 'page', v: k }; });
    cmdItems = q.length >= 2 ? pages.concat(cmdItems.filter(function (x) { return x.k === 'case'; })) : pages; cmdSel = 0; cmdPaint();
    if (q.length >= 2) api('searchCasesPaged', { q: q, page: 1, pageSize: 6 }).then(function (r) { if ($('#cmdInput').value !== q) return; cmdItems = pages.concat(r.rows.map(function (c) { return { t: c.caseNumber + ' · ' + c.crimeType, s: c.station + ' · ' + c.requestor, k: 'case', v: c.caseNumber }; })); cmdPaint(); }).catch(function () { });
  }
  function cmdPaint() { $('#cmdList').innerHTML = cmdItems.length ? cmdItems.map(function (x, i) { return '<div class="cmd-opt" role="option" data-i="' + i + '" aria-selected="' + (i === cmdSel) + '"><span>' + esc(x.t) + '</span><small>' + esc(x.s || (x.k === 'page' ? 'Page' : '')) + '</small></div>'; }).join('') : '<div class="empty">No matches.</div>'; }
  function cmdRun(i) { var x = cmdItems[i]; if (!x) return; closeCmd(); if (x.k === 'page') go(x.v); else openCase(x.v); }
  $('#cmdInput').addEventListener('input', debounce(function () { cmdRender(this.value.trim()); }, 150));
  $('#cmdInput').addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { cmdSel = Math.min(cmdItems.length - 1, cmdSel + 1); cmdPaint(); e.preventDefault(); } else if (e.key === 'ArrowUp') { cmdSel = Math.max(0, cmdSel - 1); cmdPaint(); e.preventDefault(); } else if (e.key === 'Enter') cmdRun(cmdSel); });
  $('#cmdList').addEventListener('click', function (e) { var o = e.target.closest('[data-i]'); if (o) cmdRun(+o.dataset.i); });
  $('#cmd').addEventListener('mousedown', function (e) { if (e.target.id === 'cmd') closeCmd(); });
  $('#cmdOpen').onclick = openCmd;

  // ---------- chrome wiring ----------
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmd(); }
    if (e.key === 'Escape') { if ($('#cmd').classList.contains('on')) closeCmd(); else if ($('#modal').classList.contains('on')) closeModal(); else if ($('#drawer').classList.contains('on')) closeDrawer(); else $('#sidebar').classList.remove('on'); }
  });
  $('#scrim').onclick = function () { if ($('#modal').classList.contains('on')) closeModal(); else if ($('#cmd').classList.contains('on')) closeCmd(); else { closeDrawer(); $('#sidebar').classList.remove('on'); $('#scrim').classList.remove('on'); } };
  $('#nav').addEventListener('click', function (e) { var b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });
  $('#menuBtn').onclick = function () { $('#sidebar').classList.add('on'); $('#scrim').classList.add('on'); };
  $('#bellBtn').onclick = function () { IRISNotify.openPanel(openModal, closeModal, go); };
  $('#userBtn').onclick = openAccount;
  document.addEventListener('click', function (e) { var n = e.target.closest && e.target.closest('.notif[data-case]'); if (n) { var no = n.dataset.case; closeModal(); openCase(no); } });
  $('#dashRefresh').onclick = loadDashboard; $('#alertRefresh').onclick = loadAlerts;
  $('#patTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) { S.pat.tab = b.dataset.tab; renderPatTab(); } });
  $('#pat-window').onchange = function () { S.pat.window = +this.value; loadPatterns(); };
  $$('[data-basis]').forEach(function (b) { b.onclick = function () { S.pat.basis = b.dataset.basis; $$('[data-basis]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); loadPatterns(); }; });
  $$('[data-af]').forEach(function (b) { b.onclick = function () { S.alertFilter = b.dataset.af; $$('[data-af]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); loadAlerts(); }; });
  function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('iris-theme', t); } catch (e) { } }
  $('#themeBtn').onclick = function () { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); if (S.view === 'patterns') renderPatTab(); };
  (function () { var t = null; try { t = localStorage.getItem('iris-theme'); } catch (e) { } if (!t && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) t = 'dark'; if (t) document.documentElement.setAttribute('data-theme', t); })();

  // ---------- recent cases: everything logged in the last 24 hours ----------
  var TZ = 'America/Port_of_Spain';
  function dayKey(d) { return d.toLocaleDateString('en-CA', { timeZone: TZ }); }
  function fmtLogged(iso, fallbackDate) {
    if (!iso) return fallbackDate ? 'Received ' + fmtShort(fallbackDate) : '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var now = new Date(), t = d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    var y = new Date(now.getTime() - 86400000);
    return (dayKey(d) === dayKey(now) ? 'Today ' : dayKey(d) === dayKey(y) ? 'Yesterday ' : fmtShort(dayKey(d)) + ' ') + t;
  }
  function renderRecent(rows, hours, offline) {
    var box = $('#dashRecent'), n = (rows || []).length;
    $('#recentSub').textContent = (offline ? 'Your own recent cases saved on this device' : 'Every case logged in the last ' + (hours || 24) + ' hours') + (n ? ' · ' + plural(n, 'case') : '');
    if (!n) { box.innerHTML = '<div class="empty"><b>' + (offline ? 'Nothing saved on this device yet' : 'No cases logged in the last ' + (hours || 24) + ' hours') + '</b>' + (offline ? 'Your recent cases appear here after you have used IRIS online.' : 'New requests appear here as soon as they are saved.') + '</div>'; return; }
    box.innerHTML = '<table class="t"><thead><tr><th scope="col">Case</th><th scope="col">Station</th><th scope="col">Analyst</th><th scope="col">Crime type</th><th scope="col">Request</th><th scope="col">Logged</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr' + (offline ? '' : ' class="click" tabindex="0" data-case="' + esc(r.caseNumber) + '"') + '><td class="case-no">' + esc(r.caseNumber) + '</td><td>' + esc(r.station || '—') + '</td><td>' + esc(r.analyst) + '</td><td>' + esc(r.crimeType) + '</td><td><span class="chip">' + esc(r.requestType) + '</span></td><td class="when num">' + esc(fmtLogged(r.createdAt, r.dateReceived)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function loadOfflineDashboard() {
    $('#dashSub').textContent = 'You are offline. Showing what is saved on this device.';
    ['#kpis', '#dashWeekly', '#dashUrgent', '#dashPriority', '#dashPatterns'].forEach(function (s) { $(s).innerHTML = ''; });
    $('#dashPatternsCard').hidden = true;
    $('#kpis').innerHTML = '<div class="card card-pad" style="grid-column:1/-1"><b>Offline</b><p class="muted" style="margin-top:6px">Charts and totals need a connection. You can still start new requests. They are saved on this device and sent automatically.</p></div>';
    IRISAPI.call('getRecentCases').then(function (rows) { renderRecent(rows, 24, true); }).catch(function () { renderRecent([], 24, true); });
  }
  function recordFacts(c) {
    var by = function (u, at) { return u ? esc(u) + (at ? ' · ' + esc(at) : '') : '<span class="muted">—</span>'; };
    return '<h3 class="section-h">Record</h3><dl class="facts"><div class="fact"><dt>Created by</dt><dd>' + by(c['Created By'], c['Created At']) + '</dd></div><div class="fact"><dt>Last changed by</dt><dd>' + by(c['Modified By'], c['Modified At']) + '</dd></div></dl>';
  }
  function reopenDialog(c) {
    openModal('<div class="dialog-head"><h2 id="modalTitle">Reopen case ' + esc(c['Case Number']) + '</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><p class="muted" style="margin-bottom:12px">The case goes back to Open. The reason is added to the case history and the owner and supervisors are told.</p><div class="field"><label for="ro-reason">Reason for reopening <span class="req">*</span></label><textarea id="ro-reason" style="min-height:90px" maxlength="500"></textarea></div><div class="callout" id="ro-err" role="alert" hidden style="margin-top:10px;border-left-color:var(--crit-edge);background:var(--crit-soft)"></div></div><div class="dialog-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ro-ok">Reopen case</button></div>', { cls: 'narrow' });
    $('#ro-ok').onclick = function () {
      var why = $('#ro-reason').value.trim(), b = this;
      if (why.length < 5) { var e = $('#ro-err'); e.hidden = false; e.textContent = 'Enter a reason (at least 5 characters).'; return; }
      spinBtn(b, true, 'Reopening…');
      api('reopenCase', c['Case Number'], why).then(function (r) {
        spinBtn(b, false); if (!r.success) { var e = $('#ro-err'); e.hidden = false; e.textContent = r.error || 'Could not reopen the case.'; return; }
        closeModal(); closeDrawer(); toast('Case ' + c['Case Number'] + ' reopened', 'ok'); refreshCurrent();
      }).catch(function (e) { spinBtn(b, false); fail(e); });
    };
  }

  // ---------- administration: users and messages ----------
  var ROLE_OPTS = ['user', 'supervisor', 'admin', 'superadmin'];
  function loadUsers() {
    $('#adminAdd').hidden = false; $('#adminAdd').lastChild.textContent = 'Add user';
    api('userList').then(function (r) {
      S.users = r.users;
      if (!r.users.length) { $('#adminTable').innerHTML = '<div class="empty"><b>No accounts yet</b>Add the first user.</div>'; return; }
      $('#adminTable').innerHTML = '<table class="t"><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Limited to</th><th>Status</th><th>Last sign-in</th><th class="r">Actions</th></tr></thead><tbody>' +
        r.users.map(function (u, i) {
          var scope = [u.scopeDivision, u.scopeStation].filter(Boolean).join(' / ') || 'Everything';
          var st = (u.active ? '<span class="chip good">Active</span>' : '<span class="chip">Inactive</span>') + (u.locked ? ' <span class="chip lock">Locked</span>' : '') + (!u.hasPassword ? ' <span class="chip warn">No password</span>' : u.mustChange ? ' <span class="chip info">Must change password</span>' : '');
          return '<tr><td class="strong">' + esc(u.username) + '</td><td>' + esc(u.name) + '</td><td>' + esc(ROLE_LABEL[u.role] || u.role) + '</td><td>' + esc(scope) + '</td><td>' + st + '</td><td class="num">' + esc(u.lastLogin || 'Never') + '</td><td class="r"><div class="user-actions"><button class="btn btn-sm" data-ua="edit" data-i="' + i + '">Edit</button><button class="btn btn-sm" data-ua="reset" data-i="' + i + '">Reset password</button>' + (u.locked ? '<button class="btn btn-sm" data-ua="unlock" data-i="' + i + '">Unlock</button>' : '') + '<button class="btn btn-sm" data-ua="delete" data-i="' + i + '">Delete</button></div></td></tr>';
        }).join('') + '</tbody></table>';
    }).catch(fail);
  }
  $('#adminTable').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ua]'); if (!b) return; var u = S.users[+b.dataset.i];
    if (b.dataset.ua === 'edit') userDialog(u);
    else if (b.dataset.ua === 'reset') confirmDialog('Reset password for ' + u.username + '?', 'A new temporary password is created and shown once. ' + (u.name || u.username) + ' is signed out everywhere and must choose a new password.', 'Reset password', function (done) { api('userResetPassword', u.username).then(function (r) { done(); if (!r.success) throw new Error(r.error); tempDone(r, 'Password reset'); loadUsers(); }).catch(function (x) { done(); fail(x); }); });
    else if (b.dataset.ua === 'unlock') api('userUnlock', u.username).then(function (r) { if (!r.success) throw new Error(r.error); toast(u.username + ' unlocked', 'ok'); loadUsers(); }).catch(fail);
    else if (b.dataset.ua === 'delete') confirmDialog('Delete ' + u.username + '?', 'The account is removed and signed out at once. Cases they created stay in IRIS. To keep the account but stop it being used, choose Edit and set it to Inactive.', 'Delete account', function (done) { api('userDelete', u.username).then(function (r) { done(); if (!r.success) throw new Error(r.error); toast('Account deleted', 'ok'); loadUsers(); }).catch(function (x) { done(); fail(x); }); });
  }, true);
  function confirmDialog(title, text, okLabel, run) {
    openModal('<div class="dialog-head"><h2 id="modalTitle">' + esc(title) + '</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><p>' + esc(text) + '</p></div><div class="dialog-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="cf-ok">' + esc(okLabel) + '</button></div>', { cls: 'narrow' });
    $('#cf-ok').onclick = function () { var b = this; spinBtn(b, true, 'Working…'); run(function () { closeModal(); }); };
  }
  function opt(list, sel, blank) { return (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (v) { return '<option' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join(''); }
  function userDialog(u) {
    var L = S.init.lookups, isNew = !u; u = u || { username: '', name: '', role: 'user', contactEmail: '', userId: '', scopeDivision: '', scopeStation: '', active: true };
    var roles = ROLE_OPTS.filter(function (r) { return r !== 'superadmin' || S.user.role === 'superadmin'; });
    var canEdit = u.role !== 'superadmin' || S.user.role === 'superadmin';
    openModal('<div class="dialog-head"><h2 id="modalTitle">' + (isNew ? 'Add user' : 'Edit ' + esc(u.username)) + '</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><div class="callout" id="us-err" role="alert" hidden style="margin-bottom:12px;border-left-color:var(--crit-edge);background:var(--crit-soft)"></div><div class="form-grid" style="grid-template-columns:1fr 1fr">' +
      '<div class="field"><label for="us-username">Username</label><input type="text" id="us-username" value="' + esc(u.username) + '"' + (isNew ? '' : ' readonly') + ' autocomplete="off" autocapitalize="off"><span class="hint">3 to 32 letters, numbers, dot, dash or underscore.</span></div>' +
      '<div class="field"><label for="us-name">Full name</label><input type="text" id="us-name" value="' + esc(u.name) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="us-role">Role</label><select id="us-role">' + opt(roles, u.role) + '</select></div>' +
      '<div class="field"><label for="us-uid">User ID</label><input type="text" id="us-uid" value="' + esc(u.userId) + '" autocomplete="off"><span class="hint">Stamped on case notes. Leave blank to use the username.</span></div>' +
      '<div class="field"><label for="us-div">Limit to division</label><select id="us-div">' + opt(L.divisions, u.scopeDivision, 'All divisions') + '</select><span class="hint">Applies to Analysts and Supervisors only.</span></div>' +
      '<div class="field"><label for="us-stn">Limit to station</label><select id="us-stn">' + opt(L.stations, u.scopeStation, 'All stations') + '</select></div>' +
      '<div class="field"><label for="us-mail">Contact email (optional)</label><input type="text" id="us-mail" value="' + esc(u.contactEmail) + '" autocomplete="off"></div>' +
      (isNew ? '' : '<div class="field"><label for="us-act">Account</label><select id="us-act"><option value="true"' + (u.active ? ' selected' : '') + '>Active</option><option value="false"' + (u.active ? '' : ' selected') + '>Inactive</option></select></div>') +
      '</div></div><div class="dialog-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="us-save"' + (canEdit ? '' : ' disabled') + '>' + (isNew ? 'Create account' : 'Save changes') + '</button></div>');
    $('#us-save').onclick = function () {
      var b = this, d = { name: $('#us-name').value.trim(), role: $('#us-role').value, userId: $('#us-uid').value.trim(), scopeDivision: $('#us-div').value, scopeStation: $('#us-stn').value, contactEmail: $('#us-mail').value.trim() };
      spinBtn(b, true, 'Saving…'); var p;
      if (isNew) { d.username = $('#us-username').value.trim().toLowerCase(); p = api('userCreate', d); } else { d.active = $('#us-act').value === 'true'; p = api('userUpdate', u.username, d); }
      p.then(function (r) {
        spinBtn(b, false); if (!r.success) { var e = $('#us-err'); e.hidden = false; e.textContent = r.error || 'Could not save.'; return; }
        closeModal(); if (isNew) tempDone(r, 'Account created'); else toast('Saved', 'ok'); loadUsers();
      }).catch(function (x) { spinBtn(b, false); fail(x); });
    };
  }
  /** If the server emailed the temporary password, say so and do not show it. Otherwise show it once. */
  function tempDone(r, title) {
    if (r.emailed) { openModal('<div class="dialog-head"><h2 id="modalTitle">' + esc(title) + '</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><div class="temp-box"><p><b>Username:</b> ' + esc(r.username) + '</p><p>The temporary password was emailed to <b>' + esc(r.emailedTo) + '</b>. It is not shown here. If it does not arrive, ask them to check their spam folder, or reset the password again.</p></div></div><div class="dialog-foot"><button class="btn btn-primary" data-close>Done</button></div>', { cls: 'narrow' }); return; }
    tempDialog(r.username, r.tempPassword, title);
  }
  /** The temporary password is shown once. It stays hidden until the administrator chooses Show. */
  function tempDialog(username, temp, title) {
    openModal('<div class="dialog-head"><h2 id="modalTitle">' + esc(title) + '</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><div class="temp-box"><p><b>Username:</b> ' + esc(username) + '</p><div class="pw-row">' + IRISUI.pwField('tp-pw', 'Temporary password', { readonly: true, value: temp, autocomplete: 'off' }) + '<button class="btn" id="tp-copy" style="align-self:flex-end">Copy</button></div></div><p class="muted" style="margin-top:12px">This password is shown only now and is not stored anywhere readable. Give it to the person directly. They must choose their own password the first time they sign in.</p></div><div class="dialog-foot"><button class="btn btn-primary" data-close>I have noted it</button></div>', { cls: 'narrow' });
    $('#tp-copy').onclick = function () { var v = $('#tp-pw').value; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Copied', 'ok'); }, function () { var i = $('#tp-pw'); i.type = 'text'; i.select(); toast('Press Ctrl C to copy', ''); }); };
  }
  function loadBroadcast() {
    $('#adminAdd').hidden = true; var L = S.init.lookups;
    $('#adminTable').innerHTML = '<div class="stack" style="max-width:640px"><div><h3>Send a message to everyone, or a group</h3><p class="muted">It appears in each person\'s alert bell. Do not put case details or names in a message.</p></div>' +
      '<div class="field"><label for="bc-title">Title</label><input type="text" id="bc-title" maxlength="120" autocomplete="off"></div><div class="field"><label for="bc-msg">Message</label><textarea id="bc-msg" maxlength="380" style="min-height:90px"></textarea></div>' +
      '<div class="field"><label for="bc-aud">Send to</label><select id="bc-aud"><option value="all">Everyone</option><option value="role:user">Analysts</option><option value="role:supervisor">Supervisors</option><option value="role:admin">Administrators</option>' + L.divisions.map(function (d) { return '<option value="division:' + esc(d) + '">Division ' + esc(d) + '</option>'; }).join('') + '</select></div>' +
      '<div class="actions"><button class="btn btn-primary" id="bc-send">Send message</button><button class="btn" id="bc-scan">Check for new alerts now</button></div></div>';
    $('#bc-send').onclick = function () { var b = this; spinBtn(b, true, 'Sending…'); api('notifBroadcast', $('#bc-title').value, $('#bc-msg').value, $('#bc-aud').value).then(function (r) { spinBtn(b, false); if (!r.success) throw new Error(r.error); toast('Sent to ' + plural(r.recipients, 'person', 'people'), 'ok'); $('#bc-title').value = ''; $('#bc-msg').value = ''; }).catch(function (e) { spinBtn(b, false); fail(e); }); };
    $('#bc-scan').onclick = function () { var b = this; spinBtn(b, true, 'Checking…'); api('alertsScan').then(function (r) { spinBtn(b, false); toast('New alerts: ' + r.overdue + ' overdue, ' + r.spikes + ' spikes, ' + r.hotspots + ' hotspots', 'ok'); }).catch(function (e) { spinBtn(b, false); fail(e); }); };
  }

  // ---------- your account, password, drafts, sign out ----------
  var IDLE_MS = 20 * 60000, WARN_MS = 18 * 60000, lastAct = Date.now(), warnOpen = false, expWarned = false;
  function lastApiAt() { return parseInt(sessionStorage.getItem('iris_last_api') || '0', 10) || 0; }
  function toLogin(q) { location.replace('login.html' + (q ? '?' + q : '')); }
  function endSession(why) {
    var keep = why !== 'out';
    return IRISAPI.endSession(keep).then(function () { toLogin(why === 'out' ? 'out=1' : 'expired=1'); }, function () { toLogin(why === 'out' ? 'out=1' : 'expired=1'); });
  }
  function signOut() {
    IRISAPI.queueCounts().then(function (c) {
      var n = c.waiting + c.failed;
      if (!n) return endSession('out');
      confirmDialog('Sign out and delete unsent work?', plural(n, 'request') + ' saved on this device ' + (n === 1 ? 'has' : 'have') + ' not been sent yet. Signing out deletes ' + (n === 1 ? 'it' : 'them') + ' from this device. Stay signed in and connect to the internet to send ' + (n === 1 ? 'it' : 'them') + '.', 'Delete and sign out', function () { endSession('out'); });
    });
  }
  function openAccount() {
    var u = S.user;
    openModal('<div class="dialog-head"><h2 id="modalTitle">Your account</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><dl class="facts"><div class="fact"><dt>Name</dt><dd>' + esc(u.name || u.username) + '</dd></div><div class="fact"><dt>Username</dt><dd>' + esc(u.username) + '</dd></div><div class="fact"><dt>Role</dt><dd>' + esc(ROLE_LABEL[u.role] || u.role) + '</dd></div>' + ((u.division || u.station) ? '<div class="fact"><dt>Limited to</dt><dd>' + esc([u.division, u.station].filter(Boolean).join(' / ')) + '</dd></div>' : '') + '</dl>' +
      '<div class="stack" style="margin-top:14px"><button class="btn" id="ac-pw">Change password</button><div id="ac-push"></div><button class="btn" id="ac-drafts">Requests waiting on this device</button></div></div><div class="dialog-foot"><button class="btn" data-close>Close</button><button class="btn btn-primary" id="ac-out">Sign out</button></div>', { cls: 'narrow' });
    $('#ac-pw').onclick = function () { closeModal(); passwordDialog(); };
    $('#ac-out').onclick = function () { closeModal(); signOut(); };
    $('#ac-drafts').onclick = function () { closeModal(); draftsDialog(); };
    paintPush();
  }
  function paintPush() {
    var box = $('#ac-push'); if (!box) return;
    if (navigator.onLine === false) { box.innerHTML = '<p class="muted small">Phone alerts can be changed when you are online.</p>'; return; }
    api('notifPrefsGet').then(function (p) {
      box.innerHTML = p.push ? '<button class="btn" id="ac-pushoff">Turn off phone alerts</button><p class="muted small" style="margin-top:6px">Phone alerts only say there is something new. They never show case details.</p>' : '<button class="btn" id="ac-pushon">Turn on phone alerts</button><p class="muted small" style="margin-top:6px">Your phone or browser will ask for permission. Alerts only say there is something new in IRIS.</p>';
      var on = $('#ac-pushon'), off = $('#ac-pushoff');
      if (on) on.onclick = function () { spinBtn(on, true, 'Turning on…'); IRISNotify.enablePush().then(function () { toast('Phone alerts are on', 'ok'); paintPush(); }).catch(function (e) { spinBtn(on, false); fail(e); }); };
      if (off) off.onclick = function () { IRISNotify.disablePush().then(function () { toast('Phone alerts are off', 'ok'); paintPush(); }).catch(fail); };
    }).catch(function () { });
  }
  function passwordDialog() {
    var U = IRISUI;
    openModal('<div class="dialog-head"><h2 id="modalTitle">Change password</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><div class="callout" id="pw-err" role="alert" hidden style="margin-bottom:12px;border-left-color:var(--crit-edge);background:var(--crit-soft)"></div><div class="stack">' +
      U.pwField('pw-old', 'Current password', { autocomplete: 'current-password' }) + U.pwField('pw-new', 'New password', { autocomplete: 'new-password', hint: 'At least 10 characters with a letter and a number.' }) + U.pwField('pw-new2', 'Type the new password again', { autocomplete: 'new-password' }) +
      '</div></div><div class="dialog-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pw-save">Change password</button></div>', { cls: 'narrow' });
    $('#pw-save').onclick = function () {
      var o = $('#pw-old').value, a = $('#pw-new').value, b2 = $('#pw-new2').value, err = $('#pw-err'), b = this;
      var bad = !o ? 'Enter your current password.' : IRISUI.passwordProblem(a, S.user.username) || (a !== b2 ? 'The two new passwords do not match.' : '') || (a === o ? 'Choose a different password from your current one.' : '');
      if (bad) { err.hidden = false; err.textContent = bad; return; }
      spinBtn(b, true, 'Saving…');
      api('changePassword', o, a).then(function (r) {
        spinBtn(b, false); if (!r.success) { err.hidden = false; err.textContent = r.error || 'Could not change the password.'; return; }
        IRISAPI.setSession(r.token, r.sk, r.user); closeModal(); toast('Password changed', 'ok');
      }).catch(function (e) { spinBtn(b, false); fail(e); });
    };
  }
  function draftsDialog() {
    IRISAPI.readDrafts().then(function (list) {
      var body = list.length ? list.map(function (d, i) {
        var a = d.job.args[0] || {};
        return '<div class="notif ' + (d.failed ? 'critical unread' : '') + '"><div class="notif-top"><span class="chip ' + (d.failed ? 'crit' : 'info') + '">' + (d.failed ? 'Needs attention' : 'Waiting to send') + '</span><time>' + esc(d.job.at ? new Date(d.job.at).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') + '</time></div><div class="notif-title">' + esc(a.crimeType || 'New request') + ' · ' + esc(a.station || '') + '</div>' + (d.failed ? '<div class="notif-msg">' + esc(d.job.error || '') + '</div>' : '') + '<div style="margin-top:6px"><button class="btn btn-sm" data-dd="' + esc(d.key) + '">Delete from this device</button></div></div>';
      }).join('') : '<div class="empty"><b>Nothing waiting</b>Everything you saved has been sent.</div>';
      openModal('<div class="dialog-head"><h2 id="modalTitle">Requests on this device</h2><button class="icon-btn" data-close aria-label="Close">' + icon('x') + '</button></div><div class="dialog-body"><div class="notif-list">' + body + '</div></div><div class="dialog-foot"><button class="btn" id="dd-send">Send now</button><button class="btn btn-primary" data-close>Close</button></div>', { cls: 'narrow' });
      $$('[data-dd]').forEach(function (b) { b.onclick = function () { IRISAPI.discardDraft(b.dataset.dd).then(function () { closeModal(); draftsDialog(); }); }; });
      $('#dd-send').onclick = function () { IRISAPI.flushQueue().then(function (r) { toast(r.sent ? plural(r.sent, 'request') + ' sent' : 'Nothing could be sent yet', r.sent ? 'ok' : ''); closeModal(); draftsDialog(); }); };
    });
  }
  function updateSync() {
    var chip = $('#syncChip'), off = navigator.onLine === false; $('#offBanner').hidden = !off;
    IRISAPI.queueCounts().then(function (c) {
      var txt = off ? 'Offline' + (c.waiting ? ' · ' + c.waiting + ' waiting' : '') : c.failed ? c.failed + ' need attention' : c.waiting ? c.waiting + ' waiting to send' : 'Synced';
      chip.className = 'sync-chip' + (off ? ' off' : (c.waiting || c.failed) ? ' wait' : ''); chip.querySelector('span').textContent = txt;
      chip.style.cursor = (c.waiting || c.failed) ? 'pointer' : 'default'; chip.onclick = (c.waiting || c.failed) ? draftsDialog : null;
    });
  }

  // ---------- idle sign-out (20 minutes, warning at 18) and the 4 hour limit ----------
  function stayIn() { lastAct = Date.now(); warnOpen = false; closeModal(); api('ping').catch(function () { }); }
  function idleTick() {
    var now = Date.now(), idle = now - lastAct, ti = IRISAPI.tokenInfo();
    if (!ti || ti.exp <= now) { endSession('expired'); return; }
    if (idle >= IDLE_MS) { endSession('expired'); return; }
    if (idle >= WARN_MS) {
      var left = Math.max(0, Math.ceil((IDLE_MS - idle) / 1000));
      if (!warnOpen) {
        warnOpen = true;
        openModal('<div class="dialog-head"><h2 id="modalTitle">Are you still there?</h2></div><div class="dialog-body"><p>For security you will be signed out in <b id="idleLeft">' + left + '</b> seconds because nothing has happened for a while. Unsent drafts stay safe on this device.</p></div><div class="dialog-foot"><button class="btn" id="idleOut">Sign out now</button><button class="btn btn-primary" id="idleStay">Stay signed in</button></div>', { cls: 'narrow' });
        $('#idleStay').onclick = stayIn; $('#idleOut').onclick = function () { warnOpen = false; closeModal(); signOut(); };
      } else { var el = $('#idleLeft'); if (el) el.textContent = left; }
    }
    if (ti.exp - now < 5 * 60000 && !expWarned) { expWarned = true; toast('For security IRIS signs everyone out after 4 hours. Save your work. You will be asked to sign in again soon.', ''); }
  }
  function activity() {
    if (warnOpen) return;
    lastAct = Date.now();
    if (navigator.onLine !== false && lastAct - lastApiAt() > 4 * 60000) { IRISAPI.call('ping').catch(function () { }); }   // keeps the server's idle clock in step with real use
  }
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function (ev) { document.addEventListener(ev, activity, { passive: true, capture: true }); });

  // ---------- boot ----------
  var bootTries = 0;
  function boot() {
    var ti = IRISAPI.tokenInfo();
    if (!ti || ti.exp <= Date.now()) { toLogin('expired=1'); return; }
    if (ti.scope === 'pwd') { toLogin(''); return; }
    IRISAPI.on('expired', function () { endSession('expired'); });
    IRISAPI.on('mustchange', function () { toLogin(''); });
    IRISAPI.on('offline', updateSync); IRISAPI.on('online', function () { updateSync(); toast('Back online', 'ok'); refreshCurrent(); }); IRISAPI.on('queue', updateSync);
    IRISAPI.on('sent', function (r) { toast('A request saved offline was sent' + (r && r.caseNumber ? ' as ' + r.caseNumber : ''), 'ok'); if (S.view === 'dashboard' || S.view === 'cases') go(S.view, false); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { });
    api('getInitData').then(function (d) {
      $('#boot').hidden = true; S.init = d; S.user = d.user;
      if (!d.user || d.user.role === 'no-access') { $('#denied').hidden = false; return; }
      $('#app').hidden = false;
      $('#uName').textContent = d.user.name || d.user.username; $('#uRole').textContent = ROLE_LABEL[d.user.role] || d.user.role;
      $('#avatar').textContent = (d.user.name || d.user.username || '?').trim().charAt(0).toUpperCase(); $('#sideUser').textContent = d.user.name || d.user.username; $('#sideVer').textContent = 'TTPS · v' + d.version;
      $$('[data-need]').forEach(function (e) { var need = e.dataset.need; if ((need === 'sup' && !isSup()) || (need === 'adm' && !isAdm())) e.hidden = true; });
      var start = (location.hash || '').replace('#', ''); go(TITLES[start] ? start : 'dashboard', false);
      if (navigator.onLine !== false) { pollAlerts(); IRISAPI.flushQueue(); IRISNotify.start(); }
      setInterval(pollAlerts, 5 * 60 * 1000); setInterval(idleTick, 5000); updateSync();
    }).catch(function (e) {
      if (e && (e.code === 'auth' || e.code === 'mustchange')) return;
      $('#boot').hidden = true; $('#denied').hidden = false; $('#denied').querySelector('h2').textContent = 'IRIS could not start'; $('#denied').querySelector('p').textContent = e.message;
    });
  }
  boot();
})();
