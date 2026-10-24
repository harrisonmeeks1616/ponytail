// Keep every core file from one release together, including the Spanish dictionary.
// Bump CACHE for every app release. Existing tabs keep their build until all close.
const CACHE = 'schwab-field-apps-v16';
const FILES = ['./', 'index.html', 'tasks.html', 'report.html', 'report.mjs', 'shared.mjs', 'sync.mjs', 'live.mjs', 'jobs.mjs', 'jobs-ui.mjs', 'es.mjs', 'shared.css']; // every file the app imports
const CORE = new Set(FILES.map(f => new URL(f, self.location).href));

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))));
// Do not skipWaiting: switching workers under an open page could mix module versions.
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k === 'schwab-field-apps' || (k.startsWith('schwab-field-apps-') && k !== CACHE)).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url); url.search = ''; url.hash = '';
  if (e.request.method !== 'GET' || !CORE.has(url.href)) return;
  // The complete cache was populated atomically at install; never refresh one core file alone.
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true })).then(hit => hit || fetch(e.request)));
});
