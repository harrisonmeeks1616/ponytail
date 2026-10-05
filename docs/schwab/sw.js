// Offline copy of the apps: answer from cache, refresh it in the background.
// Upper floors and electrical rooms often have no signal, and a reopened tab must still load.
const CACHE = 'schwab-field-apps-v3';
const FILES = ['./', 'index.html', 'tasks.html', 'report.html', 'shared.mjs', 'es.mjs', 'shared.css'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k === 'schwab-field-apps' || (k.startsWith('schwab-field-apps-') && k !== CACHE)).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const fresh = fetch(e.request).then(async res => {
    if (res.ok) await (await caches.open(CACHE)).put(e.request, res.clone());
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fresh));
});
