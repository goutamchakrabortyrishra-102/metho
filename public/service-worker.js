// Service worker for METHO AAY-UPAY PWA
// Minimal caching so shell + static assets load offline. API calls always go to network.
const CACHE_NAME = "metho-aayupay-v3";
const STATIC_ASSETS = ["/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache API calls
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  // HTML/navigation should be network-only so new deploys are visible immediately.
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(fetch(event.request));
    return;
  }

  // JS/CSS should also prefer network to avoid stale bundle issues.
  if (event.request.destination === "script" || event.request.destination === "style") {
    event.respondWith(
      fetch(event.request)
    );
    return;
  }

  // Images/fonts can stay cache-first for faster repeat loads.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === "basic") {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match("/index.html"));
    })
  );
});

