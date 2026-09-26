const CACHE_VERSION = 'tomato-pwa-v1';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const PRECACHE_MANIFEST = /* __PRECACHE_MANIFEST__ */ [];
const CORE_URLS = ['/', '/offline.html', '/site.webmanifest', '/favicon-192.png', '/favicon-512.png'];

function unique(values) { return [...new Set(values)]; }

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    const urls = unique([...CORE_URLS, ...PRECACHE_MANIFEST]);
    await Promise.allSettled(urls.map(url => cache.add(url)));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('tomato-pwa-') && key !== APP_CACHE && key !== RUNTIME_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response?.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put('/', response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match('/')) || (await caches.match('/offline.html'));
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request).then(async response => {
    if (response?.ok && response.type === 'basic') {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (['script', 'style', 'font', 'image'].includes(request.destination) || url.pathname === '/site.webmanifest') {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { title: 'Tomato', body: event.data?.text() || 'You have a new order update.' }; }
  const title = payload.title || 'Tomato';
  const options = {
    body: payload.body || 'You have a new order update.',
    icon: '/favicon-192.png',
    badge: '/favicon-192.png',
    tag: payload.tag || 'tomato-order-update',
    renotify: true,
    data: { url: payload.url || '/orders' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/orders';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      try {
        const url = new URL(client.url);
        const targetUrl = new URL(target, self.location.origin);
        if (url.origin === targetUrl.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(targetUrl.href);
          return;
        }
      } catch {}
    }
    return self.clients.openWindow(target);
  })());
});
