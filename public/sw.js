// Minimale service worker — maakt de CRM installeerbaar als app, zonder agressief
// te cachen (zo zie je altijd de nieuwste versie na een update/deploy).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Push-melding tonen op telefoon/desktop, ook als de CRM dicht is.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'Keyservice CRM';
  const options = {
    body: data.body || 'Er is iets nieuws binnengekomen.',
    icon: '/img/icon-192.png',
    badge: '/img/icon-192.png',
    tag: data.tag || 'ks',
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Bij tikken op de melding: open/focus de CRM.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// Netwerk-eerst: altijd vers ophalen; alleen bij een offline GET-navigatie tonen we
// een korte melding. We cachen geen API-data of code (voorkomt verouderde schermen).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PATCH/DELETE nooit onderscheppen
  event.respondWith(
    fetch(req).catch(() => {
      if (req.mode === 'navigate') {
        return new Response(
          '<meta charset="utf-8"><div style="font-family:sans-serif;padding:40px;text-align:center;color:#333"><h2>Geen verbinding</h2><p>Je bent offline. Probeer het zo opnieuw.</p></div>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } }
        );
      }
      return new Response('', { status: 504 });
    })
  );
});
