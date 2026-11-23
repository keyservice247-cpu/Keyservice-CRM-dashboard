// Test: automatische boekingen in Cijfers — betaalde factuur -> omzet (excl. btw,
// juiste bron/monteur), afgeronde DRS-kaart -> vaste fee. Idempotent (nooit dubbel).
// Draait tegen een verse lokale server op PORT=3123.
const BASE = 'http://localhost:3123';
const TOKEN = 'test123';
let cookie = '';
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }
async function api(method, path, body, useToken = false) {
  const headers = { 'content-type': 'application/json' };
  if (useToken) headers['x-ingest-token'] = TOKEN;
  else if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie'); if (setC) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}

await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });
await api('PATCH', '/api/settings', { whatsappOrderGroups: 'raf breda', autoMergeWindowHours: 0 });

console.log('\n== DRS-kaart afronden -> automatische fee-boeking ==');
const sIn = await api('POST', '/api/ingest/whatsapp', {
  group: 'groep 120363177872957422', name: 'Fee Klant',
  body: 'Fee Klant, Feestraat 1, 3911 AB Rhenen, 0622334455, slot vervangen graag',
  externalId: 'fee1',
}, true);
const rev = sIn.json.reviewId ? (await api('POST', `/api/reviews/${sIn.json.reviewId}/approve`, {})).json : null;
const ordId = rev?.order?.id || (await api('GET', '/api/orders')).json.find((o) => (o.intake?.phone || '').includes('0622334455'))?.id;
ok('DRS-kaart aangemaakt', !!ordId);
await api('PATCH', `/api/orders/${ordId}`, { status: 'afgerond' });

console.log('\n== Betaalde factuur -> automatische omzet-boeking ==');
const inv = (await api('POST', '/api/invoices', { customerId: (await api('GET', '/api/orders')).json.find((o) => o.id === ordId).customerId, type: 'factuur', orderId: ordId })).json;
const invId = (inv.invoice || inv).id;
await api('PATCH', `/api/invoices/${invId}`, { lines: [{ description: 'Slot vervangen', qty: 1, priceExcl: 200 }], btwPct: 21, note: '' });
await api('POST', `/api/invoices/${invId}/status`, { status: 'verzonden' });
await api('POST', `/api/invoices/${invId}/status`, { status: 'betaald' });
const run1 = await api('POST', '/api/finance/autosync', {});
ok('autosync boekt 1 omzet + 1 fee', run1.json.income === 1 && run1.json.fees === 1, JSON.stringify(run1.json));
const month = new Date().toISOString().slice(0, 7);
const fin = (await api('GET', `/api/finance?month=${month}`)).json;
const entries = fin.report?.entries || [];
const omzet = entries.find((e) => e.kind === 'income' && /Factuur/.test(e.note || ''));
ok('omzet geboekt: € 200 excl. btw, bron DRS opdracht', omzet && omzet.amount === 200 && omzet.category === 'DRS opdracht', JSON.stringify(omzet));
const fee = entries.find((e) => e.kind === 'expense' && e.category === 'Fee per opdracht');
ok('DRS-fee geboekt: € 42,50 gekoppeld aan de kaart', fee && fee.amount === 42.5 && fee.orderId === ordId, JSON.stringify(fee));

console.log('\n== Idempotent: tweede run boekt NIETS dubbel ==');
const run2 = await api('POST', '/api/finance/autosync', {});
ok('tweede run: 0 nieuwe boekingen', run2.json.income === 0 && run2.json.fees === 0, JSON.stringify(run2.json));
const fin2 = (await api('GET', `/api/finance?month=${month}`)).json;
const cnt = (fin2.report?.entries || []).filter((e) => e.sourceRef).length;
ok('nog steeds precies 2 automatische boekingen', cnt === 2, `count=${cnt}`);

console.log('\n== Uitzetten werkt ==');
await api('POST', '/api/finance/settings', { autoSync: false, drsFeePerJob: 42.5 });
const run3 = await api('POST', '/api/finance/autosync', {});
ok('autoSync uit -> run doet niets', run3.json.income === 0 && run3.json.fees === 0);

console.log('\n== Terugwerkend boeken: voorbeeld + selectie + dubbel-waarschuwing ==');
// Tweede DRS-kaart + betaalde factuur, maar dan met autoSync UIT: die worden dus
// NIET automatisch geboekt en moeten via het terugwerkende scherm te halen zijn.
const sIn2 = await api('POST', '/api/ingest/whatsapp', {
  group: 'groep 120363177872957422', name: 'Historie Klant',
  body: 'Historie Klant, Oudestraat 9, 3911 XX Rhenen, 0644556677, cilinder vervangen',
  externalId: 'hist1',
}, true);
const rev2 = sIn2.json.reviewId ? (await api('POST', `/api/reviews/${sIn2.json.reviewId}/approve`, {})).json : null;
const ordId2 = rev2?.order?.id;
await api('PATCH', `/api/orders/${ordId2}`, { status: 'afgerond' });
const cust2 = (await api('GET', '/api/orders')).json.find((o) => o.id === ordId2).customerId;
const inv2 = (await api('POST', '/api/invoices', { customerId: cust2, type: 'factuur', orderId: ordId2 })).json;
const invId2 = (inv2.invoice || inv2).id;
await api('PATCH', `/api/invoices/${invId2}`, { lines: [{ description: 'Cilinder', qty: 1, priceExcl: 150 }], btwPct: 21, note: '' });
await api('POST', `/api/invoices/${invId2}/status`, { status: 'verzonden' });
await api('POST', `/api/invoices/${invId2}/status`, { status: 'betaald' });
// Handmatige boeking van hetzelfde bedrag -> moet als mogelijke dubbel gemeld worden.
await api('POST', '/api/finance', { kind: 'income', amount: 150, category: 'Overig', date: new Date().toISOString().slice(0, 10), note: 'handmatig geboekt' });

const prev = await api('GET', '/api/finance/autosync/preview?since=2000-01-01');
ok('voorbeeld toont de niet-geboekte historie', prev.status === 200 && prev.json.items.length >= 2, JSON.stringify(prev.json.totals));
const dupItem = (prev.json.items || []).find((x) => x.sourceRef === `inv:${invId2}`);
ok('mogelijke dubbel gemarkeerd (zelfde bedrag, zelfde maand, handmatig)', !!dupItem && !!dupItem.possibleDuplicate, JSON.stringify(dupItem?.possibleDuplicate));
ok('totalen kloppen (omzet + kosten apart)', prev.json.totals.income >= 150 && prev.json.totals.expense >= 42.5, JSON.stringify(prev.json.totals));

// Alleen de FEE-regel boeken (de factuur-regel bewust niet — die was al handmatig).
const feeRef = `drsfee:${ordId2}`;
const applied = await api('POST', '/api/finance/autosync/apply', { refs: [feeRef] });
ok('alleen de geselecteerde regel wordt geboekt', applied.json.fees === 1 && applied.json.income === 0, JSON.stringify(applied.json));
const prev2 = await api('GET', '/api/finance/autosync/preview?since=2000-01-01');
ok('geboekte regel verdwijnt uit het voorbeeld', !(prev2.json.items || []).some((x) => x.sourceRef === feeRef));
ok('niet-geselecteerde regel staat er nog steeds', (prev2.json.items || []).some((x) => x.sourceRef === `inv:${invId2}`));

console.log('\n== Omzet-suggesties weigeren (niet meer voorstellen) ==');
await api('POST', '/api/monteurs', { name: 'Rapport Monteur', phone: '0611223300', waGroup: 'Rapport Groep' });
await api('POST', '/api/ingest/whatsapp', {
  group: 'Rapport Groep', name: 'Rapport Monteur',
  body: 'Dagrapport\nAfgerond 3911 AB Rhenen €450 pin\nAfgerond 3912 CD Veenendaal €75 lips kosten',
  externalId: 'rap1',
}, true);
const sug1 = await api('GET', `/api/finance/suggest-income?month=${month}`);
const sugList = sug1.json.suggestions || [];
ok('bedragen uit het monteursrapport worden voorgesteld', sugList.length >= 2, JSON.stringify(sugList.map((s) => s.amount)));
const target = sugList.find((s) => s.amount === 450);
ok('slimme gok: "pin" telt als omzet', !!target && target.guess === 'income');
const dis = await api('POST', '/api/finance/dismiss-income', { refs: [target.ref] });
ok('weigeren geaccepteerd', dis.json.dismissed === 1);
const sug2 = await api('GET', `/api/finance/suggest-income?month=${month}`);
ok('geweigerd bedrag wordt niet meer voorgesteld', !(sug2.json.suggestions || []).some((s) => s.ref === target.ref));

console.log('\n== Bedragen zonder duizendpunt + DRS-fee voor geplakte opdracht (audit 3 okt) ==');
await api('POST', '/api/ingest/whatsapp', {
  group: 'Rapport Groep', name: 'Rapport Monteur',
  body: 'Dagrapport\nAfgerond 3911 AB Rhenen €1250 pin\nAfgerond 3912 CD Veenendaal €1.800,50 pin\nOfferte 3913 EF Ede €2000',
  externalId: 'rap2',
}, true);
const sug3 = ((await api('GET', `/api/finance/suggest-income?month=${month}`)).json.suggestions || []).map((s) => s.amount);
ok('€1250 → 1250 (niet 125), €1.800,50 → 1800,5, €2000 → 2000', sug3.includes(1250) && sug3.includes(1800.5) && sug3.includes(2000) && !sug3.includes(125) && !sug3.includes(200), JSON.stringify(sug3));
const plak = await api('POST', '/api/orders/paste', { text: 'Naam: Plak Klant\nAdres: Plakstraat 4\nWoonplaats: Rhenen\nTelefoon: 0655566677\nOpmerkingen: slot vervangen' });
const plakId = plak.json?.id;
ok('plak-opdracht aangemaakt', !!plakId, JSON.stringify(plak.json).slice(0, 150));
await api('PATCH', `/api/orders/${plakId}`, { status: 'afgerond' });
const prev3 = await api('GET', '/api/finance/autosync/preview?since=2000-01-01');
ok('afgeronde geplakte DRS-opdracht krijgt een DRS-fee', (prev3.json.items || []).some((x) => x.sourceRef === `drsfee:${plakId}`), JSON.stringify((prev3.json.items || []).map((x) => x.sourceRef)));

console.log('\n== Facturen deze maand: omzet verstuurd / betaald / openstaand (23 nov 2026) ==');
// Besluit eigenaar: "omzet moet zijn verstuurde facturen, met daarnaast welke facturen zijn
// betaald". Een kijk op de facturen zelf, naast de boekingen (die blijven zoals ze zijn).
{
  const bijna = (a, b) => Math.abs((Number(a) || 0) - b) < 0.005;
  // 1) De rekenregel zelf, zonder server: maandgrens in NEDERLANDSE tijd en wat wel/niet telt.
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'crm-cijfers-'));
  const { facturenOmzet } = await import('../server/finance.js');
  const f = (o) => ({ type: 'factuur', status: 'betaald', lines: [{ description: 'x', qty: 1, priceExcl: 100 }], totalExcl: 100, totalIncl: 121, ...o });
  const lijst = [
    f({ id: 'a', number: 'A', sentAt: '2026-10-05T10:00:00.000Z', paidAt: '2026-10-05T10:00:00.000Z' }),                 // verstuurd + betaald in oktober
    f({ id: 'b', number: 'B', status: 'verzonden', sentAt: '2026-10-20T10:00:00.000Z', totalExcl: 200, totalIncl: 242 }), // verstuurd in oktober, nog open
    f({ id: 'c', number: 'C', sentAt: '2026-09-28T10:00:00.000Z', paidAt: '2026-10-02T10:00:00.000Z', totalExcl: 50, totalIncl: 60.5 }), // verstuurd sept, betaald okt
    f({ id: 'd', number: 'D', paidAt: '2026-10-10T10:00:00.000Z', totalExcl: 30, totalIncl: 36.3 }),                     // betaald in oktober, nooit verstuurd
    f({ id: 'e', number: 'E', sentAt: '2026-10-31T23:30:00.000Z', paidAt: '2026-10-31T23:30:00.000Z' }),                 // 1 nov 00:30 NL → november
    f({ id: 'g', number: 'G', sentAt: '2026-09-30T22:30:00.000Z', paidAt: '2026-09-30T22:30:00.000Z', totalExcl: 10, totalIncl: 12.1 }), // 1 okt 00:30 NL → oktober
    f({ id: 'h', number: 'OFF', type: 'offerte', status: 'verzonden', sentAt: '2026-10-06T10:00:00.000Z' }),             // offerte: telt nooit
    f({ id: 'i', number: 'CON', status: 'concept', paidAt: '2026-10-06T10:00:00.000Z' }),                                // concept: telt nooit
    f({ id: 'j', number: 'AF', status: 'oninbaar', sentAt: '2026-10-07T10:00:00.000Z' }),                                // afgeschreven: telt nooit
    f({ id: 'k', number: 'LEEG', lines: [], totalExcl: 0, totalIncl: 0, paidAt: '2026-10-08T10:00:00.000Z' }),           // lege factuur (nooit verstuurd): telt niet
  ];
  const okt = facturenOmzet('2026-10', { invoices: lijst, klantNaam: (i) => `Klant ${i.number}` });
  ok('verstuurd in oktober: 3 facturen, € 310 excl. / € 375,10 incl.', okt.verstuurd.aantal === 3 && bijna(okt.verstuurd.exclBtw, 310) && bijna(okt.verstuurd.inclBtw, 375.1), JSON.stringify(okt.verstuurd));
  ok('betaald in oktober: 4 facturen, € 190 excl. / € 229,90 incl.', okt.betaald.aantal === 4 && bijna(okt.betaald.exclBtw, 190) && bijna(okt.betaald.inclBtw, 229.9), JSON.stringify(okt.betaald));
  ok('openstaand = in oktober verstuurd en nog niet betaald: 1 factuur, € 242 incl.', okt.openstaand.aantal === 1 && bijna(okt.openstaand.inclBtw, 242), JSON.stringify(okt.openstaand));
  ok('lijsten: nieuwste eerst (verstuurd op verzenddatum, betaald op betaaldatum)', okt.verstuurd.facturen.map((x) => x.id).join() === 'b,a,g' && okt.betaald.facturen.map((x) => x.id).join() === 'd,a,c,g', JSON.stringify([okt.verstuurd.facturen.map((x) => x.id), okt.betaald.facturen.map((x) => x.id)]));
  const rijB = okt.verstuurd.facturen[0];
  ok('regel draagt nummer, klant, datum, status en bedragen', rijB.number === 'B' && rijB.klant === 'Klant B' && rijB.sentAt === '2026-10-20T10:00:00.000Z' && rijB.status === 'verzonden' && rijB.exclBtw === 200 && rijB.inclBtw === 242, JSON.stringify(rijB));
  ok('offerte, concept, afgeschreven en lege factuur staan nergens', !JSON.stringify(okt).match(/"(OFF|CON|AF|LEEG)"/));
  const nov = facturenOmzet('2026-11', { invoices: lijst });
  ok('maandgrens in Nederlandse tijd: 31 okt 23:30 UTC telt in november', nov.verstuurd.aantal === 1 && nov.betaald.aantal === 1 && nov.verstuurd.facturen[0].id === 'e', JSON.stringify([nov.verstuurd.aantal, nov.betaald.aantal]));
  const veel = Array.from({ length: 250 }, (_, n) => f({ id: `v${n}`, number: `V${n}`, sentAt: `2026-08-${String(1 + (n % 28)).padStart(2, '0')}T10:00:00.000Z`, paidAt: null, status: 'verzonden' }));
  const aug = facturenOmzet('2026-08', { invoices: veel });
  ok('lijst hooguit 200 regels, de totalen tellen alles', aug.verstuurd.aantal === 250 && aug.verstuurd.facturen.length === 200 && bijna(aug.verstuurd.exclBtw, 25000) && aug.openstaand.aantal === 250, JSON.stringify([aug.verstuurd.aantal, aug.verstuurd.facturen.length, aug.verstuurd.exclBtw]));
  const nlMaand = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 7);
  ok('zonder (geldige) maand: de lopende maand', facturenOmzet('', { invoices: [] }).maand === nlMaand && facturenOmzet('onzin', { invoices: [] }).maand === nlMaand);

  // 2) Via de server: echte facturen in elke stand; we meten het VERSCHIL met vooraf.
  const haal = async (m = nlMaand) => (await api('GET', `/api/finance/facturen-omzet?maand=${m}`)).json;
  const voor = await haal();
  ok('route geeft de drie blokken voor deze maand', voor.maand === nlMaand && Array.isArray(voor.verstuurd?.facturen) && Array.isArray(voor.betaald?.facturen) && typeof voor.openstaand?.aantal === 'number', JSON.stringify(voor).slice(0, 200));
  const kF = (await api('POST', '/api/customers', { name: 'Omzet Klant', phone: '0612349001' })).json;
  const maak = async (type, excl) => {
    const i = (await api('POST', '/api/invoices', { customerId: kF.id, type })).json.invoice;
    if (excl) await api('PATCH', `/api/invoices/${i.id}`, { lines: [{ description: 'Werk', qty: 1, priceExcl: excl }], btwPct: 21, note: '' });
    return i;
  };
  const A = await maak('factuur', 100); await api('POST', `/api/invoices/${A.id}/send-whatsapp`, { betaald: true });  // verstuurd + betaald
  const B = await maak('factuur', 200); await api('POST', `/api/invoices/${B.id}/send-whatsapp`, { betaald: false }); // verstuurd, nog open
  const C = await maak('factuur', 50);                                                                                // betaald (standaard), niet verstuurd
  const D = await maak('factuur', 999); await api('POST', `/api/invoices/${D.id}/status`, { status: 'concept' });     // concept
  const E = await maak('offerte', 300); await api('POST', `/api/invoices/${E.id}/send-whatsapp`, {});                 // verstuurde offerte
  const F = await maak('factuur', 400); await api('POST', `/api/invoices/${F.id}/send-whatsapp`, { betaald: false });
  await api('POST', `/api/invoices/${F.id}/status`, { status: 'oninbaar', reden: 'test' });                           // afgeschreven
  const G = await maak('factuur', 0);                                                                                 // lege factuur (staat op betaald, geen regels)
  const na = await haal();
  const d = (blok, veld) => (na[blok][veld] || 0) - (voor[blok][veld] || 0);
  ok('verstuurd: +2 facturen, +€ 300 excl. btw (+€ 363 incl.)', d('verstuurd', 'aantal') === 2 && bijna(d('verstuurd', 'exclBtw'), 300) && bijna(d('verstuurd', 'inclBtw'), 363), JSON.stringify([d('verstuurd', 'aantal'), d('verstuurd', 'exclBtw'), d('verstuurd', 'inclBtw')]));
  ok('betaald: +2 facturen, +€ 150 excl. btw (+€ 181,50 incl.)', d('betaald', 'aantal') === 2 && bijna(d('betaald', 'exclBtw'), 150) && bijna(d('betaald', 'inclBtw'), 181.5), JSON.stringify([d('betaald', 'aantal'), d('betaald', 'exclBtw'), d('betaald', 'inclBtw')]));
  ok('openstaand: +1 factuur, +€ 242 incl. btw', d('openstaand', 'aantal') === 1 && bijna(d('openstaand', 'inclBtw'), 242), JSON.stringify(na.openstaand));
  const vIds = na.verstuurd.facturen.map((x) => x.id); const bIds = na.betaald.facturen.map((x) => x.id);
  ok('lijst Verstuurd: A en B (nieuwste eerst), met klantnaam en bedrag excl. btw', vIds.includes(A.id) && vIds.includes(B.id) && vIds.indexOf(B.id) < vIds.indexOf(A.id) && na.verstuurd.facturen.find((x) => x.id === B.id)?.klant === 'Omzet Klant' && na.verstuurd.facturen.find((x) => x.id === B.id)?.exclBtw === 200 && na.verstuurd.facturen.find((x) => x.id === B.id)?.status === 'verzonden', JSON.stringify(na.verstuurd.facturen.slice(0, 3)));
  ok('lijst Betaald: A en C, niet de nog open B', bIds.includes(A.id) && bIds.includes(C.id) && !bIds.includes(B.id) && !!na.betaald.facturen.find((x) => x.id === C.id)?.paidAt);
  ok('offerte, concept, afgeschreven en lege factuur tellen nergens mee', ![...vIds, ...bIds].some((x) => [D.id, E.id, F.id, G.id].includes(x)));
  const oud = await haal('2020-01');
  ok('andere maand (2020-01): niets', oud.maand === '2020-01' && oud.verstuurd.aantal === 0 && oud.betaald.aantal === 0 && oud.openstaand.aantal === 0 && oud.verstuurd.exclBtw === 0, JSON.stringify(oud));
  // B wordt betaald → schuift naar "betaald", staat niet meer open.
  await api('POST', `/api/invoices/${B.id}/status`, { status: 'betaald' });
  const na2 = await haal();
  ok('factuur alsnog betaald: telt bij Betaald, niet meer bij openstaand', na2.betaald.aantal - voor.betaald.aantal === 3 && na2.openstaand.aantal === voor.openstaand.aantal && na2.verstuurd.aantal === na.verstuurd.aantal, JSON.stringify([na2.betaald.aantal, na2.openstaand.aantal]));
  // De boekingen (de bestaande cijfers) zijn hier niet door veranderd.
  const fin3 = (await api('GET', `/api/finance?month=${nlMaand}`)).json;
  ok('de bestaande maandcijfers (boekingen) werken ongewijzigd door', typeof fin3.report?.income === 'number' && Array.isArray(fin3.report?.entries));
  // Rechten: alleen wie Cijfers mag zien.
  const admin = cookie;
  await api('POST', '/api/users', { name: 'Assistente Cijfers', email: 'asscijfers@keyservice.nl', password: 'ass12345', role: 'assistent' });
  await api('POST', '/api/users', { name: 'Monteur Cijfers', email: 'montcijfers@keyservice.nl', password: 'monteur123', role: 'monteur' });
  cookie = '';
  ok('niet ingelogd → 401', (await api('GET', '/api/finance/facturen-omzet')).status === 401);
  await api('POST', '/api/login', { email: 'asscijfers@keyservice.nl', password: 'ass12345' });
  ok('assistente (geen recht op Cijfers) → 403', (await api('GET', `/api/finance/facturen-omzet?maand=${nlMaand}`)).status === 403);
  cookie = '';
  await api('POST', '/api/login', { email: 'montcijfers@keyservice.nl', password: 'monteur123' });
  ok('monteur → 403', (await api('GET', `/api/finance/facturen-omzet?maand=${nlMaand}`)).status === 403);
  cookie = admin;
}

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
