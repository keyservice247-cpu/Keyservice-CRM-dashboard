// Test: kortingen op facturen (pct + bedrag), PDF-generatie, dueAt in overzicht.
const BASE = 'http://localhost:3117';
let cookie = '';
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }
async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie'); if (setC) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json, headers: r.headers };
}

await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });
const cust = await api('POST', '/api/customers', { name: 'Korting Klant', phone: '0699999999', email: 'korting@example.nl' });
const inv = await api('POST', '/api/invoices', { customerId: cust.json.id, type: 'factuur' });
const created = inv.json.invoice || inv.json;
ok('losse factuur aangemaakt', inv.status === 200 && created.id, JSON.stringify(created.number));
const ID = created.id;

console.log('\n== Korting: percentage ==');
const p1 = await api('PATCH', `/api/invoices/${ID}`, { lines: [{ description: 'Slot vervangen', qty: 2, priceExcl: 100 }], btwPct: 21, note: '', discount: { type: 'pct', value: 10 } });
ok('subtotaal 200', p1.json.subtotalExcl === 200, JSON.stringify(p1.json.subtotalExcl));
ok('korting 20 (10%)', p1.json.discountExcl === 20);
ok('excl 180', p1.json.totalExcl === 180);
ok('btw 37,80', p1.json.btw === 37.8);
ok('incl 217,80', p1.json.totalIncl === 217.8);

console.log('\n== Korting: vast bedrag ==');
const p2 = await api('PATCH', `/api/invoices/${ID}`, { lines: [{ description: 'Slot vervangen', qty: 2, priceExcl: 100 }], btwPct: 21, note: '', discount: { type: 'bedrag', value: 50 } });
ok('korting 50', p2.json.discountExcl === 50);
ok('excl 150 / incl 181,50', p2.json.totalExcl === 150 && p2.json.totalIncl === 181.5, JSON.stringify([p2.json.totalExcl, p2.json.totalIncl]));

console.log('\n== Korting weghalen ==');
const p3 = await api('PATCH', `/api/invoices/${ID}`, { lines: [{ description: 'Slot vervangen', qty: 2, priceExcl: 100 }], btwPct: 21, note: '', discount: {} });
ok('geen korting meer', (p3.json.discountExcl || 0) === 0 && p3.json.totalExcl === 200);

console.log('\n== PDF met korting rendert ==');
await api('PATCH', `/api/invoices/${ID}`, { lines: [{ description: 'Slot vervangen', qty: 2, priceExcl: 100 }], btwPct: 21, note: '', discount: { type: 'pct', value: 15 } });
const pdf = await fetch(`${BASE}/api/invoices/${ID}/pdf`, { headers: { cookie } });
ok('PDF 200 + juiste content-type', pdf.status === 200 && /application\/pdf/.test(pdf.headers.get('content-type') || ''));
ok('PDF heeft inhoud', (await pdf.arrayBuffer()).byteLength > 5000);

console.log('\n== Kopie neemt korting mee ==');
const copy = await api('POST', `/api/invoices/${ID}/copy`, {});
ok('kopie heeft zelfde korting', copy.json.discount?.value === 15 && copy.json.discountExcl === 30, JSON.stringify(copy.json.discount));

console.log('\n== dueAt in overzicht ==');
const list = await api('GET', '/api/invoices');
const mine = (list.json || []).find((i) => i.id === ID);
ok('concept heeft geen dueAt (nog niet verstuurd)', mine && !mine.dueAt);

console.log('\n== Instellingen: auto-herinnering opslaan ==');
await api('PATCH', '/api/settings', { invoiceSettings: { companyName: 'Key service 24/7', paymentDays: 14, quoteValidDays: 30, btwPct: 21, autoRemind: true, remindAfterDays: 5, remindRepeatDays: 10, remindMax: 3 } });
const st = await api('GET', '/api/settings');
ok('auto-herinnering-instellingen bewaard', st.json.invoiceSettings?.autoRemind === true && st.json.invoiceSettings?.remindAfterDays === 5 && st.json.invoiceSettings?.paymentDays === 14, JSON.stringify(st.json.invoiceSettings));

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
