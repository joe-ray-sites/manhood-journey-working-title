// Sixteen (Manhood Journey) — offline service worker
// Precaches the app shell so the app works with no signal after the first
// online visit. BUMP THE VERSION ON EVERY CHANGE (both copies of this file),
// or installed phones keep serving the previous build indefinitely.
// The cache name is internal — never rename the "manhood-" prefix, that only
// orphans caches. Never precache large media or the install screenshots.
const CACHE = 'manhood-v1';
const PRECACHE = [
  "./",
  "index.html",
  "manifest.json",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/apple-touch-icon.png"
];

// Fill in whatever is missing from the precache. Per-URL add, not addAll: one
// stale entry costs one failed request instead of breaking the whole install.
function precache() {
  return caches.open(CACHE).then((cache) =>
    Promise.all(PRECACHE.map((url) =>
      cache.match(url).then((hit) =>
        hit || cache.add(url).catch((err) => console.warn('[sw] precache skip', url, err))
      )
    ))
  );
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(precache());
});

// Self-heal. Sibling apps on this origin (Fellowship, Greece) delete EVERY
// cache that is not their own when they update, which silently wipes ours.
// The page posts this on each load, so one online open restores offline use.
self.addEventListener('message', (e) => {
  if (e.data === 'manhood-ensure-cache') e.waitUntil(precache());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      // All joe-ray-sites apps share one origin and therefore one cache
      // namespace: only ever delete THIS app's old caches.
      Promise.all(keys.filter((k) => k.startsWith('manhood-') && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // never intercept cross-origin
  if (/\.(m4a|mp3|mp4|mov)$/i.test(url.pathname)) return;     // media streams, never cached

  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
          return res;
        }).catch((err) => {
          // Offline and not cached: a page load (any query string) still gets the shell.
          if (req.mode === 'navigate') return cache.match('index.html').then((shell) => shell || Promise.reject(err));
          throw err;
        });
      })
    )
  );
});
