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

console.log('\n== Automatische opschoning foto\'s/filmpjes (20 sep 2026) ==');
cookie = adminCookie;
const kO = (await api('POST', '/api/customers', { name: 'Opschoon Klant', phone: '0655500099' })).json;
const oAf = (await api('POST', '/api/orders', { customerId: kO.id, title: 'Rhenen — afgerond met foto', status: 'open' })).json;
const oOpen = (await api('POST', '/api/orders', { customerId: kO.id, title: 'Rhenen — nog open met foto', status: 'open' })).json;
const PNG3 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAD0lEQVR42mNk+M9QzwAEAAX+Av4N70a4AAAAAElFTkSuQmCC';
const PNG4 = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAEklEQVR42mNkYPhfz0AEYBxWCgEAiVEDA2PpNjwAAAAASUVORK5CYII=';
const fAf = (await api('POST', `/api/orders/${oAf.id}/attachments`, { filename: 'af.png', mime: 'image/png', dataBase64: PNG3 })).json.attachments.find((a) => a.filename === 'af.png');
const fOpen = (await api('POST', `/api/orders/${oOpen.id}/attachments`, { filename: 'open.png', mime: 'image/png', dataBase64: PNG4 })).json.attachments.find((a) => a.filename === 'open.png');
const pdfOpen = (await api('POST', `/api/orders/${oAf.id}/attachments`, { filename: 'bon.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 test').toString('base64') })).json.attachments.find((a) => a.filename === 'bon.pdf');
await api('PATCH', `/api/orders/${oAf.id}`, { status: 'afgerond', notes: 'klaar' });
const cfgGet = (await api('GET', '/api/settings')).json.attachmentCleanup;
ok('standaard: aan, om de 3 dagen, afgerond na 3 dagen, alles ouder dan 30 dagen, alleen media', cfgGet.enabled === true && cfgGet.intervalDays === 3 && cfgGet.doneDays === 3 && cfgGet.days === 30 && cfgGet.mediaOnly === true, JSON.stringify(cfgGet));
const r0 = await api('POST', '/api/attachments/cleanup-run', {});
const naR0 = (await api('GET', '/api/orders?includeArchived=1')).json;
ok('net afgerond (< 3 dagen): foto blijft nog staan', r0.status === 200 && (naR0.find((o) => o.id === oAf.id).attachments || []).some((a) => a.id === fAf.id), JSON.stringify(r0.json));
const r1 = await api('POST', '/api/attachments/cleanup-run', { doneDays: 0 });
const naR1 = (await api('GET', '/api/orders?includeArchived=1')).json;
ok('afgerond + wachttijd voorbij: foto van de afgeronde opdracht is weg', r1.json.afgerond >= 1 && !(naR1.find((o) => o.id === oAf.id).attachments || []).some((a) => a.id === fAf.id), JSON.stringify(r1.json));
ok('PDF op de afgeronde opdracht blijft staan (alleen media)', (naR1.find((o) => o.id === oAf.id).attachments || []).some((a) => a.id === pdfOpen.id));
ok('foto op de OPEN opdracht (jonger dan 30 dagen) blijft staan', (naR1.find((o) => o.id === oOpen.id).attachments || []).some((a) => a.id === fOpen.id));
ok('bestand van de weggehaalde foto is van schijf', (await fetch(BASE + fAf.url, { headers: { cookie } })).status === 404);
const r2 = await api('POST', '/api/attachments/cleanup-run', { days: 0 });
const naR2 = (await api('GET', '/api/orders?includeArchived=1')).json;
ok('"ouder dan X dagen" ruimt ook foto\'s van open opdrachten op', r2.json.verouderd >= 1 && !(naR2.find((o) => o.id === oOpen.id).attachments || []).some((a) => a.id === fOpen.id), JSON.stringify(r2.json));
const laatste = (await api('GET', '/api/settings')).json.attachmentCleanupLaatste;
ok('laatste ronde wordt bijgehouden voor het scherm', laatste && laatste.at && typeof laatste.removed === 'number');
const oSig = (await api('POST', '/api/orders', { customerId: kO.id, title: 'Rhenen — met handtekening', status: 'open' })).json;
const sigAtt = (await api('POST', `/api/orders/${oSig.id}/attachments`, { filename: 'handtekening.png', mime: 'image/png', dataBase64: PNG })).json.attachments.find((a) => a.filename === 'handtekening.png');
await api('POST', `/api/orders/${oSig.id}/werkbon`, { work: 'Slot vervangen', materials: '', signatureAttachmentId: sigAtt.id });
await api('PATCH', `/api/orders/${oSig.id}`, { status: 'afgerond', notes: 'klaar' });
const r3 = await api('POST', '/api/attachments/cleanup-run', { doneDays: 0, days: 0 });
const sigNog = (await api('GET', '/api/orders?includeArchived=1')).json.find((o) => o.id === oSig.id);
ok('werkbon-handtekening overleeft elke ronde (ook met alles op 0)', r3.status === 200 && (sigNog.attachments || []).some((a) => a.id === sigAtt.id));

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

// ============================================================================
// AUDIT 28 sep 2026 — cluster D: serversnelheid en robuustheid.
// ============================================================================
cookie = adminCookie;
const http = await import('node:http');
const zlib = await import('node:zlib');
// Ruw verzoek (zonder automatische gzip-afhandeling van fetch): status, headers, bytes.
const ruw = (path, headers = {}) => new Promise((resolve, reject) => {
  const u = new URL(BASE + path);
  const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers: { cookie, ...headers } }, (rs) => {
    const delen = []; rs.on('data', (c) => delen.push(c)); rs.on('end', () => resolve({ status: rs.statusCode, headers: rs.headers, body: Buffer.concat(delen) }));
  });
  rq.on('error', reject); rq.end();
});

console.log('\n== gzip: JSON en statische bestanden (pc-browser#14 / mobiel#17 / server#5) ==');
for (let i = 0; i < 6; i++) await api('POST', '/api/orders', { customerId: kC.id, title: `Ede — gzip-kaart ${i} ${'lange omschrijving '.repeat(20)}`, status: 'open' });
const plat = await ruw('/api/orders');
const gz = await ruw('/api/orders', { 'accept-encoding': 'gzip, deflate, br' });
ok('/api/orders zonder Accept-Encoding: plat JSON (geen gzip)', plat.status === 200 && !plat.headers['content-encoding'] && Array.isArray(JSON.parse(plat.body.toString('utf8'))));
let gzJson = null; try { gzJson = JSON.parse(zlib.gunzipSync(gz.body).toString('utf8')); } catch { /* blijft null */ }
ok('/api/orders met gzip: gecomprimeerd én exact dezelfde inhoud/vorm', gz.headers['content-encoding'] === 'gzip' && /accept-encoding/i.test(String(gz.headers.vary || '')) && JSON.stringify(gzJson) === plat.body.toString('utf8'), `${gz.headers['content-encoding']} ${gz.body.length}/${plat.body.length}`);
ok('gzip scheelt echt (minder dan de helft van de bytes)', gz.body.length < plat.body.length / 2, `${gz.body.length} vs ${plat.body.length}`);
const klein = await ruw('/api/pulse', { 'accept-encoding': 'gzip' });
ok('klein antwoord (pulse) blijft plat — gzip wint daar niets', klein.status === 200 && !klein.headers['content-encoding']);
const js1 = await ruw('/js/app.js', { 'accept-encoding': 'gzip' });
const jsPlat = await ruw('/js/app.js');
ok('app.js gecomprimeerd, uitgepakt identiek aan het bestand', js1.headers['content-encoding'] === 'gzip' && zlib.gunzipSync(js1.body).equals(jsPlat.body) && /javascript/.test(js1.headers['content-type'] || ''), `${js1.headers['content-encoding']} ${js1.headers['content-type']}`);
const js304 = await ruw('/js/app.js', { 'accept-encoding': 'gzip', 'if-none-match': js1.headers.etag });
ok('app.js met gzip: tweede keer 304 (ETag werkt nog)', js304.status === 304 && !!js1.headers.etag, `${js304.status} ${js1.headers.etag}`);
const range = await ruw('/js/app.js', { 'accept-encoding': 'gzip', range: 'bytes=0-9' });
ok('range-verzoek gaat ongecomprimeerd via express.static', range.status === 206 && !range.headers['content-encoding'] && range.body.length === 10);
const geenPad = await ruw('/../server/index.js', { 'accept-encoding': 'gzip' });
ok('pad buiten public/ geeft geen broncode prijs', geenPad.status !== 200 || !geenPad.body.toString('utf8').includes('gracefulShutdown'));

console.log('\n== Facturenlijst zonder handtekening-afbeeldingen (server#8) ==');
const sigInv = (await api('POST', '/api/invoices', { customerId: kC.id, type: 'factuur' })).json.invoice;
await api('PATCH', `/api/invoices/${sigInv.id}`, { lines: [{ description: 'Cilinder', qty: 1, price: 50 }], signature: 'data:image/png;base64,' + PNG });
const invLijst = (await api('GET', '/api/invoices')).json;
const inLijst = invLijst.find((i) => i.id === sigInv.id);
ok('lijst bevat geen signature-veld meer, wel hasSignature', inLijst && !('signature' in inLijst) && inLijst.hasSignature === true && invLijst.every((i) => !('signature' in i)), JSON.stringify(inLijst && Object.keys(inLijst)));
ok('lijst houdt de regels (lines) gewoon mee', inLijst && Array.isArray(inLijst.lines) && inLijst.lines.length === 1);
const losInv = (await api('GET', `/api/invoices/${sigInv.id}`)).json;
ok('editor (GET /api/invoices/:id) krijgt de handtekening nog wel', String((losInv.invoice || losInv).signature || '').startsWith('data:image/png'));

console.log('\n== Zoekbalk: zelfde treffers, snel (server#6) ==');
const zk = (await api('POST', '/api/customers', { name: 'Zoek Testklant', phone: '+31 6 4433 2211', address: 'Kerkstraat 12, 3911AB Rhenen' })).json;
const zoek = async (q) => (await api('GET', `/api/search?q=${encodeURIComponent(q)}`)).json;
ok('postcode met spatie vindt postcode zonder spatie', (await zoek('3911 ab')).customers.some((c) => c.id === zk.id));
ok('hoofdletters maken niet uit', (await zoek('KERKSTRAAT')).customers.some((c) => c.id === zk.id));
ok('06-nummer vindt een +31-nummer met spaties', (await zoek('0644332211')).customers.some((c) => c.id === zk.id));
ok('deel van het nummer vindt hem ook', (await zoek('44332211')).customers.some((c) => c.id === zk.id));
ok('regex-tekens in de zoekvraag geven geen fout', (await api('GET', '/api/search?q=' + encodeURIComponent('(.*+?['))).status === 200);
await api('POST', '/api/ingest/email', { from: 'Bericht Zoeker <zoeker@example.nl>', subject: 'Vraag over slot', body: 'Mijn uniekewoordzoek deur klemt.' }, true);
ok('bericht wordt gevonden (van nieuw naar oud)', (await zoek('uniekewoordzoek')).messages.length === 1);

console.log('\n== Bijlage-upload: snel pad, ruwe route, zelfde ontdubbeling (server GEMIST 1) ==');
const upK = (await api('POST', '/api/orders', { customerId: kC.id, title: 'Ede — upload-test', status: 'open' })).json;
const PNG_BYTES = Buffer.from(PNG, 'base64');
const upJson = await api('POST', `/api/orders/${upK.id}/attachments`, { filename: 'json.png', mime: 'image/png', dataBase64: 'data:image/png;base64,' + PNG });
const attJ = (upJson.json?.attachments || []).find((a) => a.filename === 'json.png');
ok('JSON-upload (data-URL) werkt via de snelle lezer', upJson.status === 200 && !!attJ && attJ.size === PNG_BYTES.length, JSON.stringify(upJson.json?.error || attJ));
const terug = attJ ? await fetch(BASE + attJ.url, { headers: { cookie } }) : null;
ok('opgeslagen bytes zijn exact de geüploade bytes', !!terug && Buffer.from(await terug.arrayBuffer()).equals(PNG_BYTES));
const upRaw = await fetch(BASE + `/api/orders/${upK.id}/attachments/raw?filename=ruw.png`, { method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body: PNG_BYTES });
const upRawJ = await upRaw.json();
ok('ruwe upload van dezelfde inhoud → herkend als dubbel (geen tweede verwijzing)', upRaw.status === 200 && upRawJ.dubbel === true && upRawJ.attachments.length === 1, JSON.stringify({ s: upRaw.status, d: upRawJ.dubbel, n: upRawJ.attachments?.length }));
const ander = Buffer.from(PNG2, 'base64');
const upRaw2 = await fetch(BASE + `/api/orders/${upK.id}/attachments/raw?filename=${encodeURIComponent('twee"\n.png')}`, { method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body: ander });
const upRaw2J = await upRaw2.json();
const attR = (upRaw2J.attachments || []).find((a) => a.size === ander.length);
ok('ruwe upload van een andere foto → nieuwe bijlage, nette bestandsnaam', upRaw2.status === 200 && !!attR && attR.kind === 'image' && !/["\n]/.test(attR.filename), JSON.stringify(attR));
const teGroot = await fetch(BASE + `/api/orders/${upK.id}/attachments/raw?filename=groot.mp4`, { method: 'POST', headers: { cookie, 'content-type': 'video/mp4' }, body: Buffer.alloc(26 * 1024 * 1024, 1) });
ok('ruwe upload boven 25 MB → 413 met uitleg', teGroot.status === 413 && /25 MB/.test((await teGroot.json()).error || ''));
const escJson = await api('POST', `/api/orders/${upK.id}/attachments`, { filename: 'met "aanhalingstekens".png', mime: 'image/png', dataBase64: 'data:image\\/png;base64,' + PNG3 });
ok('JSON met escape-tekens valt veilig terug op de gewone lezer', escJson.status === 200 && (escJson.json.attachments || []).some((a) => a.filename === 'met "aanhalingstekens".png'), JSON.stringify(escJson.json?.error));
const kapot = await fetch(BASE + `/api/orders/${upK.id}/attachments`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"filename":"x.png","dataBase64":"abc' });
ok('kapotte JSON → 400 (geen crash)', kapot.status === 400);
await login('monteur-audit@keyservice.nl', 'monteur123');
ok('monteur kan niet ruw uploaden op andermans kaart', (await fetch(BASE + `/api/orders/${upK.id}/attachments/raw?filename=x.png`, { method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body: PNG_BYTES })).status === 403);
cookie = adminCookie;

// ---------- AUDIT 28 sep 2026 — cluster A: opdracht-venster & data-integriteit ----------
console.log('\n== 28 sep: opdracht-venster — intake, gelijktijdig bewerken, één opdracht ophalen ==');
cookie = adminCookie;
const kI = (await api('POST', '/api/customers', { name: 'Intake Klant', phone: '0655500777', email: 'intake@example.nl', address: 'Oudeweg 1, 3911 AA Rhenen' })).json;
const oI = (await api('POST', '/api/orders', { customerId: kI.id, title: 'Utrecht — intake-test', status: 'open' })).json;
// Aanvraag-gegevens zoals de pipeline/plak-route ze zet (oude client: alle vier velden).
await api('PATCH', `/api/orders/${oI.id}`, { intake: { name: 'Intake Klant', phone: '0655500777', email: '', address: 'Nieuwelaan 99, 3511 AA Utrecht' } });
// Nieuw venster: alleen de prijs gewijzigd → geen intake mee → aanvraag-adres blijft.
const alleenPrijs = await api('PATCH', `/api/orders/${oI.id}`, { price: '95', basis: { price: '' } });
ok('Opslaan met alleen een prijs laat order.intake (aanvraag-adres) staan', alleenPrijs.status === 200 && alleenPrijs.json.intake?.address === 'Nieuwelaan 99, 3511 AA Utrecht', JSON.stringify(alleenPrijs.json?.intake));
// Eén intake-veld gewijzigd → alleen dát veld, de rest van de aanvraag blijft.
const telIntake = await api('PATCH', `/api/orders/${oI.id}`, { intake: { phone: '0655500778' } });
ok('gedeeltelijke intake wijzigt alleen het meegestuurde veld', telIntake.json.intake?.phone === '0655500778' && telIntake.json.intake?.address === 'Nieuwelaan 99, 3511 AA Utrecht' && telIntake.json.intake?.name === 'Intake Klant', JSON.stringify(telIntake.json?.intake));
ok('klantrecord bleef ongemoeid (WET 3)', (await api('GET', '/api/customers')).json.find((c) => c.id === kI.id)?.address === 'Oudeweg 1, 3911 AA Rhenen');
// Collega zet de notitie; dit venster zag nog '' en wijzigt zelf de notitie → 409.
await api('PATCH', `/api/orders/${oI.id}`, { notes: 'Collega: klant belt terug' });
const botsing = await api('PATCH', `/api/orders/${oI.id}`, { notes: 'Mijn notitie', basis: { notes: '' } });
ok('gelijktijdig bewerkt veld → 409 met nette melding, niets overschreven', botsing.status === 409 && botsing.json?.conflict && /intussen/.test(botsing.json?.error || '') && (await api('GET', `/api/orders/${oI.id}`)).json.notes === 'Collega: klant belt terug', JSON.stringify(botsing.json));
const geenBotsing = await api('PATCH', `/api/orders/${oI.id}`, { price: '120', basis: { price: '95' } });
ok('ander veld wijzigen terwijl de collega de notitie aanpaste = gewoon opslaan', geenBotsing.status === 200 && geenBotsing.json.notes === 'Collega: klant belt terug' && geenBotsing.json.price === '120');
ok('oude client zonder basis werkt ongewijzigd', (await api('PATCH', `/api/orders/${oI.id}`, { notes: 'Oude client' })).status === 200);
const een = await api('GET', `/api/orders/${oI.id}`);
ok('GET /api/orders/:id geeft één opdracht mét klant', een.status === 200 && een.json.id === oI.id && een.json.customer?.id === kI.id);
await api('DELETE', `/api/orders/${oI.id}`);
const wegI = await api('GET', `/api/orders/${oI.id}`);
ok('GET /api/orders/:id in de prullenbak → 404 met uitleg', wegI.status === 404 && /prullenbak/.test(wegI.json?.error || ''));
const vreemd = (await api('POST', '/api/orders', { customerId: kI.id, title: 'Ede — kaart van Abdel', status: 'open', monteurId: mont2.id })).json;
await login('monteur-audit@keyservice.nl', 'monteur123');
ok('monteur kan andermans opdracht niet los ophalen', (await api('GET', `/api/orders/${vreemd.id}`)).status === 403);
cookie = adminCookie;

console.log('\n== 28 sep: afwijzen + ongedaan maken laat geen leersignaal achter ==');
await api('POST', '/api/ingest/whatsapp', { from: '31655500888@c.us', fromPhone: '31655500888', name: 'Undo Klant', body: 'Mijn voordeur klemt, kunt u langskomen?\nTelefoon: +31655500888', externalId: 'aud-undo-1' }, true);
const revsU = (await api('GET', '/api/reviews')).json;
const revU = (revsU.items || revsU || []).find((r) => /0655500888|31655500888/.test(JSON.stringify(r)));
const fbVoor = ((await api('GET', '/api/feedback')).json || []).length;
if (revU) {
  await api('POST', `/api/reviews/${revU.id}/reject`, {});
  const fbTussen = ((await api('GET', '/api/feedback')).json || []).length;
  await api('POST', `/api/reviews/${revU.id}/restore`, {});
  const fbNa = ((await api('GET', '/api/feedback')).json || []);
  ok('afwijzen voegt een leervoorbeeld toe', fbTussen === fbVoor + 1, `${fbVoor} -> ${fbTussen}`);
  ok('"Ongedaan maken" haalt dat leervoorbeeld weer weg', fbNa.length === fbVoor && !fbNa.some((f) => f.reviewId === revU.id), `${fbVoor} -> ${fbNa.length}`);
} else ok('aanvraag voor ongedaan-maken-test staat in de inbox', false);

console.log('\n== 28 sep: Nog te factureren telt alleen een échte factuur ==');
const kT = (await api('POST', '/api/customers', { name: 'Todo Klant', phone: '0655500999' })).json;
const oOff = (await api('POST', '/api/orders', { customerId: kT.id, title: 'Rhenen — alleen offerte', status: 'afgerond' })).json;
await api('POST', `/api/orders/${oOff.id}/invoice`, { type: 'offerte', lines: [{ description: 'Slot', qty: 1, priceExcl: 100 }] });
const oLeeg = (await api('POST', '/api/orders', { customerId: kT.id, title: 'Rhenen — lege factuur', status: 'afgerond' })).json;
const leeg = (await api('POST', '/api/invoices', { customerId: kT.id, orderId: oLeeg.id, type: 'factuur' })).json;
const oEcht = (await api('POST', '/api/orders', { customerId: kT.id, title: 'Rhenen — echte factuur', status: 'afgerond' })).json;
await api('POST', `/api/orders/${oEcht.id}/invoice`, { type: 'factuur', lines: [{ description: 'Cilinder', qty: 1, priceExcl: 80 }] });
const todo = (await api('GET', '/api/invoices/todo')).json || [];
ok('afgeronde opdracht met alleen een OFFERTE staat nog in "Nog te factureren"', todo.some((t) => t.id === oOff.id));
const leegRij = todo.find((t) => t.id === oLeeg.id);
ok('lege €0-factuur (nooit verstuurd) telt niet als gefactureerd — en "afmaken" wijst naar die factuur', !!leegRij && leegRij.leegFactuurId === (leeg.invoice || leeg).id, JSON.stringify(leegRij));
ok('opdracht met een echte factuur (bedrag > 0) staat er niet meer in', !todo.some((t) => t.id === oEcht.id));

console.log(`\n========== AUDIT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
