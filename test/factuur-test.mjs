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

console.log('\n== Offerte-herinnering via WhatsApp (klant met alleen 06) ==');
const custW = await api('POST', '/api/customers', { name: 'Wa Klant', phone: '0612345600' });
let off = (await api('POST', '/api/invoices', { customerId: custW.json.id, type: 'offerte' })).json; off = off.invoice || off;
await api('PATCH', `/api/invoices/${off.id}`, { lines: [{ description: 'Reparatie', qty: 1, priceExcl: 300 }], btwPct: 21, note: '' });
await api('POST', `/api/invoices/${off.id}/status`, { status: 'verzonden' });
const fu = await api('POST', `/api/invoices/${off.id}/quote-followup`, {});
ok('herinnering gaat via WhatsApp (geen e-mail bekend)', fu.json.ok && fu.json.via === 'whatsapp', JSON.stringify(fu.json));
const ob = await (await fetch(`${BASE}/api/whatsapp/outbox-status?full=1`, { headers: { cookie } })).json();
ok('appje in wachtrij naar het 06 van de klant', ob.some((x) => x.by === 'offerte-opvolging' && x.phone === '0612345600'), JSON.stringify(ob.map((x) => x.by)));
ok('opvolg-teller opgehoogd', ((await api('GET', `/api/invoices/${off.id}`)).json.invoice || {}).quoteFollowupCount === 1);
// Klant zonder e-mail én zonder 06 -> nette foutmelding, geen crash.
const custN = await api('POST', '/api/customers', { name: 'Niks Klant' });
let off2 = (await api('POST', '/api/invoices', { customerId: custN.json.id, type: 'offerte' })).json; off2 = off2.invoice || off2;
await api('PATCH', `/api/invoices/${off2.id}`, { lines: [{ description: 'X', qty: 1, priceExcl: 100 }], btwPct: 21, note: '' });
await api('POST', `/api/invoices/${off2.id}/status`, { status: 'verzonden' });
const fu2 = await api('POST', `/api/invoices/${off2.id}/quote-followup`, {});
ok('zonder e-mail en 06: nette foutmelding', fu2.status === 400 && /telefoonnummer/.test(fu2.json.error || ''), JSON.stringify(fu2.json));

console.log('\n== Prijswijziging werkt door in prijslijst ÉN pakketten ==');
// Klacht 28 jul: "ik had prijzen gewijzigd maar die komen niet door in facturen en
// offertes". Oorzaak: pakketten (bundels) hadden hun eigen kopie van de prijs.
await api('POST', '/api/bundles/add', { name: 'Prijstest pakket', lines: [{ description: 'Voorrijkosten prijstest', qty: 1, priceExcl: 50 }, { description: 'Arbeid prijstest', qty: 2, priceExcl: 80 }] });
const pSave = await api('PATCH', '/api/settings', { priceList: [{ description: 'Voorrijkosten prijstest', priceExcl: 65 }, { description: 'Los product', priceExcl: 10 }] });
ok('prijslijst opgeslagen + melding dat pakketten meegingen', pSave.status === 200 && pSave.json.priceSync?.changed === 1 && (pSave.json.priceSync.bundles || []).includes('Prijstest pakket'), JSON.stringify(pSave.json.priceSync));
const stP = await api('GET', '/api/settings');
const bnd = (stP.json.priceBundles || []).find((b) => b.name === 'Prijstest pakket');
ok('pakket-regel heeft de NIEUWE prijs (65)', (bnd?.lines || []).some((l) => l.description === 'Voorrijkosten prijstest' && l.priceExcl === 65), JSON.stringify(bnd?.lines));
ok('regel die NIET in de prijslijst staat blijft ongemoeid (80)', (bnd?.lines || []).some((l) => l.description === 'Arbeid prijstest' && l.priceExcl === 80));
const custP = await api('POST', '/api/customers', { name: 'Prijs Doorwerk Klant', phone: '0644332211' });
let invP = (await api('POST', '/api/invoices', { customerId: custP.json.id, type: 'offerte' })).json; invP = invP.invoice || invP;
const edP = await api('GET', `/api/invoices/${invP.id}`);
ok('offerte-editor krijgt de nieuwe prijs mee', (edP.json.priceList || []).some((p) => p.description === 'Voorrijkosten prijstest' && p.priceExcl === 65));
ok('offerte-editor krijgt het bijgewerkte pakket mee', ((edP.json.bundles || []).find((b) => b.name === 'Prijstest pakket')?.lines || []).some((l) => l.priceExcl === 65));
// "Regels -> prijslijst" met een gewijzigde prijs werkt eveneens door in pakketten.
const addP = await api('POST', '/api/pricelist/add', { items: [{ description: 'Voorrijkosten prijstest', qty: 1, priceExcl: 72 }] });
const stP2 = await api('GET', '/api/settings');
ok('prijs uit een factuurregel werkt door in prijslijst én pakket', addP.status === 200
  && (stP2.json.priceList || []).some((p) => p.description === 'Voorrijkosten prijstest' && p.priceExcl === 72)
  && ((stP2.json.priceBundles || []).find((b) => b.name === 'Prijstest pakket')?.lines || []).some((l) => l.description === 'Voorrijkosten prijstest' && l.priceExcl === 72), JSON.stringify(addP.json.priceSync));

console.log('\n== Review vragen vanaf een verzonden factuur + per monteur aan/uit ==');
// Losstaande factuur (zonder kaart) kan geen review sturen — nette melding.
const custR = await api('POST', '/api/customers', { name: 'Review Klant', email: 'review@example.nl', phone: '0612349999' });
let invLos = (await api('POST', '/api/invoices', { customerId: custR.json.id, type: 'factuur' })).json; invLos = invLos.invoice || invLos;
const rLos = await api('POST', `/api/invoices/${invLos.id}/review-request`, {});
ok('losse factuur zonder kaart: nette uitleg', rLos.status === 400 && /opdrachtkaart/i.test(rLos.json.error || ''), JSON.stringify(rLos.json));
// Factuur die wél aan een kaart hangt.
const ordR = await api('POST', '/api/orders', { customerId: custR.json.id, title: 'Review testklus', status: 'afgerond' });
let invR = (await api('POST', '/api/invoices', { customerId: custR.json.id, orderId: ordR.json.id, type: 'factuur' })).json; invR = invR.invoice || invR;
const rGeenLink = await api('POST', `/api/invoices/${invR.id}/review-request`, {});
ok('zonder review-link: nette melding i.p.v. een lege mail', rGeenLink.status === 400 && /review-link|SMTP/i.test(rGeenLink.json.error || ''), JSON.stringify(rGeenLink.json));
// Per monteur aan/uit bewaren.
const montR = await api('POST', '/api/monteurs', { name: 'Review Monteur', phone: '0611112222' });
ok('nieuwe monteur staat standaard AAN voor automatische reviews', montR.json.reviewAuto === true);
const montUit = await api('PATCH', `/api/monteurs/${montR.json.id}`, { reviewAuto: false });
ok('automatische review per monteur uit te zetten', montUit.status === 200 && montUit.json.reviewAuto === false);
const montLijst = await api('GET', '/api/monteurs');
ok('keuze blijft bewaard', (montLijst.json || []).find((m) => m.id === montR.json.id)?.reviewAuto === false);

console.log('\n== Factuur via WhatsApp versturen (PDF als bijlage) ==');
const custWA = await api('POST', '/api/customers', { name: 'Wa Factuur Klant', phone: '0612347788' });
const ordWA = await api('POST', '/api/orders', { customerId: custWA.json.id, title: 'Slot vervangen wa-test' });
let invWA = (await api('POST', '/api/invoices', { customerId: custWA.json.id, orderId: ordWA.json.id, type: 'factuur' })).json; invWA = invWA.invoice || invWA;
const leeg = await api('POST', `/api/invoices/${invWA.id}/send-whatsapp`, {});
ok('lege factuur kan niet verstuurd worden', leeg.status === 400 && /regels/i.test(leeg.json.error || ''), JSON.stringify(leeg.json));
await api('PATCH', `/api/invoices/${invWA.id}`, { lines: [{ description: 'Cilinderslot', qty: 1, priceExcl: 120 }], btwPct: 21, note: 'Let op: garantie 2 jaar' });
const waSend = await api('POST', `/api/invoices/${invWA.id}/send-whatsapp`, {});
ok('factuur via WhatsApp verstuurd', waSend.status === 200 && waSend.json.ok && waSend.json.phone === '0612347788', JSON.stringify(waSend.json));
const obWA = await (await fetch(`${BASE}/api/whatsapp/outbox-status?full=1`, { headers: { cookie } })).json();
const item = obWA.find((x) => x.by === 'factuur-whatsapp' && x.phone === '0612347788');
ok('appje staat in de wachtrij met de PDF als bijlage', !!item && Array.isArray(item.media) && item.media.length === 1 && item.media[0].mime === 'application/pdf', JSON.stringify(item?.media));
ok('factuur staat nu op verzonden', waSend.json.status === 'verzonden');
const invNa = (await api('GET', `/api/invoices/${invWA.id}`)).json.invoice || {};
const eersteDatum = invNa.sentAt;
await api('POST', `/api/invoices/${invWA.id}/send-whatsapp`, {});
const invNa2 = (await api('GET', `/api/invoices/${invWA.id}`)).json.invoice || {};
ok('opnieuw sturen verzet de factuurdatum NIET (betaaltermijn blijft staan)', invNa2.sentAt === eersteDatum, `${eersteDatum} vs ${invNa2.sentAt}`);
const custGeen = await api('POST', '/api/customers', { name: 'Geen Nummer' });
let invGeen = (await api('POST', '/api/invoices', { customerId: custGeen.json.id, type: 'factuur' })).json; invGeen = invGeen.invoice || invGeen;
await api('PATCH', `/api/invoices/${invGeen.id}`, { lines: [{ description: 'X', qty: 1, priceExcl: 10 }], btwPct: 21, note: '' });
const geenTel = await api('POST', `/api/invoices/${invGeen.id}/send-whatsapp`, {});
ok('zonder telefoonnummer: nette melding', geenTel.status === 400 && /telefoonnummer/i.test(geenTel.json.error || ''), JSON.stringify(geenTel.json));

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
