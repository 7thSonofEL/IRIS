/*
 * IRIS service worker (scope: this folder only).
 *  - App files: network first, then the saved copy, so the app opens offline and updates are picked up straight away.
 *  - The server (API) is never cached here. Cached case data lives only in the encrypted IndexedDB store.
 *  - Phone alerts: always show the same fixed sentence. Nothing from the message is displayed.
 */
var CACHE = 'iris-shell-v4';
var SHELL = ['./', 'login.html', 'index.html', 'css/app.css', 'css/brand.css', 'js/config.js', 'js/ui.js', 'js/api.js', 'js/notify.js', 'js/splash.js', 'js/app.js', 'js/login.js', 'img/logo.png', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () { }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () { return caches.match(req).then(function (m) { return m || caches.match('login.html'); }); }));
});

self.addEventListener('push', function (e) {
  e.waitUntil(self.registration.showNotification('IRIS', { body: 'New alert in IRIS, open the app', icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: 'iris-alert', renotify: true }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow('index.html');
  }));
});
