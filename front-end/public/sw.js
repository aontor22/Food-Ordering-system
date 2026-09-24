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
