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
ok('nog niet verstuurde factuur heeft geen dueAt', mine && !mine.dueAt);

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

console.log('\n== Offerte-opvolging + geannuleerde opdracht (26 sep 2026) ==');
{
  const custG = await api('POST', '/api/customers', { name: 'Annuleer Klant', phone: '0612399911' });
  const ordG = (await api('POST', '/api/orders', { customerId: custG.json.id, title: 'Rhenen — offerte annuleren', status: 'nieuw' })).json;
  let offG = (await api('POST', '/api/invoices', { customerId: custG.json.id, type: 'offerte', orderId: ordG.id })).json; offG = offG.invoice || offG;
  await api('PATCH', `/api/invoices/${offG.id}`, { lines: [{ description: 'Cilinders', qty: 2, priceExcl: 90 }], btwPct: 21, note: '' });
  await api('POST', `/api/invoices/${offG.id}/status`, { status: 'verzonden' });
  const fuG = await api('POST', `/api/invoices/${offG.id}/quote-followup`, {});
  ok('opvolging voor lopende opdracht → appje in de wachtrij', fuG.json?.ok === true, JSON.stringify(fuG.json));
  const zoek = async () => ((await (await fetch(`${BASE}/api/whatsapp/outbox-status?full=1`, { headers: { cookie } })).json()) || []).find((x) => x.by === 'offerte-opvolging' && x.phone === '0612399911');
  ok('appje staat klaar (queued)', (await zoek())?.status === 'queued');
  await api('PATCH', `/api/orders/${ordG.id}`, { status: 'geannuleerd' });
  // outbox-status?full=1 toont alleen wat nog KLAARSTAAT — ingetrokken = eruit.
  const naAnnuleren = await zoek();
  ok('opdracht op Geannuleerd → klaarstaand opvolg-appje ingetrokken (staat niet meer in de wachtrij)', !naAnnuleren, JSON.stringify(naAnnuleren));
  const log = (await api('GET', '/api/activity')).json;
  ok('logboek: "opvolg-bericht ingetrokken"', (Array.isArray(log) ? log : log?.items || []).some((a) => /opvolg-bericht ingetrokken/.test(JSON.stringify(a))));
  const fuG2 = await api('POST', `/api/invoices/${offG.id}/quote-followup`, {});
  ok('nieuwe opvolging voor geannuleerde opdracht → geweigerd met uitleg', fuG2.status === 400 && /Geannuleerd/.test(fuG2.json?.error || ''), JSON.stringify(fuG2.json));
}

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
// Losstaande factuur (zonder kaart) kan sinds 23 sep 2026 óók een review sturen: de
// klant komt dan uit de factuur. Zonder review-link/SMTP een nette melding — maar
// NOOIT meer "hangt niet aan een opdrachtkaart".
const custR = await api('POST', '/api/customers', { name: 'Review Klant', email: 'review@example.nl', phone: '0612349999' });
let invLos = (await api('POST', '/api/invoices', { customerId: custR.json.id, type: 'factuur' })).json; invLos = invLos.invoice || invLos;
const rLos = await api('POST', `/api/invoices/${invLos.id}/review-request`, {});
ok('losse factuur zonder kaart: review-route werkt (alleen link/SMTP ontbreekt in de test)', rLos.status === 400 && /review-link|SMTP/i.test(rLos.json.error || '') && !/opdrachtkaart/i.test(rLos.json.error || ''), JSON.stringify(rLos.json));
const offLos = (await api('POST', '/api/invoices', { customerId: custR.json.id, type: 'offerte' })).json;
ok('review vanaf een offerte wordt geweigerd', (await api('POST', `/api/invoices/${(offLos.invoice || offLos).id}/review-request`, {})).status === 400);
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
// Standaard betaald (20 sep): versturen verlaagt de status nooit — betaald blijft betaald,
// wél met verzend-markering (sentAt) zodat hij daarna vergrendeld is.
ok('factuur blijft betaald na versturen (status niet omlaag)', waSend.json.status === 'betaald', waSend.json.status);
const invNa = (await api('GET', `/api/invoices/${invWA.id}`)).json.invoice || {};
ok('verstuurd + betaald = vergrendeld (bewerken geweigerd)', (await api('PATCH', `/api/invoices/${invWA.id}`, { lines: [{ description: 'X', qty: 1, priceExcl: 1 }], btwPct: 21, note: '' })).status === 400);
ok('verzend-markering gezet', !!invNa.sentAt);
const eersteDatum = invNa.sentAt;
await api('POST', `/api/invoices/${invWA.id}/send-whatsapp`, {});
const invNa2 = (await api('GET', `/api/invoices/${invWA.id}`)).json.invoice || {};
ok('opnieuw sturen verzet de factuurdatum NIET (betaaltermijn blijft staan)', invNa2.sentAt === eersteDatum, `${eersteDatum} vs ${invNa2.sentAt}`);
const custGeen = await api('POST', '/api/customers', { name: 'Geen Nummer' });
let invGeen = (await api('POST', '/api/invoices', { customerId: custGeen.json.id, type: 'factuur' })).json; invGeen = invGeen.invoice || invGeen;
await api('PATCH', `/api/invoices/${invGeen.id}`, { lines: [{ description: 'X', qty: 1, priceExcl: 10 }], btwPct: 21, note: '' });
const geenTel = await api('POST', `/api/invoices/${invGeen.id}/send-whatsapp`, {});
ok('zonder telefoonnummer: nette melding', geenTel.status === 400 && /telefoonnummer/i.test(geenTel.json.error || ''), JSON.stringify(geenTel.json));

console.log('\n== Klantpagina /bon (12 aug): bon bekijken zonder login ==');
// De klant krijgt een korte ondertekende link; die toont zonder login een nette
// pagina en levert de PDF vers. Foute handtekening -> 404. De handtekening kunnen we
// hier zelf berekenen omdat de testserver met SESSION_SECRET=test draait.
const cryptoBon = await import('node:crypto');
const bonSigT = (invId) => cryptoBon.createHmac('sha256', 'test').update(`bon:${invId}`).digest('hex').slice(0, 24);
const invLijst = (await api('GET', '/api/invoices')).json || [];
const alleInv = Array.isArray(invLijst) ? invLijst : (invLijst.invoices || []);
const eenInv = alleInv.find((i) => (i.lines || []).length) || alleInv[0];
if (eenInv) {
  const goed = await fetch(`${BASE}/bon/${eenInv.id}/${bonSigT(eenInv.id)}`);
  const html = await goed.text();
  ok('bon-pagina opent ZONDER login', goed.status === 200, String(goed.status));
  ok('met downloadknop en documentnummer', /Download/.test(html) && html.includes(String(eenInv.number)), html.slice(0, 120));
  const pdf = await fetch(`${BASE}/bon/${eenInv.id}/${bonSigT(eenInv.id)}/pdf`);
  ok('PDF wordt vers geleverd', pdf.status === 200 && /application\/pdf/.test(pdf.headers.get('content-type') || ''), `${pdf.status} ${pdf.headers.get('content-type')}`);
  const fout = await fetch(`${BASE}/bon/${eenInv.id}/aaaaaaaaaaaaaaaaaaaaaaaa`);
  ok('foute handtekening -> 404', fout.status === 404, String(fout.status));
} else {
  ok('bon-test overgeslagen (geen factuur aanwezig)', true);
}

console.log('\n== STANDAARD BETAALD (20 sep 2026) ==');
{
  const ok200 = (r) => r.status === 200;
  const nb = (await api('POST', '/api/invoices', { customerId: cust.json.id, type: 'factuur' })).json;
  const nbInv = nb.invoice || nb;
  ok('nieuwe factuur staat standaard op betaald, met paidAt', nbInv.status === 'betaald' && !!nbInv.paidAt, JSON.stringify([nbInv.status, nbInv.paidAt]));
  const nbEdit = await api('PATCH', `/api/invoices/${nbInv.id}`, { lines: [{ description: 'Cilinder', qty: 1, priceExcl: 80 }], btwPct: 21, note: '' });
  ok('betaald maar niet verstuurd = gewoon bewerkbaar', ok200(nbEdit) && nbEdit.json.totalExcl === 80, JSON.stringify(nbEdit.json?.error || nbEdit.json?.totalExcl));
  // Omzet in Cijfers: autosync boekt de betaalde factuur; bewerken werkt het bedrag bij.
  await api('POST', '/api/finance/settings', { autoSync: true, drsFeePerJob: 0 });
  await api('POST', '/api/finance/autosync', {});
  const maand = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 7);
  const boek = () => api('GET', `/api/finance?month=${maand}`).then((r) => (r.json.report.entries || []).find((e) => e.sourceRef === `inv:${nbInv.id}`));
  const b1 = await boek();
  ok('betaalde factuur automatisch als omzet geboekt (80 excl.)', b1 && b1.amount === 80, JSON.stringify(b1));
  await api('PATCH', `/api/invoices/${nbInv.id}`, { lines: [{ description: 'Cilinder', qty: 1, priceExcl: 120 }], btwPct: 21, note: '' });
  const b2 = await boek();
  ok('regels gewijzigd → boeking loopt mee (120)', b2 && b2.amount === 120, JSON.stringify(b2));
  // PDF van een betaalde factuur rendert (tekst "voldaan" i.p.v. betaalverzoek).
  const pdfB = await fetch(`${BASE}/api/invoices/${nbInv.id}/pdf`, { headers: { cookie } });
  ok('PDF betaalde factuur rendert', pdfB.status === 200 && (await pdfB.arrayBuffer()).byteLength > 5000);
  // "Nog niet betaald" zonder verzending → concept; boeking weg.
  const terug = await api('POST', `/api/invoices/${nbInv.id}/status`, { status: 'concept' });
  ok('"Nog niet betaald" (nooit verstuurd) → concept', ok200(terug) && terug.json.status === 'concept', JSON.stringify(terug.json));
  ok('omzet-boeking weer weg', !(await boek()));
  const weer = await api('POST', `/api/invoices/${nbInv.id}/status`, { status: 'betaald' });
  ok('concept → betaald kan direct (zonder versturen)', ok200(weer) && weer.json.status === 'betaald');
  // Verwijderen mag zolang hij niet verstuurd is (gedraagt zich als concept).
  const kopie = (await api('POST', `/api/invoices/${nbInv.id}/copy`, {})).json;
  ok('kopie van een factuur volgt de instelling (betaald)', kopie.status === 'betaald', kopie.status);
  const del = await api('DELETE', `/api/invoices/${kopie.id}`);
  ok('niet-verstuurde betaalde factuur mag weg', ok200(del), JSON.stringify(del.json));
  // Offerte → factuur blijft concept (nog niet betaald).
  const off = (await api('POST', '/api/invoices', { customerId: cust.json.id, type: 'offerte' })).json;
  const offInv = off.invoice || off;
  ok('offerte begint als concept', offInv.status === 'concept');
  await api('PATCH', `/api/invoices/${offInv.id}`, { lines: [{ description: 'Schuifpui', qty: 1, priceExcl: 500 }], btwPct: 21, note: '' });
  const conv = (await api('POST', `/api/invoices/${offInv.id}/copy`, { type: 'factuur' })).json;
  ok('factuur uit offerte begint als concept (nog te betalen)', conv.type === 'factuur' && conv.status === 'concept', JSON.stringify([conv.type, conv.status]));
  // Instelling uit → nieuwe factuur weer concept.
  await api('PATCH', '/api/settings', { invoiceSettings: { ...(await api('GET', '/api/settings')).json.invoiceSettings, standaardBetaald: false } });
  const uit = (await api('POST', '/api/invoices', { customerId: cust.json.id, type: 'factuur' })).json;
  ok('instelling uit → nieuwe factuur is concept', (uit.invoice || uit).status === 'concept');
  await api('PATCH', '/api/settings', { invoiceSettings: { ...(await api('GET', '/api/settings')).json.invoiceSettings, standaardBetaald: true } });
  const aan = (await api('POST', '/api/invoices', { customerId: cust.json.id, type: 'factuur' })).json;
  ok('instelling aan → weer betaald', (aan.invoice || aan).status === 'betaald');
  // Assistente mag betaald → verzonden (gewone handeling), maar een verstuurde betaalde
  // factuur niet bewerkbaar maken (concept) — dat blijft beheerder.
  const admCookie = cookie;
  await api('POST', '/api/users', { name: 'Assistente Fx', email: 'assfx@keyservice.nl', password: 'ass12345', role: 'assistent' });
  cookie = '';
  await api('POST', '/api/login', { email: 'assfx@keyservice.nl', password: 'ass12345' });
  const asInv = (aan.invoice || aan);
  const asNaarVerz = await api('POST', `/api/invoices/${asInv.id}/status`, { status: 'verzonden' });
  ok('assistente: betaald → nog niet betaald mag', ok200(asNaarVerz) && asNaarVerz.json.status === 'verzonden', JSON.stringify(asNaarVerz.json));
  cookie = admCookie;
}

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
