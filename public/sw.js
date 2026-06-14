// Minimale service worker — maakt de CRM installeerbaar als app, zonder agressief
// te cachen (zo zie je altijd de nieuwste versie na een update/deploy).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
