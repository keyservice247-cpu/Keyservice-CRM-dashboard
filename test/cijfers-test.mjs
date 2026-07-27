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

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
