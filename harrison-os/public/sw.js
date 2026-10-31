// Harrison OS service worker (Slice 1).
// Shell caching with network-first navigations, plus reminder push and click handling.
// Bump CACHE_NAME whenever any shell file changes.
const CACHE_PREFIX = 'hos-';
const CACHE_NAME = 'hos-v6';

// '/' is the app page (index.html). Workers static assets may redirect /index.html
// to /, so the page is cached under '/'. Google Fonts are not cached: offline, the
// app falls back to system fonts.
const SHELL = [
  '/',
  '/app.js',
  '/outbox-core.js',
  '/idb.js',
  '/styles.css',
  '/views/index.js',
  '/views/ask.js',
  '/views/ask.css',
  '/views/drafts.js',
  '/views/drafts.css',
  '/views/calendar.js',
  '/views/calendar.css',
  '/views/pm.js',
  '/views/pm.css',
  '/views/weekly.js',
  '/views/weekly.css',
  '/views/connections.js',
  '/views/connections.css',
  '/manifest.webmanifest',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const NAV_TIMEOUT_MS = 3500;
const BEACON_TIMEOUT_MS = 8000;
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const DEFAULT_TITLE = 'Reminder';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // cache: 'reload' bypasses the HTTP cache so a new worker never precaches stale files.
      // Any failure (offline, a sign-in redirect) rejects install; the old worker stays.
      await Promise.all(
        SHELL.map(async (url) => {
          const res = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
          if (!res.ok || res.type !== 'basic') throw new Error(`precache ${url}: ${res.status}`);
          // A redirected response cannot be replayed for a navigation, so store a clean copy.
          const clean = res.redirected
            ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })
            : res;
          await cache.put(url, clean);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isShellPath(pathname) {
  return SHELL.includes(pathname);
}

async function cachedShellPage() {
  const cache = await caches.open(CACHE_NAME);
  return cache.match('/');
}

// Navigations go to the network first (short timeout) so that "Sign in again"
// (a top-level location.reload()) can reach the sign-in page. If the network fails
// or is slow, the cached shell is served so the app opens offline.
async function handleNavigation(request) {
  let timer;
  const network = fetch(request);
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NAV_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([network, timeout]);
    clearTimeout(timer);
    if (res) return res; // includes an opaque redirect to the sign-in page
  } catch {
    clearTimeout(timer);
  }
  network.catch(() => {});
  const cached = await cachedShellPage();
  if (cached) return cached;
  return network; // nothing cached yet: let the real outcome through
}

async function handleShellAsset(request, pathname) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(pathname);
  if (hit) return hit;
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache or intercept the API. Also leave the worker script itself alone.
  if (url.pathname.startsWith('/api/') || url.pathname === '/api' || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname !== '/' && isShellPath(url.pathname)) {
    event.respondWith(handleShellAsset(request, url.pathname));
  }
  // Anything else: default network handling, nothing cached.
});

function apiPost(path, body) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), BEACON_TIMEOUT_MS) : null;
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'manual',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body),
    signal: controller ? controller.signal : undefined,
  }).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function parsePush(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    return {};
  }
}

function ackTarget(deliveryId) {
  return deliveryId ? `/?ack=${encodeURIComponent(deliveryId)}#/today` : '/#/today';
}

self.addEventListener('push', (event) => {
  const data = parsePush(event);
  const n = data && typeof data.notification === 'object' && data.notification ? data.notification : {};
  const rawId = data.delivery_id || n.tag || '';
  const deliveryId = ID_RE.test(String(rawId)) ? String(rawId) : null;
  const title = typeof n.title === 'string' && n.title ? n.title : DEFAULT_TITLE;
  const options = {
    body: typeof n.body === 'string' ? n.body : '',
    tag: deliveryId || undefined,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    silent: n.silent === true,
    data: {
      delivery_id: deliveryId,
      reminder_id: typeof data.reminder_id === 'string' ? data.reminder_id : null,
      navigate: ackTarget(deliveryId),
    },
  };

  // Show the notification first. Only after it is shown (or has failed) is the
  // receipt beacon sent, and the beacon can never fail the handler.
  const shown = self.registration
    .showNotification(title, options)
    .catch(() => self.registration.showNotification(DEFAULT_TITLE, { tag: options.tag, data: options.data }));

  event.waitUntil(
    shown.then(
      () => beacon(deliveryId, data),
      () => beacon(deliveryId, data),
    ),
  );
});

function beacon(deliveryId, data) {
  if (!deliveryId) return Promise.allSettled([]);
  return Promise.allSettled([
    apiPost(`/api/deliveries/${encodeURIComponent(deliveryId)}/received`, {
      received_at_ms: Date.now(),
      sent_at_ms: typeof data.sent_at_ms === 'number' ? data.sent_at_ms : null,
    }),
  ]);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const rawId = d.delivery_id || event.notification.tag || '';
  const deliveryId = ID_RE.test(String(rawId)) ? String(rawId) : null;
  const target = ackTarget(deliveryId);

  // The ack starts first (best effort), but the window is focused or opened without
  // waiting for it, so a slow network never costs the user activation.
  const ack = deliveryId
    ? apiPost(`/api/deliveries/${encodeURIComponent(deliveryId)}/ack`, { via: 'notification' })
    : Promise.resolve();

  const focusOrOpen = (async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(client.url).origin === self.location.origin;
      } catch {
        sameOrigin = false;
      }
      if (sameOrigin && 'focus' in client) {
        const focused = await client.focus();
        (focused || client).postMessage({ type: 'notification-ack', deliveryId });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })();

  event.waitUntil(Promise.allSettled([ack, focusOrOpen]));
});
