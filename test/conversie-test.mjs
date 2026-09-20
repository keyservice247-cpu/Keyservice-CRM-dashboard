// Test: CONVERSIE (20 sep 2026) — hoeveel van de binnengekomen aanvragen wordt écht
// uitgevoerd? Seedt opdrachten uit verschillende bronnen met verschillende uitkomsten
// en controleert de tellingen, percentages, bron-labels, weekcohorten, briefing
// (zonder AI-sleutel = feiten-tekst) en de Cijfers-correcties (bron van automatische
// omzet, datum in Nederlandse tijd). Draait tegen een verse server op PORT=3139.
const BASE = 'http://localhost:3139';
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
const nlVandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });

console.log('\n== Zonder login: geen cijfers ==');
const anon = await api('GET', '/api/conversie');
ok('GET /api/conversie zonder login -> 401', anon.status === 401, `status=${anon.status}`);

await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });
await api('PATCH', '/api/settings', { whatsappOrderGroups: 'raf breda', autoMergeWindowHours: 0, aiAutoApproveThreshold: 0 });
// De verse test-DB bevat voorbeeldopdrachten (seed). Die gaan naar de prullenbak zodat
// de tellingen hieronder exact zijn — én dat bewijst meteen dat de prullenbak niet meetelt.
for (const o of (await api('GET', '/api/orders?includeArchived=1')).json) await api('DELETE', `/api/orders/${o.id}`);

console.log('\n== Lege staat (voorbeeldopdrachten in de prullenbak tellen niet mee) ==');
const leeg = (await api('GET', '/api/conversie?dagen=30')).json;
ok('lege staat: 0 binnen, conversie null, patroon "geen aanvragen"', leeg.totaal.binnen === 0 && leeg.totaal.conversie === null && /geen aanvragen/i.test(leeg.patronen[0] || ''), JSON.stringify(leeg.totaal));
ok('periode-clamp: dagen=1 -> 7, dagen=9999 -> 730', (await api('GET', '/api/conversie?dagen=1')).json.periode.dagen === 7 && (await api('GET', '/api/conversie?dagen=9999')).json.periode.dagen === 730);

console.log('\n== Seed: 3 DRS-opdrachten, 1 website-lead, 1 handmatige opdracht ==');
const mont = (await api('POST', '/api/monteurs', { name: 'Youssef Test', phone: '0612121212' })).json;
const montId = mont?.id || mont?.monteur?.id;
const drsIds = [];
for (const [i, naam] of ['Aad', 'Bep', 'Cor'].entries()) {
  const s = await api('POST', '/api/ingest/whatsapp', {
    group: 'groep 120363177872957422', name: `${naam} Klant`,
    body: `${naam} Klant, Teststraat ${i + 1}, 3911 AB Rhenen, 06${String(30000000 + i).padStart(8, '0')}, slot vervangen graag`,
    externalId: `cv-drs-${i}`,
  }, true);
  const rev = (await api('POST', `/api/reviews/${s.json.reviewId}/approve`, {})).json;
  drsIds.push(rev?.order?.id);
}
ok('3 DRS-kaarten aangemaakt', drsIds.every(Boolean), JSON.stringify(drsIds));
await api('PATCH', `/api/orders/${drsIds[0]}`, { status: 'afgerond', monteurId: montId });
await api('PATCH', `/api/orders/${drsIds[1]}`, { status: 'afgerond', monteurId: montId });
await api('PATCH', `/api/orders/${drsIds[2]}`, { status: 'geannuleerd' });
const web = await api('POST', '/api/ingest/form?token=' + TOKEN, { name: 'Nora Web', phone: '0655555555', email: 'nora@example.nl', city: 'Breda', message: 'Schuifpui klemt, graag offerte', formType: 'offerte' });
const webRev = (await api('POST', `/api/reviews/${web.json.reviewId}/approve`, {})).json;
ok('website-lead goedgekeurd (blijft open)', !!webRev?.order?.id, JSON.stringify(web.json));
const hand = (await api('POST', '/api/orders', { title: 'Rhenen — handmatig slot', status: 'nieuw', description: 'test', source: 'Handmatig', customerName: 'Hand Klant', customerPhone: '0699999999' })).json;
const handId = hand?.id || hand?.order?.id;
ok('handmatige kaart aangemaakt', !!handId, JSON.stringify(hand).slice(0, 200));
await api('PATCH', `/api/orders/${handId}`, { status: 'afgerond', price: '150' });
// Factuur (verzonden, excl. 200) op de eerste DRS-kaart → omzet telt via de factuur.
const ord0 = (await api('GET', '/api/orders')).json.find((o) => o.id === drsIds[0]);
const inv = (await api('POST', '/api/invoices', { customerId: ord0.customerId, type: 'factuur', orderId: drsIds[0] })).json;
const invId = (inv.invoice || inv).id;
await api('PATCH', `/api/invoices/${invId}`, { lines: [{ description: 'Slot vervangen', qty: 1, priceExcl: 200 }], btwPct: 21, note: '' });
await api('POST', `/api/invoices/${invId}/status`, { status: 'verzonden' });

console.log('\n== Tellingen en percentages (30 dagen) ==');
const c = (await api('GET', '/api/conversie?dagen=30')).json;
const t = c.totaal;
ok('binnen 5 · afgerond 3 · geannuleerd 1 · open 1', t.binnen === 5 && t.afgerond === 3 && t.geannuleerd === 1 && t.open === 1, JSON.stringify(t));
ok('conversie van beslist = 75% (3 van 4)', t.conversie === 75, `${t.conversie}`);
ok('conversie van alles = 60% (3 van 5)', t.conversieTotaal === 60, `${t.conversieTotaal}`);
ok('vorige periode leeg → delta binnen +5, delta conversie null', c.delta.binnen === 5 && c.delta.conversie === null, JSON.stringify(c.delta));
const drs = c.perBron.find((b) => b.naam === 'DRS-groep');
const site = c.perBron.find((b) => b.naam === 'Website');
const handB = c.perBron.find((b) => b.naam === 'Handmatig');
ok('per bron: DRS-groep 3 binnen / 2 afgerond / 1 geannuleerd = 66,7%', drs && drs.binnen === 3 && drs.afgerond === 2 && drs.geannuleerd === 1 && drs.conversie === 66.7, JSON.stringify(drs));
ok('per bron: Website 1 open, conversie nog onbekend (null)', site && site.binnen === 1 && site.open === 1 && site.conversie === null, JSON.stringify(site));
ok('per bron: Handmatig 1 afgerond = 100%', handB && handB.afgerond === 1 && handB.conversie === 100, JSON.stringify(handB));
ok('per bron gesorteerd op instroom (DRS-groep bovenaan)', c.perBron[0]?.naam === 'DRS-groep');
const mY = c.perMonteur.find((m) => m.naam === 'Youssef Test');
const mG = c.perMonteur.find((m) => m.naam === 'Geen monteur');
ok('per monteur: Youssef 2 afgerond (100%), zonder monteur 3', mY && mY.afgerond === 2 && mY.conversie === 100 && mG && mG.binnen === 3, JSON.stringify(c.perMonteur));
const stNieuw = c.perStatus.find((s) => s.key === 'nieuw');
const stAfg = c.perStatus.find((s) => s.key === 'afgerond');
ok('per status: nieuw 1 (20%), afgerond 3 (60%)', stNieuw && stNieuw.count === 1 && stNieuw.pct === 20 && stAfg && stAfg.count === 3 && stAfg.pct === 60, JSON.stringify(c.perStatus));
ok('weekcohorten: 12 weken, som binnen = 5, laatste week 5', c.perWeek.length === 12 && c.perWeek.reduce((s, w) => s + w.binnen, 0) === 5 && c.perWeek[11].binnen === 5, JSON.stringify(c.perWeek.slice(-2)));
ok('weeklabels zijn maandagen', c.perWeek.every((w) => new Date(w.week + 'T00:00:00Z').getUTCDay() === 1));
ok('omzet afgerond = 350 (factuur 200 excl. + prijsveld 150), 2 afgerond zonder factuur', c.waarde.omzetAfgerond === 350 && c.waarde.afgerondZonderFactuur === 2, JSON.stringify(c.waarde));
ok('omzet per afgeronde 116,67 · per aanvraag 70', c.waarde.perAfgerond === 116.67 && c.waarde.perAanvraag === 70, JSON.stringify(c.waarde));
ok('doorlooptijd: n=3 afgerond, waarden numeriek', c.doorlooptijd.n === 3 && typeof c.doorlooptijd.afgerondGem === 'number', JSON.stringify(c.doorlooptijd));
ok('patronen: lijst met tekst (nooit leeg)', Array.isArray(c.patronen) && c.patronen.length >= 1 && c.patronen.every((p) => typeof p === 'string' && p.length > 5), JSON.stringify(c.patronen));
ok('nog geen briefing', c.briefing === null);

console.log('\n== Prullenbak telt niet mee ==');
await api('DELETE', `/api/orders/${drsIds[2]}`);
const c2 = (await api('GET', '/api/conversie?dagen=30')).json;
ok('kaart in prullenbak valt uit de telling: binnen 4, geannuleerd 0, conversie 100%', c2.totaal.binnen === 4 && c2.totaal.geannuleerd === 0 && c2.totaal.conversie === 100, JSON.stringify(c2.totaal));
await api('POST', `/api/trash/${drsIds[2]}/restore`, {});
const c3 = (await api('GET', '/api/conversie?dagen=30')).json;
ok('teruggezet: weer 5 binnen', c3.totaal.binnen === 5, JSON.stringify(c3.totaal));

console.log('\n== Briefing (zonder AI-sleutel = feiten-tekst) ==');
const br = await api('POST', '/api/conversie/briefing', {});
ok('POST /api/conversie/briefing -> ok', br.status === 200 && br.json?.ok && br.json.briefing, JSON.stringify(br.json).slice(0, 200));
const b = br.json.briefing;
ok('bron = feiten, tekst noemt 75% en 3 van 4', b.bron === 'feiten' && /75%/.test(b.tekst) && /3 van 4/.test(b.tekst), b.tekst);
ok('weeksleutel = maandag van deze week', /^\d{4}-\d{2}-\d{2}$/.test(b.week) && new Date(b.week + 'T00:00:00Z').getUTCDay() === 1, b.week);
ok('conversie30/90 meegegeven', b.conversie30 === 75 && b.conversie90 === 75, JSON.stringify([b.conversie30, b.conversie90]));
const c4 = (await api('GET', '/api/conversie?dagen=90')).json;
ok('GET geeft dezelfde briefing terug', c4.briefing && c4.briefing.at === b.at && c4.briefing.tekst === b.tekst);
const act = (await api('GET', '/api/activity')).json;
ok('logboekregel "conversie-briefing gemaakt"', (Array.isArray(act) ? act : act.items || []).some((a) => /conversie-briefing/.test(a.action || a.text || JSON.stringify(a))));

console.log('\n== Cijfers-correcties ==');
const fe = (await api('POST', '/api/finance', { kind: 'income', amount: 120, category: 'DRS opdracht', note: 'zonder bron' })).json;
ok('boeking zonder datum krijgt de datum van vandaag in NL-tijd', fe && fe.date === nlVandaag(), JSON.stringify(fe?.date));
const fin = (await api('GET', `/api/finance?month=${nlVandaag().slice(0, 7)}`)).json;
ok('omzet zonder bron-veld telt in "Per bron" mee als DRS (via categorie)', fin.report.bySource.DRS === 120, JSON.stringify(fin.report.bySource));
ok('maandrapport standaard = huidige NL-maand', (await api('GET', '/api/finance')).json.report.month === nlVandaag().slice(0, 7));

console.log('\n== Rechten: monteur ziet geen conversie ==');
await api('POST', '/api/users', { name: 'Monteur Cv', email: 'monteurcv@keyservice.nl', password: 'monteur123', role: 'monteur' });
cookie = '';
await api('POST', '/api/login', { email: 'monteurcv@keyservice.nl', password: 'monteur123' });
const mnt = await api('GET', '/api/conversie');
ok('monteur -> 403 op /api/conversie', mnt.status === 403, `status=${mnt.status}`);
const mntB = await api('POST', '/api/conversie/briefing', {});
ok('monteur -> 403 op briefing', mntB.status === 403, `status=${mntB.status}`);

console.log(`\n==========\nConversie-test: ${passed} geslaagd, ${failed} gefaald`);
if (failed) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
