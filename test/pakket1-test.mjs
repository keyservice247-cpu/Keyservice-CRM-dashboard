// Test: PAKKET 1 na de audit van 20 nov 2026 (veiligheid, rechten, gegevens).
// Draait tegen een lokale testserver (PORT=3149) met een verse database:
//   DATA_DIR=<scratch> INGEST_TOKEN=test123 SESSION_SECRET=test PORT=3149 node server/index.js
// Bewaakt:
//   F3  datumvelden nemen alleen een datum aan (geen opmaakcode meer het bord op)
//   F4  een monteur kan de inbox niet uitlezen; tellers alleen over eigen werk
//   --  assistente ziet conversie, nooit omzet of winst (ook niet buiten Cijfers)
//   D5  twee klanten met dezelfde WhatsApp-tekst: de tweede verdwijnt niet
//   D9  postcodes als "4567 DE" worden herkend, "2025 al" niet
import { vindPostcode, isPostcodeLetters } from '../server/drs-rapport.js';
import { conversieZonderGeld } from '../server/conversie.js';
import { extractDetails } from '../server/ai/categorizer.js';

const BASE = 'http://localhost:3149';
const TOKEN = 'test123';
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

async function api(method, path, body, { cookie = '', token = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-ingest-token'] = TOKEN; if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const c = (r.headers.get('set-cookie') || '').split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json, cookie: c };
}
const login = async (email, password) => (await api('POST', '/api/login', { email, password })).cookie;
const lijst = (j) => (Array.isArray(j) ? j : (j?.orders || j?.items || []));
const bevat = (obj, re) => re.test(JSON.stringify(obj || {}));

const admin = await login('admin@keyservice.nl', 'admin123');
ok('ingelogd als beheerder', !!admin);

// ---------- opzet ----------
const sam = (await api('POST', '/api/monteurs', { name: 'Sam', phone: '0611000101', waGroup: 'Sam testgroep' }, { cookie: admin })).json;
await api('POST', '/api/users', { name: 'Noor Test', email: 'noor@pakket1.test', password: 'assist-12345', role: 'assistent' }, { cookie: admin });
await api('POST', '/api/users', { name: 'Sam Test', email: 'sam@pakket1.test', password: 'monteur-12345', role: 'monteur', monteurId: sam.id }, { cookie: admin });
const ass = await login('noor@pakket1.test', 'assist-12345');
const mon = await login('sam@pakket1.test', 'monteur-12345');
ok('assistente en monteur ingelogd', !!ass && !!mon);
const eigen = (await api('POST', '/api/orders', { customerName: 'Familie Proef', customerPhone: '0611000201', customerAddress: 'Proefweg 1, 1234 AB Testdorp', title: 'Testdorp — slot vervangen', monteurId: sam.id, price: '250' }, { cookie: admin })).json;
const ander = (await api('POST', '/api/orders', { customerName: 'Familie Ander', customerPhone: '0611000202', title: 'Proefwijk — andere klus', price: '400' }, { cookie: admin })).json;
await api('PATCH', `/api/orders/${eigen.id}`, { status: 'afgerond', notes: 'klaar' }, { cookie: admin });
await api('POST', '/api/finance', { kind: 'income', amount: 1234, category: 'Overig', date: new Date().toISOString().slice(0, 10) }, { cookie: admin });

// ---------- F3: datumvelden ----------
console.log('\n== F3 — datumvelden nemen alleen een datum aan ==');
const kwaad = '<img src=x onerror="window.__proef=true">';
ok('monteur: opmaakcode in het afspraakveld wordt geweigerd (400)', (await api('PATCH', `/api/orders/${eigen.id}`, { appointmentAt: kwaad }, { cookie: mon })).status === 400);
ok('kantoor: opmaakcode in het opvolgveld wordt geweigerd (400)', (await api('PATCH', `/api/orders/${ander.id}`, { snoozeAt: kwaad }, { cookie: ass })).status === 400);
ok('nieuwe opdracht met onzin als afspraak wordt geweigerd (400)', (await api('POST', '/api/orders', { customerName: 'X', title: 'x', appointmentAt: 'morgen ergens' }, { cookie: admin })).status === 400);
const goed = await api('PATCH', `/api/orders/${ander.id}`, { appointmentAt: '2026-12-01T14:00', appointmentEndAt: '2026-12-01T15:00' }, { cookie: admin });
ok('een gewone datum met tijd werkt als altijd, ongewijzigd opgeslagen', goed.status === 200 && (goed.json?.appointmentAt || goed.json?.order?.appointmentAt) === '2026-12-01T14:00', JSON.stringify(goed.json).slice(0, 120));
ok('alleen een datum (zonder tijd) mag ook', (await api('PATCH', `/api/orders/${ander.id}`, { snoozeAt: '2026-12-05' }, { cookie: admin })).status === 200);
ok('leegmaken van de afspraak mag', (await api('PATCH', `/api/orders/${ander.id}`, { appointmentAt: '', appointmentEndAt: '' }, { cookie: admin })).status === 200);

// ---------- F4: inbox en tellers ----------
console.log('\n== F4 — een monteur kan de inbox niet uitlezen ==');
await api('POST', '/api/ingest/email', { from: 'Jan Proef <jan@voorbeeld.test>', subject: 'Slot kapot', externalId: 'p1-m1', body: 'Mijn voordeurslot is kapot.\nAdres: Proeflaan 5, 3333 CC Proefstad\nTel: 0611000221' }, { token: true });
ok('monteur: GET /api/reviews → 403', (await api('GET', '/api/reviews?status=pending', null, { cookie: mon })).status === 403);
const rvA = await api('GET', '/api/reviews?status=pending', null, { cookie: ass });
ok('assistente ziet de inbox gewoon', rvA.status === 200 && (rvA.json.items || []).length >= 1);
const stM = (await api('GET', '/api/stats', null, { cookie: mon })).json;
const stA = (await api('GET', '/api/stats', null, { cookie: admin })).json;
ok('monteur: tellers alleen over eigen opdrachten, geen inbox-teller', stM.totalOrders === 1 && stM.pendingReviews === 0 && stM.customers === 0 && stM.leads === 0, JSON.stringify(stM).slice(0, 160));
ok('beheerder: tellers over het hele bedrijf', stA.totalOrders > 1 && stA.pendingReviews >= 1);

// ---------- conversie zonder geld ----------
console.log('\n== Assistente: wel conversie, geen omzet of winst ==');
const cvAdmin = await api('GET', '/api/conversie?dagen=30', null, { cookie: admin });
const cvAss = await api('GET', '/api/conversie?dagen=30', null, { cookie: ass });
ok('beheerder: conversie mét omzet', cvAdmin.status === 200 && typeof cvAdmin.json.totaal.omzet === 'number' && 'omzetAfgerond' in cvAdmin.json.waarde);
ok('assistente (standaardrechten): conversie mag (200)', cvAss.status === 200 && cvAss.json.zonderGeld === true);
ok('… met dezelfde aantallen en percentages', cvAss.json.totaal.binnen === cvAdmin.json.totaal.binnen && cvAss.json.totaal.conversie === cvAdmin.json.totaal.conversie && cvAss.json.perBron.length === cvAdmin.json.perBron.length);
ok('… maar zonder één geldveld', !bevat(cvAss.json, /"omzet|"perAfgerond|"perAanvraag/) && cvAss.json.briefing === null, JSON.stringify(cvAss.json.waarde));
ok('assistente: de pagina met omzet en kosten blijft dicht (403)', (await api('GET', `/api/finance?month=${new Date().toISOString().slice(0, 7)}`, null, { cookie: ass })).status === 403);
ok('monteur: geen conversie (403)', (await api('GET', '/api/conversie?dagen=30', null, { cookie: mon })).status === 403);
const wrAdmin = (await api('GET', '/api/report/week', null, { cookie: admin })).json;
const wrAss = (await api('GET', '/api/report/week', null, { cookie: ass })).json;
ok('weekrapport beheerder: met omzet', typeof wrAdmin.omzet === 'number' && wrAdmin.perMonteur.every((m) => 'omzet' in m));
ok('weekrapport assistente: zelfde aantallen, geen omzet', wrAss.zonderGeld === true && !('omzet' in wrAss) && wrAss.doneCount === wrAdmin.doneCount && wrAss.perMonteur.length === wrAdmin.perMonteur.length && wrAss.perMonteur.every((m) => !('omzet' in m)), JSON.stringify(wrAss).slice(0, 200));
const ovAdmin = (await api('GET', '/api/overview', null, { cookie: admin })).json;
const ovAss = (await api('GET', '/api/overview', null, { cookie: ass })).json;
ok('activiteit beheerder: boeking zichtbaar', bevat(ovAdmin.activity, /geboekt/));
ok('activiteit assistente: geen regels over boekingen', !bevat(ovAss.activity, /geboekt|1234/), JSON.stringify(ovAss.activity).slice(0, 200));
const doAss = await api('GET', '/api/day-overview', null, { cookie: ass });
const doAdmin = await api('GET', '/api/day-overview', null, { cookie: admin });
ok('dagoverzicht beheerder: weekcijfers aanwezig', doAdmin.status === 200 && !!doAdmin.json.facts?.week);
ok('dagoverzicht assistente: zonder weekcijfers', doAss.status === 200 && doAss.json.zonderGeld === true && !doAss.json.facts?.week && Array.isArray(doAss.json.facts?.appts ?? []));
// de beheerder kan haar het recht "cijfers" geven en het recht "conversie" afnemen
const users = (await api('GET', '/api/users', null, { cookie: admin })).json; const noor = (users.users || users).find((u) => u.email === 'noor@pakket1.test');
await api('PATCH', `/api/users/${noor.id}`, { perms: { conversie: false } }, { cookie: admin });
ok('recht "conversie" uit → 403', (await api('GET', '/api/conversie?dagen=30', null, { cookie: ass })).status === 403);
await api('PATCH', `/api/users/${noor.id}`, { perms: { finance: true } }, { cookie: admin });
const cvVol = await api('GET', '/api/conversie?dagen=30', null, { cookie: ass });
ok('recht "cijfers" aan → conversie mét omzet', cvVol.status === 200 && !cvVol.json.zonderGeld && typeof cvVol.json.totaal.omzet === 'number');
await api('PATCH', `/api/users/${noor.id}`, { perms: null }, { cookie: admin });
// pure functie
const z = conversieZonderGeld({ totaal: { binnen: 3, omzet: 900 }, perBron: [{ naam: 'Website', omzet: 5 }], waarde: { omzetAfgerond: 900, perAfgerond: 300, perAanvraag: 100, afgerondZonderFactuur: 2 }, patronen: ['Omzet per aanvraag daalt', 'DRS levert 40%'], briefing: { tekst: 'omzet € 900' } });
ok('conversieZonderGeld: geldvelden weg, rest blijft', z.totaal.binnen === 3 && !('omzet' in z.totaal) && !('omzet' in z.perBron[0]) && z.waarde.afgerondZonderFactuur === 2 && !('omzetAfgerond' in z.waarde) && z.briefing === null && z.patronen.length === 1);

// ---------- D5: zelfde tekst, andere afzender ----------
console.log('\n== D5 — twee klanten met dezelfde WhatsApp-tekst ==');
const tekst = 'Goedemiddag, ik heb een vraag over mijn slot. Kunt u mij terugbellen?';
const w1 = await api('POST', '/api/ingest/whatsapp', { name: 'Klant A', fromPhone: '0611000211', externalId: 'p1-w1', body: tekst }, { token: true });
const w2 = await api('POST', '/api/ingest/whatsapp', { name: 'Klant B', fromPhone: '0611000212', externalId: 'p1-w2', body: tekst }, { token: true });
const w3 = await api('POST', '/api/ingest/whatsapp', { name: 'Klant A', fromPhone: '0611000211', externalId: 'p1-w3', body: tekst }, { token: true });
ok('tweede klant met dezelfde tekst wordt NIET als dubbel weggegooid', w1.status === 200 && w2.status === 200 && !w2.json?.duplicate, JSON.stringify(w2.json).slice(0, 120));
ok('dezelfde klant die het nog eens stuurt is wél dubbel', w3.json?.duplicate === true);
const chats = (await api('GET', '/api/chats', null, { cookie: admin })).json; const cl = Array.isArray(chats) ? chats : (chats.chats || []);
ok('beide klanten hebben een eigen gesprek', bevat(cl, /0611000211/) && bevat(cl, /0611000212/));
const r1 = await api('POST', '/api/ingest/whatsapp', { name: 'Klant A', fromPhone: '0611000211', externalId: 'p1-r1', body: '👍 (reactie op een eerder bericht)' }, { token: true });
const r2 = await api('POST', '/api/ingest/whatsapp', { name: 'Klant B', fromPhone: '0611000212', externalId: 'p1-r2', body: '👍 (reactie op een eerder bericht)' }, { token: true });
const r3 = await api('POST', '/api/ingest/whatsapp', { name: 'Klant A', fromPhone: '0611000211', externalId: 'p1-r3', body: '👍 (reactie op een eerder bericht)' }, { token: true });
ok('een reactie (duimpje) is nooit dubbel, ook niet twee keer van dezelfde klant', !r1.json?.duplicate && !r2.json?.duplicate && !r3.json?.duplicate);
// groepsberichten: ongewijzigd — identieke doorgestuurde tekst blijft dubbel
await api('PATCH', '/api/settings', { whatsappOrderGroups: 'opdrachtgever testgroep' }, { cookie: admin });
const gt = 'Hallo. We sturen je de volgende klant:\nNaam: Peter Smits\nAdres: Eikenlaan 14\nWoonplaats: 1234 EF - Testdorp\nTelefoon: 0611000021\nOpmerkingen: voordeur klemt';
const g1 = await api('POST', '/api/ingest/whatsapp', { group: 'Opdrachtgever testgroep', name: 'Kim', externalId: 'p1-g1', body: gt }, { token: true });
const g2 = await api('POST', '/api/ingest/whatsapp', { group: 'Sam testgroep', name: 'Kantoor', externalId: 'p1-g2', body: gt }, { token: true });
ok('doorgestuurde groepsopdracht blijft dubbel (geen tweede aanvraag)', !g1.json?.duplicate && g2.json?.duplicate === true);

// ---------- D9: postcodes ----------
console.log('\n== D9 — postcodes met letters die ook een woord zijn ==');
ok('"4567 DE Groepstad" is een postcode', vindPostcode('Woonplaats: 4567 DE - Groepstad') === '4567DE');
ok('"4811 EN", "5611 AL", "3011 OP" worden herkend', vindPostcode('4811 EN Breda') === '4811EN' && vindPostcode('5611 AL Eindhoven') === '5611AL' && vindPostcode('3011OP Rotterdam') === '3011OP');
ok('"2025 al gebeld" en "2026 om 10 uur" blijven geen postcode', vindPostcode('in 2025 al gebeld') === '' && vindPostcode('afspraak 2026 om 10 uur') === '');
ok('"1200 KG", "3000 km" en SA/SD/SS nooit', vindPostcode('weegt 1200 KG') === '' && vindPostcode('3000 km rijden') === '' && !isPostcodeLetters('SS') && !isPostcodeLetters('sa'));
ok('gewone postcode ongewijzigd', vindPostcode('Teststraat 1, 1234 ab Testdorp') === '1234AB' && vindPostcode('1234AB') === '1234AB');
const gd = await api('POST', '/api/ingest/whatsapp', { group: 'Opdrachtgever testgroep', name: 'Kim', externalId: 'p1-g3', body: 'Hallo. We sturen je de volgende klant:\nNaam: Karel Groep\nAdres: Groepsweg 8\nWoonplaats: 4567 DE - Groepstad\nTelefoon: 0611000031\nOpmerkingen: cilinder vervangen' }, { token: true });
ok('complete groepsopdracht met postcode "4567 DE" komt als aanvraag binnen', gd.status === 200 && ['pending', 'auto_approved', 'approved'].includes(gd.json?.status), JSON.stringify(gd.json));

// ---------- D4: naam en adres uitlezen ----------
console.log('\n== D4 — naam en adres uit een bericht ==');
const dx = extractDetails('Hallo. We sturen je de volgende klant:\nNaam: Dhr. Smits\nAdres: Eikenlaan 14\nWoonplaats: 1234 EF - Testdorp\nTelefoon: 0611000021\nOpmerkingen: voordeur klemt');
ok('"Naam: Dhr. Smits" blijft "Dhr. Smits" (was "Dhr")', dx.customerName === 'Dhr. Smits' && dx.naamBron === 'label', dx.customerName);
ok('Adres + Woonplaats worden één adres met postcode en plaats', dx.customerAddress === 'Eikenlaan 14, 1234 EF Testdorp' && dx.adresBron === 'label', dx.customerAddress);
const dy = extractDetails('Naam: Mevr. A. de Boer\nAdres: Kerkstraat 12, 5056 AC Berkel-Enschot\nTelefoon: 0611000022');
ok('titel + voorletter blijven heel; compleet adres ongewijzigd', dy.customerName === 'Mevr. A. de Boer' && dy.customerAddress === 'Kerkstraat 12, 5056 AC Berkel-Enschot');
ok('"naam is Jan. Tel 06…" stopt bij de zinspunt', extractDetails('naam is Jan. Tel 0611000023').customerName === 'Jan');
const dz = extractDetails('Goedemiddag,\n\nOnze schuifpui klemt. Kunt u langskomen?');
ok('een begroeting wordt nooit een klantnaam', dz.customerName === null && dz.naamBron === '');
const rvn = await api('GET', '/api/reviews?status=pending&limit=50', null, { cookie: admin });
ok('inbox: de groepsopdracht staat er met de volledige naam', (rvn.json.items || []).some((r) => r.suggestion?.customerName === 'Karel Groep'), (rvn.json.items || []).map((r) => r.suggestion?.customerName).join(' | '));

// ---------- E1: openbaar statusadres ----------
console.log('\n== E1 — statusadres voor bewaking van buiten ==');
const st = await fetch(BASE + '/status'); const stj = await st.json();
ok('GET /status werkt zonder inlog (200) en zegt "goed"', st.status === 200 && stj.status === 'goed', JSON.stringify(stj).slice(0, 200));
ok('alleen ja/nee en leeftijden — geen namen, nummers of tekst', Object.keys(stj).sort().join(',') === 'brugMinutenStil,gestartMinutenGeleden,laatsteControleMinutenGeleden,omgeving,onderdelen,status' && !/0611|Proef|@/.test(JSON.stringify(stj)) && Object.values(stj.onderdelen).every((v) => v === null || typeof v === 'boolean'));
ok('wordt niet bewaard door de browser of een tussenstation', st.headers.get('cache-control') === 'no-store');

// ---------- D1: tussenpersoon ----------
console.log('\n== D1 — een tussenpersoon wordt nooit de klant ==');
{
  const BEHEER = 'beheer@vastgoed-voorbeeld.test';
  const stuur = async (id, van, naam, tel, adres, onderwerp = 'Slot kapot bij huurder') => (await api('POST', '/api/ingest/email', { from: van, subject: onderwerp, externalId: id, body: `Graag een monteur sturen.\nNaam: ${naam}\nTelefoon: ${tel}\nAdres: ${adres}\nProbleem: slot van de voordeur is kapot` }, { token: true })).json;
  const keur = async (reviewId, extra = {}) => (await api('POST', `/api/reviews/${reviewId}/approve`, extra, { cookie: admin })).json?.order;
  const klant = async (id) => (await api('GET', '/api/customers', null, { cookie: admin })).json.find((c) => c.id === id);
  // Twee verschillende huurders, doorgestuurd vanaf hetzelfde adres van de beheerder.
  const r1 = await stuur('d1-a', `Beheer Voorbeeld <${BEHEER}>`, 'Huurder Een', '0611000301', 'Eerstelaan 1, 3333 AA Proefstad');
  const o1 = await keur(r1.reviewId, { customerName: 'Huurder Een', customerPhone: '0611000301', customerEmail: BEHEER, customerAddress: 'Eerstelaan 1, 3333 AA Proefstad' });
  const r2 = await stuur('d1-b', `Beheer Voorbeeld <${BEHEER}>`, 'Bewoner Twee', '0611000302', 'Tweedestraat 2, 3333 BB Proefstad');
  const o2 = await keur(r2.reviewId, { customerName: 'Bewoner Twee', customerPhone: '0611000302', customerEmail: BEHEER, customerAddress: 'Tweedestraat 2, 3333 BB Proefstad' });
  ok('twee huurders via hetzelfde afzenderadres worden TWEE klanten (was: één)', !!o1 && !!o2 && o1.customerId !== o2.customerId, JSON.stringify([o1?.customerId, o2?.customerId]));
  const k1 = await klant(o1.customerId); const k2 = await klant(o2.customerId);
  ok('huurder 1 houdt zijn eigen naam, nummer en adres', k1.name === 'Huurder Een' && k1.phone === '0611000301' && /Eerstelaan/.test(k1.address));
  ok('huurder 2 krijgt het gedeelde adres NIET als klantgegeven', k2.name === 'Bewoner Twee' && k2.phone === '0611000302' && !k2.email, JSON.stringify(k2.email));
  ok('de opdracht van huurder 2 legt uit waarom, en houdt het adres voor déze aanvraag', o2.tussenpersoonHint?.reden === 'gedeeld' && o2.tussenpersoonHint.email === BEHEER && o2.tussenpersoonHint.andereNaam === 'Huurder Een' && o2.intake?.email === BEHEER && !o1.tussenpersoonHint, JSON.stringify(o2.tussenpersoonHint));
  ok('geen stille wijziging: op opdracht 2 staat geen suggestie om huurder 1 te overschrijven', !(o2.dataSuggestions || []).length);
  // Wat NIET verandert: dezelfde persoon blijft dezelfde klant.
  const r3 = await stuur('d1-c', 'Karin Zelf <karin.zelf@voorbeeld.test>', 'Karin Zelf', '0611000303', 'Derdeweg 3, 3333 CC Proefstad', 'Cilinder vervangen');
  const o3 = await keur(r3.reviewId, { customerName: 'Karin Zelf', customerPhone: '0611000303', customerEmail: 'karin.zelf@voorbeeld.test' });
  const r4 = await stuur('d1-d', 'Karin Zelf <karin.zelf@voorbeeld.test>', 'K. Zelf', '0611000399', 'Derdeweg 3, 3333 CC Proefstad', 'Nog een slot');
  const o4 = await keur(r4.reviewId, { customerName: 'K. Zelf', customerPhone: '0611000399', customerEmail: 'karin.zelf@voorbeeld.test' });
  ok('zelfde e-mail, zelfde achternaam, nieuw nummer = dezelfde klant (met een suggestie voor het nummer)', o3.customerId === o4.customerId && !o4.tussenpersoonHint && (o4.dataSuggestions || []).some((x) => x.field === 'telefoon'), JSON.stringify([o3.customerId === o4.customerId, o4.dataSuggestions]));
  // Kantoor zet het adres op de lijst: daarna is het nooit meer een klantsleutel.
  ok('monteur mag de melding niet afhandelen (403)', (await api('POST', `/api/orders/${o2.id}/tussenpersoon`, { actie: 'toevoegen' }, { cookie: mon })).status === 403);
  const toe = await api('POST', `/api/orders/${o2.id}/tussenpersoon`, { actie: 'toevoegen' }, { cookie: ass });
  ok('assistente: "altijd zo behandelen" zet het adres op de lijst en haalt de melding weg', toe.status === 200 && toe.json.tussenpersonen.includes(BEHEER) && !(await api('GET', `/api/orders/${o2.id}`, null, { cookie: admin })).json.tussenpersoonHint, JSON.stringify(toe.json));
  const r5 = await stuur('d1-e', `Beheer Voorbeeld <${BEHEER}>`, 'Huurder Een', '0611000301', 'Eerstelaan 1, 3333 AA Proefstad', 'Nog een klus voor huurder 1');
  const o5 = await keur(r5.reviewId, { customerName: 'Huurder Een', customerPhone: '0611000301', customerEmail: BEHEER });
  // (Binnen het zelfde-moment-venster hangt deze aanvraag aan zijn lopende opdracht — Regel 1.)
  ok('volgende klus voor huurder 1 via de beheerder: gevonden op zijn NUMMER, niet op het adres van de beheerder', o5.customerId === o1.customerId && o5.customerId !== o2.customerId && (await klant(o1.customerId)).name === 'Huurder Een', JSON.stringify([o5.customerId === o1.customerId, o5.id === o1.id]));
  const r6 = await stuur('d1-f', `Beheer Voorbeeld <${BEHEER}>`, 'Nieuwe Derde', '0611000306', 'Vierdeplein 4, 3333 DD Proefstad');
  const o6 = await keur(r6.reviewId, { customerName: 'Nieuwe Derde', customerPhone: '0611000306', customerEmail: BEHEER });
  const k6 = await klant(o6.customerId);
  ok('nieuwe huurder via de beheerder: eigen klant, zonder het adres van de beheerder', ![o1.customerId, o2.customerId].includes(o6.customerId) && !k6.email && o6.intake?.email === BEHEER, JSON.stringify(k6));
  // De lijst in Instellingen.
  const fout = await api('PATCH', '/api/settings', { tussenpersonen: ['gmail.com'] }, { cookie: admin });
  ok('een domein als gmail.com wordt geweigerd (anders herkent het CRM niemand meer op e-mail)', fout.status === 400 && /gmail\.com/.test(fout.json?.error || ''), JSON.stringify(fout.json));
  const goed = await api('PATCH', '/api/settings', { tussenpersonen: [BEHEER, 'vve-voorbeeld.test', 'iemand@gmail.com'] }, { cookie: admin });
  const inst = (await api('GET', '/api/settings', null, { cookie: admin })).json;
  ok('adres, eigen domein en een los gmail-adres mogen wél', goed.status === 200 && (inst.tussenpersonen || []).join() === `${BEHEER},vve-voorbeeld.test,iemand@gmail.com`, JSON.stringify(inst.tussenpersonen));
  const r7 = await stuur('d1-g', 'Secretaris <secretaris@vve-voorbeeld.test>', 'Bewoner Vijf', '0611000307', 'Vijfdehof 5, 3333 EE Proefstad');
  const o7 = await keur(r7.reviewId, { customerName: 'Bewoner Vijf', customerPhone: '0611000307', customerEmail: 'secretaris@vve-voorbeeld.test' });
  ok('een heel domein op de lijst werkt voor elk adres van dat domein', o7.tussenpersoonHint?.reden === 'lijst' && !(await klant(o7.customerId)).email);
}

console.log(`\n========== PAKKET 1: ${passed} geslaagd, ${failed} gefaald ==========`);
if (failed) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
