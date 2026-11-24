/*
 * IRIS API layer.
 *  - IRISAPI.call(action, ...args) talks to the Apps Script web app (JSON over text/plain, so no browser pre-flight).
 *  - A small google.script.run shim lets the app screens call the same names they always did.
 *  - Offline: the user's own recent cases and the form lists are kept encrypted (AES-GCM) in IndexedDB. New requests
 *    typed while offline wait in an encrypted queue and are sent, in order, with their request ids, when the connection returns.
 *  - The encryption key comes from the server at sign-in and lives only in this tab's sessionStorage.
 */
(function () {
  var CFG = window.IRIS_CONFIG || {};
  var SS = window.sessionStorage;
  var K = { t: 'iris_t', sk: 'iris_sk', u: 'iris_u', pend: 'iris_pwd' };
  var CACHEABLE = { getInitData: 'init' };           // whole-reply cache (form lists only; no case data)
  var OWN_RECENT = 'recent';                          // the user's own recent cases, filtered before saving
  var QUEUEABLE = { saveCase: 1 };                    // what may be drafted offline
  var handlers = {};
  var flushing = false;

  function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
  function emit(ev, a) { (handlers[ev] || []).forEach(function (f) { try { f(a); } catch (e) { } }); }
  function sget(k) { try { return SS.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { SS.setItem(k, v); } catch (e) { } }
  function sdel(k) { try { SS.removeItem(k); } catch (e) { } }
  function newId() { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

  // ---------- session ----------
  function getToken() { return sget(K.t) || ''; }
  function getUser() { try { return JSON.parse(sget(K.u) || 'null'); } catch (e) { return null; } }
  function setSession(token, sk, user) { if (token) sset(K.t, token); if (sk) sset(K.sk, sk); if (user) sset(K.u, JSON.stringify(user)); }
  function tokenInfo() {
    try { var p = JSON.parse(atob(getToken().split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))); return { exp: p.exp, scope: p.s, user: p.u }; } catch (e) { return null; }
  }
  /** keepDrafts: idle or expired sessions keep unsent drafts (encrypted, unreadable without signing in again). Logout wipes everything. */
  function endSession(keepDrafts) {
    sdel(K.t); sdel(K.sk); sdel(K.u); sdel(K.pend);
    return (keepDrafts ? idb.delWhere(function (k) { return k.indexOf('q:') !== 0 && k.indexOf('f:') !== 0; }) : idb.clear());
  }

  // ---------- encrypted offline store ----------
  var idb = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        if (!window.indexedDB) return rej(new Error('no indexeddb'));
        var r = indexedDB.open('iris_offline', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    function tx(mode, fn) { return open().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('kv', mode), s = t.objectStore('kv'), out = fn(s); t.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); }; t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error); }; }); }); }
    return {
      get: function (k) { return tx('readonly', function (s) { return s.get(k); }); },
      set: function (k, v) { return tx('readwrite', function (s) { return s.put(v, k); }); },
      del: function (k) { return tx('readwrite', function (s) { return s.delete(k); }); },
      keys: function () { return tx('readonly', function (s) { return s.getAllKeys(); }).then(function (k) { return k || []; }); },
      clear: function () { return tx('readwrite', function (s) { return s.clear(); }).catch(function () { }); },
      delWhere: function (pred) { var self = this; return self.keys().then(function (ks) { return Promise.all(ks.filter(pred).map(function (k) { return self.del(k); })); }).catch(function () { }); }
    };
  })();
  function b64(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); }
  function unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function cryptoKey() {
    var sk = sget(K.sk); if (!sk) return Promise.reject(new Error('locked'));
    var raw = unb64(sk.replace(/-/g, '+').replace(/_/g, '/') + '===='.slice(0, (4 - sk.length % 4) % 4));
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  function seal(obj) {
    return cryptoKey().then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj))).then(function (ct) { return { iv: b64(iv), ct: b64(ct), u: (getUser() || {}).username }; });
    });
  }
  function unseal(rec) {
    return cryptoKey().then(function (key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct)); }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
  }
  function cachePut(name, obj) { return seal(obj).then(function (r) { r.at = Date.now(); return idb.set('c:' + name, r); }).catch(function () { }); }
  function cacheGet(name) {
    return idb.get('c:' + name).then(function (r) { var me = (getUser() || {}).username; return r && r.u === me ? unseal(r) : null; }).catch(function () { return null; });
  }

  // ---------- network ----------
  function isNetworkError(e) { return e && (e.name === 'TypeError' || e.isNetwork); }
  function post(action, args, clientId) {
    if (!CFG.API_URL) return Promise.reject(Object.assign(new Error('IRIS is not connected to its server yet. The administrator must set API_URL in js/config.js.'), { code: 'config' }));
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', credentials: 'omit',
      body: JSON.stringify({ action: action, token: getToken(), args: args || [], clientId: clientId || '' }) })
      .then(function (r) { if (!r.ok) { var e = new Error('The server did not answer (' + r.status + ').'); e.isNetwork = true; throw e; } return r.json(); });
  }
  function lastActivityNow() { sset('iris_last_api', String(Date.now())); }

  /** Main entry. Resolves with the action's data. Rejects with Error (error.code is set for auth problems). */
  function call(action, args, opts) {
    opts = opts || {};
    args = args || [];
    var clientId = opts.clientId || (action === 'login' || action === 'healthcheck' || action === 'ping' ? '' : newId());
    if (navigator.onLine === false) return offlineFallback(action, args, clientId);
    return post(action, args, clientId).then(function (r) {
      lastActivityNow();
      if (r.token) sset(K.t, r.token);
      if (!r.ok) {
        var err = new Error(r.error || 'Something went wrong.'); err.code = r.code;
        if (r.code === 'auth') emit('expired', err);
        if (r.code === 'mustchange') emit('mustchange', err);
        throw err;
      }
      afterOnline(action, args, r.data);
      return r.data;
    }, function (e) {
      if (isNetworkError(e)) { emit('offline'); return offlineFallback(action, args, clientId); }
      throw e;
    });
  }

  function afterOnline(action, args, data) {
    if (CACHEABLE[action]) cachePut(CACHEABLE[action], data);
    if (action === 'getRecentCases' && Array.isArray(data)) {
      var me = getUser() || {};
      cachePut(OWN_RECENT, data.filter(function (r) { return r.createdBy === me.username; }).slice(0, 50));
    }
    if (action === 'getDashboardData' && data && Array.isArray(data.recent)) {
      var u = getUser() || {};
      cachePut(OWN_RECENT, data.recent.filter(function (r) { return r.createdBy === u.username; }).slice(0, 50));
    }
  }

  function offlineFallback(action, args, clientId) {
    if (CACHEABLE[action]) return cacheGet(CACHEABLE[action]).then(function (d) { if (d) return d; throw offlineErr(); });
    if (action === 'getRecentCases') return cacheGet(OWN_RECENT).then(function (d) { return d || []; });
    if (QUEUEABLE[action]) return enqueue(action, args, clientId);
    if (action === 'ping') return Promise.resolve({ ok: false, offline: true });
    return Promise.reject(offlineErr());
  }
  function offlineErr() { var e = new Error('You are offline. You can look at your own recent cases and start new requests; everything else needs a connection.'); e.code = 'offline'; return e; }

  // ---------- drafts (queue) ----------
  var seq = 0;
  function enqueue(action, args, clientId) {
    var key = 'q:' + String(Date.now()).padStart(14, '0') + ':' + String(++seq).padStart(4, '0');
    return seal({ action: action, args: args, clientId: clientId, at: new Date().toISOString() }).then(function (rec) { return idb.set(key, rec); })
      .then(function () { emit('queue'); return { success: true, queued: true, message: 'Saved on this device. It will be sent when you are back online.' }; });
  }
  function listQueue() {
    var me = (getUser() || {}).username;
    return idb.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('q:') === 0 || k.indexOf('f:') === 0; }).sort().map(function (k) { return idb.get(k).then(function (r) { return { key: k, rec: r }; }); })); })
      .then(function (items) { return items.filter(function (x) { return x.rec && x.rec.u === me; }); }).catch(function () { return []; });
  }
  function queueCounts() { return listQueue().then(function (l) { return { waiting: l.filter(function (x) { return x.key[0] === 'q'; }).length, failed: l.filter(function (x) { return x.key[0] === 'f'; }).length }; }); }
  /** Sends waiting drafts one at a time, in the order they were made. Stops at the first connection problem. */
  function flushQueue() {
    if (flushing || navigator.onLine === false || !getToken()) return Promise.resolve({ sent: 0 });
    flushing = true; var sent = 0, failed = 0;
    return listQueue().then(function (items) {
      var waiting = items.filter(function (x) { return x.key[0] === 'q'; });
      return waiting.reduce(function (p, it) {
        return p.then(function (stop) {
          if (stop) return true;
          return unseal(it.rec).then(function (job) {
            return post(job.action, job.args, job.clientId).then(function (r) {
              if (r.token) sset(K.t, r.token);
              if (!r.ok) {
                if (r.code === 'auth') { emit('expired'); return true; }
                return seal(Object.assign(job, { error: r.error })).then(function (s) { s.u = it.rec.u; return idb.set('f:' + it.key.slice(2), s); }).then(function () { return idb.del(it.key); }).then(function () { failed++; return false; });
              }
              if (r.data && r.data.success === false) {
                return seal(Object.assign(job, { error: r.data.error || 'The server did not accept this request.' })).then(function (s) { return idb.set('f:' + it.key.slice(2), s); }).then(function () { return idb.del(it.key); }).then(function () { failed++; return false; });
              }
              sent++; return idb.del(it.key).then(function () { emit('sent', r.data); return false; });
            }, function () { return true; });
          }, function () { return true; });
        });
      }, Promise.resolve(false));
    }).then(function () { flushing = false; emit('queue'); return { sent: sent, failed: failed }; }, function () { flushing = false; return { sent: sent }; });
  }
  function discardDraft(key) { return idb.del(key).then(function () { emit('queue'); }); }
  function readDrafts() { return listQueue().then(function (items) { return Promise.all(items.map(function (it) { return unseal(it.rec).then(function (j) { return { key: it.key, failed: it.key[0] === 'f', job: j }; }, function () { return null; }); })); }).then(function (l) { return l.filter(Boolean); }); }

  window.addEventListener('online', function () { emit('online'); flushQueue(); });
  window.addEventListener('offline', function () { emit('offline'); });

  // ---------- google.script.run shim ----------
  function makeRunner(ok, bad) {
    return new Proxy({}, { get: function (t, name) {
      if (name === 'withSuccessHandler') return function (f) { return makeRunner(f, bad); };
      if (name === 'withFailureHandler') return function (f) { return makeRunner(ok, f); };
      return function () { var a = Array.prototype.slice.call(arguments); call(String(name), a).then(function (v) { if (ok) ok(v); }, function (e) { if (bad) bad(e); }); };
    } });
  }
  window.google = { script: { run: makeRunner(null, null) } };

  window.IRISAPI = { call: call, on: on, getToken: getToken, getUser: getUser, setSession: setSession, endSession: endSession, tokenInfo: tokenInfo,
    flushQueue: flushQueue, queueCounts: queueCounts, readDrafts: readDrafts, discardDraft: discardDraft, newId: newId, cacheGet: cacheGet, lastActivity: lastActivityNow,
    _idb: idb, _seal: seal, _unseal: unseal, K: K };
})();
