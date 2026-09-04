// Test: RECHTEN PER ROL (punt 19, audit 18 aug) + prullenbak + werkbon-bescherming.
//
// Waarom: álle andere tests loggen in als admin. Daardoor bleef een kapotte rechten-
// sleutel (requirePerm('invoices') — bestond niet) maandenlang onzichtbaar: de
// Review-knop gaf de assistente en de monteur altijd 403. Deze test loopt de
// belangrijkste routes af als ASSISTENTE en als MONTEUR-ZONDER-KOPPELING en
// asserteert op 200/403/404 — precies de grens die de AVG en de werkstroom nodig hebben.
//
// Draaien: DATA_DIR=<vers> INGEST_TOKEN=test123 SESSION_SECRET=test PORT=3129 node server/index.js &
//          node test/rollen-test.mjs
const BASE = 'http://localhost:3129';
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
  if (setC && !useToken) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}
const login = async (email, password) => { cookie = ''; return api('POST', '/api/login', { email, password }); };

console.log('\n== Setup (admin) ==');
ok('admin inloggen', (await login('admin@keyservice.nl', 'admin123')).status === 200);
const adminCookie = cookie;
await api('POST', '/api/users', { name: 'Assistente Test', email: 'assistente@keyservice.nl', password: 'assist123', role: 'assistent' });
await api('POST', '/api/users', { name: 'Monteur Los', email: 'monteurlos@keyservice.nl', password: 'monteur123', role: 'monteur' });
const kaart = await api('POST', '/api/orders', { customerName: 'Rechten Klant', customerPhone: '0612345678', customerEmail: 'rechten@example.nl', title: 'Rhenen — rechtentest' });
const orderId = kaart.json?.id;
ok('testkaart aangemaakt', !!orderId, JSON.stringify(kaart.json));
const klantId = kaart.json?.customerId;
// Factuur op de kaart (voor review-request en canTouchInvoice).
const inv = await api('POST', `/api/orders/${orderId}/invoice`, { lines: [{ description: 'Test', qty: 1, priceExcl: 100 }], btwPct: 21, type: 'factuur' });
const invId = inv.json?.invoice?.id || inv.json?.id;
ok('testfactuur aangemaakt', !!invId, JSON.stringify(inv.json).slice(0, 120));

console.log('\n== Ingest-token: alleen via header, constante tijd ==');
const viaQuery = await fetch(`${BASE}/api/outbox?token=${TOKEN}`);
ok('token in de URL wordt geweigerd', viaQuery.status === 401);
const viaHeader = await api('GET', '/api/outbox', null, true);
ok('token in de header werkt', viaHeader.status === 200);
const fout = await fetch(`${BASE}/api/outbox`, { headers: { 'x-ingest-token': 'x' } });
ok('fout token (andere lengte) -> 401, geen crash', fout.status === 401);

console.log('\n== Assistente ==');
ok('assistente inloggen', (await login('assistente@keyservice.nl', 'assist123')).status === 200);
ok('gesprekkenlijst', (await api('GET', '/api/chats')).status === 200);
ok('review-verzoek is niet meer 403 (was kapotte rechten-sleutel)', (await api('POST', `/api/invoices/${invId}/review-request`, {})).status !== 403);
ok('status-scan mag', (await api('GET', '/api/digest')).status === 200);
ok('instellingen wijzigen mag NIET', (await api('PATCH', '/api/settings', { whatsappPaused: false })).status === 403);
ok('pauzeknop via Berichten mag WEL', (await api('POST', '/api/whatsapp/pause', { paused: false })).status === 200);
ok('onbeantwoord-lijst', Array.isArray((await api('GET', '/api/chats/onbeantwoord')).json));
ok('afgewezen bericht definitief verwijderen: inbox-recht volstaat (404 = auth ok)', (await api('DELETE', '/api/reviews/bestaat-niet')).status === 404);
ok('cijfers mag NIET', (await api('GET', '/api/finance')).status === 403);
ok('factuur bereikbaar (alle facturen zien staat standaard aan)', (await api('GET', `/api/invoices/${invId}`)).status === 200);

console.log('\n== Monteur ZONDER gekoppeld monteur-record ==');
ok('monteur inloggen', (await login('monteurlos@keyservice.nl', 'monteur123')).status === 200);
const mOrders = await api('GET', '/api/orders');
ok('bord: leeg, niet andermans kaarten (null === null-lek)', mOrders.status === 200 && Array.isArray(mOrders.json) && mOrders.json.length === 0, JSON.stringify(mOrders.json?.length));
const mInv = await api('GET', `/api/invoices/${invId}`);
ok('andermans factuur: geen toegang (canTouchInvoice null-guard)', mInv.status === 403, String(mInv.status));
ok('status-scan: geen toegang (lekte hele pijplijn)', (await api('GET', '/api/digest')).status === 403);
ok('gesprekkenlijst: leeg', ((await api('GET', '/api/chats')).json || []).length === 0);
ok('andermans klant bewerken: geen toegang', (await api('PATCH', `/api/customers/${klantId}`, { email: 'x@y.nl' })).status === 403);
ok('kaart aanmaken: geen toegang', (await api('POST', '/api/orders', { customerName: 'X', customerPhone: '0611111111', title: 'x' })).status === 403);
ok('prullenbak: geen toegang', (await api('GET', '/api/trash')).status === 403);
ok('andermans kaart status wijzigen: geen toegang', (await api('PATCH', `/api/orders/${orderId}`, { status: 'afgerond' })).status === 403);
ok('agenda: leeg', ((await api('GET', '/api/agenda')).json || []).length === 0);

console.log('\n== Prullenbak: verwijderen, terughalen, definitief, legen ==');
cookie = adminCookie;
const k2 = await api('POST', '/api/orders', { customerName: 'Prullenbak Klant', customerPhone: '0699988877', title: 'Vught — prullenbaktest' });
const k2id = k2.json?.id;
ok('kaart verwijderen', (await api('DELETE', `/api/orders/${k2id}`)).status === 200);
let trash = (await api('GET', '/api/trash')).json || [];
ok('staat in de prullenbak', trash.some((o) => o.id === k2id));
ok('PATCH op kaart in prullenbak noemt de prullenbak', /prullenbak/i.test((await api('PATCH', `/api/orders/${k2id}`, { status: 'open' })).json?.error || ''));
ok('terughalen', (await api('POST', `/api/trash/${k2id}/restore`)).status === 200);
ok('staat weer op het bord', ((await api('GET', '/api/orders')).json || []).some((o) => o.id === k2id));
await api('DELETE', `/api/orders/${k2id}`);
ok('definitief verwijderen (admin)', (await api('DELETE', `/api/trash/${k2id}`)).status === 200);
trash = (await api('GET', '/api/trash')).json || [];
ok('is echt weg', !trash.some((o) => o.id === k2id));
// Samenvoegen: bron gaat naar de prullenbak, andere klant vereist force.
const a = await api('POST', '/api/orders', { customerName: 'Merge A', customerPhone: '0655555551', title: 'A' });
const b = await api('POST', '/api/orders', { customerName: 'Merge B', customerPhone: '0655555552', title: 'B' });
const mergeVreemd = await api('POST', '/api/orders/merge', { primaryId: a.json.id, mergeIds: [b.json.id] });
ok('samenvoegen met andere klant zonder force -> 409', mergeVreemd.status === 409, String(mergeVreemd.status));
const mergeForce = await api('POST', '/api/orders/merge', { primaryId: a.json.id, mergeIds: [b.json.id], force: true });
ok('met force wél', mergeForce.status === 200);
trash = (await api('GET', '/api/trash')).json || [];
ok('bronkaart staat in de prullenbak (niet hard weg)', trash.some((o) => o.id === b.json.id));

console.log('\n== Werkbon-handtekening is beschermd ==');
const sig = await api('POST', `/api/orders/${orderId}/attachments`, { filename: 'handtekening.png', mime: 'image/png', dataBase64: Buffer.from('png').toString('base64') });
const sigId = (sig.json?.attachments || []).slice(-1)[0]?.id;
await api('POST', `/api/orders/${orderId}/werkbon`, { work: 'Slot vervangen', materials: 'cilinder', signatureAttachmentId: sigId });
const browse = (await api('GET', '/api/attachments/browse')).json || [];
const lijst = Array.isArray(browse) ? browse : (browse.items || []);
ok('handtekening staat NIET in de opruimlijst', !lijst.some((x) => x.id === sigId || x.attachmentId === sigId));
const del = await api('POST', '/api/attachments/bulk-delete', { ids: [sigId] });
ok('handtekening kan NIET worden verwijderd', del.status !== 200 || !(del.json?.removed > 0), JSON.stringify(del.json));

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
