// Test: BERICHTEN-SCHERM (7 aug 2026) — alle klantgesprekken op één plek.
//
// Bewaakt drie dingen die niet stilletjes kapot mogen:
// 1. Versturen loopt ALTIJD via de beveiligde wachtrij (pauzeknop/snelheidsrem gelden),
//    en het bericht komt óók als notitie op de nieuwste open kaart (alles gekoppeld).
// 2. De gesprekkenlijst en de historie kloppen (in- en uitgaand, geen dubbelen).
// 3. Alleen admin/assistent mogen erin; een monteur niet (die ziet alleen eigen kaarten).
//
// Draaien: DATA_DIR=<vers> INGEST_TOKEN=test123 SESSION_SECRET=test PORT=3127 node server/index.js &
//          node test/chat-test.mjs
const BASE = 'http://localhost:3127';
const TOKEN = 'test123';

let cookie = '';
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}
async function api(method, path, body, useToken = false) {
  const headers = { 'content-type': 'application/json' };
  if (useToken) headers['x-ingest-token'] = TOKEN;
  if (cookie && !useToken) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}

console.log('\n== Setup ==');
const login = await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });
ok('inloggen', login.status === 200);
await api('PATCH', '/api/settings', { whatsappOrderGroups: 'raf breda', autoMergeWindowHours: 0 });
const mont = await api('POST', '/api/monteurs', { name: 'Youssef', phone: '0687654321', waGroup: 'Youssef Keyservice247' });
await api('PATCH', '/api/settings', { monteurDispatch: { autoEnabled: true, days: [0, 1, 2, 3, 4, 5, 6], autoMonteurId: mont.json.id, trigger: 'intake', onlyDrs: true } });

// Een klant komt binnen via de DRS-groep -> kaart + klant bestaan.
console.log('\n== Gesprek ontstaat uit een binnengekomen aanvraag ==');
await api('POST', '/api/ingest/whatsapp', {
  group: 'groep 120363177872957422', name: 'Chat Klant',
  body: 'Chat Klant, Teststraat 1, 3911 AB Rhenen, 0655512399, slot klemt, graag langskomen',
  externalId: 'chat1',
}, true);
const chats1 = await api('GET', '/api/chats');
ok('gesprekkenlijst bereikbaar', chats1.status === 200 && Array.isArray(chats1.json));
const gesprek = (chats1.json || []).find((c) => (c.phone || '').includes('0655512399'));
ok('klant staat in de gesprekkenlijst', !!gesprek, JSON.stringify((chats1.json || []).map((c) => c.name)));
ok('open kaart is gekoppeld aan het gesprek', !!gesprek?.orderId, JSON.stringify(gesprek));
ok('laatste bericht is het binnengekomen appje', /slot klemt/i.test(gesprek?.lastBody || ''));

console.log('\n== Versturen: via de beveiligde wachtrij én op de kaart ==');
const stuur = await api('POST', `/api/chats/${gesprek.id}/send`, { text: 'Goedemorgen! We kunnen vanmiddag om 14:00 langskomen. Schikt dat?' });
ok('versturen lukt', stuur.status === 200 && stuur.json?.ok, JSON.stringify(stuur.json));
ok('bericht gekoppeld aan de open kaart', stuur.json?.orderId === gesprek.orderId);
const wachtrij = await api('GET', '/api/whatsapp/outbox-status?full=1');
const item = (wachtrij.json || []).find((o) => /vanmiddag om 14:00/.test(o.text || ''));
ok('bericht staat in de ECHTE wachtrij (zelfde vangrails als altijd)', !!item && item.status === 'queued', JSON.stringify(item));
const orders = (await api('GET', '/api/orders')).json || [];
const kaart = orders.find((o) => o.id === gesprek.orderId);
ok('bericht staat ook als uitgaand in de kaart-historie', (kaart?.thread || []).some((t) => t.outgoing && /vanmiddag om 14:00/.test(t.body || '')));

const hist = await api('GET', `/api/customers/${gesprek.id}/history?limit=50`);
const uitgaand = (hist.json?.items || []).filter((t) => /vanmiddag om 14:00/.test(t.body || ''));
ok('historie toont het bericht PRECIES één keer (geen dubbel wachtrij+kaart)', uitgaand.length === 1, `${uitgaand.length}x`);
ok('met verzendstatus erbij', uitgaand[0]?.waStatus === 'queued', JSON.stringify(uitgaand[0]?.waStatus));

console.log('\n== Vangrails ==');
const pauze = await api('PATCH', '/api/settings', { whatsappPaused: true });
ok('pauzeknop aan te zetten', pauze.status === 200);
const stuur2 = await api('POST', `/api/chats/${gesprek.id}/send`, { text: 'Tweede bericht tijdens de pauze' });
ok('tijdens pauze: bericht in wachtrij, mét duidelijke pauze-vlag', stuur2.json?.ok && stuur2.json?.paused === true, JSON.stringify(stuur2.json));
await api('PATCH', '/api/settings', { whatsappPaused: false });
const leeg = await api('POST', `/api/chats/${gesprek.id}/send`, { text: '   ' });
ok('leeg bericht wordt geweigerd', leeg.status === 400);
const kloi = await api('POST', '/api/chats/bestaat-niet/send', { text: 'x' });
ok('onbekende klant -> nette 404', kloi.status === 404);
// Klant zonder (geldig) nummer -> duidelijke uitleg.
const zonderNr = await api('POST', '/api/customers', { name: 'Zonder Nummer', email: 'zn@example.nl' });
const znId = (zonderNr.json?.id) || (zonderNr.json?.customer?.id);
const stuur3 = await api('POST', `/api/chats/${znId}/send`, { text: 'Hallo?' });
ok('klant zonder nummer -> uitleg i.p.v. stille fout', stuur3.status === 400 && /telefoonnummer/i.test(stuur3.json?.error || ''), JSON.stringify(stuur3.json));

console.log('\n== Gelezen-teller ==');
// Klant reageert 1-op-1 -> unread loopt op; lezen zet hem op 0.
await api('POST', '/api/ingest/whatsapp', {
  name: 'Chat Klant', body: 'Ja dat schikt!\nTelefoon: +31655512399', externalId: 'chat2',
}, true);
const chats2 = await api('GET', '/api/chats');
const g2 = (chats2.json || []).find((c) => c.id === gesprek.id);
ok('klantreactie telt als ongelezen', (g2?.unread || 0) >= 1, JSON.stringify(g2?.unread));
ok('reactie staat in het gesprek als laatste bericht', /dat schikt/i.test(g2?.lastBody || ''));
await api('POST', `/api/chats/${gesprek.id}/read`, {});
const chats3 = await api('GET', '/api/chats');
ok('na openen: teller op nul', ((chats3.json || []).find((c) => c.id === gesprek.id)?.unread || 0) === 0);

console.log('\n== Rechten: monteur komt er niet in ==');
// Vers monteur-account aanmaken en daarmee proberen.
await api('POST', '/api/users', { name: 'Monteur Test', email: 'monteurtest@keyservice.nl', password: 'monteur123', role: 'monteur' });
const adminCookie = cookie;
cookie = '';
const ml = await api('POST', '/api/login', { email: 'monteurtest@keyservice.nl', password: 'monteur123' });
ok('monteur kan inloggen', ml.status === 200);
ok('monteur: gesprekkenlijst geweigerd', (await api('GET', '/api/chats')).status === 403);
ok('monteur: versturen geweigerd', (await api('POST', `/api/chats/${gesprek.id}/send`, { text: 'x' })).status === 403);
cookie = adminCookie;

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
