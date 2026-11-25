// Test: E-MAILCAMPAGNES (stap 3, 25 nov 2026). Bewaakt de vaste afspraken uit
// server/campagnes.js:
//   1. er gaat niets uit zonder een klik van een mens (een concept verstuurt nooit zelf);
//   2. wie de campagne krijgt volgt uit vaste regels (zelfde invoer = zelfde lijst);
//   3. vangrails: afgemeld, tussenpersoon, teruggekomen adres, dubbel adres, rustperiode;
//   4. afmelden via de link onder de mail werkt zonder inlog, en alleen met de juiste link;
//   5. de assistente ziet het resultaat in aantallen, nooit in euro's.
// Deel 1 draait zonder server (rekenregels). Deel 2 start ZELF een nep-mailserver (SMTP) en
// de CRM-server (poort 3157), zodat de mails echt door de verzendroute gaan.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { klantFeiten, kiesOntvangers, doelgroepTelling, regelVoorstellen, vulTekst, plaatsUit, DOELGROEPEN } from '../server/campagnes.js';

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));
const DAG = 86400000;

// ====================== DEEL 1: rekenregels (zonder server) ======================
const nu = new Date('2026-11-25T10:00:00Z').getTime();
const geleden = (dagen) => new Date(nu - dagen * DAG).toISOString();
const customers = [
  { id: 'k1', name: 'Familie Jansen', email: 'jansen@voorbeeld.test', address: 'Lindelaan 12, 1234 AB Testdorp' },
  { id: 'k2', name: 'Mevrouw De Boer', email: 'DeBoer@Voorbeeld.test', address: 'Kerkstraat 3, 2345 CD Voorbeeldstad' },
  { id: 'k3', name: 'VvE Parkzicht', email: 'bestuur@vve-parkzicht.test', address: 'Parklaan 1, 1234 AB Testdorp' },
  { id: 'k4', name: 'Peter Visser', email: '', address: 'Dorpsweg 9, Demoveen' },
  { id: 'k5', name: 'Afgemelde Klant', email: 'afgemeld@voorbeeld.test', campaignOptOut: true, address: 'Testdorp' },
  { id: 'k6', name: 'Beheer Proef', email: 'beheer@vastgoed-proef.test', address: 'Kantoorweg 5, 3456 EF Proefwijk' },
  { id: 'k7', name: 'Dubbel Adres', email: 'jansen@voorbeeld.test', address: 'Lindelaan 12, 1234 AB Testdorp' },
  { id: 'k8', name: 'Net Gemaild', email: 'net@voorbeeld.test', lastCampaignAt: geleden(5), address: 'Testdorp' },
  { id: 'k9', name: 'Teruggekomen', email: 'weg@voorbeeld.test', emailBounceAt: geleden(2), address: 'Testdorp' },
  { id: 'k10', name: 'Onbekende klant', email: 'onbekend@voorbeeld.test', address: '' },
];
const orders = [
  { id: 'o1', customerId: 'k1', status: 'afgerond', title: 'Testdorp — schuifpui loopt zwaar', createdAt: geleden(500), completedAt: geleden(498) },
  { id: 'o2', customerId: 'k2', status: 'afgerond', title: 'Voorbeeldstad — cilinder vervangen', createdAt: geleden(40), completedAt: geleden(39) },
  { id: 'o3', customerId: 'k3', status: 'in_behandeling', title: 'Testdorp — centrale toegangsdeur klemt', createdAt: geleden(3) },
  { id: 'o4', customerId: 'k6', status: 'afgerond', title: 'Proefwijk — slot kantoor', createdAt: geleden(700), completedAt: geleden(699) },
  { id: 'o5', customerId: 'k1', status: 'afgerond', title: 'Weg', createdAt: geleden(2), deletedAt: geleden(1) },
];
const invoices = [
  { id: 'i1', customerId: 'k2', type: 'offerte', status: 'verzonden', sentAt: geleden(30), createdAt: geleden(30) },
  { id: 'i2', customerId: 'k1', type: 'offerte', status: 'verzonden', sentAt: geleden(600), createdAt: geleden(600), convertedInvoiceId: 'i3' },
];
const feiten = klantFeiten({ customers, orders, invoices, nooitMail: (e) => /vastgoed-proef\.test$/.test(e), nu });
const f = (idK) => feiten.find((x) => x.id === idK);

ok('plaats wordt uit het adres gehaald (met en zonder postcode)', plaatsUit('Lindelaan 12, 1234 AB Testdorp') === 'Testdorp' && plaatsUit('Dorpsweg 9, Demoveen') === 'Demoveen' && plaatsUit('Rhenen') === 'Rhenen' && plaatsUit('Dorpsweg 9') === '' && plaatsUit('') === '');
ok('klantfeiten: schuifpui-werk, laatste opdracht en een verwijderde opdracht telt niet', f('k1').schuifpui && !f('k1').sloten && f('k1').aantalOpdrachten === 1 && f('k1').afgerond === 1);
ok('klantfeiten: lopende opdracht, zakelijk (VvE) en tussenpersoon worden herkend', f('k3').lopend && f('k3').zakelijk && f('k6').tussenpersoon && !f('k1').zakelijk);
ok('klantfeiten: offerte van 30 dagen zonder factuur = niet doorgegaan; een omgezette offerte niet', f('k2').offerteNietDoor && !f('k1').offerteNietDoor);
ok('e-mailadres wordt genormaliseerd (kleine letters)', f('k2').email === 'deboer@voorbeeld.test' && f('k2').geldigeMail && !f('k4').geldigeMail);

const alle = kiesOntvangers(feiten, { doelgroep: 'alle', nu });
const adressen = alle.ontvangers.map((o) => o.email).sort();
ok('doelgroep "alle": alleen wie bereikbaar is — geen afgemelde, tussenpersoon, teruggekomen adres of klant zonder e-mail', JSON.stringify(adressen) === JSON.stringify(['bestuur@vve-parkzicht.test', 'deboer@voorbeeld.test', 'jansen@voorbeeld.test', 'onbekend@voorbeeld.test']), JSON.stringify(adressen));
ok('elk adres krijgt de campagne één keer (twee klanten met hetzelfde adres)', alle.ontvangers.filter((o) => o.email === 'jansen@voorbeeld.test').length === 1 && alle.afgevallen.dubbelAdres === 1);
ok('het scherm krijgt te zien WAAROM mensen afvallen', alle.afgevallen.geenEmail === 1 && alle.afgevallen.afgemeld === 1 && alle.afgevallen.tussenpersoon === 1 && alle.afgevallen.nietAangekomen === 1 && alle.afgevallen.rust === 1, JSON.stringify(alle.afgevallen));
ok('rustperiode: wie 5 dagen geleden een campagne kreeg valt af; met rust 0 doet hij weer mee', !adressen.includes('net@voorbeeld.test') && kiesOntvangers(feiten, { doelgroep: 'alle', rustDagen: 0, nu }).ontvangers.some((o) => o.email === 'net@voorbeeld.test'));
ok('zelfde invoer = zelfde lijst in dezelfde volgorde (vaste regels, geen toeval)', JSON.stringify(kiesOntvangers(feiten, { doelgroep: 'alle', nu })) === JSON.stringify(alle));
ok('doelgroep "lang niet gezien" (12 maanden): alleen wie echt zo lang geleden klant was', JSON.stringify(kiesOntvangers(feiten, { doelgroep: 'oud', params: { maanden: 12 }, nu }).ontvangers.map((o) => o.customerId)) === JSON.stringify(['k1']));
ok('doelgroep "schuifpui" en "sloten" volgen het soort werk', kiesOntvangers(feiten, { doelgroep: 'schuifpui', nu }).ontvangers.map((o) => o.customerId).join() === 'k1' && kiesOntvangers(feiten, { doelgroep: 'sloten', nu }).ontvangers.some((o) => o.customerId === 'k2'));
ok('doelgroep "offerte niet doorgegaan" en "zakelijk"', kiesOntvangers(feiten, { doelgroep: 'offerte', nu }).ontvangers.map((o) => o.customerId).join() === 'k2' && kiesOntvangers(feiten, { doelgroep: 'zakelijk', nu }).ontvangers.map((o) => o.customerId).join() === 'k3');
ok('doelgroep "plaats": hoofdletters maken niet uit; zonder plaats niemand', kiesOntvangers(feiten, { doelgroep: 'plaats', params: { plaats: 'testdorp' }, nu }).ontvangers.length >= 1 && kiesOntvangers(feiten, { doelgroep: 'plaats', params: { plaats: '' }, nu }).ontvangers.length === 0);
ok('een onbekende doelgroep valt terug op "alle" (geen lege of willekeurige lijst)', kiesOntvangers(feiten, { doelgroep: 'bestaat-niet', nu }).doelgroep === 'alle');

const telling = doelgroepTelling(feiten, { nu });
const tekstTelling = JSON.stringify(telling);
ok('de telling voor de AI bevat alleen aantallen en plaatsnamen — geen naam, e-mailadres of klant-id', !/voorbeeld\.test|Jansen|De Boer|Parkzicht|"k\d+"/.test(tekstTelling) && telling.totaal === 10 && telling.groepen.length === DOELGROEPEN.length - 1, tekstTelling.slice(0, 200));
ok('{naam} en {plaats} worden ingevuld; een onbekende naam wordt "klant"', vulTekst('Beste {naam} uit {plaats}', { naam: 'Familie Jansen', plaats: 'Testdorp' }) === 'Beste Familie Jansen uit Testdorp' && vulTekst('Beste {naam}', { naam: 'Onbekende klant' }) === 'Beste klant');
const groot = { groepen: [{ key: 'schuifpui', bereikbaar: 140 }, { key: 'oud', bereikbaar: 90 }, { key: 'offerte', bereikbaar: 12 }, { key: 'sloten', bereikbaar: 300 }, { key: 'zakelijk', bereikbaar: 2 }, { key: 'nieuw', bereikbaar: 25 }] };
const vs = regelVoorstellen(groot, { maand: 11 });
ok('voorstellen zonder AI: vaste regels, elk met doelgroep, onderwerp, bericht en uitleg; te kleine groepen doen niet mee', vs.length >= 3 && vs.every((v) => v.doelgroep && v.onderwerp && /\{naam\}/.test(v.tekst) && v.waarom && v.bron === 'regels') && !vs.some((v) => v.doelgroep === 'zakelijk'), JSON.stringify(vs.map((v) => v.doelgroep)));
ok('voorstellen: een doelgroep die net een campagne kreeg komt achteraan', regelVoorstellen(groot, { maand: 11, eerdere: [{ doelgroep: vs[0].doelgroep }] })[0].doelgroep !== vs[0].doelgroep);

// ====================== DEEL 2: met de server en een nep-mailserver ======================
const schoneOmgeving = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SMTP_|IMAP_|SENT_IMAP_|WHATSAPP_|GOOGLE_|ANTHROPIC_|DATA_DIR$|OMGEVING$)/.test(k)));
const PORT = 3157; const SMTP_PORT = 2657; const BASE = `http://localhost:${PORT}`; const TOKEN = 'test123';
const DIR = mkdtempSync(join(tmpdir(), 'crm-campagne-'));
const mails = []; const enveloppen = []; let smtpStuk = false;
const smtp = createServer((sock) => {
  let data = false; let buf = ''; let huidig = ''; let rcpt = [];
  sock.write('220 nep-smtp klaar\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8'); let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const regel = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (regel === '.') { data = false; mails.push(huidig); enveloppen.push(rcpt); rcpt = []; huidig = ''; sock.write('250 OK opgeslagen\r\n'); } else huidig += regel.replace(/^\.\./, '.') + '\n'; continue; }
      const cmd = regel.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') sock.write('250-nep-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
      else if (cmd === 'HELO') sock.write('250 nep-smtp\r\n');
      else if (cmd === 'AUTH') { if (/PLAIN\s+\S+/i.test(regel)) sock.write('235 OK\r\n'); else if (/PLAIN/i.test(regel)) sock.write('334 \r\n'); else if (/LOGIN/i.test(regel)) { sock.write('334 VXNlcm5hbWU6\r\n'); sock._login = 1; } }
      else if (sock._login === 1) { sock._login = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }
      else if (sock._login === 2) { sock._login = 0; sock.write('235 OK\r\n'); }
      else if (cmd === 'MAIL') sock.write(smtpStuk ? '451 tijdelijk niet beschikbaar\r\n' : '250 OK\r\n');
      else if (cmd === 'RCPT') { rcpt.push(regel.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, '$1').toLowerCase()); sock.write('250 OK\r\n'); }
      else if (cmd === 'DATA') { data = true; sock.write('354 ga je gang\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 doei\r\n'); sock.end(); }
      else if (cmd === 'RSET' || cmd === 'NOOP') sock.write('250 OK\r\n');
      else if (regel.length && !sock._login) sock.write('235 OK\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => smtp.listen(SMTP_PORT, r));

async function api(method, path, body, cookie = '') {
  const headers = { 'content-type': 'application/json' }; if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const c = (r.headers.get('set-cookie') || '').split(';')[0];
  let json = null; let tekst = ''; try { tekst = await r.text(); json = JSON.parse(tekst); } catch { /* geen json */ }
  return { status: r.status, json, tekst, cookie: c };
}
const proc = spawn(process.execPath, ['server/index.js'], {
  env: { ...schoneOmgeving(), DATA_DIR: DIR, INGEST_TOKEN: TOKEN, SESSION_SECRET: 'test', PORT: String(PORT), CAMPAGNE_TEST: '1', APP_URL: BASE, SMTP_HOST: '127.0.0.1', SMTP_PORT: String(SMTP_PORT), SMTP_USER: 'test@keyservice247.nl', SMTP_PASSWORD: 'x', SMTP_FROM: 'test@keyservice247.nl' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
let gestart = false;
for (let i = 0; i < 60 && !gestart; i++) { try { await fetch(BASE + '/login.html'); gestart = true; } catch { await slaap(500); } }
if (!gestart) { console.log('server start mislukt:\n' + log); process.exit(1); }

try {
  const admin = (await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' })).cookie;
  ok('ingelogd als beheerder', !!admin);
  await api('POST', '/api/users', { name: 'Noor Test', email: 'noor@campagne.test', password: 'assist-12345', role: 'assistent' }, admin);
  const sam = (await api('POST', '/api/monteurs', { name: 'Sam', phone: '0611000101' }, admin)).json;
  await api('POST', '/api/users', { name: 'Sam Test', email: 'sam@campagne.test', password: 'monteur-12345', role: 'monteur', monteurId: sam.id }, admin);
  const ass = (await api('POST', '/api/login', { email: 'noor@campagne.test', password: 'assist-12345' })).cookie;
  const mon = (await api('POST', '/api/login', { email: 'sam@campagne.test', password: 'monteur-12345' })).cookie;

  // Twaalf klanten met e-mail (meer dan één verzendronde van 8), één afgemeld, één zonder e-mail.
  const klanten = [];
  for (let i = 1; i <= 12; i++) klanten.push((await api('POST', '/api/customers', { name: `Campagne Klant ${i}`, email: `klant${i}@campagne.test`, phone: `06110010${String(i).padStart(2, '0')}`, address: `Proefweg ${i}, 3911 AA Rhenen` }, admin)).json);
  const afgemeld = (await api('POST', '/api/customers', { name: 'Wil Geen Mail', email: 'geenmail@campagne.test', address: 'Rhenen' }, admin)).json;
  await api('PATCH', `/api/customers/${afgemeld.id}`, { campaignOptOut: true }, admin);
  await api('POST', '/api/customers', { name: 'Zonder Mail', phone: '0611009999', address: 'Rhenen' }, admin);
  ok('testklanten aangemaakt', klanten.every((k) => k && k.id) && !!afgemeld.id);

  ok('monteur mag niet bij de campagnes (403)', (await api('GET', '/api/campagnes', null, mon)).status === 403);
  const overzicht = (await api('GET', '/api/campagnes', null, ass)).json;
  ok('assistente ziet het overzicht: doelgroepen, telling en instellingen', overzicht.doelgroepen.length === DOELGROEPEN.length && overzicht.telling.metMail >= 13 && overzicht.instellingen.rustDagen === 30 && overzicht.kanVersturen === true, JSON.stringify(overzicht.instellingen));

  const vb = (await api('POST', '/api/campagnes/voorbeeld', { doelgroep: 'plaats', params: { plaats: 'Rhenen' } }, ass)).json;
  ok('voorbeeld "wie krijgt hem": 12 ontvangers in Rhenen, de afgemelde en de klant zonder e-mail vallen af met reden', vb.aantal === 12 && vb.afgevallen.afgemeld === 1 && vb.afgevallen.geenEmail === 1, JSON.stringify({ aantal: vb.aantal, af: vb.afgevallen }));

  const concept = (await api('POST', '/api/campagnes', { naam: 'Proefcampagne', onderwerp: 'Sluit alles nog goed?', tekst: 'Beste {naam},\n\nWerkt alles nog naar wens in {plaats}?', doelgroep: 'plaats', params: { plaats: 'Rhenen' } }, ass)).json;
  ok('concept aangemaakt (status concept, nog geen ontvangers)', concept.status === 'concept' && concept.aantal === 0 && concept.doelgroepNaam === 'Klanten in één plaats');
  await api('POST', '/api/campagnes/ronde', {}, admin); await slaap(400);
  ok('EEN CONCEPT VERSTUURT NOOIT ZELF: een verzendronde zonder klik van een mens stuurt niets', mails.length === 0, String(mails.length));
  ok('leeg onderwerp of bericht kan niet verstuurd worden (400 met uitleg)', (await api('POST', `/api/campagnes/${(await api('POST', '/api/campagnes', { naam: 'Leeg' }, ass)).json.id}/start`, {}, ass)).status === 400);

  const test = await api('POST', `/api/campagnes/${concept.id}/test`, { naar: 'eigenaar@campagne.test' }, ass);
  await slaap(300);
  ok('testmail gaat naar het opgegeven adres met [TEST] in het onderwerp en "Voorbeeldklant"', test.status === 200 && mails.length === 1 && enveloppen[0].join() === 'eigenaar@campagne.test' && /\[TEST\]/.test(mails[0]) && /Voorbeeldklant/.test(mails[0]), mails[0] ? mails[0].slice(0, 200) : 'geen mail');
  mails.length = 0; enveloppen.length = 0;

  // Later inplannen: er gaat nu niets uit; terug naar concept kan zolang er niets verstuurd is.
  const gepland = (await api('POST', `/api/campagnes/${concept.id}/start`, { op: new Date(Date.now() + 2 * 3600000).toISOString() }, ass)).json;
  await api('POST', '/api/campagnes/ronde', {}, admin); await slaap(300);
  ok('inplannen voor later: status gepland, ontvangers vastgelegd, er gaat nog niets uit', gepland.status === 'gepland' && gepland.aantal === 12 && mails.length === 0);
  ok('een geplande campagne kun je niet stilletjes wijzigen (409)', (await api('PATCH', `/api/campagnes/${concept.id}`, { tekst: 'Anders' }, ass)).status === 409);
  ok('terug naar concept kan zolang er niets verstuurd is', (await api('POST', `/api/campagnes/${concept.id}/concept`, {}, ass)).json.status === 'concept');

  // Nu versturen: klik van een mens → eerste reeks meteen, de rest in volgende rondes.
  const gestartC = (await api('POST', `/api/campagnes/${concept.id}/start`, {}, ass)).json;
  ok('versturen: status bezig met 12 ontvangers', gestartC.status === 'bezig' && gestartC.aantal === 12);
  for (let i = 0; i < 30 && mails.length < 8; i++) await slaap(200);
  ok('de eerste reeks is hooguit 8 mails (tussenpozen, geen stortvloed)', mails.length === 8, String(mails.length));
  // Intussen meldt klant 9 zich af (hij zit in de tweede reeks: de volgorde is op naam, dus
  // 1, 10, 11, 12, 2 … 9): die mag in de volgende ronde niets meer krijgen.
  await api('PATCH', `/api/customers/${klanten[8].id}`, { campaignOptOut: true }, admin);
  await api('POST', '/api/campagnes/ronde', {}, admin);
  for (let i = 0; i < 30 && mails.length < 11; i++) await slaap(200);
  await slaap(300);
  const klaar = (await api('GET', `/api/campagnes/${concept.id}`, null, ass)).json;
  ok('tweede ronde maakt de campagne af: 11 verstuurd, 1 overgeslagen (intussen afgemeld), status verstuurd', klaar.status === 'verstuurd' && klaar.verstuurd === 11 && klaar.overgeslagen === 1 && mails.length === 11, JSON.stringify({ s: klaar.status, v: klaar.verstuurd, o: klaar.overgeslagen, m: mails.length }));
  const alleAdressen = enveloppen.map((e) => e.join()).sort();
  ok('elk adres precies één mail; niets naar de afgemelde klanten', new Set(alleAdressen).size === 11 && !alleAdressen.includes('geenmail@campagne.test') && !alleAdressen.includes('klant9@campagne.test'), alleAdressen.join(' '));
  const eerste = mails.find((m) => /klant1@campagne\.test/i.test(m)) || mails[0];
  const platte = eerste.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  ok('de mail: onderwerp, {naam} en {plaats} ingevuld, en een afmeldlink eronder', /Sluit alles nog goed/.test(platte) && /Beste Campagne Klant \d+/.test(platte) && /Rhenen/.test(platte) && /\/afmelden\/[\w-]+\/[0-9a-f]{24}/.test(platte), platte.slice(0, 400));
  ok('de ontvangerslijst toont per klant de status en waarom iemand is overgeslagen', klaar.ontvangers.length === 12 && klaar.ontvangers.filter((o) => o.status === 'verstuurd').length === 11 && klaar.ontvangers.some((o) => o.status === 'overgeslagen' && /afgemeld/.test(o.fout)));
  ok('een verstuurde campagne kan niet opnieuw gestart of verwijderd worden (409)', (await api('POST', `/api/campagnes/${concept.id}/start`, {}, ass)).status === 409 && (await api('DELETE', `/api/campagnes/${concept.id}`, null, ass)).status === 409);

  // Rustperiode: dezelfde klanten vallen de komende 30 dagen af voor een volgende campagne.
  const vb2 = (await api('POST', '/api/campagnes/voorbeeld', { doelgroep: 'plaats', params: { plaats: 'Rhenen' } }, ass)).json;
  ok('rustperiode: wie net een campagne kreeg valt af bij de volgende (11× "rust")', vb2.aantal === 0 && vb2.afgevallen.rust === 11, JSON.stringify(vb2.afgevallen));

  // Afmelden via de link onder de mail.
  const link = (platte.match(/\/afmelden\/[\w-]+\/[0-9a-f]{24}/) || [''])[0];
  const fout = await api('GET', link.replace(/[0-9a-f]{24}$/, '0'.repeat(24)));
  ok('afmeldlink met een verkeerde handtekening werkt niet (404) en meldt niemand af', fout.status === 404 && /werkt niet/.test(fout.tekst));
  const klantId = link.split('/')[2];
  const kijken = await api('GET', link);
  const naKijken = (await api('GET', '/api/customers', null, admin)).json.find((k) => k.id === klantId);
  ok('de afmeldlink alleen OPENEN meldt niemand af (mailprogramma\'s en scanners openen links vanzelf): er staat een knop om te bevestigen', kijken.status === 200 && /Ja, meld mij af/.test(kijken.tekst) && /method="post"/.test(kijken.tekst) && naKijken && !naKijken.campaignOptOut, JSON.stringify({ s: kijken.status, opt: naKijken && naKijken.campaignOptOut }));
  const foutPost = await api('POST', link.replace(/[0-9a-f]{24}$/, '0'.repeat(24)));
  const goed = await api('POST', link);
  const naAfmelden = (await api('GET', '/api/customers', null, admin)).json.find((k) => k.id === klantId);
  ok('bevestigen meldt precies die klant af, zonder inlog, met een nette pagina (verkeerde link: 404)', foutPost.status === 404 && goed.status === 200 && /U bent afgemeld/.test(goed.tekst) && naAfmelden && naAfmelden.campaignOptOut === true && naAfmelden.campaignOptOutVia === 'link', JSON.stringify({ f: foutPost.status, s: goed.status, opt: naAfmelden && naAfmelden.campaignOptOut }));
  ok('daarna toont de link dat de klant al is afgemeld', /U bent afgemeld/.test((await api('GET', link)).tekst));

  // Resultaat: een van de ontvangers krijgt daarna een opdracht.
  await api('POST', '/api/orders', { title: 'Rhenen — slot vervangen na campagne', customerId: klanten[0].id, status: 'nieuw', price: '150' }, admin);
  const resAss = (await api('GET', `/api/campagnes/${concept.id}`, null, ass)).json.resultaat;
  const resAdm = (await api('GET', `/api/campagnes/${concept.id}`, null, admin)).json.resultaat;
  ok('resultaat: aantal verstuurd, nieuwe opdrachten en afmeldingen daarna', resAss.verstuurd === 11 && resAss.opdrachten === 1 && resAss.afgemeld === 1, JSON.stringify(resAss));
  ok('de assistente ziet GEEN omzet bij het resultaat; de beheerder wel — met het bedrag van die opdracht (zelfde rekenregel als Cijfers)', !('omzet' in resAss) && resAdm.omzet === 150, JSON.stringify({ ass: Object.keys(resAss), omzet: resAdm.omzet }));

  // Voorstellen: zonder AI-sleutel komen ze uit de vaste regels, met het echte aantal ontvangers.
  await api('POST', '/api/campagnes/instellingen', { rustDagen: 0, perDag: 500 }, admin);
  const vst = await api('POST', '/api/campagnes/voorstellen', {}, ass);
  ok('voorstellen zonder AI: uit de vaste regels, elk met doelgroep, onderwerp, tekst, uitleg en het echte aantal ontvangers', vst.status === 200 && vst.json.bron === 'regels' && vst.json.voorstellen.length >= 1 && vst.json.voorstellen.every((v) => v.doelgroep && v.onderwerp && /\{naam\}/.test(v.tekst) && v.waarom && v.bereikbaar > 0 && v.doelgroepNaam), JSON.stringify(vst.json).slice(0, 300));
  ok('een voorstel is nog geen campagne: er is niets aangemaakt of verstuurd', (await api('GET', '/api/campagnes', null, ass)).json.campagnes.length === 2);
  const uitVoorstel = (await api('POST', '/api/campagnes', { ...vst.json.voorstellen[0], naam: vst.json.voorstellen[0].titel }, ass)).json;
  ok('van een voorstel maak je met één klik een CONCEPT (bron en uitleg bewaard) — versturen blijft een aparte klik', uitVoorstel.status === 'concept' && uitVoorstel.bron === 'regels' && !!uitVoorstel.waarom && uitVoorstel.aantal === 0, JSON.stringify(uitVoorstel).slice(0, 200));
  await api('DELETE', `/api/campagnes/${uitVoorstel.id}`, null, ass);
  const aiTekst = await api('POST', '/api/campagnes/ai-tekst', { wens: 'korter', doelgroep: 'alle', tekst: 'Beste {naam}' }, ass);
  ok('AI-tekst zonder AI-sleutel: nette uitleg (503), geen crash', aiTekst.status === 503 && /AI/.test(aiTekst.json.error || ''), JSON.stringify(aiTekst.json));
  ok('monteur mag geen voorstellen opvragen (403)', (await api('POST', '/api/campagnes/voorstellen', {}, mon)).status === 403);
  await api('POST', '/api/campagnes/instellingen', { rustDagen: 30, perDag: 200 }, admin);

  // Het bevestigde aantal moet kloppen met wat er echt uitgaat.
  {
    for (let i = 1; i <= 2; i++) await api('POST', '/api/customers', { name: `Aantal Klant ${i}`, email: `aantal${i}@campagne.test`, address: `Laan ${i}, 3901 AA Veenendaal` }, admin);
    const ca = (await api('POST', '/api/campagnes', { naam: 'Aantal', onderwerp: 'Proef aantal', tekst: 'Beste {naam}', doelgroep: 'plaats', params: { plaats: 'Veenendaal' } }, ass)).json;
    const voor = mails.length;
    const mis = await api('POST', `/api/campagnes/${ca.id}/start`, { verwacht: 1 }, ass);
    const naMis = (await api('GET', `/api/campagnes/${ca.id}`, null, ass)).json;
    ok('het scherm bevestigde 1 ontvanger maar het zijn er 2: de server start NIET (409 met uitleg) en er gaat niets uit', mis.status === 409 && /veranderd/.test((mis.json || {}).error || '') && naMis.status === 'concept' && mails.length === voor, JSON.stringify({ s: mis.status, e: mis.json, st: naMis.status }));
    await api('DELETE', `/api/campagnes/${ca.id}`, null, ass);
  }

  // Stoppen halverwege.
  for (let i = 13; i <= 24; i++) await api('POST', '/api/customers', { name: `Stop Klant ${i}`, email: `stop${i}@campagne.test`, address: `Stopweg ${i}, 6701 AA Wageningen` }, admin);
  mails.length = 0; enveloppen.length = 0;
  const c2 = (await api('POST', '/api/campagnes', { naam: 'Stopproef', onderwerp: 'Proef', tekst: 'Beste {naam}', doelgroep: 'plaats', params: { plaats: 'Wageningen' } }, ass)).json;
  await api('POST', `/api/campagnes/${c2.id}/start`, {}, ass);
  for (let i = 0; i < 30 && mails.length < 8; i++) await slaap(200);
  const gestopt = (await api('POST', `/api/campagnes/${c2.id}/stop`, {}, ass)).json;
  await api('POST', '/api/campagnes/ronde', {}, admin); await slaap(500);
  ok('stoppen halverwege: wat nog wachtte gaat niet meer uit', gestopt.status === 'gestopt' && gestopt.verstuurd === 8 && gestopt.overgeslagen === 4 && mails.length === 8, JSON.stringify({ s: gestopt.status, v: gestopt.verstuurd, o: gestopt.overgeslagen, m: mails.length }));

  // Instellingen: alleen de beheerder.
  ok('instellingen wijzigen: assistente 403, beheerder mag (binnen grenzen)', (await api('POST', '/api/campagnes/instellingen', { rustDagen: 10 }, ass)).status === 403 && (await api('POST', '/api/campagnes/instellingen', { rustDagen: 9999, perDag: 1 }, admin)).json.rustDagen === 365);
  const dagmax = (await api('GET', '/api/campagnes', null, admin)).json;
  ok('het dagmaximum heeft een ondergrens en het overzicht telt wat er vandaag al uit is', dagmax.instellingen.perDag === 10 && dagmax.vandaagVerstuurd === 19, JSON.stringify({ i: dagmax.instellingen, v: dagmax.vandaagVerstuurd }));
  // Dagmaximum bereikt (10, er zijn er vandaag al 19 uit): een nieuwe campagne wacht tot morgen.
  await api('POST', '/api/campagnes/instellingen', { rustDagen: 0, perDag: 10 }, admin);
  mails.length = 0;
  const c3 = (await api('POST', '/api/campagnes', { naam: 'Dagmax', onderwerp: 'Proef 3', tekst: 'Beste {naam}', doelgroep: 'plaats', params: { plaats: 'Wageningen' } }, ass)).json;
  await api('POST', `/api/campagnes/${c3.id}/start`, {}, ass); await slaap(700);
  const c3na = (await api('GET', `/api/campagnes/${c3.id}`, null, ass)).json;
  ok('dagmaximum bereikt: de campagne blijft staan met uitleg en er gaat vandaag niets meer uit', mails.length === 0 && c3na.status === 'bezig' && /maximum/.test(c3na.melding), JSON.stringify({ m: mails.length, s: c3na.status, melding: c3na.melding }));

  // De oude snelle knop op Klanten (POST /api/campaign/send) heeft dezelfde vangrails en dezelfde afmeldlink.
  const s1 = (await api('POST', '/api/customers', { name: 'Snel Een', email: 'snel1@campagne.test' }, admin)).json;
  const s2 = (await api('POST', '/api/customers', { name: 'Snel Twee', email: 'snel2@beheerkantoor.test' }, admin)).json;
  const s3 = (await api('POST', '/api/customers', { name: 'Snel Drie', email: 'snel3@campagne.test' }, admin)).json;
  await api('PATCH', '/api/settings', { tussenpersonen: ['beheerkantoor.test'] }, admin);
  await api('PATCH', `/api/customers/${s3.id}`, { campaignOptOut: true }, admin);
  mails.length = 0; enveloppen.length = 0;
  const snel = (await api('POST', '/api/campaign/send', { subject: 'Snelle proef', body: 'Beste {naam}', customerIds: [s1.id, s2.id, s3.id] }, ass)).json;
  const snelMail = (mails[0] || '').replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  ok('snelle mail vanaf Klanten: niet naar een tussenpersoon of afgemelde klant, en met dezelfde afmeldlink eronder', snel.sent === 1 && snel.skipped === 2 && mails.length === 1 && enveloppen[0].join() === 'snel1@campagne.test' && new RegExp(`/afmelden/${s1.id}/[0-9a-f]{24}`).test(snelMail), JSON.stringify({ antwoord: snel, m: mails.length, e: enveloppen.map((e) => e.join()) }));
  const snelLink = (snelMail.match(/\/afmelden\/[\w-]+\/[0-9a-f]{24}/) || [''])[0];
  const snelAf = snelLink ? await api('POST', snelLink) : { status: 0 };
  ok('die afmeldlink werkt ook echt', snelAf.status === 200 && (await api('GET', '/api/customers', null, admin)).json.find((k) => k.id === s1.id).campaignOptOut === true, String(snelAf.status));

  // Storing bij de mailserver: niemand wordt als "mislukt" weggeschreven; na 5 rondes pauzeert de campagne.
  await api('POST', `/api/campagnes/${c3.id}/stop`, {}, ass); // de campagne van hierboven wacht nog op morgen: uit de weg
  await api('POST', '/api/campagnes/instellingen', { rustDagen: 0, perDag: 200 }, admin);
  for (let i = 1; i <= 3; i++) await api('POST', '/api/customers', { name: `Storing Klant ${i}`, email: `storing${i}@campagne.test`, address: `Dijk ${i}, 4001 AA Tiel` }, admin);
  smtpStuk = true; mails.length = 0; enveloppen.length = 0;
  const c4 = (await api('POST', '/api/campagnes', { naam: 'Storing', onderwerp: 'Proef 4', tekst: 'Beste {naam}', doelgroep: 'plaats', params: { plaats: 'Tiel' } }, ass)).json;
  await api('POST', `/api/campagnes/${c4.id}/start`, {}, ass);
  let st1 = null; for (let i = 0; i < 30; i++) { await slaap(200); st1 = (await api('GET', `/api/campagnes/${c4.id}`, null, ass)).json; if (st1.melding) break; }
  ok('storing bij de mailserver: de campagne blijft staan, niemand is "mislukt" en er staat uitleg bij', st1.status === 'bezig' && st1.mislukt === 0 && st1.ontvangers.every((o) => o.status === 'wacht') && /lukt nu niet/.test(st1.melding) && mails.length === 0, JSON.stringify({ s: st1.status, mis: st1.mislukt, melding: st1.melding }));
  for (let i = 0; i < 4; i++) await api('POST', '/api/campagnes/ronde', {}, admin);
  const st5 = (await api('GET', `/api/campagnes/${c4.id}`, null, ass)).json;
  ok('na 5 rondes storing pauzeert de campagne vanzelf; iedereen wacht nog', st5.status === 'gepauzeerd' && st5.mislukt === 0 && st5.ontvangers.every((o) => o.status === 'wacht') && /gepauzeerd/.test(st5.melding), JSON.stringify({ s: st5.status, melding: st5.melding }));
  smtpStuk = false;
  await api('POST', `/api/campagnes/${c4.id}/hervat`, {}, ass);
  await api('POST', '/api/campagnes/ronde', {}, admin);
  for (let i = 0; i < 30 && mails.length < 3; i++) await slaap(200);
  const stNa = (await api('GET', `/api/campagnes/${c4.id}`, null, ass)).json;
  ok('werkt de mail weer en klik je op Hervatten, dan krijgt iedereen de mail alsnog (precies één keer)', stNa.status === 'verstuurd' && stNa.verstuurd === 3 && mails.length === 3 && new Set(enveloppen.map((e) => e.join())).size === 3 && !stNa.melding, JSON.stringify({ s: stNa.status, v: stNa.verstuurd, m: mails.length, melding: stNa.melding }));

  // Inplannen + twee campagnes met dezelfde mensen: wie intussen een andere campagne kreeg, krijgt
  // de tweede niet meer (de rustperiode geldt ook op het moment van versturen).
  await api('POST', '/api/campagnes/instellingen', { rustDagen: 30, perDag: 200 }, admin);
  for (let i = 1; i <= 2; i++) await api('POST', '/api/customers', { name: `Dubbel Klant ${i}`, email: `dubbel${i}@campagne.test`, address: `Kade ${i}, 4201 AA Gorinchem` }, admin);
  const dubbel = (naam) => api('POST', '/api/campagnes', { naam, onderwerp: `Proef ${naam}`, tekst: 'Beste {naam}', doelgroep: 'plaats', params: { plaats: 'Gorinchem' } }, ass).then((r) => r.json);
  const dA = await dubbel('A'); const dB = await dubbel('B'); const dC = await dubbel('C');
  mails.length = 0; enveloppen.length = 0;
  const ingepland = (await api('POST', `/api/campagnes/${dC.id}/start`, { op: new Date(Date.now() + 26 * 3600000).toISOString() }, ass)).json;
  await api('POST', '/api/campagnes/ronde', {}, admin); await slaap(300);
  ok('inplannen: een campagne voor morgen staat op "gepland" met de ontvangers klaar, en verstuurt nu nog niets', ingepland.status === 'gepland' && ingepland.wacht === 2 && !!ingepland.geplandOp && mails.length === 0, JSON.stringify({ s: ingepland.status, w: ingepland.wacht, m: mails.length }));
  await api('POST', `/api/campagnes/${dC.id}/stop`, {}, ass);
  smtpStuk = true;                                                   // B start, maar de mailserver hapert …
  await api('POST', `/api/campagnes/${dB.id}/start`, {}, ass);
  for (let i = 0; i < 30; i++) { await slaap(200); if ((await api('GET', `/api/campagnes/${dB.id}`, null, ass)).json.melding) break; }
  await api('POST', `/api/campagnes/${dB.id}/pauze`, {}, ass);
  smtpStuk = false;
  await api('POST', `/api/campagnes/${dA.id}/start`, {}, ass);       // … intussen krijgen dezelfde mensen campagne A
  for (let i = 0; i < 30 && mails.length < 2; i++) await slaap(200);
  await api('POST', `/api/campagnes/${dB.id}/hervat`, {}, ass);
  await api('POST', '/api/campagnes/ronde', {}, admin); await slaap(400);
  const bNa = (await api('GET', `/api/campagnes/${dB.id}`, null, ass)).json;
  ok('wie intussen een andere campagne kreeg, krijgt de tweede niet meer: overgeslagen met de reden erbij, geen tweede mail', mails.length === 2 && bNa.verstuurd === 0 && bNa.overgeslagen === 2 && bNa.ontvangers.every((o) => /andere campagne/.test(o.fout)), JSON.stringify({ m: mails.length, v: bNa.verstuurd, o: bNa.overgeslagen, f: bNa.ontvangers.map((o) => o.fout) }));
} finally {
  proc.kill('SIGTERM'); smtp.close();
}

console.log(`\n========== CAMPAGNE: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
