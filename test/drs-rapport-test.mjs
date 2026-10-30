// Test: DRS-RAPPORT (16 okt 2026, casus 4879 NB Etten-Leur / North Ridge BV twee keer als
// afgerond gemeld → twee keer betalen). Bewaakt:
//  - alleen DRS-opdrachten, alleen wat nog NIET gemeld is, klantnaam bij de postcode;
//  - nooit twee keer als afgerond afvinken (409), alleen bewust met force;
//  - ons rapport uit de DRS-groep vinkt automatisch af en geeft een DUBBEL-alarm;
//  - tweede kaart op hetzelfde adres = "mogelijk dubbel"; onbekende postcode zichtbaar;
//  - vinkje op de opdracht, ongedaan maken, samenvoegen neemt het vinkje mee;
//  - eenmalige start (oude rapporten inlezen) en de avondherinnering (zonder server).
//
// Draaien: DATA_DIR=<vers> INGEST_TOKEN=test123 SESSION_SECRET=test PORT=3145 node server/index.js &
//          node test/drs-rapport-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'http://localhost:3145';
const TOKEN = 'test123';
const RAF_ID = '120363177872957422';
let cookie = '';
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}
async function api(method, p, body, useToken = false) {
  const headers = { 'content-type': 'application/json' };
  if (useToken) headers['x-ingest-token'] = TOKEN;
  if (cookie && !useToken) headers.cookie = cookie;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie');
  if (setC && !useToken) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}
const login = async (email, password) => { cookie = ''; return api('POST', '/api/login', { email, password }); };
const nlDag = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
const DAG = 86400000;
const dmVan = (dag) => `${dag.slice(8, 10)}-${dag.slice(5, 7)}`;
const DAGNAAM = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
const kopVan = (dag) => `${DAGNAAM[new Date(`${dag}T12:00:00Z`).getUTCDay()]} ${dmVan(dag)}`;
const vandaag = nlDag(Date.now());
const eergisteren = nlDag(Date.now() - 2 * DAG);
const gisteren = nlDag(Date.now() - DAG);
const drieDagen = nlDag(Date.now() - 3 * DAG);

console.log('\n== Setup ==');
ok('admin inloggen', (await login('admin@keyservice.nl', 'admin123')).status === 200);
const adminCookie = cookie;
await api('PATCH', '/api/settings', { whatsappOrderGroups: 'raf breda', autoMergeWindowHours: 0 });
// Een verse database krijgt demo-opdrachten (seed.js), waaronder een DRS-opdracht op Afspraak
// ingepland. Sinds 24 okt telt die mee (alle vier kopjes) — eerst afvinken als "al gemeld",
// zodat de tellingen hieronder alleen over de testopdrachten gaan.
const demo = (await api('GET', '/api/drs-rapport')).json?.items || [];
if (demo.length) await api('POST', '/api/drs-rapport/markeer', { via: 'handmatig', items: demo.map((i) => ({ orderId: i.orderId, cat: i.cat, regel: i.regel })) });
const maak = async (velden, status) => {
  const r = await api('POST', '/api/orders', { source: 'DRS WhatsApp groep', ...velden });
  if (status) await api('PATCH', `/api/orders/${r.json.id}`, { status, ...(velden.notesNa ? { notes: velden.notesNa } : {}) });
  return r.json;
};
const A = await maak({ customerName: 'North Ridge BV', customerPhone: '0611000001', customerAddress: 'Industrieweg 4, 4879 NB Etten-Leur', title: 'Etten-Leur — deur sluit niet' }, 'afgerond');
const B = await maak({ customerName: 'Jan Kapel', customerPhone: '0611000002', customerAddress: 'Dorpsweg 1, 4421 BR Kapelle', title: 'Kapelle — slot vervangen' }, 'afgerond');
const C = await maak({ customerName: 'Mevr. Timmer', customerPhone: '0611000003', customerAddress: 'Laan 3, 4871 DK Etten-Leur', title: 'Etten-Leur — deur afstellen', notesNa: 'Langs geweest: deur moet afgesteld worden door een timmerman' }, 'geannuleerd');
const D = await api('POST', '/api/orders', { source: 'Handmatig', customerName: 'Eigen Klant', customerPhone: '0611000004', customerAddress: 'Straat 9, 3911 AB Rhenen', title: 'Rhenen — eigen lead' });
await api('PATCH', `/api/orders/${D.json.id}`, { status: 'afgerond' });
const OPEN = await maak({ customerName: 'Nog Bezig', customerPhone: '0611000005', customerAddress: 'Weg 2, 5000 AA Tilburg', title: 'Tilburg — afspraak' });
ok('testopdrachten aangemaakt', !!(A && B && C && D.json?.id && OPEN));

console.log('\n== Rapport-voorstel: alleen DRS, alleen nog niet gemeld ==');
let v = (await api('GET', '/api/drs-rapport')).json;
const ids = (v.items || []).map((i) => i.orderId);
ok('afgeronde + geannuleerde DRS-opdrachten staan erin', ids.includes(A.id) && ids.includes(B.id) && ids.includes(C.id), JSON.stringify(ids));
ok('eigen lead (geen DRS) staat er NIET in', !ids.includes(D.json.id));
ok('lopende opdracht (niet afgerond) staat er niet in', !ids.includes(OPEN.id));
const regelA = (v.items || []).find((i) => i.orderId === A.id)?.regel || '';
ok('regel = postcode + plaats + klantnaam (wens DRS)', regelA === '4879 NB Etten-Leur — North Ridge BV', regelA);
const regelC = (v.items || []).find((i) => i.orderId === C.id)?.regel || '';
ok('geannuleerd: reden uit de notitie erbij', /4871 DK Etten-Leur — Mevr\. Timmer, Langs geweest/.test(regelC), regelC);
ok('kop met dagnaam + datum', v.kop === kopVan(vandaag), v.kop);
ok('standaard kopjes: alle vier (sinds 24 okt ook Offerte + Afspraken)', JSON.stringify(v.kopjes) === JSON.stringify(['afgerond', 'geannuleerd', 'offerte', 'afspraak']), JSON.stringify(v.kopjes));
const pulse = (await api('GET', '/api/pulse')).json;
ok('pulse geeft teller "nog te melden" (3)', pulse.drsTeMelden === 3, JSON.stringify(pulse.drsTeMelden));

console.log('\n== Afvinken (na kopiëren + plaatsen) ==');
const mk = await api('POST', '/api/drs-rapport/markeer', { datum: eergisteren, tekst: 'rapport', items: [A, B, C].map((o) => ({ orderId: o.id, cat: (v.items.find((i) => i.orderId === o.id) || {}).cat, regel: 'x' })) });
ok('3 opdrachten afgevinkt', mk.status === 200 && mk.json?.gemarkeerd === 3 && !!mk.json?.rapportId, JSON.stringify(mk.json));
v = (await api('GET', '/api/drs-rapport')).json;
ok('daarna staat er niets meer open', (v.items || []).length === 0, JSON.stringify(v.items));
ok('rapport staat in de geschiedenis', (v.rapporten || []).some((r) => r.id === mk.json.rapportId && r.afgerond === 2));
const nogmaals = await api('POST', '/api/drs-rapport/markeer', { items: [{ orderId: A.id, cat: 'afgerond' }] });
ok('NOGMAALS als afgerond afvinken → 409 met uitleg (geen dubbele betaling)', nogmaals.status === 409 && /al als afgerond gemeld/.test(nogmaals.json?.error || '') && nogmaals.json?.conflicten?.[0]?.orderId === A.id, JSON.stringify(nogmaals.json));
const bewust = await api('POST', '/api/drs-rapport/markeer', { items: [{ orderId: B.id, cat: 'afgerond' }], force: true });
ok('bewust opnieuw (force) kan wel, met historie', bewust.status === 200 && bewust.json?.gemarkeerd === 1);
const orders1 = (await api('GET', '/api/orders?includeArchived=1')).json;
const Ao = orders1.find((o) => o.id === A.id);
ok('opdracht draagt drsGemeld.afgerond (datum, wie, via)', Ao?.drsGemeld?.afgerond?.datum === eergisteren && Ao.drsGemeld.afgerond.via === 'crm' && !!Ao.drsGemeld.afgerond.door, JSON.stringify(Ao?.drsGemeld));

console.log('\n== VANGNET: ons rapport uit de DRS-groep ==');
const E = await maak({ customerName: 'Waal Wijk', customerPhone: '0611000006', customerAddress: 'Markt 1, 5146 BE Waalwijk', title: 'Waalwijk — slot' }, 'afgerond');
const voorAantal = (await api('GET', '/api/orders?includeArchived=1')).json.length;
const rapportTekst = `*${kopVan(gisteren)}*\n\n*Afgerond:*\n\n4421 BR Kapelle\n\n4879 NB Etten-Leur\n\n5146BE Waalwijk\n\n9999 ZZ Nergenshuizen`;
const ing = await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Key service 24/7', body: rapportTekst, externalId: 'drs-rapport-1' }, true);
ok('rapport komt binnen (geen fout)', ing.status === 200, JSON.stringify(ing.json));
ok('rapport wordt GEEN opdracht', (await api('GET', '/api/orders?includeArchived=1')).json.length === voorAantal);
v = (await api('GET', '/api/drs-rapport')).json;
const gelezen = (v.rapporten || []).find((r) => r.via === 'groep');
ok('rapport uit de groep staat in de geschiedenis', !!gelezen, JSON.stringify(v.rapporten?.map((r) => r.via)));
const uit = (pc) => (gelezen?.regels || []).find((r) => r.postcode === pc)?.uitkomst || '';
ok('nog niet gemelde opdracht (Waalwijk) automatisch afgevinkt', /^gemeld/.test(uit('5146 BE')), uit('5146 BE'));
ok('4879 NB (al op eergisteren gemeld) → DUBBEL', uit('4879 NB') === 'dubbel', uit('4879 NB'));
ok('onbekende postcode zichtbaar als onbekend', uit('9999 ZZ') === 'onbekend', uit('9999 ZZ'));
ok('DUBBEL-alarm staat open in het DRS-scherm', (v.alarmen || []).some((a) => a.postcode === '4879 NB' && a.eerder === eergisteren), JSON.stringify(v.alarmen));
const Eo = (await api('GET', '/api/orders?includeArchived=1')).json.find((o) => o.id === E.id);
ok('Waalwijk draagt drsGemeld via "groep" met de datum uit de kop', Eo?.drsGemeld?.afgerond?.via === 'groep' && Eo.drsGemeld.afgerond.datum === gisteren, JSON.stringify(Eo?.drsGemeld));
const act = (await api('GET', '/api/activity')).json || [];
ok('logboek: "DUBBEL als afgerond gemeld"', JSON.stringify(act).includes('DUBBEL als afgerond gemeld'));
// Zelfde bericht nogmaals bezorgd (bridge-herstart) → niet nogmaals verwerkt.
await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Key service 24/7', body: rapportTekst, externalId: 'drs-rapport-1' }, true);
v = (await api('GET', '/api/drs-rapport')).json;
ok('zelfde bericht opnieuw bezorgd → geen tweede rapport/alarm', (v.rapporten || []).filter((r) => r.via === 'groep').length === 1 && (v.alarmen || []).filter((a) => a.postcode === '4879 NB').length === 1);
// Een DRS-OPDRACHT (met telefoon) in de groep is nooit een rapport.
await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Shemara DRS', body: 'Hallo. We sturen je de volgende klant:\nNaam: Piet Afgerond\nAdres: Kerkstraat 5\nWoonplaats: 5051 TL - Goirle\nTelefoon: 0612777002\nOpmerkingen: voordeur klemt', externalId: 'drs-opdracht-1' }, true);
v = (await api('GET', '/api/drs-rapport')).json;
ok('DRS-opdracht met telefoonnummer wordt niet als rapport gelezen', (v.rapporten || []).filter((r) => r.via === 'groep').length === 1);
// DRS stelt een vraag met postcodes in een genummerde lijst → geen rapport.
await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Shemara DRS', body: 'Goedemorgen Raf en Noura,\n\n3. Suzanne Groene, 4631 GM Hoogerheide\n4. van Zetten, 5345 HH Oss\n\nEn Etten-Leur 4879 NB (North Ridge BV) staat zowel op dinsdag als donderdag als afgerond.', externalId: 'drs-vraag-1' }, true);
v = (await api('GET', '/api/drs-rapport')).json;
ok('vraag van DRS met postcodes wordt niet als rapport gelezen', (v.rapporten || []).filter((r) => r.via === 'groep').length === 1);

console.log('\n== Tweede kaart op hetzelfde adres = mogelijk dubbel ==');
const F1 = await maak({ customerName: 'Dubbel Klant', customerPhone: '0611000007', customerAddress: 'Kade 7, 5251 AE Vlijmen', title: 'Vlijmen — slot' }, 'afgerond');
await api('POST', '/api/drs-rapport/markeer', { datum: drieDagen, items: [{ orderId: F1.id, cat: 'afgerond', regel: '5251 AE Vlijmen' }] });
const F2 = await maak({ customerName: 'Dubbel Klant', customerPhone: '0611000008', customerAddress: 'Kade 7, 5251 AE Vlijmen', title: 'Vlijmen — slot (nogmaals doorgestuurd)' }, 'afgerond');
v = (await api('GET', '/api/drs-rapport')).json;
const f2item = (v.items || []).find((i) => i.orderId === F2.id);
ok('voorstel waarschuwt: postcode al gemeld bij een andere opdracht', f2item && f2item.waarschuwingen.some((w) => /al als afgerond gemeld/.test(w)), JSON.stringify(f2item));
await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Noura Key Service', body: `${kopVan(vandaag)}\nAfgerond:\n5251AE Vlijmen\n4471 NK Wolphaartsdijk`, externalId: 'drs-rapport-2' }, true);
v = (await api('GET', '/api/drs-rapport')).json;
const r2 = (v.rapporten || []).find((r) => r.via === 'groep' && r.datum === vandaag);
ok('tweede kaart afgevinkt maar gemarkeerd als "mogelijk dubbel"', (r2?.regels || []).some((r) => r.postcode === '5251 AE' && /mogelijk dubbel/.test(r.uitkomst)), JSON.stringify(r2?.regels));
ok('alarm "mogelijk dubbel" staat open', (v.alarmen || []).some((a) => a.postcode === '5251 AE' && a.mogelijk));

console.log('\n== Vinkje op de opdracht + ongedaan maken ==');
const G = await maak({ customerName: 'Vinkje Klant', customerPhone: '0611000009', customerAddress: 'Pad 1, 4000 AA Tiel', title: 'Tiel — slot' }, 'geannuleerd');
let t = await api('POST', `/api/orders/${G.id}/drs-gemeld`, { gemeld: true });
ok('vinkje "gemeld" op de opdracht (kopje volgt de status)', t.status === 200 && t.json?.drsGemeld?.geannuleerd?.via === 'handmatig', JSON.stringify(t.json));
t = await api('POST', `/api/orders/${G.id}/drs-gemeld`, { gemeld: false });
ok('vinkje weer uit', t.status === 200 && !t.json?.drsGemeld?.geannuleerd);
ok('vinkje op een eigen lead (geen DRS) → 400', (await api('POST', `/api/orders/${D.json.id}/drs-gemeld`, { gemeld: true })).status === 400);
const ong = await api('POST', '/api/drs-rapport/ongedaan', { rapportId: mk.json.rapportId });
ok('rapport ongedaan maken zet de vinkjes terug', ong.status === 200 && ong.json?.teruggezet >= 2, JSON.stringify(ong.json));
v = (await api('GET', '/api/drs-rapport')).json;
ok('C (geannuleerd) staat weer bij nog te melden', (v.items || []).some((i) => i.orderId === C.id));
const alarm = (v.alarmen || [])[0];
ok('alarm afhandelen', (await api('POST', `/api/drs-rapport/alarm/${alarm.id}/afgehandeld`)).status === 200
  && !((await api('GET', '/api/drs-rapport')).json.alarmen || []).some((a) => a.id === alarm.id));

console.log('\n== Samenvoegen neemt "gemeld" mee ==');
const H1 = await maak({ customerName: 'Merge Klant', customerPhone: '0611000010', customerAddress: 'Hof 2, 5109 TB \'s Gravenmoer', title: "'s Gravenmoer — slot" }, 'afgerond');
await api('POST', '/api/drs-rapport/markeer', { items: [{ orderId: H1.id, cat: 'afgerond', regel: 'x' }] });
const H2 = await maak({ customerName: 'Merge Klant', customerPhone: '0611000010', customerAddress: 'Hof 2, 5109 TB \'s Gravenmoer', title: "'s Gravenmoer — slot (dubbel)" }, 'afgerond');
await api('POST', '/api/orders/merge', { primaryId: H2.id, mergeIds: [H1.id] });
const H2o = (await api('GET', '/api/orders?includeArchived=1')).json.find((o) => o.id === H2.id);
ok('hoofdkaart erft drsGemeld.afgerond van de samengevoegde kaart', !!H2o?.drsGemeld?.afgerond, JSON.stringify(H2o?.drsGemeld));
ok('en staat dus niet meer bij nog te melden', !((await api('GET', '/api/drs-rapport')).json.items || []).some((i) => i.orderId === H2.id));

console.log('\n== Rechten + maandtelling ==');
await api('POST', '/api/users', { name: 'Monteur Drs', email: 'monteurdrs@keyservice.nl', password: 'monteur123', role: 'monteur' });
await api('POST', '/api/users', { name: 'Assistente Drs', email: 'assdrs@keyservice.nl', password: 'assist123', role: 'assistent' });
await login('monteurdrs@keyservice.nl', 'monteur123');
ok('monteur: geen toegang tot het DRS-rapport (403)', (await api('GET', '/api/drs-rapport')).status === 403);
await login('assdrs@keyservice.nl', 'assist123');
ok('assistente: wel toegang', (await api('GET', '/api/drs-rapport')).status === 200);
ok('assistente mag de instellingen niet wijzigen', (await api('POST', '/api/drs-rapport/instellingen', { herinnering: false })).status === 403);
cookie = adminCookie;
const inst = await api('POST', '/api/drs-rapport/instellingen', { kopjes: ['afgerond', 'geannuleerd', 'afspraak'], herinneringUur: 22 });
ok('beheerder wijzigt instellingen (kopjes + uur)', inst.status === 200 && inst.json.kopjes.includes('afspraak') && inst.json.herinneringUur === 22);
const maand = (await api('GET', `/api/drs-rapport/maand?maand=${vandaag.slice(0, 7)}`)).json;
ok('maandtelling voor de controle van de DRS-factuur', maand.maand === vandaag.slice(0, 7) && maand.afgerond >= 3 && Array.isArray(maand.rijen), JSON.stringify({ n: maand.afgerond }));

console.log('\n== Audit-fixes 16 okt: andere rapportvormen, afzender, twee klussen op één adres ==');
{
  cookie = adminCookie;
  const P = await maak({ customerName: 'Vorm Klant', customerPhone: '0611000020', customerAddress: 'Laan 1, 4561 KZ Hulst', title: 'Hulst — slot' }, 'afgerond');
  const Q1 = await maak({ customerName: 'Jansen', customerPhone: '0611000021', customerAddress: 'Northridge 4, 4880 AB Etten-Leur', title: 'Etten-Leur — unit 4' }, 'afgerond');
  const Q2 = await maak({ customerName: 'Pietersen', customerPhone: '0611000022', customerAddress: 'Northridge 6, 4880 AB Etten-Leur', title: 'Etten-Leur — unit 6' }, 'afgerond');
  // Naam vóór de postcode, emoji voor het kopje, "Afgeronde opdrachten:", en een onbekend kopje.
  await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Noura Key Service', body: `✅ *Afgeronde opdrachten:*\nVorm Klant — 4561 KZ Hulst\n4880 AB Etten-Leur — Jansen\n4880 AB Etten-Leur — Pietersen\n*Nog open:*\n5000 AA Tilburg`, externalId: 'drs-vorm-1' }, true);
  const lijst = (await api('GET', '/api/orders?includeArchived=1')).json;
  const g = (id) => lijst.find((o) => o.id === id)?.drsGemeld?.afgerond;
  ok('rapport met emoji-kopje + naam vóór de postcode wordt gelezen', !!g(P.id));
  ok('twee klussen op hetzelfde adres: de naam in de regel bepaalt welke (beide afgevinkt, geen vals alarm)', !!g(Q1.id) && !!g(Q2.id), JSON.stringify([g(Q1.id), g(Q2.id)]));
  const tilburg = lijst.find((o) => o.id === OPEN.id);
  ok('regel onder een onbekend kopje ("Nog open:") telt NIET als afgerond', !tilburg?.drsGemeld?.afgerond, JSON.stringify(tilburg?.drsGemeld));
  const alarmVals = ((await api('GET', '/api/drs-rapport')).json.alarmen || []).some((a) => a.postcode === '4880 AB');
  ok('geen vals dubbel-alarm voor de twee units', !alarmVals);
  // Lijstje van een DRS-medewerker: niet afvinken, geen alarm.
  const R = await maak({ customerName: 'Vreemd Lijstje', customerPhone: '0611000023', customerAddress: 'Plein 2, 4600 AA Bergen op Zoom', title: 'Bergen op Zoom — slot' }, 'afgerond');
  await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Shemara DRS', body: `Afgerond:\n4600 AA Bergen op Zoom graag factuur\n4879 NB Etten-Leur`, externalId: 'drs-vreemd-1' }, true);
  const Ro = (await api('GET', '/api/orders?includeArchived=1')).json.find((o) => o.id === R.id);
  ok('lijstje van een DRS-medewerker vinkt NIETS af', !Ro?.drsGemeld?.afgerond);
  const vv = (await api('GET', '/api/drs-rapport')).json;
  ok('…en geeft geen alarm, maar staat wel ter info in de geschiedenis', !(vv.alarmen || []).some((a) => a.datum === vandaag && a.postcode === '4879 NB' && !a.afgehandeld && a.at > new Date(Date.now() - 60000).toISOString())
    && (vv.rapporten || []).some((r) => (r.regels || []).some((x) => /andere afzender/.test(x.uitkomst || ''))));
  // Met de naam in de instellingen telt het wél.
  await api('POST', '/api/drs-rapport/instellingen', { afzenders: 'Shemara' });
  await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Shemara DRS', body: `Afgerond:\n4600 AA Bergen op Zoom`, externalId: 'drs-vreemd-2' }, true);
  ok('met de naam bij "Wie plaatsen het rapport" telt het wel', !!(await api('GET', '/api/orders?includeArchived=1')).json.find((o) => o.id === R.id)?.drsGemeld?.afgerond);
  await api('POST', '/api/drs-rapport/instellingen', { afzenders: '' });
  // Oude kop laten staan: rapport van eergisteren opnieuw geplaatst → dubbel.
  const S = await maak({ customerName: 'Oude Kop', customerPhone: '0611000024', customerAddress: 'Dijk 3, 4700 AA Roosendaal', title: 'Roosendaal — slot' }, 'afgerond');
  await api('POST', '/api/drs-rapport/markeer', { datum: drieDagen, items: [{ orderId: S.id, cat: 'afgerond', regel: '4700 AA Roosendaal' }] });
  // Het oorspronkelijke rapport (kop drie dagen terug) staat in de groep…
  await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Key service 24/7', body: `*${kopVan(drieDagen)}*\n*Afgerond:*\n4700 AA Roosendaal`, externalId: 'drs-oudekop-0' }, true);
  ok('oorspronkelijk rapport met teruggezette kop → geen alarm (zelfde rapport)', !((await api('GET', '/api/drs-rapport')).json.alarmen || []).some((a) => a.postcode === '4700 AA'));
  // …en wordt later gekopieerd en aangevuld opnieuw geplaatst zonder de kop aan te passen.
  await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Key service 24/7', body: `*${kopVan(drieDagen)}*\n*Afgerond:*\n4700 AA Roosendaal\n4561 KZ Hulst nogmaals`, externalId: 'drs-oudekop-1' }, true);
  ok('rapport met een OUDE kop (niet aangepast) → toch dubbel-alarm', ((await api('GET', '/api/drs-rapport')).json.alarmen || []).some((a) => a.postcode === '4700 AA'));
  // Precies hetzelfde rapport twee keer (binnen 24 uur) → tweede keer alarm.
  const T = await maak({ customerName: 'Twee Keer', customerPhone: '0611000025', customerAddress: 'Hof 9, 4800 AA Breda', title: 'Breda — slot' }, 'afgerond');
  const tekst2 = `*${kopVan(vandaag)}*\n\n*Afgerond:*\n\n4800 AA Breda\n\n9998 ZZ Nergens`;
  await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Key service 24/7', body: tekst2, externalId: 'drs-twee-1' }, true);
  ok('eerste keer: afgevinkt, geen alarm', !!(await api('GET', '/api/orders?includeArchived=1')).json.find((o) => o.id === T.id)?.drsGemeld?.afgerond
    && !((await api('GET', '/api/drs-rapport')).json.alarmen || []).some((a) => a.postcode === '4800 AA'));
  await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Key service 24/7', body: tekst2, externalId: 'drs-twee-2' }, true);
  ok('zelfde rapport nogmaals geplaatst → dubbel-alarm', ((await api('GET', '/api/drs-rapport')).json.alarmen || []).some((a) => a.postcode === '4800 AA'));
  // Een-regel-rapport met een telefoonnummer erin wordt nooit een opdracht.
  const voor = (await api('GET', '/api/orders?includeArchived=1')).json.length;
  const een = await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Key service 24/7', body: `*Geannuleerd:*\n4871 DK Etten-Leur, klant belt zelf terug 0612345678`, externalId: 'drs-een-1' }, true);
  ok('een-regel-rapport (met telefoonnummer) wordt geen opdracht en geen "onvolledig"-melding', (await api('GET', '/api/orders?includeArchived=1')).json.length === voor && een.json?.status !== 'auto_approved', JSON.stringify(een.json));
}

console.log('\n== Audit-fixes 16 okt: dubbele opdrachten, fee, inklappen, terug op het bord ==');
{
  cookie = adminCookie;
  // Plak opdracht: bestaat al → 409, bewust doorgaan kan.
  const drsTekst = 'Hallo. We sturen je de volgende klant:\nNaam: North Ridge BV\nAdres: Industrieweg 4\nWoonplaats: 4879 NB - Etten-Leur\nTelefoon: 0611000001\nOpmerkingen: deur sluit weer niet';
  const p1 = await api('POST', '/api/orders/paste', { text: drsTekst });
  ok('plakken van een bestaande opdracht → 409 "staat er waarschijnlijk al"', p1.status === 409 && /staat er waarschijnlijk al/.test(p1.json?.error || '') && p1.json?.dubbel?.orderId === A.id, JSON.stringify(p1.json));
  const p2 = await api('POST', '/api/orders/paste', { text: drsTekst, force: true });
  ok('bewust toch aanmaken (force) kan', p2.status === 200 && !!p2.json?.id);
  // Opnieuw geposte DRS-opdracht na afronden: niet stil automatisch een tweede kaart.
  const mont = await api('POST', '/api/monteurs', { name: 'Youssef Test', phone: '0687650000', waGroup: 'Youssef Keyservice247' });
  await api('PATCH', '/api/settings', { monteurDispatch: { autoEnabled: true, days: [0, 1, 2, 3, 4, 5, 6], autoMonteurId: mont.json.id, trigger: 'intake', onlyDrs: true } });
  const job = 'Karel Herpost, Dorpsstraat 77, 3911 XY Rhenen, 0611777888, cilinderslot voordeur kapot';
  const i1 = await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Shemara DRS', body: job, externalId: 'herpost-1' }, true);
  ok('eerste DRS-opdracht: volautomatisch een kaart', i1.json?.status === 'auto_approved', JSON.stringify(i1.json));
  const kaart = (await api('GET', '/api/orders')).json.find((o) => (o.intake?.phone || '').includes('0611777888'));
  await api('PATCH', `/api/orders/${kaart.id}`, { status: 'afgerond' });
  const i2 = await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Shemara DRS', body: `${job}, klant belt opnieuw`, externalId: 'herpost-2' }, true);
  ok('zelfde klant opnieuw gepost na afronden → NIET automatisch (assistente beslist)', i2.json?.status === 'pending', JSON.stringify(i2.json));
  const rev = ((await api('GET', '/api/reviews?limit=100')).json?.items || []).find((r) => r.id === i2.json?.reviewId);
  ok('inbox-item legt uit waarom (opnieuw gepost, met de eerdere opdracht)', /opnieuw gepost/.test(rev?.autoOvergeslagen || '') && rev?.mogelijkDubbel?.orderId === kaart.id, JSON.stringify(rev?.autoOvergeslagen));
  await api('PATCH', '/api/settings', { monteurDispatch: { autoEnabled: false } });
  // DRS-fee volgt de opdracht: terug bij heropenen, één fee bij samenvoegen.
  const maandNu = vandaag.slice(0, 7);
  const fees = async () => ((await api('GET', `/api/finance?month=${maandNu}`)).json?.report?.entries || []).filter((e) => /^drsfee:/.test(e.sourceRef || ''));
  const U = await maak({ customerName: 'Fee Klant', customerPhone: '0611000030', customerAddress: 'Weg 1, 5100 AA Dongen', title: 'Dongen — slot' }, 'afgerond');
  await api('POST', '/api/finance/autosync', {});
  ok('afgeronde DRS-opdracht krijgt een fee', (await fees()).some((e) => e.sourceRef === `drsfee:${U.id}`));
  await api('PATCH', `/api/orders/${U.id}`, { status: 'open' });
  ok('heropend → fee teruggedraaid', !(await fees()).some((e) => e.sourceRef === `drsfee:${U.id}`));
  await api('PATCH', `/api/orders/${U.id}`, { status: 'afgerond' });
  await api('POST', '/api/finance/autosync', {});
  ok('weer afgerond → fee weer geboekt (één keer)', (await fees()).filter((e) => e.sourceRef === `drsfee:${U.id}`).length === 1);
  const V1 = await maak({ customerName: 'Merge Fee', customerPhone: '0611000031', customerAddress: 'Laan 5, 5120 AA Rijen', title: 'Rijen — slot' });
  const V2 = await maak({ customerName: 'Merge Fee', customerPhone: '0611000031', customerAddress: 'Laan 5, 5120 AA Rijen', title: 'Rijen — slot (dubbel)' }, 'afgerond');
  await api('POST', '/api/finance/autosync', {});
  await api('POST', '/api/orders/merge', { primaryId: V1.id, mergeIds: [V2.id] });
  const V1o = (await api('GET', '/api/orders?includeArchived=1')).json.find((o) => o.id === V1.id);
  ok('samenvoegen: afgerond gaat mee naar de hoofdkaart', V1o?.status === 'afgerond' && !!V1o?.completedAt, JSON.stringify({ s: V1o?.status }));
  await api('POST', '/api/finance/autosync', {});
  const vf = (await fees()).filter((e) => e.sourceRef === `drsfee:${V1.id}` || e.sourceRef === `drsfee:${V2.id}`);
  ok('samenvoegen: één klus = één fee (overgezet naar de hoofdkaart)', vf.length === 1 && vf[0].sourceRef === `drsfee:${V1.id}`, JSON.stringify(vf.map((e) => e.sourceRef)));
  const W = await maak({ customerName: 'Prullenbak Fee', customerPhone: '0611000032', customerAddress: 'Weg 8, 5130 AA Alphen', title: 'Alphen — slot' }, 'afgerond');
  await api('POST', '/api/finance/autosync', {});
  await api('DELETE', `/api/orders/${W.id}`);
  ok('naar de prullenbak → fee weg', !(await fees()).some((e) => e.sourceRef === `drsfee:${W.id}`));
  // Handmatig inklappen: alleen afgehandeld + zichtbaar; open blijft staan.
  const X1 = await maak({ customerName: 'Inklap Open', customerPhone: '0611000040', customerAddress: 'Weg 1, 5140 AA Waalwijk', title: 'Waalwijk — open' });
  const X2 = await maak({ customerName: 'Inklap Klaar', customerPhone: '0611000041', customerAddress: 'Weg 2, 5140 AA Waalwijk', title: 'Waalwijk — klaar' }, 'afgerond');
  const ik = (await api('POST', '/api/archives/collapse', { channel: 'all', ids: [X1.id, X2.id] })).json;
  const na = (await api('GET', '/api/orders?includeArchived=1')).json;
  ok('handmatig inklappen: open opdracht blijft op het bord, afgeronde gaat de bundel in', !na.find((o) => o.id === X1.id)?.archivedWeek && na.find((o) => o.id === X2.id)?.archivedWeek?.key === ik.key && ik.overgeslagen >= 1, JSON.stringify(ik));
  // Status wijzigen van een ingeklapte opdracht → terug op het bord.
  await api('PATCH', `/api/orders/${X2.id}`, { status: 'open' });
  ok('status gewijzigd van een ingeklapte opdracht → terug op het bord', !(await api('GET', '/api/orders?includeArchived=1')).json.find((o) => o.id === X2.id)?.archivedWeek);
  // Direct als afgerond aangemaakt → afrondmoment + intake vastgelegd.
  const Y = (await api('POST', '/api/orders', { source: 'Handmatig', customerName: 'Achteraf', customerPhone: '0611000050', customerAddress: 'Straat 1, 5150 AA Drunen', title: 'Drunen — achteraf', status: 'afgerond' })).json;
  ok('direct als afgerond aangemaakt → completedAt + intake van déze aanvraag', !!Y.completedAt && Y.intake?.address === 'Straat 1, 5150 AA Drunen', JSON.stringify({ c: Y.completedAt, i: Y.intake }));
}

console.log('\n== DRS mailt opdrachten (16 okt): e-mail van een DRS-adres wordt een DRS-opdracht ==');
{
  cookie = adminCookie;
  const inst = await api('POST', '/api/drs-rapport/instellingen', { emailAfzenders: 'planning@drs-test.nl, drsgroep.nl' });
  ok('instelling e-mailadressen DRS opgeslagen (adres + domein)', inst.status === 200 && inst.json.emailAfzenders.includes('planning@drs-test.nl') && inst.json.emailAfzenders.includes('drsgroep.nl'), JSON.stringify(inst.json.emailAfzenders));
  const m1 = await api('POST', '/api/ingest/email', { from: 'DRS Planning <planning@drs-test.nl>', subject: 'Nieuwe opdracht', body: 'We sturen je de volgende klant:\nNaam: Mail Klant\nAdres: Kerkweg 3\nWoonplaats: 5050 AB Goirle\nTelefoon: 0611222999\nOpmerkingen: slot klemt', externalId: 'drs-mail-1' }, true);
  const ap = await api('POST', `/api/reviews/${m1.json.reviewId}/approve`, {});
  ok('goedgekeurde DRS-mail → bron "DRS e-mail" en telt als DRS', ap.status === 200 && ap.json?.order?.source === 'DRS e-mail' && ap.json?.order?.isDrs === true, JSON.stringify({ s: ap.json?.order?.source, d: ap.json?.order?.isDrs, e: ap.json?.error }));
  const m2 = await api('POST', '/api/ingest/email', { from: 'Info <info@sub.drsgroep.nl>', subject: 'Opdracht', body: 'Naam: Domein Klant\nAdres: Laan 1\nWoonplaats: 5051 AB Goirle\nTelefoon: 0611222998\nOpmerkingen: deur', externalId: 'drs-mail-2' }, true);
  const ap2 = await api('POST', `/api/reviews/${m2.json.reviewId}/approve`, {});
  ok('ook op domein (subdomein) herkend', ap2.json?.order?.source === 'DRS e-mail');
  const m3 = await api('POST', '/api/ingest/email', { from: 'Klant <klant@gmail.com>', subject: 'Slot kapot', body: 'Naam: Gewone Klant\nAdres: Weg 2, 5052 AB Goirle\nTelefoon: 0611222997\nMijn slot is kapot', externalId: 'drs-mail-3' }, true);
  const ap3 = await api('POST', `/api/reviews/${m3.json.reviewId}/approve`, {});
  ok('gewone klantmail blijft "Keyservice e-mail" (geen DRS)', ap3.json?.order?.source === 'Keyservice e-mail' && !ap3.json?.order?.isDrs, JSON.stringify(ap3.json?.order?.source));
  await api('POST', '/api/drs-rapport/instellingen', { emailAfzenders: '' });
}

console.log('\n== Review-fixes 16 okt ==');
{
  cookie = adminCookie;
  const grp = { group: `groep ${RAF_ID}`, name: 'Key service 24/7' };
  const lijstNu = async () => (await api('GET', '/api/orders?includeArchived=1')).json;
  // (a) CRM vinkt eerst af, daarna komt het rapport uit de groep; op hetzelfde adres staat een
  //     oude geannuleerde kaart → die mag NIET als afgerond worden afgevinkt.
  const A1 = await maak({ customerName: 'Echo Klant', customerPhone: '0611000060', customerAddress: 'Kade 1, 4900 AA Oosterhout', title: 'Oosterhout — oud' }, 'geannuleerd');
  const A2 = await maak({ customerName: 'Echo Klant', customerPhone: '0611000061', customerAddress: 'Kade 1, 4900 AA Oosterhout', title: 'Oosterhout — nu' }, 'afgerond');
  const tA = await api('POST', '/api/drs-rapport/markeer', { items: [{ orderId: A2.id, cat: 'afgerond', regel: '4900 AA Oosterhout — Echo Klant' }], tekst: 'x' });
  ok('(a) CRM vinkt af', tA.status === 200 && tA.json.gemarkeerd === 1);
  await api('POST', '/api/ingest/whatsapp', { ...grp, body: `*${kopVan(vandaag)}*\n*Afgerond:*\n4900 AA Oosterhout — Echo Klant`, externalId: 'rv-echo-1' }, true);
  const l1 = await lijstNu();
  ok('(a) rapport uit de groep daarna: de OUDE geannuleerde kaart blijft ongemoeid', !l1.find((o) => o.id === A1.id)?.drsGemeld?.afgerond, JSON.stringify(l1.find((o) => o.id === A1.id)?.drsGemeld));
  // (b) Eerst de groep, dan "Geplaatst — vink af" → geen vals 409.
  const B1 = await maak({ customerName: 'Volgorde Klant', customerPhone: '0611000062', customerAddress: 'Weg 1, 4901 AA Oosterhout', title: 'Oosterhout — volgorde' }, 'afgerond');
  await api('POST', '/api/ingest/whatsapp', { ...grp, body: `*${kopVan(vandaag)}*\n*Afgerond:*\n4901 AA Oosterhout — Volgorde Klant`, externalId: 'rv-volgorde-1' }, true);
  const tB = await api('POST', '/api/drs-rapport/markeer', { items: [{ orderId: B1.id, cat: 'afgerond', regel: 'x' }], tekst: 'x' });
  ok('(b) "Geplaatst" ná het groepsbericht → 200, "al afgevinkt" (geen vals dubbel-alarm)', tB.status === 200 && tB.json.gemarkeerd === 0 && tB.json.alGemeld === 1, JSON.stringify(tB.json));
  // (c) Kopdatum in het CRM teruggezet (rapport van eergisteren, pas vandaag geplaatst) → geen dubbel.
  const C1 = await maak({ customerName: 'Kopdatum Klant', customerPhone: '0611000063', customerAddress: 'Weg 2, 4902 AA Oosterhout', title: 'Oosterhout — kop' }, 'afgerond');
  await api('POST', '/api/drs-rapport/markeer', { datum: drieDagen, items: [{ orderId: C1.id, cat: 'afgerond', regel: 'x' }] });
  await api('POST', '/api/ingest/whatsapp', { ...grp, body: `*${kopVan(drieDagen)}*\n*Afgerond:*\n4902 AA Oosterhout`, externalId: 'rv-kop-1' }, true);
  const alarmenNu = async () => ((await api('GET', '/api/drs-rapport')).json.alarmen || []);
  ok('(c) teruggezette kopdatum + later geplaatst → geen vals dubbel-alarm', !(await alarmenNu()).some((x) => x.postcode === '4902 AA'));
  const toekomst = await api('POST', '/api/drs-rapport/markeer', { datum: '2099-01-01', items: [{ orderId: C1.id, cat: 'geannuleerd', regel: 'x' }] });
  ok('(c) datum in de toekomst wordt vandaag (nooit een datum in de toekomst)', toekomst.json?.datum === vandaag, JSON.stringify(toekomst.json));
  // (d) Lijstje van een DRS-medewerker eerder vandaag → ons eigen rapport daarna is GEEN dubbel.
  const D1 = await maak({ customerName: 'Info Klant', customerPhone: '0611000064', customerAddress: 'Weg 3, 4903 AA Oosterhout', title: 'Oosterhout — info' }, 'afgerond');
  await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Shemara DRS', body: 'Afgerond:\n4903 AA Oosterhout graag factuur sturen', externalId: 'rv-info-1' }, true);
  await api('POST', '/api/ingest/whatsapp', { ...grp, body: `*${kopVan(vandaag)}*\n*Afgerond:*\n4903 AA Oosterhout`, externalId: 'rv-info-2' }, true);
  ok('(d) lijstje van DRS eerder vandaag maakt ons rapport niet "dubbel"', !(await alarmenNu()).some((x) => x.postcode === '4903 AA') && !!(await lijstNu()).find((o) => o.id === D1.id)?.drsGemeld?.afgerond);
  // (f) Zelfde klus als twee kaarten, één zonder naam → waarschuwing in het voorstel + dubbel in het rapport.
  const F1 = await maak({ customerName: 'Naam Klant', customerPhone: '0611000065', customerAddress: 'Weg 4, 4904 AA Oosterhout', title: 'Oosterhout — met naam' }, 'afgerond');
  const F2 = await maak({ customerName: 'Onbekende klant', customerPhone: '0611000066', customerAddress: 'Weg 4, 4904 AA Oosterhout', title: 'Oosterhout — zonder naam' }, 'afgerond');
  const vf = (await api('GET', '/api/drs-rapport')).json;
  ok('(f) voorstel waarschuwt: zelfde postcode 2× (één zonder naam)', (vf.items || []).filter((i) => [F1.id, F2.id].includes(i.orderId)).every((i) => i.waarschuwingen.some((w) => /2× in dit rapport/.test(w))));
  await api('POST', '/api/ingest/whatsapp', { ...grp, body: `*${kopVan(vandaag)}*\n*Afgerond:*\n4904 AA Oosterhout — Naam Klant\n4904 AA Oosterhout`, externalId: 'rv-f-1' }, true);
  ok('(f) tweede regel zonder naam = dubbel-alarm, tweede kaart NIET afgevinkt', (await alarmenNu()).some((x) => x.postcode === '4904 AA') && !(await lijstNu()).find((o) => o.id === F2.id)?.drsGemeld?.afgerond);
  // (e) Melding van lang geleden (> 45 dagen) op hetzelfde adres → geen dubbel-alarm.
  const E1 = await maak({ customerName: 'Oud Adres', customerPhone: '0611000067', customerAddress: 'Weg 5, 4905 AA Oosterhout', title: 'Oosterhout — oud adres' }, 'afgerond');
  await api('POST', '/api/drs-rapport/markeer', { datum: nlDag(Date.now() - 12 * DAG), items: [{ orderId: E1.id, cat: 'afgerond', regel: 'x' }] });
  // (12 dagen is binnen de grens van 14 voor de route; > 45 dagen testen we zonder server.)
  // (g) DRS-mail goedkeuren met de standaard-herkomst uit het scherm → toch "DRS e-mail".
  await api('POST', '/api/drs-rapport/instellingen', { emailAfzenders: 'planning@drs-test.nl' });
  const gm = await api('POST', '/api/ingest/email', { from: 'planning@drs-test.nl', subject: 'Opdracht', body: 'Naam: Scherm Klant\nAdres: Laan 9\nWoonplaats: 5060 AB Oisterwijk\nTelefoon: 0611222990\nOpmerkingen: slot', externalId: 'rv-mail-1' }, true);
  const gap = await api('POST', `/api/reviews/${gm.json.reviewId}/approve`, { source: 'Keyservice e-mail' });
  ok('(g) goedkeuren met herkomst "Keyservice e-mail" uit het scherm → toch "DRS e-mail"', gap.json?.order?.source === 'DRS e-mail', JSON.stringify(gap.json?.order?.source));
  await api('POST', '/api/drs-rapport/instellingen', { emailAfzenders: '' });
  // (h) Eerst ter controle in de monteursgroep, dan in de DRS-groep → eerste keer bij DRS, geen dubbel.
  const H1 = await maak({ customerName: 'Controle Klant', customerPhone: '0611000068', customerAddress: 'Weg 6, 4906 AA Oosterhout', title: 'Oosterhout — controle' }, 'afgerond');
  const tekstH = `*${kopVan(vandaag)}*\n\n*Afgerond:*\n\n4906 AA Oosterhout — Controle Klant`;
  await api('POST', '/api/ingest/whatsapp', { group: 'Youssef Keyservice247', name: 'Key service 24/7', body: tekstH, externalId: 'rv-h-1' }, true);
  await api('POST', '/api/ingest/whatsapp', { ...grp, body: tekstH, externalId: 'rv-h-2' }, true);
  ok('(h) eerst in de monteursgroep, dan bij DRS → afgevinkt en GEEN dubbel', !!(await lijstNu()).find((o) => o.id === H1.id)?.drsGemeld?.afgerond && !(await alarmenNu()).some((x) => x.postcode === '4906 AA'));
  // (i) Samenvoegen terugdraaien via de prullenbak → status, vinkje en fee terug.
  const maandNu = vandaag.slice(0, 7);
  const fees = async () => ((await api('GET', `/api/finance?month=${maandNu}`)).json?.report?.entries || []).filter((e) => /^drsfee:/.test(e.sourceRef || ''));
  const I1 = await maak({ customerName: 'Terug Klant', customerPhone: '0611000069', customerAddress: 'Weg 7, 4907 AA Oosterhout', title: 'Oosterhout — hoofd' });
  const I2 = await maak({ customerName: 'Terug Klant', customerPhone: '0611000069', customerAddress: 'Weg 7, 4907 AA Oosterhout', title: 'Oosterhout — bron' }, 'afgerond');
  await api('POST', '/api/drs-rapport/markeer', { items: [{ orderId: I2.id, cat: 'afgerond', regel: 'x' }] });
  await api('POST', '/api/finance/autosync', {});
  await api('POST', '/api/orders/merge', { primaryId: I1.id, mergeIds: [I2.id] });
  const naMerge = (await lijstNu()).find((o) => o.id === I1.id);
  ok('(i) na samenvoegen: hoofdkaart afgerond + gemeld', naMerge?.status === 'afgerond' && !!naMerge?.drsGemeld?.afgerond);
  await api('POST', `/api/trash/${I2.id}/restore`, {});
  const l2 = await lijstNu();
  const hoofd = l2.find((o) => o.id === I1.id); const bron = l2.find((o) => o.id === I2.id);
  ok('(i) terughalen: hoofdkaart weer open en niet gemeld; bronkaart weer afgerond + gemeld', hoofd?.status === 'open' && !hoofd?.drsGemeld?.afgerond && bron?.status === 'afgerond' && !!bron?.drsGemeld?.afgerond, JSON.stringify({ h: hoofd?.status, hg: hoofd?.drsGemeld, b: bron?.status }));
  await api('POST', '/api/finance/autosync', {});
  const fI = (await fees()).filter((e) => [`drsfee:${I1.id}`, `drsfee:${I2.id}`].includes(e.sourceRef));
  ok('(i) terughalen: precies één fee, weer op de bronkaart', fI.length === 1 && fI[0].sourceRef === `drsfee:${I2.id}`, JSON.stringify(fI.map((e) => e.sourceRef)));
  // (j) Bewust verwijderde fee blijft weg, ook na heropenen + opnieuw afronden.
  const J1 = await maak({ customerName: 'Grafsteen', customerPhone: '0611000070', customerAddress: 'Weg 8, 4908 AA Oosterhout', title: 'Oosterhout — grafsteen' }, 'afgerond');
  await api('POST', '/api/finance/autosync', {});
  const fe = (await fees()).find((e) => e.sourceRef === `drsfee:${J1.id}`);
  await api('DELETE', `/api/finance/${fe.id}`);
  await api('PATCH', `/api/orders/${J1.id}`, { status: 'open' });
  await api('PATCH', `/api/orders/${J1.id}`, { status: 'afgerond' });
  await api('POST', '/api/finance/autosync', {});
  ok('(j) bewust verwijderde DRS-fee komt niet terug na heropenen', !(await fees()).some((e) => e.sourceRef === `drsfee:${J1.id}`));
  // (l) Monteur plakt: dubbel bij andermans opdracht → geen details.
  const mRec = await api('POST', '/api/monteurs', { name: 'Plak Monteur', phone: '0612000099' });
  await api('POST', '/api/users', { name: 'Plak Monteur', email: 'plakmonteur@keyservice.nl', password: 'monteur123', role: 'monteur', monteurId: mRec.json.id });
  await login('plakmonteur@keyservice.nl', 'monteur123');
  const mp = await api('POST', '/api/orders/paste', { text: 'Naam: North Ridge BV\nAdres: Industrieweg 4\nWoonplaats: 4879 NB - Etten-Leur\nTelefoon: 0611000001\nOpmerkingen: x' });
  ok('(l) monteur: dubbel bij andermans opdracht → 409 zonder titel/id', mp.status === 409 && mp.json?.dubbel?.soort === 'verborgen' && !mp.json?.dubbel?.orderId && !/North Ridge|Etten-Leur — /.test(mp.json?.error || ''), JSON.stringify(mp.json));
  cookie = adminCookie;
  // (m) Complete DRS-opdracht die met "Offerte:" begint → GEEN eigen rapport (blijft een aanvraag).
  const om = await api('POST', '/api/ingest/whatsapp', { group: `groep ${RAF_ID}`, name: 'Kim drs', body: 'Offerte:\nJan de Vries, Hoofdstraat 12, 4879 NB Etten-Leur, 0612345678, wil offerte voor 3 cilinders', externalId: 'rv-off-1' }, true);
  ok('(m) complete DRS-opdracht met kopje "Offerte:" verdwijnt niet in Overige', om.json?.status && om.json.status !== 'overige', JSON.stringify(om.json));
}

console.log('\n== Offerte verzonden + Afspraak ingepland krijgen het DRS-label (24 okt 2026) ==');
{
  cookie = adminCookie;
  const ALLE = ['afgerond', 'geannuleerd', 'offerte', 'afspraak'];
  // Een eerdere stap zette 3 kopjes. Het instellingenscherm moet de OPGESLAGEN waarden
  // terugtonen (toonde altijd de standaard → tweede keer opslaan wiste het DRS-mailadres).
  await api('POST', '/api/drs-rapport/instellingen', { kopjes: ALLE, afzenders: 'Noura Test', emailAfzenders: 'planning@drs-test.nl' });
  const st = (await api('GET', '/api/settings')).json;
  ok('Instellingen tonen de opgeslagen DRS-instellingen (kopjes, namen, e-mail van DRS)', JSON.stringify(st?.drsRapport?.kopjes) === JSON.stringify(ALLE) && (st.drsRapport.afzenders || []).includes('Noura Test') && (st.drsRapport.emailAfzenders || []).includes('planning@drs-test.nl'), JSON.stringify(st?.drsRapport));
  const me = (await api('GET', '/api/me')).json;
  ok('scherm krijgt Offerte + Afspraken mee (labels op het bord)', ['offerte', 'afspraak'].every((k) => (me?.meta?.drsRapport?.kopjes || []).includes(k)), JSON.stringify(me?.meta?.drsRapport));
  const voor = (await api('GET', '/api/pulse')).json.drsTeMelden;
  const OF = await maak({ customerName: 'Offerte Klant', customerPhone: '0611000090', customerAddress: 'Markt 6, 4661 AA Halsteren', title: 'Halsteren — offerte cilinders', notesNa: 'Offerte 3 cilinders verstuurd' }, 'offerte_verzonden');
  const AF = await maak({ customerName: 'Afspraak Klant', customerPhone: '0611000091', customerAddress: 'Plein 7, 4703 AB Roosendaal', title: 'Roosendaal — slot vervangen' });
  await api('PATCH', `/api/orders/${AF.id}`, { status: 'afspraak_ingepland', appointmentAt: '2026-10-28T09:30' });
  const lijst = (await api('GET', '/api/orders')).json;
  const ofo = lijst.find((o) => o.id === OF.id); const afo = lijst.find((o) => o.id === AF.id);
  ok('bord: DRS-kaart in "Offerte verzonden" hoort bij kopje Offerte', ofo?.isDrs === true && ofo.drsCat === 'offerte', JSON.stringify({ d: ofo?.isDrs, c: ofo?.drsCat }));
  ok('bord: DRS-kaart in "Afspraak ingepland" hoort bij kopje Afspraken', afo?.isDrs === true && afo.drsCat === 'afspraak', JSON.stringify({ d: afo?.isDrs, c: afo?.drsCat }));
  const rv = (await api('GET', '/api/drs-rapport')).json;
  const it = (oid) => (rv.items || []).find((i) => i.orderId === oid);
  ok('rapport: offerte staat erin onder Offerte, met de notitie', it(OF.id)?.cat === 'offerte' && it(OF.id).regel === '4661 AA Halsteren — Offerte Klant, Offerte 3 cilinders verstuurd', JSON.stringify(it(OF.id)));
  ok('rapport: afspraak staat erin onder Afspraken, met datum en tijd', it(AF.id)?.cat === 'afspraak' && it(AF.id).regel === '4703 AB Roosendaal — Afspraak Klant (28-10 09:30)', JSON.stringify(it(AF.id)));
  const na1 = (await api('GET', '/api/pulse')).json.drsTeMelden;
  ok('teller op de knop DRS-rapport telt ze mee (+2)', na1 === voor + 2, JSON.stringify({ voor, na1 }));
  // Per kopje: als offerte gemeld, klant akkoord en afgerond → opnieuw te melden, nu als afgerond.
  const vk = await api('POST', `/api/orders/${OF.id}/drs-gemeld`, { gemeld: true });
  ok('offerte afvinken op de opdracht', vk.status === 200 && vk.json?.drsGemeld?.offerte?.via === 'handmatig', JSON.stringify(vk.json));
  ok('daarna niet meer bij nog te melden', !((await api('GET', '/api/drs-rapport')).json.items || []).some((i) => i.orderId === OF.id));
  await api('PATCH', `/api/orders/${OF.id}`, { status: 'afgerond' });
  const afg = ((await api('GET', '/api/drs-rapport')).json.items || []).find((i) => i.orderId === OF.id);
  const ofNa = (await api('GET', '/api/orders?includeArchived=1')).json.find((o) => o.id === OF.id);
  ok('afgerond → staat er weer in, nu onder Afgerond (offerte-melding blijft bewaard)', afg?.cat === 'afgerond' && !!ofNa?.drsGemeld?.offerte, JSON.stringify({ afg, g: ofNa?.drsGemeld }));
  await api('POST', '/api/drs-rapport/instellingen', { afzenders: '', emailAfzenders: '' });
}

console.log('\n== Kolommen opslaan bewaart "afgehandeld" (30 okt 2026, casus 47 geannuleerd op het bord) ==');
{
  cookie = adminCookie;
  const cur = (await api('GET', '/api/settings')).json?.statuses || [];
  // Precies wat het oude scherm stuurde: alleen sleutel, naam en kleur.
  const r = await api('PATCH', '/api/settings', { statuses: cur.map(({ key, label, color }) => ({ key, label, color })) });
  const na = (await api('GET', '/api/settings')).json?.statuses || [];
  ok('kolommen opslaan zonder vlaggen: Afgerond/Geannuleerd blijven "afgehandeld"', r.status === 200 && na.find((x) => x.key === 'afgerond')?.secondary === true && na.find((x) => x.key === 'geannuleerd')?.secondary === true && na.find((x) => x.key === 'open')?.secondary === false, JSON.stringify(na.map((x) => [x.key, x.secondary])));
}

// ---------- Zonder server: eenmalige start + avondherinnering ----------
console.log('\n== Eenmalige start (oude rapporten inlezen) + avondherinnering — zonder server ==');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-mig-'));
  process.env.DATA_DIR = dir;
  const dbm = await import('../server/db.js');
  dbm.load();
  const d = dbm.db();
  d.settings.whatsappOrderGroups = ['raf breda'];
  const nu = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const mkOrder = (o) => ({ id: dbm.id('ord'), createdAt: iso(nu - 20 * DAG), updatedAt: iso(nu - 20 * DAG), source: 'DRS WhatsApp groep', originGroup: 'Raf breda en vliegende keer Rhenen straal 30 KM', ...o });
  const oud = mkOrder({ title: 'Oss — oud', status: 'afgerond', completedAt: iso(nu - 20 * DAG), intake: { address: '5345 HH Oss' } });
  const recentGemeld = mkOrder({ title: 'Etten-Leur — North Ridge', status: 'afgerond', completedAt: iso(nu - 4 * DAG), intake: { address: 'Industrieweg 4, 4879 NB Etten-Leur', name: 'North Ridge BV' } });
  const recentNiet = mkOrder({ title: 'Goirle — nieuw', status: 'afgerond', completedAt: iso(nu - DAG), intake: { address: '5051 TL Goirle' } });
  const ingeklapt = mkOrder({ title: 'Vlijmen — zaterdag', status: 'afgerond', completedAt: iso(nu - 2 * DAG), archivedWeek: { key: 'x', label: 'week' }, intake: { address: '5251 AE Vlijmen' } });
  d.orders.push(oud, recentGemeld, recentNiet, ingeklapt);
  const g = 'Raf breda en vliegende keer Rhenen straal 30 KM';
  const dag4 = nlDag(nu - 4 * DAG); const dag2 = nlDag(nu - 2 * DAG);
  d.messages.push({ id: 'm1', channel: 'whatsapp', group: g, sender: 'Key service 24/7', body: `*${kopVan(dag4)}*\n\n*Afgerond:*\n\n4879 NB Etten-Leur\n\n4421 BR Kapelle`, receivedAt: iso(nu - 4 * DAG + 3600000) });
  d.messages.push({ id: 'm2', channel: 'whatsapp', group: g, sender: 'Key service 24/7', body: `*${kopVan(dag2)}*\n\n*Afgerond:*\n\n4879 NB Etten-Leur\n\n5251AE Vlijmen`, receivedAt: iso(nu - 2 * DAG + 3600000) });
  const drs = await import('../server/drs-rapport.js');
  const res = drs.drsStartMigratie({ nu });
  ok('start: 2 oude rapporten uit de groep gelezen', res && res.gelezen === 2, JSON.stringify(res));
  ok('start: de echte dubbele melding van North Ridge wordt teruggevonden', res && res.dubbel === 1, JSON.stringify(res));
  ok('start: rapport-opdrachten afgevinkt met de datum uit de kop', recentGemeld.drsGemeld?.afgerond?.datum === dag4 && ingeklapt.drsGemeld?.afgerond?.datum === dag2, JSON.stringify([recentGemeld.drsGemeld, ingeklapt.drsGemeld]));
  ok('start: oude opdracht (>7 dagen) als gemeld aangenomen', oud.drsGemeld?.afgerond?.via === 'aangenomen');
  ok('start: recente, nooit gemelde opdracht blijft bij nog te melden', !recentNiet.drsGemeld && drs.nogTeMelden({ nu }).some((o) => o.id === recentNiet.id));
  ok('start: alarm uit het verleden zichtbaar (zonder push)', (d.settings._drsAlarmen || []).some((a) => a.postcode === '4879 NB' && a.terugkijken));
  ok('start draait maar één keer', drs.drsStartMigratie({ nu }) === null);
  // Statusscan-waarschuwing: nieuwe kaart op een adres dat kort geleden al als afgerond is gemeld.
  const nieuwOpAdres = mkOrder({ title: 'Etten-Leur — nieuwe klus', status: 'open', createdAt: iso(nu), intake: { address: 'Industrieweg 4, 4879 NB Etten-Leur' } });
  d.orders.push(nieuwOpAdres);
  const waarsch = drs.alAfgerondGemeldOpAdres(nieuwOpAdres, nu);
  ok('statusscan: waarschuwing als het adres al als afgerond gemeld is', waarsch && waarsch.postcode === '4879 NB' && waarsch.datum === dag4, JSON.stringify(waarsch));
  ok('statusscan: geen waarschuwing voor een ander adres', drs.alAfgerondGemeldOpAdres(recentNiet, nu) === null);
  // Avondherinnering: vóór het uur niets, erna één keer per dag.
  const om = (uurNL) => { const t = new Date(`${nlDag(nu)}T12:00:00Z`); const off = Number(t.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false })) - 12; return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), uurNL - off, 30)); };
  ok('herinnering: om 18:30 nog niet', drs.drsHerinneringVerschuldigd({ nu: om(18) }) === null);
  const h = drs.drsHerinneringVerschuldigd({ nu: om(21) });
  ok('herinnering: om 21:30 wel, met aantal', h && h.aantal >= 1, JSON.stringify(h));
  d.settings._drsHerinneringDag = nlDag(om(21));
  ok('herinnering: maar één keer per dag', drs.drsHerinneringVerschuldigd({ nu: om(22) }) === null);
  d.settings.drsRapport = { herinnering: false };
  d.settings._drsHerinneringDag = '';
  ok('herinnering uit = nooit', drs.drsHerinneringVerschuldigd({ nu: om(22) }) === null);
  // Leeslogica los: kop zonder sterretjes, kopje met postcode op dezelfde regel, opsomming.
  const l = drs.leesRapport('Woensdag 14-10\nAfgerond: 4007 RS Tiel\n- 7091 DV Dinxperlo\nGeannuleerd\n1. 7543 ZM Enschede, niet geïnteresseerd', new Date(`${nlDag(nu).slice(0, 4)}-10-14T20:00:00Z`));
  ok('lezen: kopje met postcode op dezelfde regel + opsomming', l.posten.map((p) => `${p.cat}:${p.postcode}`).join(',') === 'afgerond:4007RS,afgerond:7091DV,geannuleerd:7543ZM', JSON.stringify(l.posten));
  ok('lezen: datum uit de kop', l.datum.endsWith('-10-14'), l.datum);
  // Afzender-poort op hele woorden (review 16 okt): "Ali" telt niet in "Natalie DRS".
  d.users.push({ id: 'u-ali', role: 'assistent', name: 'Ali' }, { id: 'u-anna', role: 'admin', name: 'Anna de Vries' });
  ok('afzender: "Natalie DRS" en "Johanna | DRS planning" zijn niet van ons', !drs.afzenderVanOns('Natalie DRS') && !drs.afzenderVanOns('Johanna | DRS planning'));
  ok('afzender: "Ali", "Anna de Vries" en "Key service 24/7" wel', drs.afzenderVanOns('Ali') && drs.afzenderVanOns('Anna de Vries') && drs.afzenderVanOns('Key service 24/7'));
  // Melding van > 45 dagen geleden op hetzelfde adres → geen dubbel-alarm (terugkerend adres).
  const oudGemeld = mkOrder({ title: 'Oss — lang geleden', status: 'afgerond', completedAt: iso(nu - 80 * DAG), intake: { address: '5347 AA Oss' }, drsGemeld: { afgerond: { datum: nlDag(nu - 80 * DAG), via: 'crm', at: iso(nu - 80 * DAG) } } });
  d.orders.push(oudGemeld);
  const alarmVoor = (d.settings._drsAlarmen || []).length;
  const rOud = drs.verwerkEigenDrsRapport({ body: `*${kopVan(nlDag(nu))}*\n*Afgerond:*\n5347 AA Oss`, group: g, receivedAt: iso(nu), messageId: 'oud-adres-1', sender: 'Key service 24/7' });
  // "Aangenomen" bij de start (Oss 5345 HH, 20 dagen) geeft ook geen alarm.
  const rAang = drs.verwerkEigenDrsRapport({ body: `*${kopVan(nlDag(nu))}*\n*Afgerond:*\n5345 HH Oss`, group: g, receivedAt: iso(nu), messageId: 'aangenomen-1', sender: 'Key service 24/7' });
  ok('bij de start "aangenomen" als gemeld → later gemeld geeft geen dubbel-alarm', /aangenomen/.test(rAang.regels[0].uitkomst), JSON.stringify(rAang.regels));
  ok('melding van 80 dagen geleden op hetzelfde adres → geen dubbel-alarm', (d.settings._drsAlarmen || []).length === alarmVoor && /lang geleden/.test(rOud.regels[0].uitkomst), JSON.stringify(rOud.regels));
  // Eenmalige start: een rapport gaat nooit over een kaart die pas later is aangemaakt.
  const later = mkOrder({ title: 'Oss — later aangemaakt', status: 'afgerond', createdAt: iso(nu), completedAt: iso(nu), intake: { address: '5346 AA Oss' } });
  d.orders.push(later);
  const rLater = drs.verwerkEigenDrsRapport({ body: `*${kopVan(nlDag(nu - 5 * DAG))}*\n*Afgerond:*\n5346 AA Oss`, group: g, receivedAt: iso(nu - 5 * DAG), messageId: 'later-1', sender: 'Key service 24/7' });
  ok('rapport van 5 dagen geleden vinkt geen kaart af die pas vandaag is aangemaakt', !later.drsGemeld && rLater.regels[0].uitkomst === 'onbekend', JSON.stringify(rLater.regels));
  // Weekgrenzen rond de klokwissel (25 okt 2026): aaneengesloten, geen gat en geen overlap.
  const wk = await import('../server/week.js');
  const w1 = wk.weekBounds(new Date('2026-10-21T12:00:00Z'));
  const w2 = wk.weekBounds(new Date('2026-10-28T12:00:00Z'));
  ok('week rond de klokwissel: ma 19-10 00:00 t/m ma 26-10 00:00 NL (geen gat op zondagavond)', new Date(w1.start).toISOString() === '2026-10-18T22:00:00.000Z' && new Date(w1.end).toISOString() === '2026-10-25T23:00:00.000Z' && w1.end === w2.start, JSON.stringify([new Date(w1.start).toISOString(), new Date(w1.end).toISOString(), new Date(w2.start).toISOString()]));
  const wm = wk.weekBounds(new Date('2026-03-25T12:00:00Z'));
  ok('week rond de klokwissel in maart: eindigt ma 30-03 00:00 NL (22:00 UTC)', new Date(wm.end).toISOString() === '2026-03-29T22:00:00.000Z', new Date(wm.end).toISOString());
  // Wekelijks inklappen (archive.js) — de week van 12 t/m 18 okt 2026, gesloten op ma 19-10.
  const arch = await import('../server/archive.js');
  d.settings.lastArchivedWeek = '';
  const mk2 = (o) => ({ id: dbm.id('ord'), createdAt: '2026-10-12T08:00:00.000Z', updatedAt: '2026-10-12T08:00:00.000Z', ...o });
  const zondag = mk2({ title: 'zondag-afspraak', status: 'afgerond', appointmentAt: '2026-10-18T10:00', completedAt: '2026-10-18T13:00:00.000Z' });
  const vroegKlaar = mk2({ title: 'vroeg klaar, afspraak stond later', status: 'afgerond', appointmentAt: '2026-10-22T10:00', completedAt: '2026-10-14T13:00:00.000Z' });
  const zonderDatum = mk2({ title: 'afspraak zonder datum', status: 'afspraak_ingepland' });
  const afspraakVolgende = mk2({ title: 'afspraak volgende week', status: 'afspraak_ingepland', appointmentAt: '2026-10-20T09:00' });
  const maandagKlaar = mk2({ title: 'maandag 00:10 afgerond', status: 'afgerond', completedAt: '2026-10-18T22:10:00.000Z' });
  const updVoor = zondag.updatedAt;
  d.orders.push(zondag, vroegKlaar, zonderDatum, afspraakVolgende, maandagKlaar);
  arch.runWeeklyArchive(new Date('2026-10-19T06:00:00Z'));
  ok('inklappen: afgerond met een afspraak op ZONDAG gaat in de week van die zondag', zondag.archivedWeek?.key === '2026-10-12', JSON.stringify(zondag.archivedWeek));
  ok('inklappen: afgerond met een (oude) latere afspraakdatum blijft niet wekenlang staan', vroegKlaar.archivedWeek?.key === '2026-10-12');
  ok('inklappen: afspraak-kaart ZONDER datum blijft staan', !zonderDatum.archivedWeek);
  ok('inklappen: afspraak van volgende week blijft staan', !afspraakVolgende.archivedWeek);
  ok('inklappen: maandag 00:10 afgerond hoort bij de nieuwe week', !maandagKlaar.archivedWeek);
  ok('inklappen verandert updatedAt niet meer (geen verschuiving in weektellingen)', zondag.updatedAt === updVoor);
  // "Openen deur …" is GEEN kopje (dan zou het kopje "open" de afgerond-lijst afsluiten): de
  // regel hoort gewoon bij Afgerond (postcode mag overal in de regel staan).
  const od = drs.leesRapport('Afgerond:\n4007 RS Tiel\nOpenen deur 5000 AA Tilburg').posten;
  ok('lezen: "Openen deur …" is geen kopje (regel blijft bij Afgerond)', od.length === 2 && od.every((p) => p.cat === 'afgerond'), JSON.stringify(od));
  // Offerte + Afspraken erbij (24 okt 2026): eenmalige migratie van een al opgeslagen instelling.
  d.settings.drsRapport = { kopjes: ['afgerond', 'geannuleerd'], herinnering: true, herinneringUur: 21, afzenders: [], emailAfzenders: ['planning@drs.nl'] };
  const offOud = mkOrder({ title: 'Breda — offerte oud', status: 'offerte_verzonden', statusSince: iso(nu - 10 * DAG), intake: { address: '4811 AA Breda' } });
  const afsNieuw = mkOrder({ title: 'Tilburg — afspraak', status: 'afspraak_ingepland', statusSince: iso(nu - 2 * DAG), appointmentAt: '2026-10-28T10:00', intake: { address: '5038 AA Tilburg' } });
  const afgOud = mkOrder({ title: 'Oss — afgerond oud', status: 'afgerond', completedAt: iso(nu - 10 * DAG), intake: { address: '5341 AA Oss' } });
  d.orders.push(offOud, afsNieuw, afgOud);
  const km = drs.drsKopjesMigratie({ nu });
  ok('kopjes-migratie: opgeslagen instelling krijgt Offerte + Afspraken erbij (rest blijft)', JSON.stringify(drs.getDrsRapportInstellingen().kopjes) === JSON.stringify(['afgerond', 'geannuleerd', 'offerte', 'afspraak']) && drs.getDrsRapportInstellingen().emailAfzenders.includes('planning@drs.nl'), JSON.stringify(d.settings.drsRapport));
  ok('kopjes-migratie: offerte die al >7 dagen in de kolom staat → als gemeld aangenomen', offOud.drsGemeld?.offerte?.via === 'aangenomen' && km?.aangenomen >= 1, JSON.stringify({ g: offOud.drsGemeld, km }));
  ok('kopjes-migratie: recente afspraak blijft bij nog te melden', !afsNieuw.drsGemeld && drs.nogTeMelden({ nu }).some((o) => o.id === afsNieuw.id));
  ok('kopjes-migratie: afgerond wordt niet aangeraakt (alleen de nieuwe kopjes)', !afgOud.drsGemeld);
  d.settings.drsRapport.kopjes = ['afgerond'];
  ok('kopjes-migratie draait maar één keer (latere keuze van de beheerder blijft)', drs.drsKopjesMigratie({ nu }) === null && JSON.stringify(drs.getDrsRapportInstellingen().kopjes) === '["afgerond"]');
  // INKLAPPEN ZONDER "AFGEHANDELD"-VINKJE (30 okt 2026): "Kolommen opslaan" wiste het vinkje
  // en daarna klapten Afgerond/Geannuleerd na zondag niet meer in.
  const st = await import('../server/settings.js');
  const kolommen = st.getStatuses().map((x) => ({ ...x, ...(x.key === 'offerte_verzonden' ? { noteRequired: false } : {}) }));
  const bewaard = st.sanitizeStatuses(kolommen.map(({ key, label, color }) => ({ key, label, color })), kolommen);
  ok('opslaan zonder vlaggen houdt "afgehandeld" én een eigen notitie-keuze', bewaard.find((x) => x.key === 'afgerond')?.secondary === true && bewaard.find((x) => x.key === 'nieuw')?.secondary === false && bewaard.find((x) => x.key === 'offerte_verzonden')?.noteRequired === false, JSON.stringify(bewaard));
  d.settings.statuses = kolommen.map((x) => ({ ...x, secondary: false })); // de kapotte situatie
  d.settings.lastArchivedWeek = '';
  const mk3 = (o) => ({ id: dbm.id('ord'), createdAt: '2026-10-20T08:00:00.000Z', updatedAt: '2026-10-20T08:00:00.000Z', ...o });
  const gean = mk3({ title: 'geannuleerd in week 19-25 okt', status: 'geannuleerd', cancelledAt: '2026-10-21T10:00:00.000Z' });
  const afg = mk3({ title: 'afgerond in week 19-25 okt', status: 'afgerond', completedAt: '2026-10-22T10:00:00.000Z' });
  d.orders.push(gean, afg);
  arch.runWeeklyArchive(new Date('2026-10-26T06:00:00Z'));
  ok('zonder vinkje klappen Afgerond en Geannuleerd na zondag tóch in (week 19-25 okt)', gean.archivedWeek?.key === '2026-10-19' && afg.archivedWeek?.key === '2026-10-19', JSON.stringify([gean.archivedWeek, afg.archivedWeek]));
  // Inhaalslag: blijven hangende afgehandelde opdrachten uit eerdere weken → elk in hun eigen week.
  delete d.settings._archiefInhaalV1;
  const oud1 = mk3({ title: 'geannuleerd 7 okt', status: 'geannuleerd', cancelledAt: '2026-10-07T10:00:00.000Z' });
  const oud2 = mk3({ title: 'afgerond 14 okt', status: 'afgerond', completedAt: '2026-10-14T10:00:00.000Z' });
  const ditWeek = mk3({ title: 'geannuleerd deze week', status: 'geannuleerd', cancelledAt: '2026-10-28T10:00:00.000Z' });
  const lopend = mk3({ title: 'nog open', status: 'open' });
  d.orders.push(oud1, oud2, ditWeek, lopend);
  const ih = arch.archiefInhaalslag(new Date('2026-10-30T12:00:00Z'));
  ok('inhaalslag: oude afgehandelde opdrachten gaan in de bundel van hun eigen week', oud1.archivedWeek?.key === '2026-10-05' && oud2.archivedWeek?.key === '2026-10-12' && /5 t\/m 11 okt/.test(oud1.archivedWeek?.label || ''), JSON.stringify([oud1.archivedWeek, oud2.archivedWeek]));
  ok('inhaalslag: deze week afgehandeld blijft staan tot zondag, open blijft altijd staan', !ditWeek.archivedWeek && !lopend.archivedWeek);
  ok('inhaalslag draait maar één keer', !!ih && ih.n >= 2 && arch.archiefInhaalslag(new Date('2026-10-30T12:00:00Z')) === null, JSON.stringify(ih));
  // Herstel bij het opstarten: het vinkje komt één keer terug (tweede rij "Afgehandeld" op het bord).
  delete d.settings.statusesSecondaryV3;
  st.ensureSettings();
  ok('herstel bij opstarten: Afgerond/Geannuleerd weer "afgehandeld"', st.getStatuses().filter((x) => ['afgerond', 'geannuleerd'].includes(x.key)).every((x) => x.secondary === true), JSON.stringify(st.getStatuses().map((x) => [x.key, x.secondary])));
}

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
