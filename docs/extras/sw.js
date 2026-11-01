// Opens with no signal (basements, electrical rooms). Each release is one versioned cache filled in a single
// install, so the page never runs a new app.mjs against an old extras.mjs. Bump CACHE with every release.
// Only this folder's own files are cached; records live in IndexedDB.
const CACHE = 'extras-log-v3';
const SHELL = ['./', 'index.html', 'app.mjs', 'extras.mjs', 'manifest.webmanifest', 'icon.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE)
  .then(c => c.addAll(SHELL.map(f => new Request(f, { cache: 'reload' }))))
  .then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k.startsWith('extras-log-') && k !== CACHE).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.registration.scope)) return;
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true })).then(hit => hit || fetch(e.request)));
});
