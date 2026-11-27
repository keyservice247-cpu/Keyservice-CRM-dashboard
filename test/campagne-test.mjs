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
import { SJABLONEN, leesOpmaak, bouwCampagneHtml, knopDoel, sjabloonVoorDoelgroep } from '../server/campagne-sjablonen.js';

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

// ---- Jaarlijks onderhoud (27 nov 2026): 11 tot 14 maanden na de laatste afgeronde schuifpui-opdracht ----
{
  const kl = ['a', 'b', 'c', 'd', 'e'].map((x) => ({ id: `oh-${x}`, name: `Onderhoud ${x}`, email: `oh-${x}@voorbeeld.test`, address: 'Testdorp' }));
  const sp = (id, klant, dagen, extra = {}) => ({ id, customerId: klant, status: 'afgerond', title: 'Testdorp — schuifpui loopt zwaar', createdAt: geleden(dagen + 2), completedAt: geleden(dagen), ...extra });
  const od = [sp('s1', 'oh-a', 365), sp('s2', 'oh-b', 270), sp('s3', 'oh-c', 460), sp('s4', 'oh-d', 365), sp('s5', 'oh-d', 60),
    { id: 's6', customerId: 'oh-e', status: 'afgerond', title: 'Testdorp — cilinder vervangen', createdAt: geleden(367), completedAt: geleden(365) }];
  const wie = kiesOntvangers(klantFeiten({ customers: kl, orders: od, invoices: [], nu }), { doelgroep: 'onderhoud', rustDagen: 0, nu }).ontvangers.map((o) => o.customerId).join(',');
  ok('onderhoud: alleen wie 11–14 maanden geleden een schuifpui liet maken (niet 9 of 15 maanden, niet wie intussen terugkwam, geen slotenklant)', wie === 'oh-a', wie);
  ok('de onderhoudsdoelgroep krijgt het schuifpui-sjabloon', sjabloonVoorDoelgroep('onderhoud') === 'schuifpui');
}

// ====================== DEEL 2: met de server en een nep-mailserver ======================
const schoneOmgeving = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SMTP_|IMAP_|SENT_IMAP_|WHATSAPP_|GOOGLE_|ANTHROPIC_|DATA_DIR$|OMGEVING$)/.test(k)));
const PORT = 3157; const SMTP_PORT = 2657; const BASE = `http://localhost:${PORT}`; const TOKEN = 'test123';
const DIR = mkdtempSync(join(tmpdir(), 'crm-campagne-'));
// OPMAAK (26 nov 2026): drie vaste sjablonen. Puur: geen database, geen mail.
{
  const bedrijf = { naam: 'Key Service 24/7', telefoon: '085 060 2359', email: 'info@voorbeeld.test', website: 'www.voorbeeld.test', whatsapp: '' };
  ok('opmaak: vier keuzes — alleen tekst en de drie vaste sjablonen (schuifpuien, kozijnonderhoud, sloten & cilinders), elk met kop, tekst en knop', SJABLONEN.map((x) => x.key).join() === 'tekst,schuifpui,kozijn,sloten' && SJABLONEN.slice(1).every((x) => x.kop && x.onderwerp && /\{naam\}/.test(x.tekst) && x.knopTekst && x.kleur));
  ok('opmaak: een onbekend sjabloon wordt "alleen tekst"; lege kop/knop krijgen de standaard van het sjabloon', leesOpmaak({ sjabloon: 'iets-anders', kop: 'x' }).sjabloon === 'tekst' && !('kop' in leesOpmaak({ sjabloon: 'tekst', kop: 'x' })) && leesOpmaak({ sjabloon: 'kozijn' }).kop === SJABLONEN[2].kop && leesOpmaak({ sjabloon: 'sloten', knopSoort: 'raar' }).knopSoort === 'aanvraag' && leesOpmaak({ sjabloon: 'sloten', knopSoort: 'bel' }).knopSoort === 'bel');
  const html = bouwCampagneHtml({ opmaak: leesOpmaak({ sjabloon: 'schuifpui', kop: 'Kop <b>met</b> haakjes', knopSoort: 'bel' }), onderwerp: 'Proef', tekst: 'Beste Jan,\n\nRegel één\nregel twee <script>alert(1)</script>', bedrijf, afmeldUrl: 'https://voorbeeld.test/afmelden/k1/abc', logoSrc: 'cid:kslogo', fotoSrc: 'cid:kopfoto' });
  ok('opmaak: de mail heeft logo, kop, foto, tekst in alinea\'s, een bel-knop, de bedrijfsgegevens en de afmeldlink', /cid:kslogo/.test(html) && /<h1[^>]*>Kop/.test(html) && /cid:kopfoto/.test(html) && /Regel één<br>regel twee/.test(html) && /href="tel:0850602359"/.test(html) && /085 060 2359/.test(html) && /href="https:\/\/voorbeeld\.test\/afmelden\/k1\/abc"/.test(html));
  ok('opmaak: wat de gebruiker typt kan nooit opmaak of code worden (alles ge-escaped)', !/<script>/.test(html) && /&lt;script&gt;/.test(html) && !/<b>met<\/b>/.test(html));
  const htmlA = (knopUrl) => bouwCampagneHtml({ opmaak: leesOpmaak({ sjabloon: 'schuifpui' }), tekst: 'x', bedrijf, knopUrl }).replace(/<a href="[^"]*afmelden[^"]*"/, '');
  ok('opmaak: de knop "aanvraag" gaat alleen naar de meegegeven link van die klant — zonder link staat er geen knop (nooit stiekem bellen)', /href="https:\/\/voorbeeld\.test\/k\/c1\/k1\/abc"/.test(htmlA('https://voorbeeld.test/k/c1/k1/abc')) && !/href="tel:/.test(htmlA('https://voorbeeld.test/k/c1/k1/abc')) && !/<a href/.test(htmlA('')));
  ok('opmaak: "alleen tekst" geeft geen HTML (de gewone mail met handtekening)', bouwCampagneHtml({ opmaak: { sjabloon: 'tekst' }, tekst: 'x', bedrijf }) === '');
  ok('opmaak: de knop — bellen, mailen, website; WhatsApp alleen met een ingesteld nummer (06 → 316…); zonder doel geen knop', knopDoel('bel', bedrijf) === 'tel:0850602359' && /^mailto:info@voorbeeld\.test\?subject=/.test(knopDoel('mail', bedrijf, 'Proef')) && knopDoel('site', bedrijf) === 'https://www.voorbeeld.test' && knopDoel('whatsapp', bedrijf) === '' && knopDoel('whatsapp', { whatsapp: '06 12345678' }) === 'https://wa.me/31612345678'
    && !/<a href/.test(bouwCampagneHtml({ opmaak: leesOpmaak({ sjabloon: 'sloten', knopSoort: 'geen' }), tekst: 'x', bedrijf }).replace(/<a href="[^"]*afmelden[^"]*"/, '')) && !/wa\.me/.test(bouwCampagneHtml({ opmaak: leesOpmaak({ sjabloon: 'sloten', knopSoort: 'whatsapp' }), tekst: 'x', bedrijf })));
  ok('opmaak: bij een voorstel uit vaste regels past het sjabloon bij de doelgroep', sjabloonVoorDoelgroep('schuifpui') === 'schuifpui' && sjabloonVoorDoelgroep('sloten') === 'sloten' && sjabloonVoorDoelgroep('oud') === 'tekst');
}

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

  // OPMAAK via de server: sjabloon + eigen foto → de klant krijgt een opgemaakte mail (met de platte tekst als terugval).
  {
    await api('POST', '/api/campagnes/instellingen', { rustDagen: 0, perDag: 500 }, admin);
    const overzicht = (await api('GET', '/api/campagnes', null, ass)).json;
    ok('het scherm krijgt de sjablonen en de bedrijfsgegevens voor onder de mail', (overzicht.sjablonen || []).length === 4 && !!overzicht.bedrijf && !!overzicht.bedrijf.naam, JSON.stringify((overzicht.sjablonen || []).map((x) => x.key)));
    for (let i = 1; i <= 2; i++) await api('POST', '/api/customers', { name: `Opmaak Klant ${i}`, email: `opmaak${i}@campagne.test`, address: `Singel ${i}, 3701 AA Zeist` }, admin);
    const co = (await api('POST', '/api/campagnes', { naam: 'Opmaak', onderwerp: 'Een onderhoudsbeurt voor uw schuifpui', tekst: 'Beste {naam},\n\nUw schuifpui in {plaats} verdient onderhoud.', doelgroep: 'plaats', params: { plaats: 'Zeist' }, opmaak: { sjabloon: 'schuifpui', kop: 'Loopt uw pui nog licht?', knopTekst: 'Bel voor onderhoud', knopSoort: 'bel' } }, ass)).json;
    ok('een campagne onthoudt het sjabloon, de kop en de knoptekst', co.opmaak && co.opmaak.sjabloon === 'schuifpui' && co.opmaak.kop === 'Loopt uw pui nog licht?' && co.opmaak.knopTekst === 'Bel voor onderhoud' && co.foto === false, JSON.stringify(co.opmaak));
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAGCAYAAAD68A/GAAAAFklEQVR42mP8z8Dwn4EIwDiqkL4KAZ0jBf3bV1p1AAAAAElFTkSuQmCC';
    const teGroot = await api('POST', `/api/campagnes/${co.id}/foto`, { mime: 'image/png', dataBase64: Buffer.alloc(1600 * 1024, 1).toString('base64') }, ass);
    const geenFoto = await api('POST', `/api/campagnes/${co.id}/foto`, { mime: 'application/pdf', dataBase64: png }, ass);
    const fotoOk = await api('POST', `/api/campagnes/${co.id}/foto`, { mime: 'image/png', dataBase64: png }, ass);
    const fotoTerug = await fetch(`${BASE}/api/campagnes/${co.id}/foto`, { headers: { cookie: ass } });
    ok('eigen foto: te groot (413) en geen afbeelding (400) worden geweigerd met uitleg; een foto wordt bewaard en is op te halen', teGroot.status === 413 && geenFoto.status === 400 && fotoOk.status === 200 && fotoOk.json.foto === true && fotoTerug.status === 200 && /image\/png/.test(fotoTerug.headers.get('content-type') || ''), JSON.stringify({ g: teGroot.status, n: geenFoto.status, o: fotoOk.status, t: fotoTerug.status }));
    ok('de foto en het voorbeeld zijn alleen voor kantoor (monteur 403, zonder inlog 401)', (await api('GET', `/api/campagnes/${co.id}/foto`, null, mon)).status === 403 && (await api('POST', '/api/campagnes/voorbeeld-html', { id: co.id }, mon)).status === 403 && (await api('GET', `/api/campagnes/${co.id}/foto`)).status === 401);
    const vb = (await api('POST', '/api/campagnes/voorbeeld-html', { id: co.id, onderwerp: co.onderwerp, tekst: co.tekst, opmaak: co.opmaak }, ass)).json;
    ok('voorbeeld: de opgemaakte mail met een voorbeeldnaam, de kop, de knop en de foto', /Beste Voorbeeldklant/.test(vb.html) && /Loopt uw pui nog licht\?/.test(vb.html) && /Bel voor onderhoud/.test(vb.html) && new RegExp(`/api/campagnes/${co.id}/foto`).test(vb.html) && /Voorbeeldstad/.test(vb.html), (vb.html || '').slice(0, 200));
    const vbTekst = (await api('POST', '/api/campagnes/voorbeeld-html', { onderwerp: 'x', tekst: 'Beste {naam}', opmaak: { sjabloon: 'tekst' } }, ass)).json;
    ok('voorbeeld bij "alleen tekst": geen HTML, wel de tekst', vbTekst.html === '' && /Beste Voorbeeldklant/.test(vbTekst.tekst));
    mails.length = 0; enveloppen.length = 0;
    await api('POST', `/api/campagnes/${co.id}/start`, {}, ass);
    for (let i = 0; i < 30 && mails.length < 2; i++) await slaap(200);
    const ruw = (mails.find((m) => /opmaak1@campagne\.test/i.test(m)) || mails[0] || '');
    const mail = ruw.replace(/=\r?\n/g, '').replace(/=3D/g, '=').replace(/=C3=A9/g, 'é');
    const klant1 = (await api('GET', '/api/customers', null, admin)).json.find((k) => k.email === 'opmaak1@campagne.test');
    ok('de klant krijgt de OPGEMAAKTE mail: HTML met kop, naam, plaats, bel-knop en afmeldlink — én de platte tekst als terugval', mails.length === 2 && /Content-Type: text\/html/i.test(ruw) && /Content-Type: text\/plain/i.test(ruw) && /Loopt uw pui nog licht\?/.test(mail) && /Beste Opmaak Klant 1/.test(mail) && /Zeist/.test(mail) && /Bel voor onderhoud/.test(mail) && new RegExp(`/k/${co.id}/${klant1.id}/[0-9a-f]{24}`).test(mail) && new RegExp(`/afmelden/${klant1.id}/[0-9a-f]{24}`).test(mail), mail.slice(0, 300));
    ok('de foto en het logo gaan als afbeelding IN de mail mee (geen link naar buiten)', /cid:kopfoto/.test(mail) && /Content-ID: <kopfoto>/i.test(ruw) && /cid:kslogo/.test(mail) && /Content-ID: <kslogo>/i.test(ruw), ruw.match(/Content-ID: [^\r\n]*/gi));
    const naStart = await api('POST', `/api/campagnes/${co.id}/foto`, { mime: 'image/png', dataBase64: png }, ass);
    ok('na het versturen is de foto niet meer te wijzigen (409)', naStart.status === 409 && (await api('DELETE', `/api/campagnes/${co.id}/foto`, null, ass)).status === 409);
    // een campagne zonder sjabloon blijft de gewone mail
    await api('POST', '/api/customers', { name: 'Gewoon Klant', email: 'gewoon@campagne.test', address: 'Dorpsweg 1, 3941 AA Doorn' }, admin);
    const cg = (await api('POST', '/api/campagnes', { naam: 'Gewoon', onderwerp: 'Gewone mail', tekst: 'Beste {naam}', doelgroep: 'plaats', params: { plaats: 'Doorn' } }, ass)).json;
    mails.length = 0;
    await api('POST', `/api/campagnes/${cg.id}/start`, {}, ass);
    for (let i = 0; i < 30 && mails.length < 1; i++) await slaap(200);
    ok('zonder sjabloon ("alleen tekst") gaat de gewone mail uit, zonder kop of knop', cg.opmaak.sjabloon === 'tekst' && mails.length === 1 && !/<h1/.test(mails[0]) && !/cid:kopfoto/.test(mails[0]) && /afmelden/.test(mails[0].replace(/=\r?\n/g, '')));
    // ---------- KLIKTELLER (27 nov 2026) ----------
    console.log('\n== Klikteller: de knop in de mail ==');
    const klikPad = (mail.match(/\/k\/[\w-]+\/[\w-]+\/[0-9a-f]{24}/) || [''])[0];
    ok('de knop in de mail aan een klant gaat via een ondertekende klik-link (niet rechtstreeks naar tel:)', !!klikPad && klikPad.includes(`/k/${co.id}/${klant1.id}/`) && !/href="tel:/.test(mail), klikPad);
    const uitslag = async (cid) => (await api('GET', `/api/campagnes/${cid}`, null, ass)).json;
    const mens = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' };
    const k0 = await fetch(BASE + klikPad, { headers: mens });
    const k0html = await k0.text();
    ok('de link stuurt meteen door naar het echte doel (bellen), met een knop als reserve', k0.status === 200 && /http-equiv="refresh" content="0;url=tel:/.test(k0html) && /class="knop" href="tel:/.test(k0html) && /Bel voor onderhoud/.test(k0html), k0html.slice(0, 300));
    ok('een klik binnen een minuut na het versturen telt NIET (virusscanners openen links meteen)', (await uitslag(co.id)).resultaat.kliks === 0);
    await fetch(BASE + klikPad, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Barracuda Link Scanner)', 'x-test-later': '1' } });
    await fetch(BASE + klikPad, { method: 'HEAD', headers: { ...mens, 'x-test-later': '1' } });
    ok('een bekende scanner en een HEAD-verzoek tellen niet', (await uitslag(co.id)).resultaat.kliks === 0);
    await fetch(BASE + klikPad, { headers: { ...mens, 'x-test-later': '1' } });
    await fetch(BASE + klikPad, { headers: { ...mens, 'x-test-later': '1' } });
    const naKlik = await uitslag(co.id);
    ok('een echte klik telt, en twee keer tikken blijft één klant', naKlik.resultaat.kliks === 1 && naKlik.ontvangers.filter((o) => o.klik).length === 1 && naKlik.ontvangers.find((o) => o.klik).email === 'opmaak1@campagne.test', JSON.stringify(naKlik.resultaat));
    const foutSig = klikPad.replace(/[0-9a-f]{24}$/, 'a'.repeat(24));
    ok('een geknoeide klik-link werkt niet (404) en telt niets', (await fetch(BASE + foutSig, { headers: { ...mens, 'x-test-later': '1' } })).status === 404 && (await uitslag(co.id)).resultaat.kliks === 1);
    ok('een gewone tekstmail heeft geen knop: kliks is "niet te meten" (null), geen 0', (await uitslag(cg.id)).resultaat.kliks === null && !/\/k\//.test(mails[0] || ''));
    const vbKlik = (await api('POST', '/api/campagnes/voorbeeld-html', { id: co.id, onderwerp: co.onderwerp, tekst: co.tekst, opmaak: co.opmaak }, ass)).json;
    ok('in het voorbeeld in het scherm zit geen klik-link (alleen in de echte mail)', !/\/k\//.test(vbKlik.html) && /href="tel:/.test(vbKlik.html));

    // ---------- KNOP "AANVRAAG" (28 nov 2026) ----------
    console.log('\n== Knop "aanvraag": een tik op de knop wordt een opdracht in het CRM ==');
    const ka = [];
    for (let i = 1; i <= 3; i++) ka.push((await api('POST', '/api/customers', { name: `Aanvraag Klant ${i}`, email: `aanvraag${i}@campagne.test`, phone: `06 5550 010${i}`, address: `Kerkpad ${i}, 3981 AA Bunnik` }, admin)).json);
    const lopend = (await api('POST', '/api/orders', { customerId: ka[1].id, title: 'Bunnik — slot klemt' }, admin)).json;
    const ca = (await api('POST', '/api/campagnes', { naam: 'Onderhoud najaar', onderwerp: 'Tijd voor onderhoud', tekst: 'Beste {naam}', doelgroep: 'plaats', params: { plaats: 'Bunnik' }, opmaak: { sjabloon: 'schuifpui', kop: 'Plan een onderhoudsbeurt', knopTekst: 'Plan onderhoud' } }, ass)).json;
    ok('een sjabloon zet de knop standaard op "aanvraag in het CRM"', ca.opmaak.knopSoort === 'aanvraag', JSON.stringify(ca.opmaak));
    const vbA = (await api('POST', '/api/campagnes/voorbeeld-html', { id: ca.id, onderwerp: ca.onderwerp, tekst: ca.tekst, opmaak: ca.opmaak }, ass)).json;
    ok('voorbeeld: de knop staat erin, zonder echte link (geen klant, dus ook geen aanvraag)', /Plan onderhoud/.test(vbA.html) && !/\/k\//.test(vbA.html) && !/href="tel:/.test(vbA.html));
    mails.length = 0;
    await api('POST', `/api/campagnes/${ca.id}/test`, { naar: 'baas@campagne.test' }, ass);
    for (let i = 0; i < 30 && mails.length < 1; i++) await slaap(200);
    const testMailA = (mails[0] || '').replace(/=\r?\n/g, '').replace(/=3D/g, '=');
    const proefPagina = await fetch(`${BASE}/k/proef`);
    ok('testmail: de knop gaat naar een uitlegpagina (/k/proef), nooit naar de aanvraag van een klant', mails.length === 1 && /\/k\/proef/.test(testMailA) && !new RegExp(`/k/${ca.id}/`).test(testMailA) && proefPagina.status === 200 && /Dit is een proef/.test(await proefPagina.text()), testMailA.match(/\/k\/[^"\s]*/g));
    mails.length = 0;
    await api('POST', `/api/campagnes/${ca.id}/start`, {}, ass);
    for (let i = 0; i < 40 && mails.length < 3; i++) await slaap(200);
    const alleA = mails.map((m) => m.replace(/=\r?\n/g, '').replace(/=3D/g, '=')).join('\n');
    const padVan = (k) => (alleA.match(new RegExp(`/k/${ca.id}/${k.id}/[0-9a-f]{24}`)) || [''])[0];
    const pad1 = padVan(ka[0]); const pad2 = padVan(ka[1]); const pad3 = padVan(ka[2]);
    const campagneOrders = async () => (await api('GET', '/api/orders', null, admin)).json.filter((o) => /^Campagne/.test(o.source || ''));
    ok('elke klant krijgt zijn eigen ondertekende link in de knop', mails.length === 3 && !!pad1 && !!pad2 && !!pad3 && pad1 !== pad2, JSON.stringify([pad1, pad2, pad3]));
    const later = { ...mens, 'x-test-later': '1' };
    const g1 = await fetch(BASE + pad1, { headers: later }); const g1html = await g1.text();
    ok('de link OPENEN toont alleen een bevestigingspagina met één knop — er wordt niets aangemaakt en niet doorgestuurd', g1.status === 200 && /<form method="post"/.test(g1html) && /Ja, neem contact met mij op/.test(g1html) && /Plan een onderhoudsbeurt/.test(g1html) && !/http-equiv="refresh"/.test(g1html) && (await campagneOrders()).length === 0, g1html.slice(0, 200));
    await fetch(BASE + pad1, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Barracuda Link Scanner)', 'x-test-later': '1' } });
    await fetch(BASE + pad1, { method: 'HEAD', headers: later });
    ok('een virusscanner of mailprogramma dat de link opent maakt geen opdracht', (await campagneOrders()).length === 0 && (await uitslag(ca.id)).resultaat.aanvragen === 0);
    const formulier = (velden) => ({ method: 'POST', headers: { ...later, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(velden).toString() });
    const p1 = await fetch(BASE + pad1, formulier({ opmerking: 'Liefst op een dinsdag. <b>dank</b>' })); const p1html = await p1.text();
    const na1 = await campagneOrders(); const o1 = na1[0] || {};
    ok('de knop op die pagina zet een NIEUWE OPDRACHT in het CRM: plaats vooraan in de titel, bron "Campagne", de klant gekoppeld', p1.status === 200 && /Bedankt/.test(p1html) && na1.length === 1 && /^Bunnik — Aanvraag via campagne: Plan een onderhoudsbeurt/.test(o1.title) && o1.source === 'Campagne (e-mail)' && o1.customerId === ka[0].id, JSON.stringify({ s: p1.status, n: na1.length, t: o1.title, b: o1.source }));
    ok('alle gegevens staan op de opdracht: naam, telefoon, e-mail en adres van de klant, de campagne en wat de klant erbij schreef', o1.intake && o1.intake.name === 'Aanvraag Klant 1' && /5550/.test(o1.intake.phone) && o1.intake.email === 'aanvraag1@campagne.test' && /Kerkpad 1/.test(o1.intake.address) && /Onderhoud najaar/.test(o1.description) && /Liefst op een dinsdag/.test(o1.description) && o1.campagneAanvraag && o1.campagneAanvraag.campagneId === ca.id, JSON.stringify(o1.intake));
    const kolommen = (await api('GET', '/api/me', null, admin)).json.meta.statuses || [];
    ok('de opdracht staat in de eerste kolom met "klant reageerde", zonder monteur en zonder afspraak: een mens plant in', o1.status === (kolommen[0] || {}).key && o1.customerReplied === true && !o1.monteurId && !o1.appointmentAt, JSON.stringify({ st: o1.status, k: (kolommen[0] || {}).key }));
    const p1b = await fetch(BASE + pad1, formulier({ opmerking: 'nog een keer' }));
    const g1b = await (await fetch(BASE + pad1, { headers: later })).text();
    ok('twee keer tikken geeft één opdracht; de pagina zegt daarna meteen "Bedankt"', p1b.status === 200 && (await campagneOrders()).length === 1 && /Bedankt/.test(g1b) && !/<form/.test(g1b));
    await fetch(BASE + pad2, formulier({}));
    const o2 = (await campagneOrders()).find((o) => o.customerId === ka[1].id) || {};
    const lopendNa = (await api('GET', `/api/orders/${lopend.id}`, null, admin)).json;
    ok('heeft de klant al een lopende opdracht, dan komt er een nieuwe opdracht met een voorstel om samen te voegen — de lopende opdracht verandert niet', !!o2.id && o2.mergeSuggestion && o2.mergeSuggestion.orderId === lopend.id && lopendNa.status === lopend.status && lopendNa.title === lopend.title, JSON.stringify(o2.mergeSuggestion));
    const fout3 = await fetch(BASE + pad3.replace(/[0-9a-f]{24}$/, 'b'.repeat(24)), formulier({}));
    ok('een geknoeide link maakt niets aan (404)', fout3.status === 404 && (await campagneOrders()).length === 2);
    const uitA = await uitslag(ca.id);
    ok('de uitslag van de campagne telt de aanvragen en laat per ontvanger zien wie het was', uitA.resultaat.aanvragen === 2 && uitA.ontvangers.filter((o) => o.aanvraag).length === 2 && uitA.ontvangers.find((o) => o.email === 'aanvraag3@campagne.test').aanvraag === '', JSON.stringify(uitA.resultaat));
    ok('een campagne met een bel-knop meet geen aanvragen (null) en stuurt nog steeds door naar bellen', (await uitslag(co.id)).resultaat.aanvragen === null && /url=tel:/.test(await (await fetch(BASE + klikPad, { headers: later })).text()));
    await api('PATCH', `/api/orders/${o1.id}`, { status: 'geannuleerd', notes: 'test' }, admin);
    await fetch(BASE + pad1, formulier({}));
    ok('meteen na het afhandelen nog eens tikken (zelfde dag) geeft geen tweede opdracht', (await campagneOrders()).filter((o) => o.customerId === ka[0].id).length === 1);
    const dagLater = { method: 'POST', headers: { ...mens, 'x-test-later': 'dag', 'content-type': 'application/x-www-form-urlencoded' }, body: '' };
    await fetch(BASE + pad1, dagLater);
    ok('is die opdracht afgehandeld en tikt de klant dagen later weer op de knop, dan is dat een NIEUWE aanvraag (hij ziet nooit "Bedankt" terwijl er niets gebeurt)', (await campagneOrders()).filter((o) => o.customerId === ka[0].id).length === 2);
    ok('de monteur ziet deze opdrachten niet (ze zijn nog van niemand)', !(await api('GET', '/api/orders', null, mon)).json.some((o) => /^Campagne/.test(o.source || '')));

    // ---------- JAARLIJKSE ONDERHOUDSHERINNERING ----------
    console.log('\n== Jaarlijkse onderhoudsherinnering: een concept, nooit vanzelf versturen ==');
    for (let i = 1; i <= 3; i++) {
      const k = (await api('POST', '/api/customers', { name: `Onderhoud Klant ${i}`, email: `onderhoud${i}@campagne.test`, address: `Puiweg ${i}, 6708 AA Wageningen` }, admin)).json;
      await api('POST', '/api/orders', { customerId: k.id, title: `Wageningen — schuifpui loopt zwaar ${i}`, status: 'afgerond' }, admin);
    }
    const teVroeg = (await api('POST', '/api/campagnes/onderhoud-ronde', { dagenVooruit: 200 }, admin)).json;
    ok('na 6,5 maand is nog niemand toe aan onderhoud: geen concept', !teVroeg.concept && teVroeg.teWeinig === 0, JSON.stringify(teVroeg));
    mails.length = 0;
    const jaar = (await api('POST', '/api/campagnes/onderhoud-ronde', { dagenVooruit: 365 }, admin)).json;
    ok('na een jaar: het CRM zet een CONCEPT klaar voor wie 11–14 maanden geleden een schuifpui liet maken', !!jaar.concept && jaar.concept.status === 'concept' && jaar.concept.doelgroep === 'onderhoud' && jaar.concept.bron === 'automatisch' && jaar.aantal >= 3 && jaar.concept.opmaak.sjabloon === 'schuifpui', JSON.stringify(jaar).slice(0, 300));
    ok('het concept heeft nog geen ontvangers en er is NIETS verstuurd', jaar.concept.aantal === 0 && jaar.concept.verstuurd === 0 && mails.length === 0);
    const nogEens = (await api('POST', '/api/campagnes/onderhoud-ronde', { dagenVooruit: 365 }, admin)).json;
    ok('zolang dat concept openstaat komt er geen tweede bij', !nogEens.concept && nogEens.openstaand === true && (await api('GET', '/api/campagnes', null, ass)).json.campagnes.filter((c) => c.doelgroep === 'onderhoud').length === 1);
    const startPunt = ((await api('GET', '/api/overview', null, ass)).json.eerstDoen || []).find((p) => p.sleutel === 'campagne');
    ok('op Start staat bij kantoor "Campagne staat klaar om na te lezen" (af te vinken)', !!startPunt && /klaar om na te lezen/.test(startPunt.titel) && startPunt.afvinkbaar === true && startPunt.ga.view === 'campagnes', JSON.stringify(startPunt));
    ok('de monteur ziet dat punt niet', !((await api('GET', '/api/overview', null, mon)).json.eerstDoen || []).some((p) => p.sleutel === 'campagne'));
    await slaap(1500);
    ok('ook na een verzendronde is er niets uit het concept verstuurd', (await api('POST', '/api/campagnes/ronde', {}, admin)).status === 200 && mails.length === 0);

    // ---------- CAMPAGNES AAN / UIT ----------
    console.log('\n== Campagnes aan/uit (op de live-site uit tot de beheerder ze aanzet) ==');
    ok('alleen de beheerder mag de knop omzetten (assistente 403)', (await api('POST', '/api/campagnes/aan', { aan: false }, ass)).status === 403);
    const proefFout = await api('POST', '/api/campagnes/proefmail', { naar: 'geen-adres' }, admin);
    mails.length = 0;
    const proefOk = await api('POST', '/api/campagnes/proefmail', { naar: 'baas@campagne.test' }, admin);
    for (let i = 0; i < 30 && mails.length < 1; i++) await slaap(200);
    const proefMail = (mails[0] || '').replace(/=\r?\n/g, '').replace(/=3D/g, '=');
    ok('proefmail aan jezelf: opgemaakte mail met [PROEF], zonder klik- of afmeldlink van een klant; ongeldig adres → 400; assistente 403', proefFout.status === 400 && proefOk.status === 200 && mails.length === 1 && /\[PROEF\]/.test(proefMail) && /Content-Type: text\/html/i.test(proefMail) && !/\/k\/(?!proef)/.test(proefMail) && !/\/afmelden\//.test(proefMail) && (await api('POST', '/api/campagnes/proefmail', { naar: 'x@campagne.test' }, ass)).status === 403, JSON.stringify([proefFout.status, proefOk.status, mails.length]));
    const uit = await api('POST', '/api/campagnes/aan', { aan: false }, admin);
    const lijstUit = await api('GET', '/api/campagnes', null, ass);
    ok('UIT: het scherm en elke campagne-route weigeren (403), ook voor de beheerder', uit.status === 200 && uit.json.aan === false && lijstUit.status === 403 && lijstUit.json.uit === true && (await api('GET', '/api/campagnes', null, admin)).status === 403 && (await api('POST', '/api/campagnes', { naam: 'x' }, admin)).status === 403 && (await api('POST', `/api/campagnes/${cg.id}/start`, {}, admin)).status === 403);
    ok('UIT: het menu krijgt het te horen (meta.campagnes) en het punt op Start is weg', (await api('GET', '/api/me', null, ass)).json.meta.campagnes === false && !((await api('GET', '/api/overview', null, ass)).json.eerstDoen || []).some((p) => p.sleutel === 'campagne'));
    ok('UIT: afmelden en de klik-link van al verstuurde mails blijven werken', (await fetch(BASE + (mail.match(/\/afmelden\/[\w-]+\/[0-9a-f]{24}/) || ['/bestaat-niet'])[0])).status === 200 && (await fetch(BASE + klikPad, { headers: mens })).status === 200);
    ok('UIT: de proefmail en de stand blijven bereikbaar voor de beheerder (anders kan hij nooit aanzetten)', (await api('GET', '/api/campagnes/stand', null, admin)).json.aan === false && (await api('POST', '/api/campagnes/proefmail', { naar: 'baas@campagne.test' }, admin)).status === 200);
    const weerAan = await api('POST', '/api/campagnes/aan', { aan: true }, admin);
    ok('weer AAN: alles werkt weer en er is niets kwijt', weerAan.json.aan === true && (await api('GET', '/api/campagnes', null, ass)).json.campagnes.some((c) => c.id === co.id));
    const inst = (await api('POST', '/api/campagnes/instellingen', { whatsapp: '06 1234 5678' }, admin)).json;
    ok('instellingen: het WhatsApp-nummer voor de knop wordt bewaard, de andere grenzen blijven staan', inst.whatsapp === '06 1234 5678' && inst.rustDagen === 0 && inst.perDag === 500, JSON.stringify(inst));
  }
} finally {
  proc.kill('SIGTERM'); smtp.close();
}

console.log(`\n========== CAMPAGNE: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
