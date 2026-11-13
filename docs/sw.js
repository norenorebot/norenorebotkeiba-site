/* sw.js — 電波が切れた時の控え（2026-11-11）。
   いつもはネットから読み（サーバーに「変わった？」と聞く）、読めた分を手元に控える。
   読めない時（競馬場で電波が弱い・切れた）だけ、控えた分を出す。予想の中身は触らない。
   同じサイトの GET だけが対象（アクセス数のカウンターなど外のサイトは素通し）。 */
'use strict';
var CACHE = 'keiba-v7';

// 最初の起動で、ページの骨組みを控えておく（その時の表示は控えの仕組みが動く前に読まれているため）
// 版の印（?v=）は HTML の読み込みと同じにする。控えから探す時は ?v= を無視する
var SHELL = ['./', 'index.html', 'style.css?v=20261113a', 'counter.css', 'app.js?v=20261113a', 'race-picker.js?v=20261113a', 'counter.js', 'data/index.json', 'data/latest.json'];
self.addEventListener('install', function (ev) {
  self.skipWaiting();
  ev.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return fetch(u, { cache: 'no-cache' }).then(function (r) { if (r.ok) return c.put(new URL(u, self.location).href, r); }).catch(function () {});
    }));
  }));
});
self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // ブラウザの手元の古い分を使わず、毎回サーバーに「変わった？」を聞く（変わっていなければ中身は送られてこない）。
  // これが無いとサイトを更新しても古い app.js が残ることがある
  ev.respondWith(
    fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req.url.split('#')[0], copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req.url.split('#')[0]).then(function (hit) {
        return hit || caches.match(req.url.split('#')[0], { ignoreSearch: true });
      }).then(function (hit) {
        if (!hit && req.mode === 'navigate') return caches.match(new URL('index.html', self.location).href);
        return hit;
      }).then(function (hit) {
        return hit || new Response('オフラインです（この画面はまだ控えがありません）', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      });
    })
  );
});
