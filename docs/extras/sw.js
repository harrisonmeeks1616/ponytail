// Opens with no signal (basements, electrical rooms): serve the saved copy at once, refresh it in the background.
// The next open after a release shows the new version. Only this folder's own files are cached; data is in IndexedDB.
const CACHE = 'extras-log-v1';
const SHELL = ['./', 'index.html', 'app.mjs', 'extras.mjs', 'manifest.webmanifest', 'icon.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k.startsWith('extras-log-') && k !== CACHE).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.registration.scope)) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (!hit) return fresh;
    e.waitUntil(fresh.catch(() => {}));
    return hit;
  }));
});
