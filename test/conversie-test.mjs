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

console.log('\n== Seed: 3 DRS-opdrachten, 1 website-lead, 2 handmatige opdrachten (afgerond + afspraak) ==');
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
// Afspraak ingepland = een "ja" van de klant → telt als GEWONNEN (akkoord eigenaar 20 sep).
const afspr = (await api('POST', '/api/orders', { title: 'Rhenen — afspraak slot', status: 'nieuw', description: 'test', source: 'Handmatig', customerName: 'Afspraak Klant', customerPhone: '0698989898' })).json;
const afsprId = afspr?.id || afspr?.order?.id;
await api('PATCH', `/api/orders/${afsprId}`, { status: 'afspraak_ingepland' });
// Factuur (verzonden, excl. 200) op de eerste DRS-kaart → omzet telt via de factuur.
const ord0 = (await api('GET', '/api/orders')).json.find((o) => o.id === drsIds[0]);
const inv = (await api('POST', '/api/invoices', { customerId: ord0.customerId, type: 'factuur', orderId: drsIds[0] })).json;
const invId = (inv.invoice || inv).id;
await api('PATCH', `/api/invoices/${invId}`, { lines: [{ description: 'Slot vervangen', qty: 1, priceExcl: 200 }], btwPct: 21, note: '' });
await api('POST', `/api/invoices/${invId}/status`, { status: 'verzonden' });

console.log('\n== Tellingen en percentages (30 dagen) ==');
const c = (await api('GET', '/api/conversie?dagen=30')).json;
const t = c.totaal;
ok('binnen 6 · gewonnen 4 (3 afgerond + 1 afspraak) · verloren 1 · open 1', t.binnen === 6 && t.gewonnen === 4 && t.afgerond === 3 && t.afspraak === 1 && t.verloren === 1 && t.open === 1, JSON.stringify(t));
ok('conversie van beslist = 80% (4 van 5) — afspraak telt als gewonnen', t.conversie === 80, `${t.conversie}`);
ok('conversie van alles = 66,7% (4 van 6)', t.conversieTotaal === 66.7, `${t.conversieTotaal}`);
ok('vorige periode leeg → delta binnen +6, delta conversie null', c.delta.binnen === 6 && c.delta.conversie === null, JSON.stringify(c.delta));
ok('definitie meegegeven: gewonnen = afgerond + afspraak_ingepland, periodes 7/14/30/90/365', c.definitie && c.definitie.gewonnen.includes('afspraak_ingepland') && c.definitie.gewonnen.includes('afgerond') && c.definitie.periodes.join() === '7,14,30,90,365', JSON.stringify(c.definitie));
ok('periode 7 en 14 dagen werken', (await api('GET', '/api/conversie?dagen=7')).json.periode.dagen === 7 && (await api('GET', '/api/conversie?dagen=14')).json.totaal.binnen === 6);
const drs = c.perBron.find((b) => b.naam === 'DRS-groep');
const site = c.perBron.find((b) => b.naam === 'Website');
const handB = c.perBron.find((b) => b.naam === 'Handmatig');
ok('per bron: DRS-groep 3 binnen / 2 gewonnen / 1 verloren = 66,7%', drs && drs.binnen === 3 && drs.gewonnen === 2 && drs.verloren === 1 && drs.conversie === 66.7, JSON.stringify(drs));
ok('per bron: Website 1 open, conversie nog onbekend (null)', site && site.binnen === 1 && site.open === 1 && site.conversie === null, JSON.stringify(site));
ok('per bron: Handmatig 2 gewonnen (1 afgerond + 1 afspraak) = 100%', handB && handB.binnen === 2 && handB.gewonnen === 2 && handB.afspraak === 1 && handB.conversie === 100, JSON.stringify(handB));
ok('per bron gesorteerd op instroom (DRS-groep bovenaan)', c.perBron[0]?.naam === 'DRS-groep');
const mY = c.perMonteur.find((m) => m.naam === 'Youssef Test');
const mG = c.perMonteur.find((m) => m.naam === 'Geen monteur');
ok('per monteur: Youssef 2 gewonnen (100%), zonder monteur 4', mY && mY.gewonnen === 2 && mY.conversie === 100 && mG && mG.binnen === 4, JSON.stringify(c.perMonteur));
const stNieuw = c.perStatus.find((s) => s.key === 'nieuw');
const stAfg = c.perStatus.find((s) => s.key === 'afgerond');
const stAfs = c.perStatus.find((s) => s.key === 'afspraak_ingepland');
ok('per status: nieuw 1 (16,7%), afgerond 3 (50%), afspraak 1', stNieuw && stNieuw.count === 1 && stNieuw.pct === 16.7 && stAfg && stAfg.count === 3 && stAfg.pct === 50 && stAfs && stAfs.count === 1, JSON.stringify(c.perStatus));
ok('weekcohorten: 12 weken, som binnen = 6, laatste week 6 (4 gewonnen)', c.perWeek.length === 12 && c.perWeek.reduce((s, w) => s + w.binnen, 0) === 6 && c.perWeek[11].binnen === 6 && c.perWeek[11].gewonnen === 4, JSON.stringify(c.perWeek.slice(-2)));
ok('weeklabels zijn maandagen', c.perWeek.every((w) => new Date(w.week + 'T00:00:00Z').getUTCDay() === 1));
ok('omzet afgerond = 350 (factuur 200 excl. + prijsveld 150), 2 afgerond zonder factuur', c.waarde.omzetAfgerond === 350 && c.waarde.afgerondZonderFactuur === 2, JSON.stringify(c.waarde));
ok('omzet per afgeronde 116,67 · per aanvraag 58,33 (afspraak telt niet als omzet)', c.waarde.perAfgerond === 116.67 && c.waarde.perAanvraag === 58.33, JSON.stringify(c.waarde));
ok('doorlooptijd: n=3 afgerond, waarden numeriek', c.doorlooptijd.n === 3 && typeof c.doorlooptijd.afgerondGem === 'number', JSON.stringify(c.doorlooptijd));
ok('patronen: lijst met tekst (nooit leeg)', Array.isArray(c.patronen) && c.patronen.length >= 1 && c.patronen.every((p) => typeof p === 'string' && p.length > 5), JSON.stringify(c.patronen));
ok('nog geen briefing', c.briefing === null);

console.log('\n== Prullenbak telt niet mee ==');
await api('DELETE', `/api/orders/${drsIds[2]}`);
const c2 = (await api('GET', '/api/conversie?dagen=30')).json;
ok('kaart in prullenbak valt uit de telling: binnen 5, verloren 0, conversie 100%', c2.totaal.binnen === 5 && c2.totaal.verloren === 0 && c2.totaal.conversie === 100, JSON.stringify(c2.totaal));
await api('POST', `/api/trash/${drsIds[2]}/restore`, {});
const c3 = (await api('GET', '/api/conversie?dagen=30')).json;
ok('teruggezet: weer 6 binnen', c3.totaal.binnen === 6, JSON.stringify(c3.totaal));

console.log('\n== Briefing (zonder AI-sleutel = feiten-tekst) ==');
const br = await api('POST', '/api/conversie/briefing', {});
ok('POST /api/conversie/briefing -> ok', br.status === 200 && br.json?.ok && br.json.briefing, JSON.stringify(br.json).slice(0, 200));
const b = br.json.briefing;
ok('bron = feiten, tekst noemt 80%, 4 van 5 en de afspraak', b.bron === 'feiten' && /80%/.test(b.tekst) && /4 van 5/.test(b.tekst) && /1 afspraak/.test(b.tekst), b.tekst);
ok('weeksleutel = maandag van deze week', /^\d{4}-\d{2}-\d{2}$/.test(b.week) && new Date(b.week + 'T00:00:00Z').getUTCDay() === 1, b.week);
ok('conversie30/90 meegegeven', b.conversie30 === 80 && b.conversie90 === 80, JSON.stringify([b.conversie30, b.conversie90]));
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
