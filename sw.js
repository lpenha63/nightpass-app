// Trocado no build (copy-static.js). Em dev fica o literal, o que não faz mal.
const CACHE = 'nightpass-__APP_BUILD__';
const STATIC = ['/manifest.json', '/icon.svg'];
const OFFLINE_QUEUE_KEY = 'np-offline-queue';

// ── Install: pre-cache static assets ──────────────────────────────────
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return c.addAll(STATIC).catch(function() {});
    })
  );
  self.skipWaiting();
});

// ── Activate: purge old caches ─────────────────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── Fetch: network-first for app shell, stale-while-revalidate for CDN ─
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;

  var url = e.request.url;
  var isSameOrigin = url.startsWith(self.location.origin);
  var isCDN = url.includes('cdnjs.cloudflare.com') ||
              url.includes('cdn.jsdelivr.net') ||
              url.includes('fonts.googleapis.com') ||
              url.includes('fonts.gstatic.com');

  // CDN assets: cache-first (rarely change)
  if (isCDN) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(res) {
          if (res && res.ok) {
            var clone = res.clone();
            caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
          }
          return res;
        });
      })
    );
    return;
  }

  // Same-origin: network-first with cache fallback
  if (isSameOrigin) {
    e.respondWith(
      fetch(e.request).then(function(res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || new Response(
            '{"error":"offline"}',
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        });
      })
    );
    return;
  }
});

// ── Background sync: flush offline check-in queue ─────────────────────
self.addEventListener('sync', function(e) {
  if (e.tag === 'sync-checkins') {
    e.waitUntil(flushOfflineQueue());
  }
});

async function flushOfflineQueue() {
  var db = await openQueueDB();
  var tx = db.transaction('queue', 'readwrite');
  var store = tx.objectStore('queue');
  var items = await storeGetAll(store);

  for (var item of items) {
    try {
      var res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body
      });
      if (res.ok) {
        var delTx = db.transaction('queue', 'readwrite');
        delTx.objectStore('queue').delete(item.id);
      }
    } catch (err) {
      // keep in queue for next sync
    }
  }
}

function openQueueDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('np-queue', 1);
    req.onupgradeneeded = function(e) {
      e.target.result.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = reject;
  });
}

function storeGetAll(store) {
  return new Promise(function(resolve, reject) {
    var req = store.getAll();
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = reject;
  });
}

// ── Push notifications ─────────────────────────────────────────────────
self.addEventListener('push', function(e) {
  if (!e.data) return;
  try {
    var data = e.data.json();
    // Bolinha com numero no icone do app (padrao WhatsApp). O contador vem no payload
    // porque o service worker nao consulta o banco.
    if (typeof data.badge_count === 'number' && self.navigator && self.navigator.setAppBadge) {
      if (data.badge_count > 0) self.navigator.setAppBadge(data.badge_count);
      else if (self.navigator.clearAppBadge) self.navigator.clearAppBadge();
    }
    e.waitUntil(
      self.registration.showNotification(data.title || 'NightPass', {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag || 'np-notif',
        data: { url: data.url || '/' }
      })
    );
  } catch (err) {}
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cs) {
      for (var c of cs) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.focus();
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
