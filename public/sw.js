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
      // Open venster naar het juiste scherm sturen (audit 16 sep): voorheen kwam een
      // tik op "Nieuwe opdracht" op het scherm uit dat toevallig openstond.
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c && url && url !== '/') return c.navigate(url).then((w) => (w || c).focus()).catch(() => c.focus());
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// Netwerk-eerst: altijd vers ophalen; alleen bij een offline GET-navigatie tonen we
// een korte melding. We cachen geen API-data of code (voorkomt verouderde schermen).
// 28 sep 2026 (audit schermcode#20): alleen NAVIGATIES lopen nog via deze handler.
// Voorheen ging élk GET-verzoek erdoorheen (de pulse elke 5 s, API-data, foto's en
// video's met range-verzoeken) — een onnodige omweg, en na een tijdje stilte moest de
// service worker eerst opstarten. Alle andere verzoeken handelt de browser nu zelf af;
// api() in de app vertaalt een netwerkfout al naar een nette melding.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req).catch(() => new Response(
      '<meta charset="utf-8"><div style="font-family:sans-serif;padding:40px;text-align:center;color:#333"><h2>Geen verbinding</h2><p>Je bent offline. Probeer het zo opnieuw.</p></div>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } }
    ))
  );
});
