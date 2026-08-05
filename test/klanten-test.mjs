// Test: klantimport (CSV), klantdossier, nog-te-factureren, campagne-vangrails,
// schijf-overzicht en foto-dispatch naar de monteur. Draait tegen een verse lokale
// server op PORT=3121 (zie test/README.md).
const BASE = 'http://localhost:3121';
let cookie = '';
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }
async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie'); if (setC) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}

await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });

console.log('\n== Klantimport: CSV met preview, dedupe en gaten aanvullen ==');
// Bestaande klant vooraf: import mag hem NOOIT overschrijven, alleen aanvullen.
await api('POST', '/api/customers', { name: 'Bestaande Klant', phone: '0699887766' });
const CSV = 'Naam;Telefoon;E-mailadres;Straat;Postcode;Woonplaats\n'
  + 'Piet Jansen;0611223344;piet@example.nl;Dorpsweg 1;3911 AB;Rhenen\n'
  + 'Bestaande Klant;0699887766;bestaand@example.nl;Nieuwstraat 2;3911 CD;Rhenen\n'
  + 'Anna de Vries;0655667788;;Kerklaan 3;6811 EF;Arnhem\n'
  + ';;;;;\n';
const fd = new FormData();
fd.append('bestand', new Blob([CSV], { type: 'text/csv' }), 'klanten.csv');
const prev = await fetch(`${BASE}/api/customers/import-preview`, { method: 'POST', headers: { cookie }, body: fd });
const pj = await prev.json();
ok('preview: rijen + kolommen herkend', prev.status === 200 && pj.total === 3 && pj.headers.length === 6, JSON.stringify(pj));
ok('preview: kolommen automatisch gemapt (naam/tel/mail/adres)', pj.mapping && pj.mapping.name === 0 && pj.mapping.phone === 1 && pj.mapping.email === 2 && pj.mapping.postcode === 4, JSON.stringify(pj.mapping));
const imp = await api('POST', '/api/customers/import', { importId: pj.importId, mapping: pj.mapping });
ok('import: 2 nieuw, 1 bestaand aangevuld, lege rij overgeslagen', imp.json.added === 2 && imp.json.filled === 1, JSON.stringify(imp.json));
const custs = (await api('GET', '/api/customers')).json || [];
const piet = custs.find((c) => (c.phone || '').includes('0611223344'));
ok('adres samengesteld uit straat+postcode+plaats', piet && /Dorpsweg 1.*3911 AB Rhenen/.test(piet.address || ''), piet && piet.address);
const bestaand = custs.find((c) => (c.phone || '').includes('0699887766'));
ok('bestaande klant NIET overschreven, e-mail-gat wél aangevuld', bestaand && bestaand.name === 'Bestaande Klant' && bestaand.email === 'bestaand@example.nl');

console.log('\n== Klantdossier ==');
const ord = await api('POST', '/api/orders', { customerId: piet.id, title: 'Slot vervangen dossier-test', status: 'afgerond' });
const inv = await api('POST', '/api/invoices', { customerId: piet.id, type: 'factuur' });
const dossier = await api('GET', `/api/customers/${piet.id}/dossier`);
ok('dossier: klant + kaarten + facturen + totalen', dossier.status === 200 && dossier.json.customer.id === piet.id && dossier.json.orders.length === 1 && dossier.json.invoices.length === 1 && dossier.json.totals.orders === 1, JSON.stringify(dossier.json.totals));

console.log('\n== Klantdossier: gesprekken + kengetallen (Rompslomp-stijl) ==');
ok('dossier bevat een berichten-lijst', Array.isArray(dossier.json.berichten), typeof dossier.json.berichten);
ok('kengetallen compleet (facturen/offertes/berichten/klant-sinds)', dossier.json.totals
  && typeof dossier.json.totals.invoiceCount === 'number'
  && typeof dossier.json.totals.quoteCount === 'number'
  && typeof dossier.json.totals.messageCount === 'number', JSON.stringify(dossier.json.totals));

console.log('\n== Nog te factureren ==');
const todo1 = (await api('GET', '/api/invoices/todo')).json || [];
ok('afgeronde kaart zonder factuur staat in de lijst', todo1.some((t) => t.id === ord.json.id), JSON.stringify(todo1.map((t) => t.title)));
// Factuur koppelen aan de kaart -> van de lijst af.
await api('POST', '/api/invoices', { customerId: piet.id, type: 'factuur', orderId: ord.json.id });
const todo2 = (await api('GET', '/api/invoices/todo')).json || [];
ok('na factuur-koppeling van de lijst af', !todo2.some((t) => t.id === ord.json.id));

console.log('\n== Campagne-vangrails (zonder SMTP) ==');
const cp = await api('POST', '/api/campaign/send', { subject: 'Test', body: 'Beste {naam}', customerIds: [piet.id] });
ok('zonder SMTP: nette 503-fout (geen stille mislukking)', cp.status === 503 && /SMTP/i.test(cp.json.error || ''), JSON.stringify(cp.json));
const cpLeeg = await api('POST', '/api/campaign/send', {});
ok('lege campagne netjes geweigerd', cpLeeg.status >= 400);

console.log('\n== Schijf-overzicht ==');
const du = await api('GET', '/api/disk-usage');
ok('disk-usage geeft uploads/backups/db terug', du.status === 200 && du.json.uploads && du.json.backups && typeof du.json.dbMb === 'number', JSON.stringify(du.json));

console.log('\n== Foto-dispatch: aangevinkte foto gaat mee in de outbox ==');
await api('POST', '/api/monteurs', { name: 'FotoMonteur', phone: '0612312312', waGroup: 'Foto Groep' });
const monteurs = (await api('GET', '/api/monteurs')).json || [];
const fm = monteurs.find((m) => m.name === 'FotoMonteur');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex').toString('base64');
const up = await api('POST', `/api/orders/${ord.json.id}/attachments`, { filename: 'deur.png', mime: 'image/png', dataBase64: PNG });
const attId = ((up.json.attachments || [])[0] || {}).id;
ok('foto-bijlage geüpload', up.status === 200 && !!attId);
const disp = await api('POST', `/api/orders/${ord.json.id}/send-monteur`, { monteurId: fm.id, attachmentIds: [attId] });
ok('dispatch geaccepteerd', disp.status === 200, JSON.stringify(disp.json));
const ob = await (await fetch(`${BASE}/api/whatsapp/outbox-status?full=1`, { headers: { cookie } })).json();
const item = ob.find((x) => x.orderId === ord.json.id && x.media);
ok('outbox-item draagt de aangevinkte foto als media', !!item && item.media.length === 1 && /^\/uploads\//.test(item.media[0].url), JSON.stringify(item && item.media));
// De bridge haalt de foto met het ingest-token op (zonder login-sessie).
const dl = await fetch(`${BASE}${item.media[0].url}`, { headers: { 'x-ingest-token': 'test123' } });
ok('bridge kan de foto met token ophalen', dl.status === 200);
const dlNo = await fetch(`${BASE}${item.media[0].url}`);
ok('zonder token/login blijft de foto afgeschermd', dlNo.status === 401 || dlNo.status === 403 || dlNo.redirected === true, `status=${dlNo.status}`);

console.log('\n== Kaart-correctie wint: dispatch gebruikt de verbeterde gegevens ==');
// Casus Piotr: kaart had oude AI-extractie ("Klant: U"); de mens verbetert de
// gegevens op de kaart -> "Stuur naar monteur" moet de NIEUWE gegevens sturen.
await api('PATCH', `/api/orders/${ord.json.id}`, { intake: { name: 'Karin Vijfhuizen', phone: '0650638809', email: '', address: 'Sportlaan 12, 2141 AB Vijfhuizen' } });
const disp2 = await api('POST', `/api/orders/${ord.json.id}/send-monteur`, { monteurId: fm.id });
ok('tweede dispatch geaccepteerd', disp2.status === 200);
const ob2 = await (await fetch(`${BASE}/api/whatsapp/outbox-status?full=1`, { headers: { cookie } })).json();
const item2 = ob2.find((x) => x.orderId === ord.json.id && /Karin Vijfhuizen/.test(x.text || ''));
ok('monteur-bericht bevat de VERBETERDE gegevens (naam+adres)', !!item2 && /Sportlaan 12/.test(item2.text) && /0650638809/.test(item2.text), item2 ? item2.text.slice(0, 120) : 'geen item');
ok('oude gegevens niet meer in het nieuwste bericht', !!item2 && !/Klant: U\b/.test(item2.text));

console.log('\n== Bijlagen beheren: bladeren + bulk verwijderen + werkbon-bescherming ==');
// Tweede foto op dezelfde kaart, plus een "werkbon-handtekening" die NOOIT in de
// lijst mag staan of verwijderbaar mag zijn.
const PNG2 = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000020806000000aabbccdd', 'hex').toString('base64');
const up2 = await api('POST', `/api/orders/${ord.json.id}/attachments`, { filename: 'deur2.png', mime: 'image/png', dataBase64: PNG2 });
const attId2 = ((up2.json.attachments || []).find((a) => a.filename === 'deur2.png') || {}).id;
const sigUp = await api('POST', `/api/orders/${ord.json.id}/attachments`, { filename: 'handtekening.png', mime: 'image/png', dataBase64: PNG2 });
const sigAttId = ((sigUp.json.attachments || []).find((a) => a.filename === 'handtekening.png') || {}).id;
await api('POST', `/api/orders/${ord.json.id}/werkbon`, { work: 'Slot vervangen', materials: 'Cilinderslot', signatureAttachmentId: sigAttId });

const browse1 = await api('GET', '/api/attachments/browse');
ok('browse geeft bijlages terug met grootte + kaartinfo', browse1.status === 200 && Array.isArray(browse1.json.items) && browse1.json.items.some((x) => x.id === attId2), JSON.stringify(browse1.json.items?.length));
ok('werkbon-handtekening staat NOOIT in de lijst', !browse1.json.items.some((x) => x.id === sigAttId));

const bulkTry = await api('POST', '/api/attachments/bulk-delete', { items: [{ id: sigAttId, orderId: ord.json.id }] });
const stillThere = (await api('GET', '/api/orders')).json.find((o) => o.id === ord.json.id);
ok('werkbon-handtekening kan niet via bulk-delete verwijderd worden (verkeerd endpoint gebruikt, blijft intact)', bulkTry.status === 200 && (stillThere.attachments || []).some((a) => a.id === sigAttId));

const bulkDel = await api('POST', '/api/attachments/bulk-delete', { items: [{ id: attId2, orderId: ord.json.id }] });
ok('bulk-delete verwijdert de gewone foto + telt bytes', bulkDel.status === 200 && bulkDel.json.removed === 1 && bulkDel.json.freedBytes > 0, JSON.stringify(bulkDel.json));
const afterOrd = (await api('GET', '/api/orders')).json.find((o) => o.id === ord.json.id);
ok('foto ook echt weg van de kaart', !(afterOrd.attachments || []).some((a) => a.id === attId2));
const browse2 = await api('GET', '/api/attachments/browse');
ok('verwijderde foto verdwijnt ook uit de bladerlijst', !browse2.json.items.some((x) => x.id === attId2));

console.log('\n== Slimme zoekbalk: klanten, kaarten en telefoonnummers in één zoekveld ==');
const zc = await api('POST', '/api/customers', { name: 'Zoekbalk Testklant', phone: '0699887766', address: 'Zoekstraat 9, Rhenen' });
await api('POST', '/api/orders', { customerId: zc.json.id, title: 'Hefschuifpui zoektest', status: 'nieuw' });
const s1 = await api('GET', '/api/search?q=zoekbalk');
ok('zoeken op naam vindt de klant', s1.status === 200 && (s1.json.customers || []).some((c) => c.name === 'Zoekbalk Testklant'), JSON.stringify(s1.json.customers));
const s2 = await api('GET', '/api/search?q=zoektest');
ok('zoeken op kaarttitel vindt de opdracht', (s2.json.orders || []).some((o) => o.title === 'Hefschuifpui zoektest'));
const s3 = await api('GET', '/api/search?q=%2B31699887766');
ok('zoeken op +31-nummer vindt de klant met 06-notatie', (s3.json.customers || []).some((c) => c.id === zc.json.id), JSON.stringify(s3.json.customers));
const s4 = await api('GET', '/api/search?q=z');
ok('1 teken zoekt niet (geen zware query per toetsaanslag)', s4.status === 200 && !(s4.json.customers || []).length && !(s4.json.orders || []).length);

console.log('\n== Zoeken op PLAATS en POSTCODE ==');
const pc = await api('POST', '/api/customers', { name: 'Postcode Testklant', phone: '0655443322', address: 'Molenweg 12, 3911 AB Rhenen' });
const s5 = await api('GET', '/api/search?q=Rhenen');
ok('zoeken op plaatsnaam vindt de klant', (s5.json.customers || []).some((c) => c.id === pc.json.id), JSON.stringify(s5.json.customers));
const s6 = await api('GET', '/api/search?q=3911%20AB');
ok('zoeken op postcode MET spatie vindt de klant', (s6.json.customers || []).some((c) => c.id === pc.json.id));
const s7 = await api('GET', '/api/search?q=3911AB');
ok('zoeken op postcode ZONDER spatie vindt de klant ook', (s7.json.customers || []).some((c) => c.id === pc.json.id), JSON.stringify(s7.json.customers));
// Klant zonder adres op het klantrecord, adres staat alleen op de KAART (WhatsApp-lead).
const kaartKlant = await api('POST', '/api/customers', { name: 'Kaartadres Klant', phone: '0655443311' });
const kaartOrd = await api('POST', '/api/orders', { customerId: kaartKlant.json.id, title: 'Slot vervangen kaartadres' });
await api('PATCH', `/api/orders/${kaartOrd.json.id}`, { intake: { address: 'Dorpsstraat 5, 4041 CD Kesteren' } });
const s8 = await api('GET', '/api/search?q=Kesteren');
ok('klant zonder eigen adres is vindbaar op de plaats van zijn KAART', (s8.json.customers || []).some((c) => c.id === kaartKlant.json.id), JSON.stringify(s8.json.customers));
const clist = await api('GET', '/api/customers');
const kk = (clist.json || []).find((c) => c.id === kaartKlant.json.id);
ok('klantenlijst geeft kaart-adressen mee voor het zoekveld (searchPlaces)', !!kk && /Kesteren/.test(kk.searchPlaces || ''), JSON.stringify(kk?.searchPlaces));

console.log('\n== AI-klantsamenvatting: nette fout zonder AI-sleutel ==');
const sum1 = await api('POST', `/api/customers/${zc.json.id}/summary`, {});
ok('zonder AI-sleutel: nette 400 met uitleg (geen crash)', sum1.status === 400 && /AI/i.test(sum1.json.error || ''), JSON.stringify(sum1.json));

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
