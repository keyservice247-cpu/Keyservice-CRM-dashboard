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

// Tekst uit een pdfkit-PDF halen: streams uitpakken en de hex-/haakjes-tekst decoderen.
// (Gedeeld door de PDF-controles hieronder: opdrachttitel, reparatielocatie, correctie.)
const zlib = await import('node:zlib');
const pdfTekst = (buf) => {
  const s = Buffer.from(buf).toString('latin1'); let uit = '';
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let data = Buffer.from(m[1], 'latin1');
    try { data = zlib.inflateSync(data); } catch { /* niet gecomprimeerd */ }
    const t = data.toString('latin1');
    for (const h of t.matchAll(/<([0-9a-fA-F]+)>/g)) uit += Buffer.from(h[1], 'hex').toString('latin1');
    for (const q of t.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) uit += q[1];
  }
  return uit;
};
const pdfVan = async (invId) => pdfTekst(await (await fetch(`${BASE}/api/invoices/${invId}/pdf`, { headers: { cookie } })).arrayBuffer());

console.log('\n== Geen interne opdrachttitel op de factuur (12 okt 2026) ==');
{
  const k2 = await api('POST', '/api/customers', { name: 'Titel Klant', phone: '0699999988', email: 'titel@example.nl', address: 'Ravelstraat 1, Zaandijk' });
  const o2 = await api('POST', '/api/orders', { customerId: k2.json.id, title: 'Zaandijk — hefschuifpui slot kapot en deur gezakt', status: 'afgerond' });
  const f2r = await api('POST', '/api/invoices', { customerId: k2.json.id, orderId: o2.json.id, type: 'factuur' });
  const f2 = f2r.json.invoice || f2r.json;
  await api('PATCH', `/api/invoices/${f2.id}`, { lines: [{ description: 'Hefslot vervangen', qty: 1, priceExcl: 190 }], btwPct: 21, note: '' });
  const pdf2 = await fetch(`${BASE}/api/invoices/${f2.id}/pdf`, { headers: { cookie } });
  const tekst2 = pdfTekst(await pdf2.arrayBuffer());
  ok('PDF leesbaar in de test (controle: factuurnummer + regel staan erin)', tekst2.includes(f2.number) && /Hefslot/.test(tekst2), tekst2.slice(0, 200));
  ok('factuur-PDF: GEEN "Betreft"-regel en geen interne opdrachttitel', !/Betreft/.test(tekst2) && !/hefschuifpui slot kapot/i.test(tekst2), tekst2.slice(0, 300));
  ok('factuur-PDF: reparatielocatie staat er nog wel', /Reparatielocatie/.test(tekst2));
  const off2r = await api('POST', '/api/invoices', { customerId: k2.json.id, orderId: o2.json.id, type: 'offerte' });
  const off2 = off2r.json.invoice || off2r.json;
  await api('PATCH', `/api/invoices/${off2.id}`, { lines: [{ description: 'Hefslot vervangen', qty: 1, priceExcl: 190 }], btwPct: 21, note: '' });
  const tekst3 = pdfTekst(await (await fetch(`${BASE}/api/invoices/${off2.id}/pdf`, { headers: { cookie } })).arrayBuffer());
  ok('offerte-PDF: ook geen "Betreft"-regel', tekst3.includes(off2.number) && !/Betreft/.test(tekst3) && !/hefschuifpui slot kapot/i.test(tekst3));
}

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
  ok('handmatige herinnering bij geannuleerde opdracht → mag wél (mens beslist)', fuG2.json?.ok === true, JSON.stringify(fuG2.json));
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
  // 4 okt 2026 (keuze eigenaar): een kopie begint ALTIJD als concept (anders dubbele omzet).
  ok('kopie van een factuur begint als concept (niet dubbel als omzet)', kopie.status === 'concept' && !kopie.paidAt, kopie.status);
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

console.log('\n== Eén offerte = hooguit één factuur (audit 3 okt 2026) ==');
{
  const klQ = (await api('POST', '/api/customers', { name: 'Offerte Eenmaal', email: 'eenmaal@example.nl' })).json;
  const offQ = (await api('POST', '/api/invoices', { customerId: klQ.id, type: 'offerte' })).json;
  const offId = (offQ.invoice || offQ).id;
  await api('PATCH', `/api/invoices/${offId}`, { lines: [{ description: 'Slot', qty: 1, priceExcl: 100 }], btwPct: 21, note: '' });
  const f1 = await api('POST', `/api/invoices/${offId}/copy`, { type: 'factuur' });
  const f2 = await api('POST', `/api/invoices/${offId}/copy`, { type: 'factuur' });
  ok('"Maak factuur" twee keer → dezelfde factuur (geen tweede nummer)', f1.json.id && f2.json.id === f1.json.id && f2.json.bestaand === true, JSON.stringify({ a: f1.json.number, b: f2.json.number }));
  const st = await api('POST', `/api/invoices/${offId}/status`, { status: 'goedgekeurd' });
  ok('daarna goedkeuren maakt GEEN extra factuur-concept', !st.json.autoInvoice || st.json.autoInvoice.id === f1.json.id, JSON.stringify(st.json.autoInvoice));
  const alle = (await api('GET', '/api/invoices')).json.filter((i) => i.copiedFrom === (offQ.invoice || offQ).number && i.type === 'factuur');
  ok('in totaal precies één factuur uit deze offerte', alle.length === 1, String(alle.length));
}

console.log('\n== Reparatielocatie invulbaar in de factuur/offerte (23 nov 2026) ==');
// Wens eigenaar: de PDF-regel "Reparatielocatie" was altijd het klantadres. Nu: wat er op de
// factuur is ingevuld → het adres van DIE opdracht → het klantadres. Leeg = terug naar standaard.
{
  const KLANT = 'Klantlaan 1, 3911 AA Rhenen'; const WERK = 'Werkstraat 9, 3901 BB Veenendaal'; const LOODS = 'Loods 3, Havenweg 12, 4811 XX Breda';
  const regels = [{ description: 'Cilinder vervangen', qty: 1, priceExcl: 90 }];
  const kL = (await api('POST', '/api/customers', { name: 'Locatie Klant', phone: '0612340011', email: 'locatie@example.nl', address: KLANT })).json;
  const oL = (await api('POST', '/api/orders', { customerId: kL.id, customerAddress: WERK, title: 'Veenendaal — slot achterdeur', status: 'afgerond' })).json;
  ok('opdracht draagt een eigen adres dat afwijkt van het klantrecord', oL.intake?.address === WERK, JSON.stringify(oL.intake));
  const ed0 = await api('GET', `/api/orders/${oL.id}/invoice`);
  ok('editor via de opdracht krijgt de standaard mee (adres van de opdracht)', ed0.json.reparatieAdresStandaard === WERK, JSON.stringify(ed0.json.reparatieAdresStandaard));
  const fL = (await api('POST', '/api/invoices', { customerId: kL.id, orderId: oL.id, type: 'factuur' })).json.invoice;
  await api('PATCH', `/api/invoices/${fL.id}`, { lines: regels, btwPct: 21, note: '' });
  const ed1 = await api('GET', `/api/invoices/${fL.id}`);
  ok('editor van de factuur: standaard = adres van de opdracht, zelf nog niets ingevuld', ed1.json.reparatieAdresStandaard === WERK && !ed1.json.invoice.reparatieAdres, JSON.stringify([ed1.json.reparatieAdresStandaard, ed1.json.invoice.reparatieAdres]));
  const t1 = await pdfVan(fL.id);
  ok('PDF: standaard staat het adres van de opdracht er (niet het klantadres)', t1.includes(`Reparatielocatie: ${WERK}`) && !t1.includes(`Reparatielocatie: ${KLANT}`), t1.slice(300, 520));
  ok('PDF: het klantblok bovenaan houdt gewoon het klantadres', t1.includes(`Locatie Klant${KLANT}`), t1.slice(250, 420));
  // Zelf invullen wint.
  const p1 = await api('PATCH', `/api/invoices/${fL.id}`, { lines: regels, btwPct: 21, note: '', reparatieAdres: `  ${LOODS}  ` });
  ok('ingevulde reparatielocatie wordt bewaard (bijgeknipt)', p1.status === 200 && p1.json.reparatieAdres === LOODS, JSON.stringify(p1.json.reparatieAdres));
  const t2 = await pdfVan(fL.id);
  ok('PDF: de ingevulde reparatielocatie wint van opdracht en klant', t2.includes(`Reparatielocatie: ${LOODS}`) && !t2.includes(`Reparatielocatie: ${WERK}`), t2.slice(300, 520));
  ok('editor geeft de bewaarde waarde én de standaard terug', (await api('GET', `/api/invoices/${fL.id}`)).json.invoice.reparatieAdres === LOODS && (await api('GET', `/api/invoices/${fL.id}`)).json.reparatieAdresStandaard === WERK);
  // Opslaan ZONDER het veld (oud scherm) laat de ingevulde waarde staan.
  const p1b = await api('PATCH', `/api/invoices/${fL.id}`, { lines: regels, btwPct: 21, note: '' });
  ok('opslaan zonder het veld (oud scherm) laat de reparatielocatie staan', p1b.json.reparatieAdres === LOODS);
  // Kopie neemt hem mee.
  const kopL = (await api('POST', `/api/invoices/${fL.id}/copy`, {})).json;
  ok('kopie neemt de reparatielocatie mee', kopL.reparatieAdres === LOODS && kopL.id !== fL.id, JSON.stringify(kopL.reparatieAdres));
  // Leegmaken = terug naar de standaard.
  const p2 = await api('PATCH', `/api/invoices/${fL.id}`, { lines: regels, btwPct: 21, note: '', reparatieAdres: '' });
  ok('leegmaken → niets meer bewaard op de factuur', p2.status === 200 && !('reparatieAdres' in p2.json), JSON.stringify(p2.json.reparatieAdres));
  ok('PDF: na leegmaken weer het adres van de opdracht', (await pdfVan(fL.id)).includes(`Reparatielocatie: ${WERK}`));
  // Gelijk aan de standaard invullen = de standaard volgen (bevriest het adres niet).
  const p3 = await api('PATCH', `/api/invoices/${fL.id}`, { lines: regels, btwPct: 21, note: '', reparatieAdres: WERK });
  ok('zelfde adres als de standaard wordt niet apart bewaard', !('reparatieAdres' in p3.json), JSON.stringify(p3.json.reparatieAdres));
  const p4 = await api('PATCH', `/api/invoices/${fL.id}`, { lines: regels, btwPct: 21, note: '', reparatieAdres: 'A'.repeat(260) });
  ok('maximaal 200 tekens', (p4.json.reparatieAdres || '').length === 200, String((p4.json.reparatieAdres || '').length));
  await api('PATCH', `/api/invoices/${fL.id}`, { lines: regels, btwPct: 21, note: '', reparatieAdres: '' });
  // Offerte: zelfde veld, en "factuur van offerte" neemt het mee.
  const qL = (await api('POST', '/api/invoices', { customerId: kL.id, type: 'offerte' })).json.invoice;
  ok('losse offerte (zonder opdracht): standaard = klantadres', (await api('GET', `/api/invoices/${qL.id}`)).json.reparatieAdresStandaard === KLANT);
  await api('PATCH', `/api/invoices/${qL.id}`, { lines: regels, btwPct: 21, note: '', reparatieAdres: LOODS });
  const tq = await pdfVan(qL.id);
  ok('offerte-PDF: ingevulde reparatielocatie', tq.includes(qL.number) && tq.includes(`Reparatielocatie: ${LOODS}`), tq.slice(300, 520));
  const fq = (await api('POST', `/api/invoices/${qL.id}/copy`, { type: 'factuur' })).json;
  ok('factuur van offerte neemt de reparatielocatie mee', fq.type === 'factuur' && fq.reparatieAdres === LOODS, JSON.stringify([fq.type, fq.reparatieAdres]));
  // Geen enkel adres bekend → geen regel (zoals altijd).
  const kZ = (await api('POST', '/api/customers', { name: 'Zonder Adres', phone: '0612340012' })).json;
  const fZ = (await api('POST', '/api/invoices', { customerId: kZ.id, type: 'factuur' })).json.invoice;
  await api('PATCH', `/api/invoices/${fZ.id}`, { lines: regels, btwPct: 21, note: '' });
  const tz = await pdfVan(fZ.id);
  ok('geen adres bekend → geen regel "Reparatielocatie" op de PDF', tz.includes(fZ.number) && !/Reparatielocatie/.test(tz));
  // Vergrendeld (verstuurd + betaald): het veld volgt dezelfde vergrendeling als de regels.
  await api('POST', `/api/invoices/${fL.id}/send-whatsapp`, { betaald: true });
  const pV = await api('PATCH', `/api/invoices/${fL.id}`, { lines: regels, btwPct: 21, note: '', reparatieAdres: LOODS });
  ok('vergrendelde factuur: reparatielocatie wijzigen wordt geweigerd zoals de andere velden', pV.status === 400 && /verstuurd én betaald/.test(pV.json.error || ''), JSON.stringify(pV.json));
}

console.log('\n== Factuur corrigeren binnen hetzelfde nummer (23 nov 2026) ==');
// Wens eigenaar: een verstuurde én betaalde factuur is vergrendeld; zit er een fout in, dan
// corrigeert kantoor hem onder HETZELFDE nummer (met reden). Nummer/status/betaald/verzonden
// blijven staan, de correctie wordt vastgelegd, de PDF zegt "Gecorrigeerde versie" en de
// automatische omzet-boeking in Cijfers volgt het nieuwe bedrag.
{
  const admin = cookie;
  await api('POST', '/api/users', { name: 'Assistente Corr', email: 'asscorr@keyservice.nl', password: 'ass12345', role: 'assistent' });
  await api('POST', '/api/finance/settings', { autoSync: true, drsFeePerJob: 0 });
  const kC = (await api('POST', '/api/customers', { name: 'Correctie Klant', phone: '0612340021', email: 'correctie@example.nl', address: 'Foutstraat 2, 3911 AB Rhenen' })).json;
  const oC = (await api('POST', '/api/orders', { customerId: kC.id, title: 'Rhenen — cilinders vervangen', status: 'afgerond' })).json;
  const fC = (await api('POST', '/api/invoices', { customerId: kC.id, orderId: oC.id, type: 'factuur' })).json.invoice;
  await api('PATCH', `/api/invoices/${fC.id}`, { lines: [{ description: 'Cilinder', qty: 1, priceExcl: 100 }], btwPct: 21, note: '' });
  const verstuur = await api('POST', `/api/invoices/${fC.id}/send-whatsapp`, { betaald: true });
  await api('POST', '/api/finance/autosync', {});
  const maand = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 7);
  const boeking = () => api('GET', `/api/finance?month=${maand}`).then((r) => (r.json.report.entries || []).find((e) => e.sourceRef === `inv:${fC.id}`));
  const voor = (await api('GET', `/api/invoices/${fC.id}`)).json.invoice;
  ok('uitgangspunt: verstuurd + betaald (vergrendeld), omzet 100 geboekt', verstuur.status === 200 && voor.status === 'betaald' && !!voor.sentAt && !!voor.paidAt && (await boeking())?.amount === 100, JSON.stringify([verstuur.status, voor.status, voor.sentAt]));
  const nieuweRegels = [{ description: 'Cilinder', qty: 2, priceExcl: 100 }];
  // Zonder correctie: geweigerd, precies zoals altijd.
  const zonder = await api('PATCH', `/api/invoices/${fC.id}`, { lines: nieuweRegels, btwPct: 21, note: '' });
  ok('zonder correctie: vergrendelde factuur wordt geweigerd zoals altijd', zonder.status === 400 && /verstuurd én betaald/.test(zonder.json.error || ''), JSON.stringify(zonder.json));
  // Reden ontbreekt / te kort / te lang → 400, er verandert niets.
  const kort = await api('PATCH', `/api/invoices/${fC.id}`, { lines: nieuweRegels, btwPct: 21, note: '', correctie: { reden: 'ab' } });
  const leeg = await api('PATCH', `/api/invoices/${fC.id}`, { lines: nieuweRegels, btwPct: 21, note: '', correctie: {} });
  const lang = await api('PATCH', `/api/invoices/${fC.id}`, { lines: nieuweRegels, btwPct: 21, note: '', correctie: { reden: 'x'.repeat(201) } });
  ok('reden te kort, leeg of te lang → 400 met uitleg', kort.status === 400 && leeg.status === 400 && lang.status === 400 && /3 tot 200/.test(kort.json.error || ''), JSON.stringify([kort.status, leeg.status, lang.status, kort.json.error]));
  ok('na de geweigerde pogingen is de factuur ongewijzigd', (await api('GET', `/api/invoices/${fC.id}`)).json.invoice.totalExcl === 100 && !(await api('GET', `/api/invoices/${fC.id}`)).json.invoice.correcties);
  // Assistente corrigeert.
  cookie = '';
  await api('POST', '/api/login', { email: 'asscorr@keyservice.nl', password: 'ass12345' });
  const corr = await api('PATCH', `/api/invoices/${fC.id}`, { lines: nieuweRegels, btwPct: 21, note: '', correctie: { reden: '  Verkeerd aantal cilinders  ' } });
  cookie = admin;
  const na = corr.json || {};
  ok('assistente corrigeert met reden → 200, nieuw totaal', corr.status === 200 && na.totalExcl === 200 && na.totalIncl === 242, JSON.stringify([corr.status, na.totalExcl, na.totalIncl, na.error]));
  ok('nummer, status, betaaldatum en verzenddatum zijn onaangeroerd', na.number === voor.number && na.status === 'betaald' && na.paidAt === voor.paidAt && na.sentAt === voor.sentAt, JSON.stringify([na.number, na.status, na.paidAt, na.sentAt]));
  const c0 = (na.correcties || [])[0] || {};
  ok('correctie vastgelegd: wie, wanneer, reden en totaal incl. btw van → naar', (na.correcties || []).length === 1 && c0.door === 'Assistente Corr' && c0.reden === 'Verkeerd aantal cilinders' && c0.vanTotaal === 121 && c0.naarTotaal === 242 && !!c0.at && na.gecorrigeerdAt === c0.at, JSON.stringify(na.correcties));
  ok('Cijfers: de automatische omzet-boeking volgt het nieuwe bedrag (200 excl.)', (await boeking())?.amount === 200, JSON.stringify(await boeking()));
  const tC = await pdfVan(fC.id);
  ok('PDF: zelfde nummer + regel "Gecorrigeerde versie van dd-mm-jjjj"', tC.includes(`Factuur: ${voor.number}`) && /Gecorrigeerde versie van \d{2}-\d{2}-\d{4}/.test(tC), tC.slice(300, 480));
  ok('daarna is de factuur weer vergrendeld (zonder correctie geweigerd)', (await api('PATCH', `/api/invoices/${fC.id}`, { lines: nieuweRegels, btwPct: 21, note: '' })).status === 400);
  const logC = (await api('GET', '/api/activity')).json;
  ok('logboek: "factuur gecorrigeerd" met nummer en reden', (Array.isArray(logC) ? logC : logC?.items || []).some((a) => /factuur gecorrigeerd/.test(JSON.stringify(a)) && JSON.stringify(a).includes(voor.number) && /Verkeerd aantal cilinders/.test(JSON.stringify(a))));
  ok('lijst geeft gecorrigeerdAt mee (label "gecorrigeerd")', !!((await api('GET', '/api/invoices')).json || []).find((i) => i.id === fC.id)?.gecorrigeerdAt);
  // "Correctie" waarbij niets verandert: er wordt niets vastgelegd (geen stempel op een gelijke factuur).
  const niets = await api('PATCH', `/api/invoices/${fC.id}`, { lines: nieuweRegels, btwPct: 21, note: '', correctie: { reden: 'Toch niets aangepast' } });
  ok('correctie zonder inhoudelijke wijziging: 200, maar geen nieuwe correctie vastgelegd', niets.status === 200 && (niets.json.correcties || []).length === 1 && niets.json.gecorrigeerdAt === na.gecorrigeerdAt, JSON.stringify([niets.status, niets.json.correcties]));
  // Tweede correctie (via de opdracht-route) komt erbij; ook de reparatielocatie kan zo gecorrigeerd worden.
  const corr2 = await api('POST', `/api/orders/${oC.id}/invoice`, { lines: nieuweRegels, btwPct: 21, note: '', reparatieAdres: 'Goedstraat 7, 3911 AC Rhenen', correctie: { reden: 'Verkeerde reparatielocatie' } });
  ok('tweede correctie (via de opdracht) komt erbij; reparatielocatie mee gecorrigeerd', corr2.status === 200 && (corr2.json.correcties || []).length === 2 && corr2.json.reparatieAdres === 'Goedstraat 7, 3911 AC Rhenen' && corr2.json.number === voor.number && corr2.json.correcties[1].vanTotaal === 242 && corr2.json.correcties[1].naarTotaal === 242, JSON.stringify([corr2.status, corr2.json.correcties, corr2.json.error]));
  // Opnieuw versturen kan gewoon; de factuurdatum (betaaltermijn) verschuift niet.
  const opnieuw = await api('POST', `/api/invoices/${fC.id}/send-whatsapp`, { betaald: true });
  const naOpnieuw = (await api('GET', `/api/invoices/${fC.id}`)).json.invoice;
  ok('gecorrigeerde factuur opnieuw versturen kan; status en factuurdatum blijven', opnieuw.status === 200 && naOpnieuw.status === 'betaald' && naOpnieuw.sentAt === voor.sentAt, JSON.stringify([opnieuw.status, naOpnieuw.status]));
  // Kopie = nieuw document: neemt de correctie-geschiedenis niet mee.
  const kopC = (await api('POST', `/api/invoices/${fC.id}/copy`, {})).json;
  ok('kopie neemt de correctie-geschiedenis niet mee', !!kopC.id && !kopC.correcties && !kopC.gecorrigeerdAt);
  // Goedgekeurde offerte blijft dicht, ook met correctie.
  const qC = (await api('POST', '/api/invoices', { customerId: kC.id, type: 'offerte' })).json.invoice;
  await api('PATCH', `/api/invoices/${qC.id}`, { lines: [{ description: 'Slot', qty: 1, priceExcl: 80 }], btwPct: 21, note: '' });
  await api('POST', `/api/invoices/${qC.id}/status`, { status: 'verzonden' });
  await api('POST', `/api/invoices/${qC.id}/status`, { status: 'goedgekeurd' });
  const qCorr = await api('PATCH', `/api/invoices/${qC.id}`, { lines: [{ description: 'Slot', qty: 2, priceExcl: 80 }], btwPct: 21, note: '', correctie: { reden: 'Aantal aanpassen' } });
  const qNa = (await api('GET', `/api/invoices/${qC.id}`)).json.invoice;
  ok('goedgekeurde offerte blijft vergrendeld, ook mét correctie', qCorr.status === 400 && /goedgekeurd/.test(qCorr.json.error || '') && qNa.totalExcl === 80 && !qNa.correcties, JSON.stringify([qCorr.status, qCorr.json.error, qNa.totalExcl]));
  // Een NIET-vergrendelde factuur: `correctie` doet niets (gewoon opslaan, geen correctie-regel).
  const fN = (await api('POST', '/api/invoices', { customerId: kC.id, type: 'factuur' })).json.invoice;
  const nCorr = await api('PATCH', `/api/invoices/${fN.id}`, { lines: [{ description: 'Sleutel', qty: 1, priceExcl: 10 }], btwPct: 21, note: '', correctie: { reden: 'Niet nodig' } });
  ok('niet-vergrendelde factuur: gewoon opgeslagen, geen correctie vastgelegd', nCorr.status === 200 && nCorr.json.totalExcl === 10 && !nCorr.json.correcties && !nCorr.json.gecorrigeerdAt, JSON.stringify([nCorr.status, nCorr.json.correcties]));
}

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
