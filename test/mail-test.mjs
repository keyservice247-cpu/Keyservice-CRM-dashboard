// Test: bounce-detectie ("mail niet afgeleverd") — zonder server en zonder echte
// mailbox. Bewaakt precies de gevaarlijke kant: een ECHTE klantmail mag nooit als
// bounce worden weggegooid (lead-instroom-wetten), en een echte DSN moet netjes
// aan de juiste kaart worden teruggekoppeld.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'crm-mailtest-'));
const { looksLikeBounce, handleBounce } = await import('../server/connectors/email-imap.js');
const { db } = await import('../server/db.js');

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

const DSN_BODY = `This is the mail system at host mail.transip.email.
I'm sorry to have to inform you that your message could not be delivered.
Final-Recipient: rfc822; klant@example.nl
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 Recipient address rejected: User unknown in virtual mailbox table
--- Original message headers ---
Message-ID: <ks-uit-123@keyservice247.nl>
`;

console.log('\n== looksLikeBounce: echte DSN wél, klantmail nooit ==');
ok('echte DSN (mailer-daemon + delivery-status) -> bounce', looksLikeBounce(
  { from: { text: 'Mail Delivery System <MAILER-DAEMON@transip.email>' }, subject: 'Undelivered Mail Returned to Sender', headerLines: [] }, DSN_BODY) === true);
ok('klantmail met "niet bezorgd" in onderwerp -> GEEN bounce (lead blijft leven)', looksLikeBounce(
  { from: { text: 'Piet Klant <piet@example.nl>' }, subject: 'Mijn vorige mail werd niet bezorgd - graag reactie', headerLines: [] },
  'Hallo, mijn slot is kapot. Kunnen jullie komen? 06-12345678.') === false);
ok('Fwd: Undeliverable van een klant -> GEEN bounce', looksLikeBounce(
  { from: { text: 'Piet Klant <piet@example.nl>' }, subject: 'Fwd: Undeliverable: mijn aanvraag', headerLines: [] },
  'zie onder, mijn voordeur klemt, tel 0612345678') === false);
ok('vertragings-DSN (action: delayed) -> GEEN bounce (geen vals alarm)', looksLikeBounce(
  { from: { text: 'MAILER-DAEMON@transip.email' }, subject: 'Delivery Status Notification (Delay)', headerLines: [] },
  'This is a warning only.\nFinal-Recipient: rfc822; klant@example.nl\nAction: delayed\nWill keep trying.') === false);

console.log('\n== handleBounce: terugkoppeling op de juiste kaart ==');
const d = db();
d.orders = d.orders || []; d.customers = d.customers || []; d.messages = d.messages || [];
d.customers.push({ id: 'cust_bt', name: 'Bounce Klant', email: 'klant@example.nl' });
const entry = { id: 'thr_bt', channel: 'email', outgoing: true, sender: 'Admin (Keyservice)', body: 'Beste klant, hierbij de offerte.', at: new Date().toISOString(), messageId: '<ks-uit-123@keyservice247.nl>', sentTo: 'klant@example.nl' };
d.orders.push({ id: 'ord_bt', title: 'Slot vervangen Rhenen', customerId: 'cust_bt', status: 'open', thread: [entry], updatedAt: new Date().toISOString() });
handleBounce({ from: { text: 'MAILER-DAEMON@transip.email' }, subject: 'Undelivered Mail Returned to Sender' }, DSN_BODY, '<bounce-1@transip>');
const ordBt = d.orders.find((o) => o.id === 'ord_bt');
ok('uitgaande mail gemarkeerd als NIET afgeleverd', entry.delivered === false && /550/.test(entry.bounce || ''), JSON.stringify(entry.bounce));
ok('waarschuwing in de gesprekshistorie van de kaart', (ordBt.thread || []).some((t) => /NIET AANGEKOMEN/.test(t.body || '')));
ok('reden = volledige Diagnostic-Code (niet het korte fragment)', /User unknown/.test((ordBt.thread.find((t) => /NIET AANGEKOMEN/.test(t.body || '')) || {}).body || ''));
ok('bounce geregistreerd als verwerkt bericht (nooit een lead)', d.messages.some((m) => m.externalId === '<bounce-1@transip>' && m.bounce === true));

console.log('\n== AI-antwoord dat halverwege afbreekt wordt gered (dagoverzicht) ==');
// Het dagoverzicht faalde omdat de AI-JSON werd afgekapt (te lage antwoordlimiet)
// en er geen werkende reparatie was. Deze test bewaakt beide kanten.
const { repairTruncatedJson } = await import('../server/ai/categorizer.js');
const afgekaptGevallen = [
  ['midden in een zin', '{"kop":"Drukke dag","acties":[{"prio":"hoog","titel":"Bel Corrie","waarom":"wacht al'],
  ['na een compleet item', '{"kop":"Test","acties":[{"prio":"hoog","titel":"A","waarom":"B","waar":"inbox"},{"prio":"laag"'],
  ['na een komma in een lijst', '{"kop":"X","kansen":["een","twee",'],
  ['diep genest', '{"kop":"Y","beantwoorden":[{"wie":"Jan","kanaal":"email","waarover":"offerte","urgent":true},{"wie":"Piet","kanaal":'],
];
let gered = 0;
for (const [naam, json] of afgekaptGevallen) { if (repairTruncatedJson(json)) gered++; else console.log('    (niet gered:', naam + ')'); }
ok('alle 4 afgekapte AI-antwoorden gerepareerd', gered === 4, `${gered}/4`);
const heel = repairTruncatedJson('{"kop":"Alles goed","acties":[],"kansen":["a"],"risicos":[]}');
ok('een compleet antwoord blijft ongewijzigd', heel && heel.kop === 'Alles goed' && heel.kansen.length === 1);
ok('onzin-invoer geeft netjes null (nooit een crash)', repairTruncatedJson('geen json hier') === null && repairTruncatedJson('') === null);

console.log('\n== FormSubmit-parser: kopcellen en veldnamen lekken nooit in de waarden ==');
const { parseFormSubmit } = await import('../server/connectors/email-imap.js');
const pfsAll = parseFormSubmit('Naam Value\nNaam Johan Goslinga\nTelefoon 0646471096\nType_schuifpui Houten\nWoonplaats Garmerwolde\nBericht schuifpui loopt zwaar en gaat slecht op slot', 'Offerte-aanvraag schuifpui (schuifpuiservice.com)');
const pfs = pfsAll.split('— Originele')[0]; // de geparste velden (de originele mail blijft bewust als bijlage-staart bewaard)
ok('kopcel "Value" nooit onderdeel van de klantnaam', /Naam: Johan Goslinga\b/.test(pfs) && !/Value/i.test(pfs), pfs.slice(0, 120));
ok('Type_schuifpui is een eigen veld (lekt niet in woonplaats)', !/Garmerwolde\s+Type/i.test(pfs));

console.log('\n== HTML-handtekening (huisstijl-mail) ==');
const { wrapHtmlMail } = await import('../server/connectors/email-smtp.js');
const html = wrapHtmlMail('Beste klant,\n\nTot morgen!\n');
ok('HTML-mail bevat naam + contactgegevens uit de handtekening', !!html && /Abdel Rafour/.test(html) && /085 060 2359/.test(html) && /keyservice247\.nl/.test(html));
ok('tekst netjes omgezet naar paragrafen + logo-verwijzing', /<p style/.test(html) && /Tot morgen!/.test(html) && /cid:kslogo/.test(html));

console.log('\n== Afspraak-berichten: {dag} klopt op elke dag (Scheepers-casus) ==');
// De herinnering zei "morgen" terwijl de afspraak diezelfde avond was (28 jul,
// 17:56 -> afspraak 19:00). {dag} rekent tegen de NEDERLANDSE datum van nu.
const { apptVars } = await import('../server/automations.js');
const { getAppointmentMsg } = await import('../server/settings.js');
const nlVandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
const plusDagen = (n) => { const [y, mo, da] = nlVandaag.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, da + n)).toISOString().slice(0, 10); };
const dagVan = (iso) => apptVars({ appointmentAt: `${iso}T19:00` }, { name: 'Scheepers' }).dag;
ok('afspraak vanavond -> "vandaag" (nooit meer "morgen")', dagVan(plusDagen(0)) === 'vandaag', dagVan(plusDagen(0)));
ok('afspraak volgende dag -> "morgen"', dagVan(plusDagen(1)) === 'morgen', dagVan(plusDagen(1)));
ok('afspraak over 2 dagen -> "overmorgen"', dagVan(plusDagen(2)) === 'overmorgen', dagVan(plusDagen(2)));
ok('verder weg -> gewoon de dagnaam', /^(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)$/.test(dagVan(plusDagen(5))), dagVan(plusDagen(5)));
ok('standaard herinnering-sjabloon gebruikt {dag}', getAppointmentMsg().reminderBody.includes('{dag}'));

console.log('\n== Website-dedup: FormSubmit-kopie die ÚREN later binnenkomt (Misa-casus) ==');
// Bewezen geval (27/28 jul): directe site-lead 23:20, FormSubmit-mailkopie 02:21
// = 3u01m later — één minuut buiten het oude 3-uursvenster, dus stond dezelfde
// aanvraag alsnog los in de inbox. Het venster is nu 72 uur, met als vangrail dat
// buiten de eerste 3 uur ook de KLANTTEKST moet overeenkomen (zodat een échte
// nieuwe aanvraag van dezelfde klant nooit wordt opgeslokt).
const { ingestMessage } = await import('../server/pipeline.js');
const klantTekst = 'Mijn hefschuifpui loopt heel zwaar en klemt bij het sluiten';
const r1 = await ingestMessage({
  channel: 'email', sender: 'Misa Test <misa.dedup@example.com>',
  subject: 'Contactaanvraag via keyservice247.nl',
  body: `Nieuwe aanvraag via de website keyservice247.nl (contact).\n\nNaam: Misa Test\nTelefoon: 0612399887\nE-mail: misa.dedup@example.com\n\n${klantTekst}`,
  forceRelevant: true, externalId: 'site-dedup-1',
});
ok('eerste site-lead komt gewoon binnen (geen duplicaat)', !!r1.message && !r1.duplicate);
// Simuleer de late bezorging: de eerste lead is 4 uur oud (buiten het oude venster).
r1.message.receivedAt = new Date(Date.now() - 4 * 3600000).toISOString();
const r2 = await ingestMessage({
  channel: 'email', sender: 'FormSubmit <noreply@formsubmit.co>',
  subject: 'Contactaanvraag via keyservice247.nl',
  body: `Nieuwe aanvraag via de website keyservice247.nl (FormSubmit-mail).\nNaam: Misa Test\nTelefoon: 0612399887\nE-mail: misa.dedup@example.com\n\n${klantTekst}\n\n— Originele mail —\nNaam Misa Test\nTelefoon 0612399887\nBericht ${klantTekst}`,
  externalId: 'fs-dedup-1',
});
ok('FormSubmit-kopie 4 uur later = duplicaat (hangt aan de eerste lead)', r2.duplicate === true && r2.message && r2.message.id === r1.message.id, JSON.stringify({ dup: r2.duplicate, zelfde: r2.message?.id === r1.message?.id }));
const r3 = await ingestMessage({
  channel: 'email', sender: 'Misa Test <misa.dedup@example.com>',
  subject: 'Contactaanvraag via keyservice247.nl',
  body: 'Nieuwe aanvraag via de website keyservice247.nl (contact).\n\nNaam: Misa Test\nTelefoon: 0612399887\nE-mail: misa.dedup@example.com\n\nNu is ook de cilinder van mijn achterdeur kapot gegaan vandaag',
  forceRelevant: true, externalId: 'site-dedup-2',
});
ok('échte NIEUWE aanvraag zelfde klant (andere tekst, >3u later) = géén duplicaat', !r3.duplicate && r3.message && r3.message.id !== r1.message.id);

// ---------- Voetregel onder automatische klantmails (10 sep 2026) ----------
console.log('\n== Disclaimer onder automatische mails ==');
const { metDisclaimer } = await import('../server/connectors/email-smtp.js');
const { getAutoReply, getEmailSignature } = await import('../server/settings.js');
const { klantInBehandeling } = await import('../server/autoreply.js');
const std = getAutoReply().disclaimer;
ok('standaard-voetregel zegt dat het automatisch gegenereerd is', /automatisch gegenereerd/i.test(std) && /in behandeling/i.test(std), std);
const sig = String(getEmailSignature() || '').trim();
ok('er is een platte handtekening om tegen te testen', sig.length > 0);
const brief = `Beste klant,\n\nBedankt voor uw aanvraag.\n\n${sig}`;
const met = metDisclaimer(brief);
ok('voetregel staat VÓÓR de handtekening (niet erachter)', met.indexOf(std) > met.indexOf('Bedankt') && met.indexOf(std) < met.lastIndexOf(sig) && met.trim().endsWith(sig), met);
ok('nogmaals toepassen plakt hem niet dubbel', metDisclaimer(met).split(std).length === 2);
ok('zonder handtekening: voetregel achteraan', metDisclaimer('Beste klant,\n\nTekst.').endsWith(std));
ok('lege voetregel = tekst ongewijzigd', metDisclaimer(brief, '') === brief);
const htmlD = wrapHtmlMail(met);
ok('HTML-versie: voetregel klein en grijs, handtekening één keer', !!htmlD && htmlD.includes('font-size:12.5px') && htmlD.includes('Dit is een automatisch gegenereerd bericht') && (htmlD.match(/Dit is een automatisch/g) || []).length === 1, htmlD ? htmlD.slice(0, 200) : 'geen html');
ok('HTML-versie: gewone alinea NIET grijs', !!htmlD && htmlD.includes('<p style="margin:0 0 14px">Bedankt voor uw aanvraag.</p>'));
// Klant al in behandeling → ontvangstbevestiging overslaan.
db().customers.push({ id: 'cust_discl', name: 'Lopende Klant', email: 'lopend@example.com' });
ok('klant zonder kaarten: niet in behandeling', klantInBehandeling('cust_discl') === false);
db().orders.push({ id: 'ord_discl_1', customerId: 'cust_discl', status: 'in_behandeling', title: 'Rhenen — test', createdAt: new Date().toISOString() });
ok('klant met lopende kaart: in behandeling', klantInBehandeling('cust_discl') === true);
db().orders.find((o) => o.id === 'ord_discl_1').status = 'afgerond';
ok('kaart afgerond → niet meer in behandeling', klantInBehandeling('cust_discl') === false);
db().orders.push({ id: 'ord_discl_2', customerId: 'cust_discl', status: 'nieuw', archivedWeek: '2026-W30', createdAt: new Date().toISOString() });
ok('ingeklapte (archief) kaart telt niet', klantInBehandeling('cust_discl') === false);

console.log('\n== Typefouten in e-mailadressen vóór het versturen (20 sep 2026, casus gmail.c) ==');
const { emailAdresProbleem } = await import('../server/connectors/email-smtp.js');
ok('gmail.c wordt herkend als typefout', /typefout/.test(emailAdresProbleem('hf.engelsman@gmail.c')));
ok('hotmail.con wordt herkend als typefout', /typefout/.test(emailAdresProbleem('jan@hotmail.con')));
ok('gewoon adres is in orde', emailAdresProbleem('jan@gmail.com') === '' && emailAdresProbleem('info@keyservice247.nl') === '');
ok('adres zonder @ is ongeldig', /geen geldig/.test(emailAdresProbleem('jan.gmail.com')));
ok('onbekend domein met .co (bv. .co.uk-achtig) wordt niet ten onrechte afgekeurd', emailAdresProbleem('jan@bedrijf.co.uk') === '');

const { afzenderProfiel } = await import('../server/settings.js');
console.log('\n== Persoonlijke handtekening (23 sep 2026) ==');
{
  const ass = afzenderProfiel({ name: 'Sara Jansen', role: 'assistent' });
  ok('assistente zonder functie → standaard "Assistente | Key Service 24/7"', ass && ass.name === 'Sara Jansen' && ass.role === 'Assistente | Key Service 24/7', JSON.stringify(ass));
  const mont = afzenderProfiel({ name: 'Youssef', role: 'monteur', functie: 'Slotenmaker | Key Service 24/7' });
  ok('monteur met functie → eigen functie', mont && mont.role === 'Slotenmaker | Key Service 24/7');
  ok('beheerder "Beheerder" zonder functie → null (vaste handtekening)', afzenderProfiel({ name: 'Beheerder', role: 'admin' }) === null);
  ok('beheerder met functie → wél eigen naam', afzenderProfiel({ name: 'Abdel Rafour', role: 'admin', functie: 'Eigenaar | Key Service 24/7' })?.name === 'Abdel Rafour');
  ok('sigUit → null', afzenderProfiel({ name: 'Sara', role: 'assistent', sigUit: true }) === null);
  ok('sigNaam wint van accountnaam', afzenderProfiel({ name: 'sara.j', role: 'assistent', sigNaam: 'Sara Jansen' })?.name === 'Sara Jansen');
  const plat = getEmailSignature(ass);
  ok('platte handtekening: groet, naam, functie, bedrijfstelefoon, e-mail — in die volgorde', plat.startsWith('Met vriendelijke groet,\nSara Jansen\nAssistente | Key Service 24/7\n') && /085 060 2359/.test(plat) && /info@keyservice247\.nl/.test(plat), JSON.stringify(plat));
  const eigenTel = getEmailSignature({ ...ass, phone: '06 1111 2222' });
  ok('eigen telefoon vervangt het bedrijfsnummer', /06 1111 2222/.test(eigenTel) && !/085 060 2359/.test(eigenTel));
  const html = wrapHtmlMail(`Beste klant,\n\nWe komen morgen.\n\n${plat}`, ass);
  ok('HTML-mail: naam van de assistente in de nette handtekening', !!html && /Sara Jansen/.test(html) && /Assistente \|/.test(html));
  ok('HTML-mail: platte handtekening niet dubbel (geen "Met vriendelijke groet" in de tekst)', !!html && !/Met vriendelijke groet/.test(html));
  const md = metDisclaimer(`Hallo\n\n${plat}`, 'DIT IS AUTOMATISCH', ass);
  ok('voetregel komt VÓÓR de persoonlijke handtekening', md.indexOf('DIT IS AUTOMATISCH') < md.indexOf('Met vriendelijke groet'), JSON.stringify(md));
}

console.log('\n== Back-up-mail 2x per maand (25 sep 2026) ==');
{
  const { backupPeriode, backupMailVerschuldigd } = await import('../server/backup-mail.js');
  const { getBackupMail } = await import('../server/settings.js');
  ok('standaard frequentie = 2x per maand', getBackupMail().frequentie === 'halfmaand', getBackupMail().frequentie);
  // Tijden in UTC; NL = UTC+2 in september, UTC+1 in januari.
  ok('periode 1e t/m 14e = "a", 15e en later = "b"', backupPeriode(new Date('2026-09-03T10:00:00Z')) === '2026-09-a' && backupPeriode(new Date('2026-09-15T10:00:00Z')) === '2026-09-b' && backupPeriode(new Date('2026-09-30T10:00:00Z')) === '2026-09-b');
  ok('periode volgt NL-tijd (31 aug 23:30 UTC = 1 sep NL)', backupPeriode(new Date('2026-08-31T23:30:00Z')) === '2026-09-a');
  const cfg = { enabled: true, hour: 6, frequentie: 'halfmaand' };
  const dag = (iso, laatste) => backupMailVerschuldigd({ datum: new Date(iso), cfg, laatstePeriode: laatste });
  ok('1e van de maand na 06:00 NL → mail', dag('2026-10-01T05:00:00Z', '2026-09-b') === true);
  ok('1e van de maand vóór 06:00 NL → nog niet', dag('2026-10-01T03:00:00Z', '2026-09-b') === false);
  ok('2e t/m 14e (al verstuurd deze periode) → géén mail', ['2026-10-02', '2026-10-07', '2026-10-14'].every((d) => dag(`${d}T10:00:00Z`, '2026-10-a') === false));
  ok('15e → weer een mail', dag('2026-10-15T10:00:00Z', '2026-10-a') === true);
  ok('server lag plat op de 15e → 16e alsnog', dag('2026-10-16T10:00:00Z', '2026-10-a') === true);
  // Een hele maand doorlopen: precies 2 mails.
  let laatste = '2026-09-b'; let n = 0;
  for (let d = 1; d <= 31; d++) for (const uur of [4, 8, 12, 20]) {
    const iso = `2026-10-${String(d).padStart(2, '0')}T${String(uur).padStart(2, '0')}:00:00Z`;
    if (backupMailVerschuldigd({ datum: new Date(iso), cfg, laatstePeriode: laatste })) { n++; laatste = backupPeriode(new Date(iso), 'halfmaand'); }
  }
  ok('oktober doorgerekend (4 checks per dag): precies 2 back-up-mails', n === 2, String(n));
  let nDag = 0; let lD = '';
  for (let d = 1; d <= 7; d++) { const iso = `2026-10-0${d}T10:00:00Z`; if (backupMailVerschuldigd({ datum: new Date(iso), cfg: { ...cfg, frequentie: 'dag' }, laatstePeriode: lD })) { nDag++; lD = backupPeriode(new Date(iso), 'dag'); } }
  ok('frequentie "dag" blijft mogelijk: 7 mails in 7 dagen', nDag === 7, String(nDag));
  ok('uit = nooit', backupMailVerschuldigd({ datum: new Date('2026-10-01T10:00:00Z'), cfg: { ...cfg, enabled: false }, laatstePeriode: '' }) === false);
}

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
