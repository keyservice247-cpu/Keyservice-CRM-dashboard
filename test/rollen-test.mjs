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
// HANDTEKENING PER MEDEWERKER (23 sep): de assistente mailt automatisch onder eigen naam.
{
  const me = (await api('GET', '/api/me')).json;
  const sig = String(me?.meta?.emailSignature || '');
  ok('assistente: /api/me toont haar EIGEN handtekening (naam + standaardfunctie)', /Met vriendelijke groet,\nAssistente Test\nAssistente \| Key Service 24\/7/.test(sig), JSON.stringify(sig));
  ok('assistente: geen "Team Key Service" meer onder haar mails', !/Team Key Service/.test(sig));
  const assUser = (await (async () => { cookie = adminCookie; const l = (await api('GET', '/api/users')).json; cookie = ''; return l; })()).find((u) => u.email === 'assistente@keyservice.nl');
  cookie = adminCookie;
  ok('beheerder: voorbeeld per medewerker (GET /api/users/:id/handtekening)', (await api('GET', `/api/users/${assUser.id}/handtekening`)).json?.eigen === true);
  await api('PATCH', `/api/users/${assUser.id}`, { functie: 'Officemanager | Key Service 24/7', sigTel: '06 1234 5678' });
  const vb = (await api('GET', `/api/users/${assUser.id}/handtekening`)).json;
  ok('beheerder: functie + eigen telefoon werken door in haar handtekening', /Officemanager \| Key Service 24\/7\n06 1234 5678/.test(vb.tekst || ''), JSON.stringify(vb));
  await api('PATCH', `/api/users/${assUser.id}`, { sigUit: true });
  const vb2 = (await api('GET', `/api/users/${assUser.id}/handtekening`)).json;
  ok('"vaste bedrijfshandtekening" → geen eigen naam, vaste tekst', vb2.eigen === false && /Team Key Service/.test(vb2.tekst || ''), JSON.stringify(vb2));
  await api('PATCH', `/api/users/${assUser.id}`, { sigUit: false });
  ok('beheerder zelf ("Beheerder" zonder functie) houdt de vaste handtekening', /Team Key Service/.test(String((await api('GET', '/api/me')).json?.meta?.emailSignature || '')));
  const tm = await api('POST', '/api/test-mail', { to: 'x@example.nl', type: 'handtekening', userId: assUser.id });
  ok('testmail als medewerker: route bestaat (zonder SMTP nette 400, geen 404/500)', tm.status === 400 && /SMTP/.test(tm.json?.error || ''), JSON.stringify(tm.json));
  await login('assistente@keyservice.nl', 'assist123');
}
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

console.log('\n== Monteur maakt/plakt zelf een opdracht (noodroute bridge stil, 10 sep) ==');
cookie = adminCookie;
const montRec = await api('POST', '/api/monteurs', { name: 'Youssef Zelf', phone: '0612000001' });
const andereMont = await api('POST', '/api/monteurs', { name: 'Piotr Ander', phone: '0612000002' });
await api('POST', '/api/users', { name: 'Monteur Zelf', email: 'monteurzelf@keyservice.nl', password: 'monteur123', role: 'monteur', monteurId: montRec.json?.id });
ok('gekoppelde monteur inloggen', (await login('monteurzelf@keyservice.nl', 'monteur123')).status === 200);
const eigen = await api('POST', '/api/orders', { customerName: 'Zelf Klant', customerPhone: '0612777001', title: 'Veenendaal — slot kapot', monteurId: andereMont.json?.id, price: '250' });
ok('monteur maakt zelf een kaart', eigen.status === 200 && !!eigen.json?.id, JSON.stringify(eigen.json));
ok('kaart hangt aan HEMZELF (opgegeven collega genegeerd), prijs blijft leeg', eigen.json?.monteurId === montRec.json?.id && eigen.json?.price === '' && eigen.json?.source === 'Handmatig (monteur)');
ok('kaart staat op zijn eigen bord', (await api('GET', '/api/orders')).json.some((o) => o.id === eigen.json.id));
const drs = 'Hallo. We sturen je de volgende klant:\nNaam: Plak Klant\nAdres: Kerkstraat 5\nWoonplaats: 3901 AB - Veenendaal\nTelefoon: 0612777002\nOpmerkingen: voordeur klemt';
const geplakt = await api('POST', '/api/orders/paste', { text: drs });
ok('monteur plakt zelf een DRS-opdracht', geplakt.status === 200 && /^Veenendaal — /.test(geplakt.json?.title || ''), JSON.stringify(geplakt.json?.title));
ok('geplakte kaart hangt aan hemzelf', geplakt.json?.monteurId === montRec.json?.id);
// Start-pagina van de monteur (browser-audit 16 sep): alleen eigen cijfers, geen
// inbox-teller, geen logboek van collega's.
const ovM = await api('GET', '/api/overview');
const eigenKaarten = (await api('GET', '/api/orders')).json.length;
ok('monteur-overzicht telt alleen zijn eigen kaarten', ovM.status === 200 && ovM.json.kpis.actief === eigenKaarten, JSON.stringify({ actief: ovM.json?.kpis?.actief, eigen: eigenKaarten }));
ok('monteur-overzicht: geen "te controleren" en geen logboek', ovM.json.kpis.teControleren === 0 && Array.isArray(ovM.json.activity) && ovM.json.activity.length === 0);
cookie = adminCookie;
const zelfKaart = (await api('GET', '/api/orders')).json.find((o) => o.id === geplakt.json.id);
ok('server markeert: zelf aangemaakt (geen dispatch naar eigen groep)', zelfKaart?.zelfAangemaaktDoorMonteur === true && !zelfKaart?.sentToMonteur);
ok('NIET-gekoppelde monteur mag geen kaart maken (403 met uitleg)', (await login('monteurlos@keyservice.nl', 'monteur123')).status === 200 && (await api('POST', '/api/orders', { customerName: 'X', customerPhone: '0612777003', title: 'x' })).status === 403);
ok('NIET-gekoppelde monteur mag ook niet plakken', (await api('POST', '/api/orders/paste', { text: drs })).status === 403);
cookie = adminCookie;

console.log('\n== Werkbon-handtekening is beschermd ==');
const sig = await api('POST', `/api/orders/${orderId}/attachments`, { filename: 'handtekening.png', mime: 'image/png', dataBase64: Buffer.from('png').toString('base64') });
const sigId = (sig.json?.attachments || []).slice(-1)[0]?.id;
await api('POST', `/api/orders/${orderId}/werkbon`, { work: 'Slot vervangen', materials: 'cilinder', signatureAttachmentId: sigId });
const browse = (await api('GET', '/api/attachments/browse')).json || [];
const lijst = Array.isArray(browse) ? browse : (browse.items || []);
ok('handtekening staat NIET in de opruimlijst', !lijst.some((x) => x.id === sigId || x.attachmentId === sigId));
const del = await api('POST', '/api/attachments/bulk-delete', { ids: [sigId] });
ok('handtekening kan NIET worden verwijderd', del.status !== 200 || !(del.json?.removed > 0), JSON.stringify(del.json));

console.log('\n== Facturen vastpinnen (16 okt 2026) ==');
{
  cookie = adminCookie;
  const pin = await api('POST', `/api/invoices/${invId}/pin`, { pin: true, notitie: 'klant belt vrijdag terug' });
  ok('beheerder pint een factuur vast (met reden)', pin.status === 200 && pin.json?.vastgepind?.notitie === 'klant belt vrijdag terug' && !!pin.json?.vastgepind?.at, JSON.stringify(pin.json));
  const lijst = (await api('GET', '/api/invoices')).json || [];
  ok('lijst geeft vastgepind mee (wie + wanneer)', !!lijst.find((i) => i.id === invId)?.vastgepind?.door);
  const eersteAt = pin.json?.vastgepind?.at;
  // Vergrendelde factuur (betaald + verstuurd): vastpinnen is alleen een markering en mag dus.
  const los = await api('POST', '/api/invoices', { customerId: klantId, type: 'factuur' });
  const losId = los.json?.invoice?.id;
  await api('PATCH', `/api/invoices/${losId}`, { lines: [{ description: 'Cilinder', qty: 1, priceExcl: 50 }], btwPct: 21 });
  await api('POST', `/api/invoices/${losId}/status`, { status: 'betaald' });
  const db0 = (await api('GET', `/api/invoices/${losId}`)).json?.invoice || {};
  ok('pinnen kan óók op een betaalde factuur', (await api('POST', `/api/invoices/${losId}/pin`, { pin: true })).status === 200 && db0.status === 'betaald');
  // Assistente: reden aanpassen houdt het oorspronkelijke moment + wie.
  await login('assistente@keyservice.nl', 'assist123');
  const bij = await api('POST', `/api/invoices/${invId}/pin`, { pin: true, notitie: 'nu urgent' });
  ok('assistente mag vastpinnen / reden bijwerken', bij.status === 200 && bij.json?.vastgepind?.notitie === 'nu urgent');
  ok('reden bijwerken houdt tijdstip en wie vast', bij.json?.vastgepind?.at === eersteAt && bij.json?.vastgepind?.door === pin.json?.vastgepind?.door, JSON.stringify(bij.json));
  const losmaken = await api('POST', `/api/invoices/${invId}/pin`, { pin: false });
  ok('assistente maakt hem los', losmaken.status === 200 && losmaken.json?.vastgepind === null);
  ok('losgemaakt staat niet meer gemarkeerd in de lijst', !((await api('GET', '/api/invoices')).json || []).find((i) => i.id === invId)?.vastgepind);
  ok('onbekende factuur -> 404', (await api('POST', '/api/invoices/bestaatniet/pin', { pin: true })).status === 404);
  // Monteur: niet (kantoorwerk).
  await login('monteurzelf@keyservice.nl', 'monteur123');
  ok('monteur mag NIET vastpinnen (403)', (await api('POST', `/api/invoices/${losId}/pin`, { pin: false })).status === 403);
  cookie = adminCookie;
  ok('pin van de monteur-poging bleef staan', !!((await api('GET', '/api/invoices')).json || []).find((i) => i.id === losId)?.vastgepind);
  const kopie = await api('POST', `/api/invoices/${losId}/copy`, {});
  const kopieInv = kopie.json?.invoice || kopie.json || {};
  ok('kopie neemt de pin NIET mee', kopie.status === 200 && !!kopieInv.id && !kopieInv.vastgepind, JSON.stringify(kopie.json).slice(0, 160));
}

console.log('\n== Factuur afschrijven / oninbaar (16 okt 2026) ==');
{
  cookie = adminCookie;
  const maak = async () => {
    const r = await api('POST', '/api/invoices', { customerId: klantId, type: 'factuur' });
    const id = r.json?.invoice?.id;
    await api('PATCH', `/api/invoices/${id}`, { lines: [{ description: 'Slot', qty: 1, priceExcl: 80 }], btwPct: 21 });
    return id;
  };
  const a = await maak();
  ok('concept afschrijven kan NIET (alleen verstuurde open factuur)', (await api('POST', `/api/invoices/${a}/status`, { status: 'concept' })).status === 200
    && (await api('POST', `/api/invoices/${a}/status`, { status: 'oninbaar' })).status === 400);
  await api('POST', `/api/invoices/${a}/status`, { status: 'verzonden' });
  await login('monteurzelf@keyservice.nl', 'monteur123');
  ok('monteur mag niet afschrijven (403 of geen toegang)', [403].includes((await api('POST', `/api/invoices/${a}/status`, { status: 'oninbaar' })).status));
  await login('assistente@keyservice.nl', 'assist123');
  const af = await api('POST', `/api/invoices/${a}/status`, { status: 'oninbaar', reden: 'klant reageert niet' });
  ok('assistente schrijft af (met reden, wie, wanneer)', af.status === 200 && af.json?.status === 'oninbaar' && af.json?.oninbaar?.reden === 'klant reageert niet' && !!af.json?.oninbaar?.door, JSON.stringify(af.json?.oninbaar));
  ok('afgeschreven factuur: geen herinnering mogelijk', (await api('POST', `/api/invoices/${a}/remind`, {})).status === 400);
  const opnieuw = await api('POST', `/api/invoices/${a}/send`, { to: 'klant@example.nl' });
  ok('afgeschreven factuur kan niet opnieuw worden verstuurd (eerst terug naar open)', opnieuw.status === 400 && /afgeschreven/i.test(opnieuw.json?.error || ''), JSON.stringify(opnieuw.json));
  ok('afgeschreven → concept kan niet', (await api('POST', `/api/invoices/${a}/status`, { status: 'concept' })).status === 400);
  const terug = await api('POST', `/api/invoices/${a}/status`, { status: 'verzonden' });
  ok('terug naar open: status verzonden, afschrijving bewaard als historie', terug.status === 200 && terug.json?.status === 'verzonden' && !terug.json?.oninbaar && terug.json?.oninbaarGeweest?.reden === 'klant reageert niet');
  await api('POST', `/api/invoices/${a}/status`, { status: 'oninbaar' });
  const betaald = await api('POST', `/api/invoices/${a}/status`, { status: 'betaald' });
  ok('afgeschreven maar toch betaald → betaald + betaaldatum', betaald.status === 200 && betaald.json?.status === 'betaald' && !!betaald.json?.paidAt);
  cookie = adminCookie;
  ok('offerte afschrijven kan niet', (await (async () => { const q = await api('POST', '/api/invoices', { customerId: klantId, type: 'offerte' }); return api('POST', `/api/invoices/${q.json?.invoice?.id}/status`, { status: 'oninbaar' }); })()).status === 400);
}

console.log('\n== Monteur: nieuwe offerte/factuur voor een bestaande, afgeronde klant (26 okt 2026) ==');
{
  cookie = adminCookie;
  // Oude klus van Youssef Zelf: afgerond, met (standaard betaalde) factuur.
  const oud = await api('POST', '/api/orders', { customerName: 'Oude Klant', customerPhone: '0612777055', customerEmail: 'oud@example.nl', title: 'Ede — slot vervangen', monteurId: montRec.json?.id });
  const oudId = oud.json?.id; const oudKlant = oud.json?.customerId;
  const oudInv = await api('POST', `/api/orders/${oudId}/invoice`, { lines: [{ description: 'Slot', qty: 1, priceExcl: 120 }], btwPct: 21, type: 'factuur' });
  const oudInvId = oudInv.json?.id || oudInv.json?.invoice?.id;
  await api('PATCH', `/api/orders/${oudId}`, { status: 'afgerond' });
  // Losse offerte van KANTOOR voor dezelfde klant: die ziet de monteur niet (alleen eigen records).
  const kantoorLos = (await api('POST', '/api/invoices', { customerId: oudKlant, type: 'offerte' })).json?.invoice?.id;
  await login('monteurzelf@keyservice.nl', 'monteur123');
  ok('monteur ziet zijn afgeronde klant bij + Factuur / + Offerte', ((await api('GET', '/api/customers')).json || []).some((c) => c.id === oudKlant));
  const d1 = await api('GET', `/api/orders/${oudId}/invoice`);
  const docs1 = d1.json?.documenten || [];
  ok('opdracht geeft de facturen/offertes van de klant mee (alleen wat hij mag zien)', d1.status === 200 && docs1.length === 1 && docs1[0].id === oudInvId && docs1[0].bijDezeOpdracht === true && !docs1.some((d) => d.id === kantoorLos), JSON.stringify(docs1));
  const off = await api('POST', '/api/invoices', { customerId: oudKlant, type: 'offerte' });
  const offId = off.json?.invoice?.id;
  ok('monteur maakt een NIEUWE offerte voor de afgeronde klant (los, eigen nummer)', off.status === 200 && off.json?.invoice?.type === 'offerte' && !off.json.invoice.orderId && /^OFF-/.test(off.json.invoice.number || ''), JSON.stringify(off.json?.invoice));
  const wijzig = await api('PATCH', `/api/invoices/${offId}`, { lines: [{ description: 'Cilinder', qty: 2, priceExcl: 45 }], btwPct: 21 });
  ok('monteur kan zijn nieuwe offerte wijzigen', wijzig.status === 200 && wijzig.json?.lines?.length === 1 && wijzig.json.lines[0].qty === 2, JSON.stringify(wijzig.json?.lines));
  const fact = await api('POST', '/api/invoices', { customerId: oudKlant, type: 'factuur' });
  const factId = fact.json?.invoice?.id;
  ok('…en een nieuwe factuur', fact.status === 200 && fact.json?.invoice?.type === 'factuur' && !fact.json.invoice.orderId);
  const docs2 = (await api('GET', `/api/orders/${oudId}/invoice`)).json?.documenten || [];
  ok('daarna staan de nieuwe documenten erbij (los), de oude factuur blijft "bij deze opdracht"', docs2.length === 3 && docs2.some((d) => d.id === offId && !d.bijDezeOpdracht) && docs2.some((d) => d.id === oudInvId && d.bijDezeOpdracht), JSON.stringify(docs2.map((d) => [d.number, d.bijDezeOpdracht])));
  const oudNa = (await api('GET', `/api/orders/${oudId}`)).json;
  ok('de afgeronde opdracht blijft ongemoeid (status + gekoppelde factuur)', oudNa?.status === 'afgerond' && oudNa?.invoiceId === oudInvId, JSON.stringify({ s: oudNa?.status, i: oudNa?.invoiceId }));
  ok('nieuwe offerte staat in zijn Facturen-lijst', ((await api('GET', '/api/invoices')).json || []).some((i) => i.id === offId));
  ok('niet voor een klant van een collega/kantoor (403)', (await api('POST', '/api/invoices', { customerId: klantId, type: 'offerte' })).status === 403);
  // Cijfers: een betaalde LOSSE factuur van de monteur telt bij die monteur (uitbetaling).
  await api('PATCH', `/api/invoices/${factId}`, { lines: [{ description: 'Extra sleutel', qty: 1, priceExcl: 30 }], btwPct: 21 });
  await api('POST', `/api/invoices/${factId}/status`, { status: 'betaald' });
  cookie = adminCookie;
  await api('POST', '/api/finance/autosync', {});
  const maand = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 7);
  const boeking = ((await api('GET', `/api/finance?month=${maand}`)).json?.report?.entries || []).find((e) => e.sourceRef === `inv:${factId}`);
  ok('Cijfers: betaalde losse factuur van de monteur staat bij die monteur', boeking?.monteurId === montRec.json?.id, JSON.stringify(boeking));
}

console.log('\n== Klantadres verbeterd: het adres van de lopende opdracht volgt (23 nov 2026) ==');
{
  // De monteur verbetert op zijn kaart het klantadres. Het adres van de opdracht (dat naar de
  // monteur gaat en als reparatielocatie op de factuur staat) was een kopie van het oude
  // klantadres en gaat dus mee. Een afwijkend werkadres en een afgeronde opdracht niet.
  cookie = adminCookie;
  const mk = async (naam, tel, adres, extra = {}) => (await api('POST', '/api/orders', { customerName: naam, customerPhone: tel, customerAddress: adres, title: 'Ede — adresproef', monteurId: montRec.json?.id, ...extra })).json;
  const oA = await mk('Adres Volgt Klant', '0612777071', 'Oudeweg 1, 6711 AA Ede');
  await login('monteurzelf@keyservice.nl', 'monteur123');
  const pA = await api('PATCH', `/api/customers/${oA.customerId}`, { address: 'Oudeweg 11, 6711 AA Ede' });
  const edA = await api('GET', `/api/orders/${oA.id}/invoice`);
  ok('monteur verbetert het klantadres → de reparatielocatie van zijn lopende opdracht volgt', pA.status === 200 && edA.json?.reparatieAdresStandaard === 'Oudeweg 11, 6711 AA Ede', JSON.stringify([pA.status, edA.json?.reparatieAdresStandaard]));
  cookie = adminCookie;
  ok('…en het adres dat naar de monteur gaat ook (order.intake)', (await api('GET', `/api/orders/${oA.id}`)).json?.intake?.address === 'Oudeweg 11, 6711 AA Ede');
  // Afwijkend werkadres op de opdracht: blijft staan.
  const oB = await mk('Adres Werk Klant', '0612777072', 'Thuisweg 2, 6711 AB Ede');
  await api('PATCH', `/api/orders/${oB.id}`, { intake: { address: 'Loods 9, Havenweg 3, 6712 AC Ede' } });
  await api('PATCH', `/api/customers/${oB.customerId}`, { address: 'Thuisweg 22, 6711 AB Ede' });
  ok('een afwijkend werkadres op de opdracht blijft staan als het klantadres wijzigt', (await api('GET', `/api/orders/${oB.id}`)).json?.intake?.address === 'Loods 9, Havenweg 3, 6712 AC Ede');
  // Afgeronde opdracht: het adres waar het werk is gedaan verandert niet meer.
  const oC = await mk('Adres Klaar Klant', '0612777073', 'Klaarweg 3, 6711 AC Ede');
  await api('PATCH', `/api/orders/${oC.id}`, { status: 'afgerond', note: 'klaar' });
  await api('PATCH', `/api/customers/${oC.customerId}`, { address: 'Klaarweg 33, 6711 AC Ede' });
  ok('een afgeronde opdracht houdt het adres waar het werk is gedaan', (await api('GET', `/api/orders/${oC.id}`)).json?.intake?.address === 'Klaarweg 3, 6711 AC Ede');
}

console.log('\n== Reparatielocatie + factuur corrigeren: wie mag wat (23 nov 2026) ==');
{
  cookie = adminCookie;
  // Opdracht van de gekoppelde monteur, met een eigen adres; factuur erop (betaald, nog niet verstuurd).
  const oR = await api('POST', '/api/orders', { customerName: 'Locatie Rol Klant', customerPhone: '0612777066', customerEmail: 'locrol@example.nl', customerAddress: 'Klantweg 1, 6711 AA Ede', title: 'Ede — cilinder', monteurId: montRec.json?.id });
  const oRid = oR.json?.id;
  const regels = [{ description: 'Cilinder', qty: 1, priceExcl: 60 }];
  const fR = await api('POST', `/api/orders/${oRid}/invoice`, { lines: regels, btwPct: 21, type: 'factuur' });
  const fRid = fR.json?.id;
  await login('monteurzelf@keyservice.nl', 'monteur123');
  const edR = await api('GET', `/api/orders/${oRid}/invoice`);
  ok('monteur: editor van zijn eigen opdracht geeft de standaard-reparatielocatie mee', edR.status === 200 && edR.json?.reparatieAdresStandaard === 'Klantweg 1, 6711 AA Ede', JSON.stringify(edR.json?.reparatieAdresStandaard));
  const zet = await api('PATCH', `/api/invoices/${fRid}`, { lines: regels, btwPct: 21, reparatieAdres: 'Schuur achter nr. 3, Klantweg 1a, 6711 AA Ede' });
  ok('monteur vult de reparatielocatie in op de factuur van zijn eigen opdracht', zet.status === 200 && zet.json?.reparatieAdres === 'Schuur achter nr. 3, Klantweg 1a, 6711 AA Ede', JSON.stringify([zet.status, zet.json?.reparatieAdres, zet.json?.error]));
  const zet2 = await api('POST', `/api/orders/${oRid}/invoice`, { lines: regels, btwPct: 21, type: 'factuur', reparatieAdres: '' });
  ok('…en maakt hem via de opdracht weer leeg (terug naar de standaard)', zet2.status === 200 && !zet2.json?.reparatieAdres);
  await login('monteurlos@keyservice.nl', 'monteur123');
  ok('andere monteur: geen toegang tot die factuur (403)', (await api('PATCH', `/api/invoices/${fRid}`, { lines: regels, btwPct: 21, reparatieAdres: 'Elders 1' })).status === 403);
  // Verstuurd + betaald = vergrendeld. Corrigeren binnen hetzelfde nummer is kantoorwerk.
  await login('monteurzelf@keyservice.nl', 'monteur123');
  const stuur = await api('POST', `/api/invoices/${fRid}/send-whatsapp`, { betaald: true });
  ok('monteur verstuurt zijn factuur als betaald (daarna vergrendeld)', stuur.status === 200 && stuur.json?.status === 'betaald', JSON.stringify(stuur.json));
  const meer = [{ description: 'Cilinder', qty: 2, priceExcl: 60 }];
  const mCorr = await api('PATCH', `/api/invoices/${fRid}`, { lines: meer, btwPct: 21, correctie: { reden: 'Verkeerd aantal' } });
  ok('monteur mag een vergrendelde factuur NIET corrigeren (403, ook op zijn eigen opdracht)', mCorr.status === 403 && /kantoor/.test(mCorr.json?.error || ''), JSON.stringify([mCorr.status, mCorr.json?.error]));
  ok('monteur zonder correctie: geweigerd zoals altijd (400)', (await api('PATCH', `/api/invoices/${fRid}`, { lines: meer, btwPct: 21 })).status === 400);
  ok('monteur via de opdracht-route: ook 403', (await api('POST', `/api/orders/${oRid}/invoice`, { lines: meer, btwPct: 21, type: 'factuur', correctie: { reden: 'Verkeerd aantal' } })).status === 403);
  cookie = adminCookie;
  const onaangeroerd = (await api('GET', `/api/invoices/${fRid}`)).json?.invoice || {};
  ok('na de pogingen van de monteur is de factuur ongewijzigd', onaangeroerd.totalExcl === 60 && !onaangeroerd.correcties, JSON.stringify([onaangeroerd.totalExcl, onaangeroerd.correcties]));
  await login('assistente@keyservice.nl', 'assist123');
  ok('assistente: te korte reden → 400', (await api('PATCH', `/api/invoices/${fRid}`, { lines: meer, btwPct: 21, correctie: { reden: 'x' } })).status === 400);
  const aCorr = await api('PATCH', `/api/invoices/${fRid}`, { lines: meer, btwPct: 21, correctie: { reden: 'Verkeerd aantal' } });
  ok('assistente corrigeert binnen hetzelfde nummer (200, status/betaald/verzonden blijven)', aCorr.status === 200 && aCorr.json?.number === onaangeroerd.number && aCorr.json?.status === 'betaald' && aCorr.json?.paidAt === onaangeroerd.paidAt && aCorr.json?.sentAt === onaangeroerd.sentAt && aCorr.json?.totalExcl === 120, JSON.stringify([aCorr.status, aCorr.json?.error, aCorr.json?.totalExcl]));
  ok('correctie staat op naam van de assistente, met totaal van → naar', (aCorr.json?.correcties || []).length === 1 && aCorr.json.correcties[0].door === 'Assistente Test' && aCorr.json.correcties[0].vanTotaal === 72.6 && aCorr.json.correcties[0].naarTotaal === 145.2, JSON.stringify(aCorr.json?.correcties));
  cookie = adminCookie;
  const bCorr = await api('PATCH', `/api/invoices/${fRid}`, { lines: regels, btwPct: 21, correctie: { reden: 'Toch één cilinder' } });
  ok('beheerder corrigeert ook (tweede correctie erbij)', bCorr.status === 200 && (bCorr.json?.correcties || []).length === 2 && bCorr.json?.totalExcl === 60);
  // Goedgekeurde offerte: blijft dicht, ook voor kantoor met een reden.
  await login('assistente@keyservice.nl', 'assist123');
  const qR = await api('POST', '/api/invoices', { customerId: oR.json?.customerId, type: 'offerte' });
  const qRid = qR.json?.invoice?.id;
  await api('PATCH', `/api/invoices/${qRid}`, { lines: regels, btwPct: 21 });
  await api('POST', `/api/invoices/${qRid}/status`, { status: 'verzonden' });
  await api('POST', `/api/invoices/${qRid}/status`, { status: 'goedgekeurd' });
  const qCorr = await api('PATCH', `/api/invoices/${qRid}`, { lines: meer, btwPct: 21, correctie: { reden: 'Aantal aanpassen' } });
  ok('goedgekeurde offerte blijft vergrendeld, ook met correctie (400)', qCorr.status === 400 && /goedgekeurd/.test(qCorr.json?.error || ''), JSON.stringify([qCorr.status, qCorr.json?.error]));
  cookie = adminCookie;
}

console.log('\n== Merk en annuleringsreden: wie mag wat (24 nov 2026) ==');
{
  cookie = adminCookie;
  const oM = (await api('POST', '/api/orders', { customerName: 'Merk Rol Klant', customerPhone: '0612777091', title: 'Ede — schuifpui klemt', monteurId: montRec.json?.id })).json;
  ok('opdracht krijgt automatisch een merk mee (schuifpui uit de titel)', oM?.merkInfo?.key === 'schuifpui' && oM.merkInfo.bron === 'werk', JSON.stringify(oM?.merkInfo));
  await login('monteurzelf@keyservice.nl', 'monteur123');
  const mm = await api('PATCH', `/api/orders/${oM.id}`, { merk: 'keyservice', notes: 'Klant vond het te duur' });
  ok('monteur kan het merk niet wijzigen (wordt genegeerd), zijn notitie wel', mm.status === 200 && !mm.json?.merk && mm.json?.notes === 'Klant vond het te duur', JSON.stringify([mm.status, mm.json?.merk]));
  const ma = await api('PATCH', `/api/orders/${oM.id}`, { status: 'geannuleerd', annuleerReden: 'prijs' });
  ok('monteur annuleert zijn eigen opdracht en kiest de reden', ma.status === 200 && ma.json?.status === 'geannuleerd' && ma.json?.annulering?.reden === 'prijs', JSON.stringify([ma.status, ma.json?.annulering, ma.json?.error]));
  await login('monteurlos@keyservice.nl', 'monteur123');
  ok('andere monteur: geen toegang tot die opdracht', [403, 404].includes((await api('PATCH', `/api/orders/${oM.id}`, { annuleerReden: 'afstand' })).status));
  await login('assistente@keyservice.nl', 'assist123');
  const am = await api('PATCH', `/api/orders/${oM.id}`, { merk: 'keyservice' });
  ok('assistente mag het merk wel kiezen', am.status === 200 && am.json?.merk === 'keyservice' && am.json?.merkInfo?.bron === 'gekozen');
  cookie = adminCookie;
}

console.log('\n== Alle koppelingen in één oogopslag: wie mag het zien (24 nov 2026) ==');
{
  cookie = adminCookie;
  const k = await api('GET', '/api/koppelingen/status');
  const sleutels = (k.json?.regels || []).map((r) => r.sleutel).sort().join();
  ok('beheerder: acht koppelingen met stand en uitleg in gewone taal', k.status === 200 && sleutels === 'agenda,ai,mailIn,mailUit,opslag,waGroep,waOfficieel,website' && k.json.regels.every((r) => ['goed', 'let', 'fout', 'uit'].includes(r.stand) && r.naam && r.uitleg) && !!k.json.instroom, sleutels);
  ok('geen sleutel, wachtwoord of mailadres in het antwoord', !/test123|password|@keyservice|token/i.test(JSON.stringify(k.json)), JSON.stringify(k.json).slice(0, 200));
  await login('assistente@keyservice.nl', 'assist123');
  ok('assistente mag het overzicht zien (zij merkt een storing het eerst)', (await api('GET', '/api/koppelingen/status')).status === 200);
  await login('monteurzelf@keyservice.nl', 'monteur123');
  ok('monteur niet (403)', (await api('GET', '/api/koppelingen/status')).status === 403);
  cookie = adminCookie;
}

console.log('\n== Start: werklijst "Eerst doen" per rol (24 nov 2026) ==');
{
  cookie = adminCookie;
  // Opdracht van de gekoppelde monteur met een afspraak van gisteren die nog open staat.
  const gisteren = new Date(Date.now() - 86400000); const p2 = (n) => String(n).padStart(2, '0');
  const gDag = `${gisteren.getFullYear()}-${p2(gisteren.getMonth() + 1)}-${p2(gisteren.getDate())}`;
  const oE = await api('POST', '/api/orders', { customerName: 'Werklijst Klant', customerPhone: '0612777081', title: 'Ede — werklijstproef', monteurId: montRec.json?.id, status: 'afspraak_ingepland', appointmentAt: `${gDag}T10:00`, appointmentEndAt: `${gDag}T11:00` });
  const a = await api('GET', '/api/overview');
  const lijstA = a.json?.eerstDoen || [];
  ok('beheerder: Start geeft de werklijst mee, elk punt met titel, telling en bestemming', a.status === 200 && Array.isArray(a.json?.eerstDoen) && lijstA.length > 0 && lijstA.every((x) => x.sleutel && x.titel && x.aantal > 0 && x.ga), JSON.stringify(lijstA).slice(0, 300));
  ok('…met de afspraak die geweest is maar nog open staat', lijstA.some((x) => x.sleutel === 'afspraakGeweest'), lijstA.map((x) => x.sleutel).join());
  await login('assistente@keyservice.nl', 'assist123');
  const s2 = await api('GET', '/api/overview');
  ok('assistente: dezelfde werklijst, zonder één bedrag', s2.status === 200 && (s2.json?.eerstDoen || []).length > 0 && !/€|euro/i.test(JSON.stringify(s2.json.eerstDoen)), JSON.stringify(s2.json?.eerstDoen).slice(0, 200));
  await login('monteurzelf@keyservice.nl', 'monteur123');
  const m2 = await api('GET', '/api/overview');
  const lijstM = m2.json?.eerstDoen || [];
  ok('monteur: alleen punten over zijn eigen werk (geen inbox, wachtlijst, DRS of facturen van anderen)', m2.status === 200 && lijstM.every((x) => ['reactie', 'afspraakGeweest', 'factureren'].includes(x.sleutel)), lijstM.map((x) => x.sleutel).join());
  ok('monteur: zijn eigen verlopen afspraak staat erin', lijstM.some((x) => x.sleutel === 'afspraakGeweest'), JSON.stringify(lijstM).slice(0, 200));
  await login('monteurlos@keyservice.nl', 'monteur123');
  const m3 = await api('GET', '/api/overview');
  ok('monteur zonder koppeling: lege werklijst (niets van anderen)', m3.status === 200 && (m3.json?.eerstDoen || []).length === 0, JSON.stringify(m3.json?.eerstDoen));
  // AFVINKEN OP START (25 nov 2026, wens eigenaar): weg van Start tot er iets nieuws bij komt;
  // het kantoor deelt één lijst, de monteur heeft zijn eigen; een kapotte koppeling kan niet.
  {
    const punt = (lijst, k) => (lijst || []).find((x) => x.sleutel === k);
    cookie = adminCookie;
    const voor = (await api('GET', '/api/overview')).json;
    const ag = punt(voor.eerstDoen, 'afspraakGeweest');
    ok('elk werkpunt is af te vinken en draagt de id\'s van zijn onderdelen', !!ag && ag.afvinkbaar === true && Array.isArray(ag.ids) && ag.ids.length === ag.aantal && voor.eerstDoen.filter((x) => !x.sleutel.startsWith('koppeling:') && x.sleutel !== 'bridge').every((x) => x.afvinkbaar && x.ids.length === x.aantal), JSON.stringify(voor.eerstDoen.map((x) => [x.sleutel, x.afvinkbaar, (x.ids || []).length, x.aantal])));
    await login('assistente@keyservice.nl', 'assist123');
    const af = await api('POST', '/api/start/afvinken', { sleutel: 'afspraakGeweest', ids: ag.ids });
    const naAss = (await api('GET', '/api/overview')).json;
    cookie = adminCookie;
    const naAdm = (await api('GET', '/api/overview')).json;
    ok('de assistente vinkt af → het punt is weg, ook bij de beheerder (het kantoor deelt één lijst)', af.status === 200 && af.json.afgevinkt === ag.ids.length && !punt(naAss.eerstDoen, 'afspraakGeweest') && !punt(naAdm.eerstDoen, 'afspraakGeweest'), JSON.stringify({ af: af.json, a: naAdm.eerstDoen.map((x) => x.sleutel) }));
    const afInfo = punt(naAdm.eerstDoenAf, 'afspraakGeweest');
    ok('wat is afgevinkt staat apart, met wie en wanneer (voor Terugzetten)', !!afInfo && afInfo.aantal === ag.ids.length && /Assist/i.test(afInfo.door || '') && !!afInfo.at, JSON.stringify(naAdm.eerstDoenAf));
    await login('monteurzelf@keyservice.nl', 'monteur123');
    const mNa = (await api('GET', '/api/overview')).json;
    ok('de monteur ziet zijn eigen punt nog: het vinkje van kantoor raakt zijn lijst niet', !!punt(mNa.eerstDoen, 'afspraakGeweest'), mNa.eerstDoen.map((x) => x.sleutel).join());
    const mAf = await api('POST', '/api/start/afvinken', { sleutel: 'afspraakGeweest', ids: punt(mNa.eerstDoen, 'afspraakGeweest').ids });
    const mInbox = await api('POST', '/api/start/afvinken', { sleutel: 'inbox', ids: ['x'] });
    ok('de monteur vinkt zijn eigen punt af; een kantoorpunt (inbox) mag hij niet (403)', mAf.status === 200 && mAf.json.afgevinkt >= 1 && !punt((await api('GET', '/api/overview')).json.eerstDoen, 'afspraakGeweest') && mInbox.status === 403, JSON.stringify({ m: mAf.json, i: mInbox.status }));
    await api('POST', '/api/start/terugzetten', { sleutel: 'afspraakGeweest' });
    cookie = adminCookie;
    // iets NIEUWS: een tweede opdracht met een afspraak die geweest is → het punt staat er weer, met alleen de nieuwe
    const oN = await api('POST', '/api/orders', { customerName: 'Werklijst Nieuw', customerPhone: '0612777082', title: 'Ede — tweede werklijstproef', status: 'afspraak_ingepland', appointmentAt: `${gDag}T14:00`, appointmentEndAt: `${gDag}T15:00` });
    const metNieuw = punt((await api('GET', '/api/overview')).json.eerstDoen, 'afspraakGeweest');
    ok('komt er iets NIEUWS bij, dan staat het punt er weer — met alleen het nieuwe', !!metNieuw && metNieuw.aantal === 1 && metNieuw.ids.length === 1 && metNieuw.ids[0].startsWith(oN.json.id) && metNieuw.ga.open === oN.json.id, JSON.stringify(metNieuw));
    // de opdracht zelf is niet aangeraakt
    const ordNa = (await api('GET', `/api/orders/${oE.json.id}`)).json;
    ok('afvinken verandert niets aan de opdracht zelf (status en afspraak staan er nog)', ordNa.status === 'afspraak_ingepland' && !!ordNa.appointmentAt, JSON.stringify({ s: ordNa.status }));
    const onzin = await api('POST', '/api/start/afvinken', { sleutel: 'afspraakGeweest', ids: ['bestaat-niet', '<script>alert(1)</script>'] });
    const koppel = await api('POST', '/api/start/afvinken', { sleutel: 'koppeling:mailUit', ids: ['x'] });
    const brug = await api('POST', '/api/start/afvinken', { sleutel: 'bridge', ids: ['x'] });
    ok('onbekende id\'s worden genegeerd; een kapotte koppeling is niet af te vinken (400 met uitleg)', onzin.status === 200 && onzin.json.afgevinkt === 0 && koppel.status === 400 && brug.status === 400 && /koppeling/i.test(koppel.json.error || ''), JSON.stringify({ o: onzin.json, k: koppel.status, b: brug.status }));
    const terug = await api('POST', '/api/start/terugzetten', { sleutel: 'afspraakGeweest' });
    const naTerug = punt((await api('GET', '/api/overview')).json.eerstDoen, 'afspraakGeweest');
    ok('terugzetten: alles staat er weer', terug.status === 200 && terug.json.terug === ag.ids.length && !!naTerug && naTerug.aantal === ag.ids.length + 1, JSON.stringify({ t: terug.json, n: naTerug && naTerug.aantal }));
    // regels uit "Jouw dag in één oogopslag": het scherm maakt de sleutel, het kantoor deelt ze
    const dagAf = await api('POST', '/api/start/afvinken', { sleutel: 'dag', ids: ['dag:a:1abc9', 'niet goed !!'] });
    await login('assistente@keyservice.nl', 'assist123');
    const dagBijAss = (await api('GET', '/api/overview')).json.dagAf || [];
    await login('monteurzelf@keyservice.nl', 'monteur123');
    const dagMont = await api('POST', '/api/start/afvinken', { sleutel: 'dag', ids: ['dag:a:1abc9'] });
    const dagBijMont = (await api('GET', '/api/overview')).json.dagAf || [];
    cookie = adminCookie;
    ok('dagoverzicht: een afgevinkte regel geldt voor het hele kantoor; de monteur heeft er niets mee (403, lege lijst)', dagAf.status === 200 && dagAf.json.afgevinkt === 1 && dagBijAss.join() === 'dag:a:1abc9' && dagMont.status === 403 && dagBijMont.length === 0, JSON.stringify({ d: dagAf.json, a: dagBijAss, m: dagMont.status }));
    await api('POST', '/api/start/terugzetten', { sleutel: 'dag' });
    // de tegels op Start blijven de ECHTE aantallen; het lijstje volgt het vinkje
    const oV = await api('POST', '/api/orders', { customerName: 'Werklijst Vandaag', customerPhone: '0612777083', title: 'Ede — afspraak van vandaag', status: 'afspraak_ingepland', appointmentAt: new Date().toISOString() });
    const lijstVoor = (await api('GET', '/api/overview')).json;
    {
      const eerste = (lijstVoor.apptToday || []).find((x) => x.id === oV.json?.id) || {};
      await api('POST', '/api/start/afvinken', { sleutel: 'afspraakVandaag', ids: [eerste.afId] });
      const lijstNa = (await api('GET', '/api/overview')).json;
      ok('lijstje "Afspraken vandaag": één regel afvinken haalt die regel weg; de tegel blijft het echte aantal', lijstNa.apptToday.length === lijstVoor.apptToday.length - 1 && lijstNa.kpis.afsprakenVandaag === lijstVoor.kpis.afsprakenVandaag && (lijstNa.eerstDoenAf || []).some((x) => x.sleutel === 'afspraakVandaag'), JSON.stringify({ v: lijstVoor.apptToday.length, n: lijstNa.apptToday.length }));
      await api('POST', '/api/start/terugzetten', { sleutel: 'afspraakVandaag' });
      if (oV.json?.id) await api('PATCH', `/api/orders/${oV.json.id}`, { status: 'afgerond', note: 'klaar' });
    }
    // Het blok "Wacht op antwoord" op Start (start=1) laat wie als punt is afgevinkt weg; zonder vinkje is het dezelfde lijst.
    {
      const metStart = await api('GET', '/api/chats/onbeantwoord?uren=0&start=1');
      const zonder = await api('GET', '/api/chats/onbeantwoord?uren=0');
      ok('het blok "Wacht op antwoord" voor Start geeft zonder vinkjes dezelfde lijst als Berichten', metStart.status === 200 && Array.isArray(metStart.json) && metStart.json.length === zonder.json.length, JSON.stringify({ s: metStart.status, a: (metStart.json || []).length, b: (zonder.json || []).length }));
    }
    // "Afgehandeld" bij Wacht op antwoord is terug te draaien (nodig voor Ongedaan maken)
    const wachtTerug = await api('POST', '/api/chats/tel:0612999001/afgehandeld', { terug: true });
    ok('"Afgehandeld" bij Wacht op antwoord kan worden teruggedraaid', wachtTerug.status === 200 && wachtTerug.json.terug === true);
    if (oN.json?.id) await api('PATCH', `/api/orders/${oN.json.id}`, { status: 'afgerond', note: 'klaar' });
  }
  cookie = adminCookie;
  if (oE.json?.id) await api('PATCH', `/api/orders/${oE.json.id}`, { status: 'afgerond', note: 'klaar' });
}

console.log('\n== Mededelingen aan het team (26 nov 2026) ==');
{
  cookie = adminCookie;
  const leeg = await api('POST', '/api/mededelingen', { titel: '   ' });
  const verleden = await api('POST', '/api/mededelingen', { titel: 'Oud', totEnMet: '2020-01-01' });
  const m1 = await api('POST', '/api/mededelingen', { titel: 'Vrijdag om 15:00 dicht', tekst: 'Graag de bus <b>op tijd</b> terug.', voor: 'iedereen', belangrijk: true });
  const m2 = await api('POST', '/api/mededelingen', { titel: 'Alleen voor de monteurs', voor: 'monteurs' });
  const m3 = await api('POST', '/api/mededelingen', { titel: 'Alleen voor kantoor', voor: 'kantoor' });
  ok('beheerder plaatst een mededeling; zonder titel of met een einddatum in het verleden kan het niet (400)', leeg.status === 400 && verleden.status === 400 && m1.status === 200 && !!m1.json.id && m2.status === 200 && m3.status === 200, JSON.stringify({ l: leeg.status, v: verleden.status, m: m1.status }));
  const bijAdmin = await api('GET', '/api/mededelingen');
  ok('wie hem plaatst ziet hem niet zelf als ongelezen, wel in het overzicht met wie hem nog moet lezen', bijAdmin.json.mijn.length === 0 && bijAdmin.json.alle.length >= 3 && bijAdmin.json.alle.find((x) => x.id === m1.json.id).lezers.nogNiet.length >= 1 && bijAdmin.json.alle.find((x) => x.id === m1.json.id).lezers.gelezen.length === 1, JSON.stringify(bijAdmin.json.alle.find((x) => x.id === m1.json.id)?.lezers));
  await login('assistente@keyservice.nl', 'assist123');
  const bijAss = await api('GET', '/api/mededelingen');
  const assPlaatst = await api('POST', '/api/mededelingen', { titel: 'Mag niet' });
  const assTrektIn = await api('DELETE', `/api/mededelingen/${m1.json.id}`);
  ok('assistente: ziet de berichten voor iedereen en voor kantoor (niet die voor monteurs), geen overzicht; plaatsen en intrekken mag ze niet (403)', bijAss.json.mijn.map((x) => x.titel).sort().join('|') === 'Alleen voor kantoor|Vrijdag om 15:00 dicht' && !('alle' in bijAss.json) && assPlaatst.status === 403 && assTrektIn.status === 403, JSON.stringify({ t: bijAss.json.mijn.map((x) => x.titel), p: assPlaatst.status }));
  ok('de pulse meldt de ongelezen mededelingen (zo verschijnt de balk vanzelf)', ((await api('GET', '/api/pulse')).json.meded || '').split(',').filter(Boolean).length === 2);
  const gelezen = await api('POST', `/api/mededelingen/${m1.json.id}/gelezen`, {});
  const nietVoorHaar = await api('POST', `/api/mededelingen/${m2.json.id}/gelezen`, {});
  ok('"Gelezen" haalt het bericht bij haar weg; een bericht dat niet voor haar is kan ze niet afvinken (403)', gelezen.status === 200 && gelezen.json.mijn.length === 1 && nietVoorHaar.status === 403, JSON.stringify({ g: gelezen.json, n: nietVoorHaar.status }));
  await login('monteurzelf@keyservice.nl', 'monteur123');
  const bijMont = await api('GET', '/api/mededelingen');
  ok('monteur: ziet de berichten voor iedereen en voor de monteurs (niet die voor kantoor) — haar "Gelezen" geldt niet voor hem', bijMont.json.mijn.map((x) => x.titel).sort().join('|') === 'Alleen voor de monteurs|Vrijdag om 15:00 dicht' && !('alle' in bijMont.json) && bijMont.json.mijn.find((x) => x.id === m1.json.id).belangrijk === true, JSON.stringify(bijMont.json.mijn.map((x) => x.titel)));
  cookie = adminCookie;
  const lezers = (await api('GET', '/api/mededelingen')).json.alle.find((x) => x.id === m1.json.id).lezers;
  ok('beheerder ziet wie het gelezen heeft (hijzelf en de assistente) en wie nog niet', lezers.gelezen.length === 2 && lezers.nogNiet.length === lezers.aantal - 2 && lezers.nogNiet.length >= 1, JSON.stringify(lezers));
  const weg = await api('DELETE', `/api/mededelingen/${m1.json.id}`);
  await login('monteurzelf@keyservice.nl', 'monteur123');
  const naIntrekken = (await api('GET', '/api/mededelingen')).json.mijn;
  ok('intrekken: het bericht verdwijnt bij wie het nog niet las; het blijft in het overzicht staan als ingetrokken', weg.status === 200 && !naIntrekken.some((x) => x.id === m1.json.id) && !!weg.json.alle.find((x) => x.id === m1.json.id).ingetrokkenAt, JSON.stringify(naIntrekken.map((x) => x.titel)));
  cookie = adminCookie;
  for (const m of [m2, m3]) await api('DELETE', `/api/mededelingen/${m.json.id}`);
  cookie = '';
  ok('zonder inlog: geen mededelingen (401)', (await api('GET', '/api/mededelingen')).status === 401);
  cookie = adminCookie;
}

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
