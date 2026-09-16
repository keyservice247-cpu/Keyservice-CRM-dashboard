// Test: AUDIT-FIXES 16 sep 2026 (backend). Elke assertie hoort bij een bevinding uit
// de code-audit; zonder de fix was hij rood.
// Draaien: DATA_DIR=<vers> INGEST_TOKEN=test123 SESSION_SECRET=test PORT=3137 node server/index.js &
//          node test/audit-test.mjs
const BASE = 'http://localhost:3137';
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
const login = (email, password) => { cookie = ''; return api('POST', '/api/login', { email, password }); };
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

console.log('\n== Setup ==');
ok('admin inloggen', (await login('admin@keyservice.nl', 'admin123')).status === 200);
const adminCookie = cookie;
await api('PATCH', '/api/settings', { whatsappOrderGroups: 'raf breda', autoMergeWindowHours: 6 });
const mont = (await api('POST', '/api/monteurs', { name: 'Youssef', phone: '0687654321', waGroup: 'Youssef Keyservice247' })).json;
const mont2 = (await api('POST', '/api/monteurs', { name: 'Abdel', phone: '0687654322', waGroup: 'Abdel groep' })).json;
const assNieuw = (await api('POST', '/api/users', { name: 'Assistente Audit', email: 'assist-audit@keyservice.nl', password: 'assist123', role: 'assistent' })).json;
await api('PATCH', `/api/users/${assNieuw.id}`, { perms: { invoicesAll: false } });
await api('POST', '/api/users', { name: 'Monteur Audit', email: 'monteur-audit@keyservice.nl', password: 'monteur123', role: 'monteur', monteurId: mont.id });

console.log('\n== Gegevens-suggestie: beide vormen, nooit "undefined" in het klantrecord ==');
const kl = (await api('POST', '/api/customers', { name: 'Suggestie Klant', phone: '0655500001', address: 'Hoofdstraat 1, Amsterdam' })).json;
const plak = await api('POST', '/api/orders/paste', { text: 'Naam: Suggestie Klant\nAdres: Nieuwe Laan 9\nWoonplaats: Utrecht\nTelefoon: 0655500001\nOpmerkingen: slot kapot' });
ok('plak-opdracht aangemaakt', plak.status === 200 && plak.json?.id, JSON.stringify(plak.json).slice(0, 120));
const sugKaart = plak.json;
const sug = (sugKaart.dataSuggestions || []).find((x) => x.field === 'adres');
ok('plak-opdracht geeft een adres-suggestie (value/current-vorm)', !!sug && (sug.value || sug.to), JSON.stringify(sugKaart.dataSuggestions));
const toep = await api('POST', `/api/orders/${sugKaart.id}/data-suggestion`, { field: 'adres', action: 'apply' });
const klNa = (await api('GET', '/api/customers')).json.find((c) => c.id === kl.id);
ok('"Bijwerken" schrijft het NIEUWE adres (niet undefined)', toep.status === 200 && /Nieuwe Laan 9/.test(klNa?.address || ''), klNa?.address);
ok('systeemnotitie noemt oud → nieuw', (toep.json.thread || []).some((t) => /Hoofdstraat 1.*Nieuwe Laan 9/.test(t.body || '')));

console.log('\n== Goedkeuren hangt aan de NIEUWSTE open kaart ==');
const k2 = (await api('POST', '/api/customers', { name: 'Twee Kaarten', phone: '0655500002' })).json;
const oud = (await api('POST', '/api/orders', { customerId: k2.id, title: 'Rhenen — OUDE kaart', status: 'open' })).json;
await slaap(1100);
const nieuw = (await api('POST', '/api/orders', { customerId: k2.id, title: 'Rhenen — NIEUWE kaart', status: 'open' })).json;
await api('POST', '/api/ingest/whatsapp', { group: 'Raf breda', name: 'DRS', body: 'Naam: Twee Kaarten\nAdres: Straat 2\nWoonplaats: Rhenen\nTelefoon: 0655500002\nOpmerkingen: sleutel afgebroken', externalId: 'aud-g1' }, true);
const rev = ((await api('GET', '/api/reviews')).json.items || (await api('GET', '/api/reviews')).json || []).find((r) => /0655500002/.test(JSON.stringify(r)));
ok('aanvraag staat in de inbox', !!rev);
const goed = rev ? await api('POST', `/api/reviews/${rev.id}/approve`, {}) : { json: {} };
ok('binnen het venster: aan de NIEUWSTE kaart gehangen, niet de oude', goed.json?.review?.mergedIntoOrder && goed.json?.order?.id === nieuw.id, JSON.stringify({ merged: goed.json?.review?.mergedIntoOrder, kaart: goed.json?.order?.id, oud: oud.id, nieuw: nieuw.id }));

console.log('\n== Dubbele klanten samenvoegen neemt facturen mee ==');
const kA = (await api('POST', '/api/customers', { name: 'Klant A', phone: '0655500003' })).json;
const kB = (await api('POST', '/api/customers', { name: 'Klant B', email: 'b@example.nl' })).json;
const invB = (await api('POST', '/api/invoices', { customerId: kB.id, type: 'factuur' })).json.invoice;
const merge = await api('POST', '/api/customers/merge', { primaryId: kA.id, mergeIds: [kB.id] });
const invNa = (await api('GET', '/api/invoices')).json.find((i) => i.id === invB.id);
ok('factuur van B hangt na samenvoegen aan A', merge.status === 200 && invNa && invNa.customerId === kA.id && invNa.customerName === 'Klant A', JSON.stringify(invNa && { c: invNa.customerId, n: invNa.customerName }));

console.log('\n== Kaarten samenvoegen: factuur mee, bijlages ontdubbeld ==');
const kC = (await api('POST', '/api/customers', { name: 'Klant C', phone: '0655500004' })).json;
const c1 = (await api('POST', '/api/orders', { customerId: kC.id, title: 'Ede — kaart 1', status: 'open' })).json;
const c2 = (await api('POST', '/api/orders', { customerId: kC.id, title: 'Ede — kaart 2', status: 'open' })).json;
const invC2 = (await api('POST', '/api/invoices', { customerId: kC.id, type: 'factuur', orderId: c2.id })).json.invoice;
await api('POST', `/api/orders/${c1.id}/attachments`, { filename: 'f.png', mime: 'image/png', dataBase64: PNG });
await api('POST', `/api/orders/${c2.id}/attachments`, { filename: 'f.png', mime: 'image/png', dataBase64: PNG });
const mk = await api('POST', '/api/orders/merge', { primaryId: c1.id, mergeIds: [c2.id], force: true });
ok('samenvoegen gelukt', mk.status === 200, JSON.stringify(mk.json).slice(0, 100));
ok('bijlage één keer op de hoofdkaart (zelfde inhoud ontdubbeld)', (mk.json.attachments || []).filter((a) => a.filename === 'f.png').length === 1, String((mk.json.attachments || []).length));
const invC2na = (await api('GET', '/api/invoices')).json.find((i) => i.id === invC2.id);
ok('factuur van de bronkaart wijst naar de hoofdkaart', invC2na && invC2na.orderId === c1.id, JSON.stringify(invC2na && invC2na.orderId));

console.log('\n== Gedeelde bestanden: één foto weghalen laat de andere kaart heel ==');
const d1 = (await api('POST', '/api/orders', { customerId: kC.id, title: 'Ede — deel 1', status: 'open' })).json;
const d2 = (await api('POST', '/api/orders', { customerId: kC.id, title: 'Ede — deel 2', status: 'open' })).json;
const PNG2 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const u1 = (await api('POST', `/api/orders/${d1.id}/attachments`, { filename: 'g.png', mime: 'image/png', dataBase64: PNG2 })).json;
const u2 = (await api('POST', `/api/orders/${d2.id}/attachments`, { filename: 'g.png', mime: 'image/png', dataBase64: PNG2 })).json;
const a1 = (u1.attachments || []).find((a) => a.filename === 'g.png'); const a2 = (u2.attachments || []).find((a) => a.filename === 'g.png');
ok('zelfde bestand op beide kaarten', a1 && a2 && a1.file === a2.file);
await api('DELETE', `/api/orders/${d1.id}/attachments/${a1.id}`);
const nogDaar = await fetch(BASE + a2.url, { headers: { cookie } });
ok('bestand blijft op schijf zolang kaart 2 het gebruikt', nogDaar.status === 200, String(nogDaar.status));
const dup = await api('POST', `/api/orders/${d2.id}/attachments`, { filename: 'g-nogmaals.png', mime: 'image/png', dataBase64: PNG2 });
ok('zelfde foto nogmaals op dezelfde kaart = geen tweede verwijzing + dubbel-vlag', dup.json?.dubbel === true && (dup.json.attachments || []).length === 1, JSON.stringify({ dubbel: dup.json?.dubbel, n: (dup.json.attachments || []).length }));
await api('DELETE', `/api/orders/${d2.id}/attachments/${a2.id}`);
const weg = await fetch(BASE + a2.url, { headers: { cookie } });
ok('laatste verwijzing weg = bestand van schijf', weg.status === 404, String(weg.status));

console.log('\n== Offerte via WhatsApp zet de kaart op Offerte verzonden ==');
const kQ = (await api('POST', '/api/customers', { name: 'Offerte Klant', phone: '0655500005' })).json;
const oq = (await api('POST', '/api/orders', { customerId: kQ.id, title: 'Veenendaal — offerte', status: 'open' })).json;
const off = (await api('POST', '/api/invoices', { customerId: kQ.id, type: 'offerte', orderId: oq.id })).json.invoice;
await api('PATCH', `/api/invoices/${off.id}`, { lines: [{ description: 'Slot', qty: 1, priceExcl: 100 }] });
const wa = await api('POST', `/api/invoices/${off.id}/send-whatsapp`, {});
const oqNa = (await api('GET', '/api/orders')).json.find((o) => o.id === oq.id);
ok('offerte via WhatsApp → kaartstatus offerte_verzonden', wa.status === 200 && oqNa?.status === 'offerte_verzonden', JSON.stringify({ st: wa.status, status: oqNa?.status, err: wa.json?.error }));
ok('quoteSentAt gezet (opvolging meet vanaf verzendmoment)', !!oqNa?.quoteSentAt);

console.log('\n== Inbox-prullenbak: terugzetten gaat terug naar de OORSPRONKELIJKE lijst ==');
await api('POST', '/api/ingest/email', { from: 'nieuwsbrief@webshop.example', subject: 'Aanbieding van de week', body: 'Korting op alles! Klik hier.', externalId: 'aud-nb1' }, true);
const alleR = (await api('GET', '/api/reviews?status=all')).json;
const item = (alleR.items || alleR || []).find((r) => /aud-nb1|Aanbieding van de week/.test(JSON.stringify(r)));
if (item) {
  const oorspronkelijk = item.status;
  await api('POST', `/api/reviews/${item.id}/reject`, { reason: 'reclame' });
  await api('POST', `/api/reviews/${item.id}/restore`, {});
  const na = (await api('GET', '/api/reviews?status=all')).json;
  const terug = (na.items || na || []).find((r) => r.id === item.id);
  ok(`terugzetten herstelt de oorspronkelijke lijst (${oorspronkelijk})`, !!terug && terug.status === oorspronkelijk, JSON.stringify(terug && terug.status));
} else {
  ok('(inbox-item gevonden om te testen)', false, JSON.stringify(alleR).slice(0, 200));
}

console.log('\n== Reden achteraf bij een 1-klik-afwijzing ==');
await api('POST', '/api/ingest/email', { from: 'reden@example.nl', subject: 'Vraag over slot', body: 'Kunt u langskomen in Ede voor een slot?', externalId: 'aud-reden-1' }, true);
const rAll = (await api('GET', '/api/reviews?status=all')).json;
const rItem = (rAll.items || rAll || []).find((r) => /aud-reden-1|reden@example/.test(JSON.stringify(r)));
ok('testbericht in de inbox', !!rItem);
const rr1 = await api('POST', `/api/reviews/${rItem.id}/reject-reason`, { note: 'x' });
ok('reden toevoegen aan een NIET-afgewezen bericht wordt geweigerd', rr1.status === 400);
await api('POST', `/api/reviews/${rItem.id}/reject`, {});
const rr2 = await api('POST', `/api/reviews/${rItem.id}/reject-reason`, { reason: 'reclame', note: 'nieuwsbrief', shouldBe: '' });
ok('reden achteraf opgeslagen op de review', rr2.status === 200 && rr2.json.review.rejectReason === 'reclame' && rr2.json.review.rejectNote === 'nieuwsbrief');
const fbLijst = (await api('GET', '/api/feedback')).json;
ok('leervoorbeeld (feedback) krijgt de reden ook', fbLijst.some((f) => f.reviewId === rItem.id && f.reason === 'reclame'));

console.log('\n== Rechten ==');
await login('assist-audit@keyservice.nl', 'assist123');
const lijstAss = await api('GET', '/api/invoices');
ok('assistente zonder invoicesAll ziet alleen eigen facturen in de LIJST', lijstAss.status === 200 && !lijstAss.json.some((i) => i.id === invB.id), String(lijstAss.json.length));
await login('monteur-audit@keyservice.nl', 'monteur123');
ok('monteur krijgt geen bedrijfslogboek', (await api('GET', '/api/activity')).status === 403);
ok('monteur krijgt geen afgewezen-berichten-feedback', (await api('GET', '/api/feedback')).status === 403);
ok('monteur kan badge van andermans kaart niet wegklikken', (await api('POST', `/api/orders/${oq.id}/seen`, {})).status === 403);
ok('monteur kan geen losse factuur voor een vreemde klant openen', (await api('POST', '/api/invoices', { customerId: kQ.id, type: 'factuur' })).status === 403);
ok('monteur kan geen nieuwe klant via factuur aanmaken', (await api('POST', '/api/invoices', { type: 'factuur', newCustomer: { name: 'Hack' } })).status === 403);
const eigen = (await api('GET', '/api/orders')).json;
cookie = adminCookie;
const eigenKaart = (await api('POST', '/api/orders', { customerId: kC.id, title: 'Ede — eigen kaart monteur', status: 'open', monteurId: mont.id })).json;
const foto = (await api('POST', `/api/orders/${eigenKaart.id}/attachments`, { filename: 'eigen.png', mime: 'image/png', dataBase64: PNG })).json.attachments.find((a) => a.filename === 'eigen.png');
await login('monteur-audit@keyservice.nl', 'monteur123');
const delEigen = await api('DELETE', `/api/orders/${eigenKaart.id}/attachments/${foto.id}`);
ok('monteur mag een foto van zijn EIGEN kaart weghalen', delEigen.status === 200 && !(delEigen.json.attachments || []).some((a) => a.id === foto.id), String(delEigen.status));
ok('(monteur zag zijn eigen kaart)', Array.isArray(eigen));

console.log('\n== Taken: collega kan een gedeelde privé-taak niet openbaar maken ==');
cookie = adminCookie;
const assUser = (await api('GET', '/api/users')).json.find((u) => u.email === 'assist-audit@keyservice.nl');
const taak = (await api('POST', '/api/taken', { titel: 'Privé geheim', categorie: 'prive', gedeeldMet: [assUser.id] })).json;
await login('assist-audit@keyservice.nl', 'assist123');
const zet = await api('PATCH', `/api/taken/${taak.id}`, { categorie: 'zakelijk' });
ok('categorie blijft privé voor de collega', zet.status === 200 && zet.json.categorie === 'prive', JSON.stringify(zet.json?.categorie));

console.log(`\n========== AUDIT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
