// Test: OFFICIËLE WHATSAPP (Meta Cloud API).
//
// Waarom deze test bestaat: de vórige Cloud-webhook had GEEN enkele controle — wie het
// adres kende, kon een aanvraag in de controlewachtrij zetten. Die route is weggehaald en
// opnieuw gebouwd mét handtekening-controle. Deze test bewaakt precies dat, plus dat een
// binnengekomen bericht exact dezelfde weg door het CRM aflegt als een bericht van de
// bridge (dus dat de lead-instroom-wetten onverkort gelden).
//
// Draaien (verse test-DB, WHATSAPP_APP_SECRET moet gezet zijn, anders is de route 404):
//   DATA_DIR=/tmp/crm-watest INGEST_TOKEN=test123 SESSION_SECRET=test \
//     WHATSAPP_APP_SECRET=appsecret123 PORT=3125 node server/index.js &
//   node test/whatsapp-cloud-test.mjs
import crypto from 'node:crypto';
import { webhookSignatureOk, parseCloudWebhook, cloudConfigured } from '../server/connectors/whatsapp-cloud.js';

const BASE = process.env.BASE || 'http://127.0.0.1:3125';
const SECRET = process.env.WHATSAPP_APP_SECRET || 'appsecret123';
process.env.WHATSAPP_APP_SECRET = SECRET;

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

function payload({ from = '31687654321', naam = 'Nieuwe Klant', tekst = 'Test', wamid = 'wamid.X' } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '31685352477', phone_number_id: 'PID' },
      contacts: [{ profile: { name: naam }, wa_id: from }],
      messages: [{ from, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: tekst } }],
    } }] }],
  };
}
const teken = (raw) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

// ---------- 1. Zuivere logica (geen server nodig) ----------
console.log('\n== Handtekening-controle (de beveiliging die eerder ontbrak) ==');
const raw = JSON.stringify(payload({ tekst: 'hallo' }));
ok('juiste handtekening wordt geaccepteerd', webhookSignatureOk(raw, teken(raw)) === true);
ok('verkeerde handtekening wordt geweigerd', webhookSignatureOk(raw, 'sha256=' + 'a'.repeat(64)) === false);
ok('ontbrekende handtekening wordt geweigerd', webhookSignatureOk(raw, '') === false);
ok('handtekening zonder "sha256="-voorvoegsel wordt geweigerd', webhookSignatureOk(raw, 'b'.repeat(64)) === false);
ok('gewijzigde body met oude handtekening wordt geweigerd', webhookSignatureOk(raw + ' ', teken(raw)) === false);
const zonderSecret = (() => { const s = process.env.WHATSAPP_APP_SECRET; delete process.env.WHATSAPP_APP_SECRET; const r = webhookSignatureOk(raw, teken(raw)); process.env.WHATSAPP_APP_SECRET = s; return r; })();
ok('zonder app secret vertrouwen we niets', zonderSecret === false);

console.log('\n== Meta-formaat omzetten naar ons standaardformaat ==');
const [m] = parseCloudWebhook(payload({ tekst: 'Slot kapot', wamid: 'wamid.A1' }));
ok('bericht-id overgenomen', m.externalId === 'wamid.A1');
ok('tekst overgenomen', m.body === 'Slot kapot');
ok('naam uit het contactprofiel', m.sender === 'Nieuwe Klant');
ok('nummer 316… wordt Nederlands 06…', m.fromPhone === '0687654321', m.fromPhone);
const statusOnly = parseCloudWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.Z', status: 'delivered' }] } }] }] });
ok('een status-melding (bezorgd/gelezen) levert GEEN bericht op', statusOnly.length === 0);
ok('lege/onbekende body geeft geen fout', parseCloudWebhook({}).length === 0 && parseCloudWebhook(null).length === 0);
const [mm] = parseCloudWebhook({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Foto Klant' }, wa_id: '31611112222' }], messages: [{ from: '31611112222', id: 'wamid.F', type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'kapotte deur' } }] } }] }] });
ok('foto: media-id, mime en bijschrift komen mee', mm.mediaId === 'MEDIA1' && mm.mime === 'image/jpeg' && mm.body === 'kapotte deur');
ok('uit staat uit: zonder token/phone-id is de koppeling niet actief', cloudConfigured() === false);

// ---------- 2. Route-gedrag (server moet draaien) ----------
const bereikbaar = await fetch(BASE + '/login.html').then(() => true).catch(() => false);
if (!bereikbaar) {
  console.log(`\n  (server op ${BASE} niet bereikbaar — route-tests overgeslagen)`);
} else {
  console.log('\n== De webhook zelf ==');
  const post = (body, sig) => fetch(BASE + '/api/ingest/whatsapp/cloud', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) },
    body,
  });
  const b1 = JSON.stringify(payload({ tekst: 'poging zonder handtekening', wamid: 'wamid.N1' }));
  ok('zonder handtekening -> 403', (await post(b1)).status === 403);
  ok('met verkeerde handtekening -> 403', (await post(b1, 'sha256=' + 'c'.repeat(64))).status === 403);

  // Uniek nummer + unieke tekst, anders grijpt terecht de klant-matching of de
  // inhoud-dedup in (dat is GEWENST gedrag — zie de twee tests daarna).
  const uniek = String(Date.now()).slice(-8);
  const tekst = `Goedemiddag, ik ben buitengesloten in Veenendaal, Kerkewijk 12, 3901EG. Ref ${uniek}`;
  const b2 = JSON.stringify(payload({ from: `3161${uniek}`, tekst, wamid: `wamid.${uniek}` }));
  ok('met juiste handtekening -> 200', (await post(b2, teken(b2))).status === 200);

  await new Promise((r) => setTimeout(r, 800));
  const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@keyservice.nl', password: 'admin123' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const reviews = await fetch(BASE + '/api/reviews', { headers: { cookie } }).then((r) => r.json()).catch(() => []);
  const lijst = Array.isArray(reviews) ? reviews : (reviews.items || reviews.reviews || []);
  const gevonden = lijst.find((r) => String(r.message?.body || '').includes(uniek));
  ok('bericht staat als te-controleren aanvraag in de inbox', !!gevonden, `${lijst.length} items`);
  ok('het échte afzendernummer is als klantnummer overgenomen (WET regel 2)',
    String(gevonden?.suggestion?.customerPhone || '').replace(/\D/g, '').endsWith(uniek), gevonden?.suggestion?.customerPhone);

  console.log('\n== De lead-instroom-wetten gelden onverkort (geen sluiproute) ==');
  const b3 = JSON.stringify(payload({ from: `3161${uniek}`, tekst, wamid: `wamid.${uniek}b` }));
  await post(b3, teken(b3));
  await new Promise((r) => setTimeout(r, 800));
  const na = await fetch(BASE + '/api/reviews', { headers: { cookie } }).then((r) => r.json()).catch(() => []);
  const naLijst = Array.isArray(na) ? na : (na.items || na.reviews || []);
  ok('identieke tekst binnen 24u wordt ontdubbeld (geen tweede inbox-item)',
    naLijst.filter((r) => String(r.message?.body || '').includes(uniek)).length === 1);
}

if (bereikbaar) {
  console.log('\n== Sjabloon-instelling (buiten 24-uursvenster) ==');
  const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@keyservice.nl', password: 'admin123' }) });
  const ck = (login.headers.get('set-cookie') || '').split(';')[0];
  const inst = (p) => fetch(BASE + '/api/settings', { method: p ? 'PATCH' : 'GET', headers: { 'content-type': 'application/json', cookie: ck }, body: p ? JSON.stringify(p) : undefined }).then((r) => r.json());
  const std = await inst();
  ok('sjabloonnaam heeft een verstandige standaard', std.whatsappCloudTemplate === 'keyservice_bericht', JSON.stringify(std.whatsappCloudTemplate));
  await inst({ whatsappCloudTemplate: 'mijn_eigen_sjabloon' });
  ok('sjabloonnaam is aan te passen', (await inst()).whatsappCloudTemplate === 'mijn_eigen_sjabloon');
  await inst({ whatsappCloudTemplate: '' });
  ok('leeg = sjabloon-terugval uit', (await inst()).whatsappCloudTemplate === '');
  await inst({ whatsappCloudTemplate: 'keyservice_bericht' });
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} geslaagd, ${failed} gefaald${bad.length ? ':\n  - ' + bad.join('\n  - ') : ''}`);
process.exit(failed === 0 ? 1 && 0 : 1);
