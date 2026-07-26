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
const ob = await (await fetch(`${BASE}/api/outbox`, { headers: { 'x-ingest-token': 'test123' } })).json();
const item = ob.find((x) => x.orderId === ord.json.id && x.media);
ok('outbox-item draagt de aangevinkte foto als media', !!item && item.media.length === 1 && /^\/uploads\//.test(item.media[0].url), JSON.stringify(item && item.media));
// De bridge haalt de foto met het ingest-token op (zonder login-sessie).
const dl = await fetch(`${BASE}${item.media[0].url}`, { headers: { 'x-ingest-token': 'test123' } });
ok('bridge kan de foto met token ophalen', dl.status === 200);
const dlNo = await fetch(`${BASE}${item.media[0].url}`);
ok('zonder token/login blijft de foto afgeschermd', dlNo.status === 401 || dlNo.status === 403 || dlNo.redirected === true, `status=${dlNo.status}`);

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
