/*
 * IRIS alerts: the bell (main channel) and optional phone alerts.
 * Phone alerts are opt-in: permission is asked only when the person taps "Turn on phone alerts".
 * A phone alert never contains case details. It only says there is something new in IRIS.
 */
(function () {
  var CFG = window.IRIS_CONFIG || {}, esc = IRISUI.esc, A = IRISAPI;
  var FB_VER = '10.12.2', unread = 0, timer = null;

  function fmtWhen(iso) {
    try { var d = new Date(iso); return d.toLocaleString('en-GB', { timeZone: 'America/Port_of_Spain', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function setCount(n) {
    unread = n; var b = document.getElementById('bellCount'); if (!b) return;
    b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
    var btn = document.getElementById('bellBtn'); if (btn) btn.setAttribute('aria-label', n ? n + ' unread alerts' : 'Alerts');
  }
  function poll() { if (document.hidden || !A.getToken()) return Promise.resolve(); return A.call('notifList', [{ limit: 50 }]).then(function (r) { setCount(r.unread); return r; }).catch(function () { }); }
  function start() { poll(); clearInterval(timer); timer = setInterval(poll, 120000); document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); }); }

  var ICON = { CASE_ASSIGNED: 'Assigned to you', CASE_CLOSED: 'Case closed', CASE_REOPENED: 'Case reopened', OVERDUE: 'Overdue', SPIKE: 'Spike', HOTSPOT: 'Hotspot', LOCKOUT: 'Account locked', ACCOUNT_CREATED: 'New account', WEEKLY: 'Weekly summary', BROADCAST: 'Message' };

  /** Opens the alerts panel as a centred dialog using the app's own modal. */
  function openPanel(openModal, closeModal, go) {
    A.call('notifList', [{ limit: 50 }]).then(function (r) {
      setCount(r.unread);
      var list = r.items.length ? r.items.map(function (n) {
        return '<div class="notif ' + (n.read ? '' : 'unread ') + esc(n.severity) + '"' + (n.caseNumber ? ' data-case="' + esc(n.caseNumber) + '" tabindex="0" role="button"' : '') + '><div class="notif-top"><span class="chip ' + (n.severity === 'critical' ? 'crit' : n.severity === 'warning' ? 'warn' : '') + '">' + esc(ICON[n.type] || 'Alert') + '</span><time>' + esc(fmtWhen(n.at)) + '</time></div><div class="notif-title">' + esc(n.title) + '</div><div class="notif-msg">' + esc(n.message) + '</div></div>';
      }).join('') : '<div class="empty"><b>You are up to date</b>New alerts for you will appear here.</div>';
      openModal('<div class="dialog-head"><h2 id="modalTitle">Alerts</h2><button class="icon-btn" data-close aria-label="Close">×</button></div><div class="dialog-body"><div class="notif-list">' + list + '</div></div><div class="dialog-foot"><button class="btn" id="nf-more">Open alert centre</button><button class="btn" id="nf-read"' + (r.unread ? '' : ' disabled') + '>Mark all as read</button><button class="btn btn-primary" data-close>Close</button></div>', { cls: 'notif-dialog' });
      var rd = document.getElementById('nf-read'); if (rd) rd.onclick = function () { A.call('notifMarkRead', ['all']).then(function () { setCount(0); closeModal(); }); };
      document.getElementById('nf-more').onclick = function () { closeModal(); go('alerts'); };
    }).catch(function (e) { IRISUI.toast(e.message, 'err'); });
  }

  // ---------- phone alerts ----------
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function pushConfigured() { var f = CFG.FIREBASE || {}; return !!(f.apiKey && f.projectId && f.messagingSenderId && f.appId && CFG.VAPID_KEY); }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load the phone alert service.')); }; document.head.appendChild(s); }); }
  function messaging() {
    if (window.firebase && firebase.apps && firebase.apps.length) return Promise.resolve(firebase.messaging());
    return loadScript('https://www.gstatic.com/firebasejs/' + FB_VER + '/firebase-app-compat.js').then(function () { return loadScript('https://www.gstatic.com/firebasejs/' + FB_VER + '/firebase-messaging-compat.js'); })
      .then(function () { firebase.initializeApp(CFG.FIREBASE); return firebase.messaging(); });
  }
  /** Called only from a tap. */
  function enablePush() {
    if (!pushSupported()) return Promise.reject(new Error('This browser cannot receive phone alerts. On iPhone, add IRIS to the Home Screen first.'));
    if (!pushConfigured()) return Promise.reject(new Error('Phone alerts are not set up yet. Ask your administrator. Alerts inside IRIS still work.'));
    return Notification.requestPermission().then(function (p) {
      if (p !== 'granted') throw new Error('Phone alerts were not allowed. You can change this in your browser settings.');
      return navigator.serviceWorker.ready;
    }).then(function (reg) { return messaging().then(function (m) { return m.getToken({ vapidKey: CFG.VAPID_KEY, serviceWorkerRegistration: reg }); }); })
      .then(function (token) { if (!token) throw new Error('Could not turn on phone alerts.'); return A.call('deviceRegister', [token, /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'web']); });
  }
  function disablePush() {
    return A.call('notifPrefsSet', [{ push: false }]).then(function () { if (window.firebase && firebase.apps && firebase.apps.length) return firebase.messaging().deleteToken().catch(function () { }); });
  }
  window.IRISNotify = { start: start, poll: poll, setCount: setCount, openPanel: openPanel, enablePush: enablePush, disablePush: disablePush, pushSupported: pushSupported, pushConfigured: pushConfigured };
})();
