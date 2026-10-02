// Manhood Journey — offline service worker
// Precaches the app shell (page, manifest, icons, the home-hero plates) and the text fonts, so the
// app works with no signal after ONE online visit. BUMP CACHE ON EVERY CHANGE, in both copies
// (root sw.js and publish/sw.js must stay byte-identical), or installed phones keep the old build.
// The cache name is internal: never rename the "manhood-" prefix, that only orphans caches.
// Never precache large media or the Download-the-App screenshots (assets/install/).
const CACHE = 'manhood-v3';
const PRECACHE = [
  "./",
  "index.html",
  "manifest.json",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/apple-touch-icon.png",
  "assets/hero-dawn.webp",
  "assets/hero-dusk.webp",
  "assets/hero-night.webp"
];
// The ONE cross-origin exception. The design's fonts come from Google Fonts; cached here they keep
// working on a trail with no signal. FONT_CSS must match the <link href> in index.html byte for
// byte (tools/sanity.py checks it). Every other cross-origin request is left alone.
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500;600&family=Source+Sans+3:wght@400;500;600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&display=swap";
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Fetch the font stylesheet and the LATIN font files it names (the only subset this app's text
// uses). Skipped silently when offline; the fetch handler below fills in anything missed.
function precacheFonts(cache) {
  return cache.match(FONT_CSS, { ignoreVary: true }).then((hit) => {
    if (hit) return hit.clone().text();
    return fetch(FONT_CSS, { mode: 'cors' }).then((res) => {
      if (!res || !res.ok) return '';
      return cache.put(FONT_CSS, res.clone()).then(() => res.text());
    });
  }).then((css) => {
    const urls = [];
    const re = /\/\* latin \*\/\s*@font-face\s*\{[^}]*?url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;
    let m;
    while ((m = re.exec(css || ''))) if (urls.indexOf(m[1]) === -1) urls.push(m[1]);
    return Promise.all(urls.map((u) =>
      cache.match(u, { ignoreVary: true }).then((h) => h || cache.add(u).catch(() => {}))
    ));
  }).catch(() => {});
}

// Fill in whatever is missing from the precache. Per-URL add, not addAll: one stale entry costs
// one failed request instead of breaking the whole install.
function precache() {
  return caches.open(CACHE).then((cache) =>
    Promise.all(PRECACHE.map((url) =>
      cache.match(url).then((hit) =>
        hit || cache.add(url).catch((err) => console.warn('[sw] precache skip', url, err))
      )
    )).then(() => precacheFonts(cache))
  );
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(precache());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      // Every joe-ray-sites app shares this ONE origin and its cache namespace:
      // only ever delete THIS app's old caches.
      Promise.all(keys.filter((k) => k.startsWith('manhood-') && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Self-heal. Sibling apps on this origin (Fellowship, Greece) delete EVERY cache that is not their
// own when they update, which silently wipes ours. The page posts this on each load, so one online
// open restores offline use.
self.addEventListener('message', (e) => {
  if (e.data === 'manhood-ensure-cache') e.waitUntil(precache());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    if (FONT_HOSTS.indexOf(url.hostname) === -1) return;       // never intercept anything else cross-origin
    e.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req.url, { ignoreVary: true }).then((cached) => {
          if (cached) return cached;                            // font files are immutable; the CSS is refreshed on each SW bump
          return fetch(req).then((res) => {
            if (res && res.ok) cache.put(req.url, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }
  if (/\.(m4a|mp3|mp4|mov|webm|ogg|wav)$/i.test(url.pathname)) return;   // media streams, never cached

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
