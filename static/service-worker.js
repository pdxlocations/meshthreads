const STATIC_CACHE = "meshthreads-static-v39";
const STATIC_ASSETS = [
  "/static/manifest.json",
  "/static/images/meshthreads.svg",
  "/static/images/meshthreads-mark-light.svg",
  "/static/images/meshthreads-mark-dark.svg",
  "/static/images/meshthreads-180.png",
  "/static/images/meshthreads-192.png",
  "/static/images/meshthreads-512.png",
  "/static/css/style.css",
  "/static/css/board.css",
  "/static/js/board.js",
  "/static/js/board-unread.js",
  "/static/js/node-panels.js",
  "/static/js/threads.js",
  "/static/js/theme.js",
  "/static/js/session-activity.js",
  "/static/js/admin.js",
  "/static/fonts/NunitoSans.ttf",
  "/static/images/favicon.svg",
  "/static/images/favicon-blk.svg",
  "/static/images/firefly.svg",
  "/static/images/firefly-logo-dark.png",
  "/static/images/firefly-logo-light.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== STATIC_CACHE)
          .map(cacheName => caches.delete(cacheName))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/static/")) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      // Prefer fresh source on every visit; cached assets are an offline fallback.
      if (cachedResponse) {
        return fetch(request).then(response => {
          if (response.ok) { const copy = response.clone(); caches.open(STATIC_CACHE).then(cache => cache.put(request, copy)); }
          return response.ok ? response : cachedResponse;
        }).catch(() => cachedResponse);
      }

      return fetch(request).then(networkResponse => {
        if (!networkResponse || !networkResponse.ok) {
          return networkResponse;
        }

        const responseCopy = networkResponse.clone();
        caches.open(STATIC_CACHE).then(cache => cache.put(request, responseCopy));
        return networkResponse;
      });
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  const requestedUrl = event.notification?.data?.url || "/";
  const targetUrl = new URL(requestedUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (!("focus" in client)) {
          continue;
        }
        if ("navigate" in client) {
          return client.navigate(targetUrl).then(() => client.focus());
        }
        return client.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
