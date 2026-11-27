// Test: KLANTEN ALLEEN VIA HET OFFICIËLE WHATSAPP-NUMMER (27 nov 2026, vaste regel eigenaar:
// "het moet via de officiële weg en niet via het wegwerpnummer; het wegwerpnummer wordt alleen
// gebruikt om groepen uit te lezen en opdrachten door te sturen").
// Bewaakt:
//   1. een klantbericht komt NOOIT in de wachtrij van de bridge (wegwerpnummer);
//   2. het gaat via Meta; lukt dat niet, dan probeert het CRM het zelf nog twee keer en zet het
//      daarna op mislukt — nooit alsnog via de bridge (ook niet na een latere weigering);
//   3. staat het officiële nummer uit, dan staat er binnen 10 minuten waarom het niet weg kon;
//   4. er is een knop per automatisch WhatsApp-bericht; betaal- en offerteherinnering volgen die.
// Start ZELF een nep-Meta (poort 2659) en de CRM-server (poort 3159). Er gaat niets naar buiten.
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 3159, META = 2659, BASE = `http://127.0.0.1:${PORT}`, SECRET = 'appsecret-test', TOKEN = 'test123';

// ---------- nep-Meta ----------
const ontvangen = []; let metaStuk = false; let teller = 0;
const meta = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    // Media ophalen (foto's die een klant stuurt): eerst het adres, dan het bestand zelf.
    const mediaBestand = req.url.match(/^\/media\/([\w-]+)$/);
    if (req.method === 'GET' && mediaBestand) { res.setHeader('content-type', 'image/jpeg'); res.end(Buffer.from(`nep-foto-${mediaBestand[1]}-${'x'.repeat(200)}`)); return; }
    const mediaId = req.url.match(/^\/(foto[\w-]+)$/);
    if (req.method === 'GET' && mediaId) { res.end(JSON.stringify({ url: `http://127.0.0.1:${META}/media/${mediaId[1]}`, mime_type: 'image/jpeg' })); return; }
    if (req.method !== 'POST' || !/\/messages$/.test(req.url)) { res.end(JSON.stringify({ data: [] })); return; }
    let json = {}; try { json = JSON.parse(body); } catch { /* leeg */ }
    if (metaStuk) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: 'nagebootste storing bij Meta', code: 131000 } })); return; }
    const id = `wamid.TEST${++teller}`;
    ontvangen.push({ id, naar: json.to, soort: json.type, tekst: json.text?.body || JSON.stringify(json.template || {}) });
    res.end(JSON.stringify({ messages: [{ id }] }));
  });
});
await new Promise((r) => meta.listen(META, '127.0.0.1', r));

// ---------- CRM-server ----------
const DATA = mkdtempSync(join(tmpdir(), 'crm-waroute-'));
const srv = spawn('node', ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, INGEST_TOKEN: TOKEN, SESSION_SECRET: 'test', WA_ROUTE_TEST: '1',
    WHATSAPP_CLOUD_TOKEN: 'nep-token', WHATSAPP_PHONE_ID: 'PID', WHATSAPP_APP_SECRET: SECRET, WHATSAPP_CLOUD_API_TEST: `http://127.0.0.1:${META}`,
    OMGEVING: '', SMTP_HOST: '', IMAP_HOST: '', ANTHROPIC_API_KEY: '', APP_URL: BASE },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
const stop = () => { try { srv.kill(); } catch { /* al weg */ } try { meta.close(); } catch { /* al weg */ } };
process.on('exit', stop);
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/pulse`)).status) break; } catch { /* nog niet op */ } await slaap(250); }

let cookie = '';
async function api(method, path, body, ingest = false) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(ingest ? { 'x-ingest-token': TOKEN } : { cookie }) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* geen json */ }
  return { status: r.status, json };
}
const login = (email, password) => api('POST', '/api/login', { email, password });
const heleWachtrij = async () => (await api('GET', '/api/whatsapp/outbox-status?full=1')).json || [];
const alles = async () => (await api('GET', '/api/whatsapp/outbox-status')).json || [];
const vind = async (id) => (await alles()).find((o) => o.id === id) || (await heleWachtrij()).find((o) => o.id === id);
const ronde = (extra = {}) => api('POST', '/api/whatsapp/test-ronde', { nu: true, ...extra });

try {
  await login('admin@keyservice.nl', 'admin123');
  const inst = (await api('GET', '/api/settings')).json;
  console.log('\n== Uitgangspunt ==');
  ok('officiële route staat AAN zodra hij is ingesteld (geen losse schakelaar nodig)', inst.whatsappCloudReady === true && inst.whatsappCloudSend === true, JSON.stringify([inst.whatsappCloudReady, inst.whatsappCloudSend]));
  ok('"wegwerpnummer alleen voor groepen" is geen instelling meer maar staat vast', inst.bridgeGroupsOnly === true);
  await api('PATCH', '/api/settings', { bridgeGroupsOnly: false });
  ok('de oude schakelaar uitzetten heeft geen effect', (await api('GET', '/api/settings')).json.bridgeGroupsOnly === true);

  const klant = (await api('POST', '/api/customers', { name: 'Proef Klant', phone: '0612340001' })).json;
  const opdracht = (await api('POST', '/api/orders', { customerId: klant.id, title: 'Testdorp — slot vervangen', status: 'open' })).json;

  console.log('\n== Een klantbericht gaat via Meta ==');
  const a1 = await api('POST', `/api/orders/${opdracht.id}/whatsapp-antwoord`, { text: 'Goedemiddag, wij komen morgen langs.', phone: '0612340001' });
  ok('antwoord klaargezet, zonder waarschuwing', a1.status === 200 && a1.json.ok && !a1.json.nietVerstuurbaar, JSON.stringify(a1.json));
  await ronde();
  const i1 = await vind(a1.json.id);
  ok('verstuurd via het officiële nummer', i1 && i1.status === 'sent' && ontvangen.some((m) => /31612340001|0612340001/.test(String(m.naar))), JSON.stringify([i1 && i1.status, i1 && i1.lastResult, ontvangen]));

  console.log('\n== Storing bij Meta: zelf opnieuw proberen, daarna eerlijk mislukt ==');
  metaStuk = true; const voor = ontvangen.length;
  const a2 = await api('POST', `/api/orders/${opdracht.id}/whatsapp-antwoord`, { text: 'Tweede bericht tijdens een storing.', phone: '0612340001' });
  await ronde();
  const p1 = await vind(a2.json.id);
  ok('na 1 mislukte poging: nog in de wachtrij, met uitleg en een wachttijd', p1 && p1.status === 'queued' && /opnieuw geprobeerd \(1\/3\)/.test(p1.lastResult || ''), JSON.stringify(p1 && [p1.status, p1.lastResult]));
  await ronde(); await ronde();
  const p3 = await vind(a2.json.id);
  ok('na 3 pogingen: MISLUKT met de reden erbij', p3 && p3.status === 'failed' && /3x geprobeerd/.test(p3.lastResult || '') && /storing/.test(p3.lastResult || ''), JSON.stringify(p3 && [p3.status, p3.lastResult]));
  ok('er is tijdens de storing niets afgeleverd', ontvangen.length === voor);
  metaStuk = false;

  console.log('\n== Meta weigert achteraf: definitief, nooit alsnog via de bridge ==');
  const a3 = await api('POST', `/api/orders/${opdracht.id}/whatsapp-antwoord`, { text: 'Derde bericht dat later wordt geweigerd.', phone: '0612340001' });
  await ronde();
  const voorWeigering = await vind(a3.json.id);
  const wamid = ontvangen[ontvangen.length - 1].id;
  const stBody = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: wamid, status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] }] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(stBody).digest('hex');
  const wh = await fetch(`${BASE}/api/ingest/whatsapp/cloud`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: stBody });
  await slaap(400);
  const naWeigering = await vind(a3.json.id);
  ok('weigering van Meta zet het bericht op MISLUKT (niet terug in de wachtrij)', wh.status === 200 && voorWeigering.status === 'sent' && naWeigering.status === 'failed' && /niet bezorgd/.test(naWeigering.lastResult || ''), JSON.stringify([voorWeigering.status, naWeigering.status, naWeigering.lastResult]));

  console.log('\n== Officieel nummer uit: er gaat niets uit, en dat staat erbij ==');
  await api('PATCH', '/api/settings', { whatsappCloudSend: false });
  const voorUit = ontvangen.length;
  const a4 = await api('POST', `/api/orders/${opdracht.id}/whatsapp-antwoord`, { text: 'Vierde bericht terwijl het officiële nummer uit staat.', phone: '0612340001' });
  ok('het scherm krijgt meteen te horen dat dit appje niet uitgaat', a4.status === 200 && /officiële WhatsApp-nummer staat uit/.test(a4.json.nietVerstuurbaar || ''), JSON.stringify(a4.json));
  // Groepsbericht naast het klantbericht: alleen dat mag naar de bridge.
  const mont = (await api('POST', '/api/monteurs', { name: 'Proef Monteur', waGroup: 'Proefgroep monteur', phone: '0612349999' })).json;
  const naarMonteur = await api('POST', `/api/orders/${opdracht.id}/send-monteur`, { monteurId: mont.id });
  ok('opdracht naar de monteursgroep klaargezet', naarMonteur.status === 200, JSON.stringify(naarMonteur.json).slice(0, 160));
  await slaap(21000); // snelheidsrem van de bridge-wachtrij
  const bridge = (await api('GET', '/api/outbox', null, true)).json || [];
  ok('de bridge krijgt de OPDRACHT voor de monteursgroep', bridge.some((o) => o.group === 'Proefgroep monteur'), JSON.stringify(bridge.map((o) => [o.group, o.by])));
  ok('de bridge krijgt GEEN ENKEL klantbericht (ook nu het officiële nummer uit staat)', !bridge.some((o) => !o.group || o.group === '__klant_dm__'), JSON.stringify(bridge.map((o) => [o.group, o.by])));
  const wachtend = await vind(a4.json.id);
  ok('het klantbericht staat nog klaar (wacht op het officiële nummer)', wachtend && wachtend.status === 'queued');
  await ronde({ oud: [a4.json.id] });
  const na10 = await vind(a4.json.id);
  ok('na 10 minuten: MISLUKT met de reden "officiële nummer staat uit"', na10 && na10.status === 'failed' && /staat uit/.test(na10.lastResult || '') && /nooit via het wegwerpnummer/.test(na10.lastResult || ''), JSON.stringify(na10 && [na10.status, na10.lastResult]));
  ok('en er is niets bij Meta aangekomen', ontvangen.length === voorUit);
  const kop = (await api('GET', '/api/koppelingen/status')).json;
  const regel = (kop.regels || []).find((r) => r.sleutel === 'waOfficieel');
  ok('het koppelingen-overzicht waarschuwt dat klanten geen WhatsApp krijgen', regel && regel.stand === 'let' && /geen WhatsApp/.test(regel.uitleg), JSON.stringify(regel));
  await api('PATCH', '/api/settings', { whatsappCloudSend: true });

  console.log('\n== Een knop per automatisch WhatsApp-bericht ==');
  const k0 = (await api('GET', '/api/whatsapp/automatisch')).json;
  ok('acht berichten, elk met naam en uitleg', (k0.lijst || []).length === 8 && k0.lijst.every((x) => x.key && x.naam && x.uitleg), JSON.stringify((k0.lijst || []).map((x) => x.key)));
  ok('standaard: wat nieuw is staat UIT (ontvangst, betaalherinnering), wat al ging blijft AAN (review, offerte)', k0.stand.ontvangst === false && k0.stand.betaal === false && k0.stand.review === true && k0.stand.offerte === true, JSON.stringify(k0.stand));
  ok('annulering en herinnering volgen standaard de afspraakbevestiging', k0.stand.annulering === k0.stand.afspraak && k0.stand.herinnering === k0.stand.afspraak, JSON.stringify(k0.stand));
  const k1 = await api('POST', '/api/whatsapp/automatisch', { soort: 'afspraak', aan: !k0.stand.afspraak });
  ok('afspraakbevestiging omzetten laat annulering en herinnering staan', k1.status === 200 && k1.json.stand.afspraak === !k0.stand.afspraak && k1.json.stand.annulering === k0.stand.annulering && k1.json.stand.herinnering === k0.stand.herinnering, JSON.stringify(k1.json.stand));
  await api('POST', '/api/whatsapp/automatisch', { soort: 'afspraak', aan: k0.stand.afspraak });
  const kOntv = await api('POST', '/api/whatsapp/automatisch', { soort: 'ontvangst', aan: true });
  ok('de knop "ontvangstbevestiging" is dezelfde instelling als in de kaart eronder', kOntv.json.stand.ontvangst === true && (await api('GET', '/api/settings')).json.autoReply.whatsappEnabled === true);
  await api('POST', '/api/whatsapp/automatisch', { soort: 'ontvangst', aan: false });
  ok('onbekend bericht → 400', (await api('POST', '/api/whatsapp/automatisch', { soort: 'bestaatniet', aan: true })).status === 400);
  ok('zonder aan/uit → 400', (await api('POST', '/api/whatsapp/automatisch', { soort: 'betaal' })).status === 400);
  ok('instellingen geven de knoppen mee', (() => true)() && typeof (await api('GET', '/api/settings')).json.whatsappAuto?.betaal === 'boolean');

  console.log('\n== Betaalherinnering via WhatsApp (klant met alleen een telefoonnummer) ==');
  let f = (await api('POST', '/api/invoices', { customerId: klant.id, type: 'factuur' })).json; f = f.invoice || f;
  await api('PATCH', `/api/invoices/${f.id}`, { lines: [{ description: 'Cilinder', qty: 1, priceExcl: 100 }], btwPct: 21 });
  await api('POST', `/api/invoices/${f.id}/status`, { status: 'verzonden' });
  const h0 = await api('POST', `/api/invoices/${f.id}/remind`, {});
  ok('knop UIT: geen appje, nette melding (geen e-mailadres)', h0.status === 400 && /e-mailadres/.test(h0.json.error || ''), JSON.stringify(h0.json));
  await api('POST', '/api/whatsapp/automatisch', { soort: 'betaal', aan: true });
  const h1 = await api('POST', `/api/invoices/${f.id}/remind`, {});
  ok('knop AAN: herinnering gaat via WhatsApp', h1.status === 200 && (h1.json.via || []).join() === 'WhatsApp', JSON.stringify(h1.json).slice(0, 200));
  const hItem = (await heleWachtrij()).find((o) => o.by === 'betaalherinnering');
  ok('appje staat klaar met het factuurnummer en een link naar de factuur', hItem && hItem.phone === '0612340001' && hItem.text.includes(f.number) && /\/bon\/[^/\s]+\/[0-9a-f]{24}/.test(hItem.text), hItem && hItem.text);
  const link = hItem ? (hItem.text.match(/https?:\/\/\S+\/bon\/\S+/) || [''])[0] : '';
  ok('de link in het appje opent de factuur zonder inlog', !!link && (await fetch(link)).status === 200, link);
  ok('teller van de herinneringen opgehoogd', ((await api('GET', `/api/invoices/${f.id}`)).json.invoice || {}).remindCount === 1);
  await ronde();
  ok('de herinnering is via het officiële nummer verstuurd', ((await vind(hItem.id)) || {}).status === 'sent');
  await api('POST', '/api/whatsapp/automatisch', { soort: 'betaal', aan: false });

  console.log('\n== Offerte-herinnering volgt haar eigen knop ==');
  const klant2 = (await api('POST', '/api/customers', { name: 'Offerte Klant', phone: '0612340002' })).json;
  let off = (await api('POST', '/api/invoices', { customerId: klant2.id, type: 'offerte' })).json; off = off.invoice || off;
  await api('PATCH', `/api/invoices/${off.id}`, { lines: [{ description: 'Reparatie', qty: 1, priceExcl: 300 }], btwPct: 21 });
  await api('POST', `/api/invoices/${off.id}/status`, { status: 'verzonden' });
  await api('POST', '/api/whatsapp/automatisch', { soort: 'offerte', aan: false });
  const o0 = await api('POST', `/api/invoices/${off.id}/quote-followup`, {});
  ok('knop UIT + alleen een telefoonnummer: uitleg waar je het aanzet', o0.status === 400 && /staat uit/.test(o0.json.error || ''), JSON.stringify(o0.json));
  await api('POST', '/api/whatsapp/automatisch', { soort: 'offerte', aan: true });
  const o1 = await api('POST', `/api/invoices/${off.id}/quote-followup`, {});
  ok('knop AAN: herinnering via WhatsApp', o1.status === 200 && o1.json.via === 'whatsapp', JSON.stringify(o1.json).slice(0, 160));

  console.log('\n== Review-verzoek volgt zijn eigen knop ==');
  const rr = (await api('GET', '/api/settings')).json.reviewRequest || {};
  await api('PATCH', '/api/settings', { reviewRequest: { ...rr, link: 'https://voorbeeld.test/review' } });
  await api('POST', '/api/whatsapp/automatisch', { soort: 'review', aan: false });
  const r0 = await api('POST', `/api/invoices/${f.id}/review-request`, {});
  ok('knop UIT + alleen een telefoonnummer: geen appje, uitleg', r0.status === 400 && /WhatsApp staat uit/.test(r0.json.error || ''), JSON.stringify(r0.json));
  ok('er staat geen review-appje klaar', !(await heleWachtrij()).some((o) => /review/i.test(o.by || '')));
  await api('POST', '/api/whatsapp/automatisch', { soort: 'review', aan: true });
  const r1 = await api('POST', `/api/invoices/${f.id}/review-request`, {});
  ok('knop AAN: review-verzoek gaat als appje (ook zonder mailinstelling)', r1.status === 200 && (await heleWachtrij()).some((o) => o.by === 'review-verzoek' && o.phone === '0612340001'), JSON.stringify(r1.json).slice(0, 200));

  console.log('\n== Foto\'s van de klant komen op de opdracht (28 nov 2026) ==');
  const webhook = async (bericht) => {
    const b = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PID' }, contacts: [{ profile: { name: bericht.naam || 'Foto Klant' }, wa_id: bericht.from }], messages: [{ from: bericht.from, id: bericht.id, timestamp: String(Math.floor(Date.now() / 1000)), ...(bericht.foto ? { type: 'image', image: { id: bericht.foto, mime_type: 'image/jpeg' } } : { type: 'text', text: { body: bericht.tekst } }) }] } }] }] });
    return fetch(`${BASE}/api/ingest/whatsapp/cloud`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', SECRET).update(b).digest('hex') }, body: b });
  };
  const haalOrder = async (oid) => { const j = (await api('GET', `/api/orders/${oid}`)).json; return j.order || j; };
  // Klant stuurt zijn vraag en daarna drie foto's — er bestaat nog GEEN opdracht.
  await webhook({ from: '31612347777', id: 'wamid.F0', tekst: 'Goedemiddag, mijn schuifpui klemt en sluit niet meer. Kunt u langskomen? Kamperlaan 5, 3911 AA Rhenen' });
  await slaap(700);
  for (const n of [1, 2, 3]) { await webhook({ from: '31612347777', id: `wamid.F${n}`, foto: `foto${n}` }); await slaap(500); }
  await slaap(600);
  const revs = ((await api('GET', '/api/reviews?limit=80')).json.items || []);
  const vraag = revs.find((r) => /schuifpui klemt/.test(JSON.stringify(r)));
  ok('de vraag van de klant staat in de inbox', !!vraag, JSON.stringify(revs.map((r) => r.status)).slice(0, 200));
  const goed = await api('POST', `/api/reviews/${vraag.id}/approve`, {});
  const oFoto = await haalOrder(goed.json?.order?.id || goed.json?.orderId || goed.json?.id);
  ok('goedkeuren: de drie foto\'s die de klant al had gestuurd staan op de opdracht (tabblad Foto\'s)', goed.status === 200 && (oFoto.attachments || []).length === 3 && oFoto.attachments.every((a) => /image/.test(a.mime || '')), JSON.stringify({ s: goed.status, n: (oFoto.attachments || []).length }));
  ok('en ze staan in het gesprek van de opdracht, op volgorde', (oFoto.thread || []).filter((t) => (t.attachments || []).length).length === 3 && (oFoto.thread || []).every((t, i, arr) => !i || String(arr[i - 1].at || '') <= String(t.at || '')));
  await webhook({ from: '31612347777', id: 'wamid.F4', foto: 'foto4' }); await slaap(900);
  ok('een foto NA het aanmaken komt er ook bij (bestond al)', ((await haalOrder(oFoto.id)).attachments || []).length === 4);
  // Handmatig aangemaakte opdracht voor een klant die al foto's had geappt.
  for (const n of [5, 6]) { await webhook({ from: '31612348888', id: `wamid.G${n}`, foto: `foto${n}`, naam: 'Hand Klant' }); await slaap(500); }
  const hand = (await api('POST', '/api/orders', { customerName: 'Hand Klant', customerPhone: '0612348888', title: 'Rhenen — met de hand aangemaakt' })).json;
  ok('opdracht met de hand aangemaakt: de eerder geappte foto\'s staan er meteen op', ((await haalOrder(hand.id)).attachments || []).length === 2);
  ok('foto\'s van een ANDER nummer komen er niet bij', !((await haalOrder(hand.id)).attachments || []).some((a) => (oFoto.attachments || []).some((b) => b.file === a.file)));
  // Inhaalslag: opdracht bestond al zonder telefoonnummer; het nummer komt er later bij.
  for (const n of [7, 8]) { await webhook({ from: '31612349999', id: `wamid.H${n}`, foto: `foto${n}`, naam: 'Inhaal Klant' }); await slaap(500); }
  const inh = (await api('POST', '/api/orders', { customerName: 'Inhaal Klant', title: 'Rhenen — inhaalslag' })).json;
  await api('PATCH', `/api/customers/${inh.customerId}`, { phone: '0612349999' });
  ok('uitgangspunt inhaalslag: de opdracht heeft nog geen foto\'s', ((await haalOrder(inh.id)).attachments || []).length === 0);
  const ih = await api('POST', '/api/whatsapp/test-fotos-inhaal', {});
  ok('eenmalige inhaalslag zet de twee foto\'s alsnog op de lopende opdracht', ih.status === 200 && ih.json.fotos === 2 && ((await haalOrder(inh.id)).attachments || []).length === 2, JSON.stringify(ih.json));
  ok('nog een keer draaien voegt niets dubbel toe', (await api('POST', '/api/whatsapp/test-fotos-inhaal', {})).json.fotos === 0 && ((await haalOrder(inh.id)).attachments || []).length === 2 && ((await haalOrder(oFoto.id)).attachments || []).length === 4);

  console.log('\n== Rechten ==');
  const lm = await login('ahmed@keyservice.nl', 'ahmed123');
  ok('monteur mag de knoppen niet omzetten', lm.status === 200 && [401, 403].includes((await api('POST', '/api/whatsapp/automatisch', { soort: 'betaal', aan: true })).status));
  ok('en ook niet lezen', [401, 403].includes((await api('GET', '/api/whatsapp/automatisch')).status));
} catch (e) {
  failed++; bad.push(`test brak af: ${e.message}`); console.log(e.stack); console.log(log.slice(-1500));
}
stop();
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} geslaagd, ${failed} gefaald${bad.length ? ':\n  - ' + bad.join('\n  - ') : ''}`);
process.exit(failed === 0 ? 0 : 1);
