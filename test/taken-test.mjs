// Test: TAKEN-MODULE (8 sep 2026) — aanmaken, afvinken, filteren, deadline-teller,
// zichtbaarheid privé/zakelijk. Geen AI, geen koppeling met de lead-instroom.
//
// Draaien: DATA_DIR=<vers> INGEST_TOKEN=test123 SESSION_SECRET=test PORT=3133 node server/index.js &
//          node test/taken-test.mjs
const BASE = 'http://localhost:3133';
let cookie = '';
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}
async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}
const login = async (email, password) => { cookie = ''; return api('POST', '/api/login', { email, password }); };
const isoOver = (dagen) => { const d = new Date(); d.setDate(d.getDate() + dagen); return d.toISOString().slice(0, 10); };

console.log('\n== Starttaken ==');
ok('admin inloggen', (await login('admin@keyservice.nl', 'admin123')).status === 200);
const adminCookie = cookie;
const start = await api('GET', '/api/taken');
ok('lijst bereikbaar', start.status === 200 && Array.isArray(start.json));
ok('elf starttaken ingeladen', start.json.length === 11, String(start.json.length));
ok('zes zakelijk, vijf privé', start.json.filter((t) => t.categorie === 'zakelijk').length === 6 && start.json.filter((t) => t.categorie === 'prive').length === 5);
const youssef = start.json.find((t) => /Youssef/.test(t.titel));
ok('deadline 1 november op de Youssef-taak', youssef?.deadline === '2026-11-01', JSON.stringify(youssef?.deadline));
ok('deadline-teller (dagen) wordt meegegeven', typeof youssef?.dagen === 'number');
ok('vier taken hoge urgentie', start.json.filter((t) => t.urgentie === 'hoog').length === 4);

console.log('\n== Aanmaken ==');
const nieuw = await api('POST', '/api/taken', { titel: 'Testtaak bellen', categorie: 'zakelijk', urgentie: 'hoog', duur: 'kort', toegewezen: 'Beheerder + Ouiam' });
ok('taak aangemaakt', nieuw.status === 200 && nieuw.json?.id, JSON.stringify(nieuw.json));
ok('standaardstatus open, toewijzing gesplitst', nieuw.json?.status === 'open' && nieuw.json?.toegewezen?.length === 2, JSON.stringify(nieuw.json?.toegewezen));
ok('lege titel geweigerd', (await api('POST', '/api/taken', { titel: '   ' })).status === 400);
const std = await api('POST', '/api/taken', { titel: 'Zonder opties' });
ok('zonder opties: zakelijk + middel', std.json?.categorie === 'zakelijk' && std.json?.urgentie === 'middel');

console.log('\n== Afvinken ==');
const klaar = await api('POST', `/api/taken/${nieuw.json.id}/klaar`, { klaar: true });
ok('afvinken zet status klaar + afgerondOp', klaar.json?.status === 'klaar' && !!klaar.json?.afgerondOp, JSON.stringify(klaar.json));
const lijst2 = (await api('GET', '/api/taken')).json;
ok('afgeronde taak blijft in de lijst (vervaagt, verdwijnt niet)', lijst2.some((t) => t.id === nieuw.json.id && t.status === 'klaar'));
ok('afgeronde taak staat onderaan (open eerst)', lijst2.findIndex((t) => t.status === 'klaar') > lijst2.filter((t) => t.status !== 'klaar').length - 1);
const heropen = await api('POST', `/api/taken/${nieuw.json.id}/klaar`, { klaar: false });
ok('heropenen zet terug op open', heropen.json?.status === 'open' && heropen.json?.afgerondOp === null);

console.log('\n== Filteren ==');
ok('filter privé', (await api('GET', '/api/taken?categorie=prive')).json.every((t) => t.categorie === 'prive'));
ok('filter hoge urgentie', (await api('GET', '/api/taken?urgentie=hoog')).json.every((t) => t.urgentie === 'hoog'));
ok('filter korte taken', (await api('GET', '/api/taken?duur=kort')).json.every((t) => t.duur === 'kort'));
const mij = (await api('GET', '/api/taken?mij=1')).json;
ok('toegewezen aan mij (op voornaam)', mij.some((t) => t.id === nieuw.json.id) && mij.every((t) => (t.toegewezen || []).some((n) => /^beheerder$/i.test(n))), JSON.stringify(mij.map((t) => t.toegewezen)));

console.log('\n== Deadline-teller en Vandaag-blok ==');
const snel = await api('POST', '/api/taken', { titel: 'Deadline over 2 dagen', urgentie: 'laag', deadline: isoOver(2) });
ok('dagen = 2', snel.json?.dagen === 2, JSON.stringify(snel.json?.dagen));
const ver = await api('POST', '/api/taken', { titel: 'Deadline over 40 dagen', urgentie: 'laag', deadline: isoOver(40) });
const vandaag = (await api('GET', '/api/taken/vandaag')).json;
ok('Vandaag-blok: max 5', Array.isArray(vandaag) && vandaag.length <= 5);
ok('Vandaag-blok bevat de taak met deadline ≤ 3 dagen bovenaan', vandaag[0]?.id === snel.json.id, JSON.stringify(vandaag.map((t) => t.titel)));
ok('Vandaag-blok bevat GEEN lage-urgentie-taak met deadline over 40 dagen', !vandaag.some((t) => t.id === ver.json.id));
await api('PATCH', `/api/taken/${snel.json.id}`, { deadline: null });
ok('deadline weghalen -> dagen null', (await api('GET', '/api/taken')).json.find((t) => t.id === snel.json.id)?.dagen === null);

console.log('\n== Bewerken en koppelen ==');
const kaart = await api('POST', '/api/orders', { customerName: 'Roger Taak', customerPhone: '0612349999', title: 'Rhenen — gesprek Roger' });
const bew = await api('PATCH', `/api/taken/${std.json.id}`, { titel: 'Gesprek met Roger', customerId: kaart.json?.customerId, orderId: kaart.json?.id, notities: 'Punten van Amal verzamelen', urgentie: 'hoog' });
ok('bewerken + koppelen aan klant en kaart', bew.status === 200 && bew.json?.customerId === kaart.json?.customerId && bew.json?.orderId === kaart.json?.id && bew.json?.urgentie === 'hoog', JSON.stringify(bew.json));

console.log('\n== Zichtbaarheid privé / zakelijk ==');
const prive = await api('POST', '/api/taken', { titel: 'Cadeau voor thuis', categorie: 'prive' });
await api('POST', '/api/users', { name: 'Assistente Taak', email: 'assistente-taak@keyservice.nl', password: 'assist123', role: 'assistent' });
ok('assistente inloggen', (await login('assistente-taak@keyservice.nl', 'assist123')).status === 200);
const zij = (await api('GET', '/api/taken')).json;
ok('assistente ziet de zakelijke taken', zij.some((t) => t.categorie === 'zakelijk'));
ok('assistente ziet GEEN privé-taken van Abdel', !zij.some((t) => t.categorie === 'prive'), JSON.stringify(zij.filter((t) => t.categorie === 'prive').map((t) => t.titel)));
ok('privé-taak van een ander bewerken: niet gevonden', (await api('PATCH', `/api/taken/${prive.json.id}`, { titel: 'x' })).status === 404);
const haar = await api('POST', '/api/taken', { titel: 'Mijn eigen privé-taak', categorie: 'prive' });
ok('assistente kan eigen privé-taak maken en zien', haar.status === 200 && (await api('GET', '/api/taken')).json.some((t) => t.id === haar.json.id));
cookie = adminCookie;
ok('Abdel ziet de privé-taak van de assistente NIET', !(await api('GET', '/api/taken')).json.some((t) => t.id === haar.json.id));

console.log('\n== Privé-taak DELEN met een collega (optioneel) ==');
const collegas = (await api('GET', '/api/taken/collegas')).json;
const assistent = (collegas || []).find((c) => c.name === 'Assistente Taak');
ok('collega-lijst bevat de assistente, niet jezelf', !!assistent && !collegas.some((c) => c.name === 'Beheerder'), JSON.stringify(collegas));
const gedeeld = await api('PATCH', `/api/taken/${prive.json.id}`, { gedeeldMet: [assistent?.id] });
ok('eigenaar deelt privé-taak', gedeeld.status === 200 && gedeeld.json?.gedeeldMet?.[0] === assistent?.id && gedeeld.json?.gedeeldMetNamen?.[0] === 'Assistente Taak', JSON.stringify(gedeeld.json));
ok('onbekend id wordt genegeerd bij delen', (await api('PATCH', `/api/taken/${prive.json.id}`, { gedeeldMet: [assistent?.id, 'user_nep'] })).json?.gedeeldMet?.length === 1);
const nietGedeeld = await api('POST', '/api/taken', { titel: 'Niet gedeeld', categorie: 'prive' });
await login('assistente-taak@keyservice.nl', 'assist123');
const zijLijst = (await api('GET', '/api/taken')).json;
const zijGedeeld = zijLijst.find((t) => t.id === prive.json.id);
ok('assistente ziet de GEDEELDE privé-taak (met eigenaar-naam, isEigenaar=false)', !!zijGedeeld && zijGedeeld.isEigenaar === false && zijGedeeld.eigenaarNaam === 'Beheerder', JSON.stringify(zijGedeeld));
ok('assistente ziet de NIET-gedeelde privé-taak nog steeds niet', !zijLijst.some((t) => t.id === nietGedeeld.json.id));
ok('assistente neemt de gedeelde taak over (afvinken)', (await api('POST', `/api/taken/${prive.json.id}/klaar`, { klaar: true })).json?.status === 'klaar');
ok('assistente mag de gedeelde taak bewerken', (await api('PATCH', `/api/taken/${prive.json.id}`, { notities: 'Gekocht' })).json?.notities === 'Gekocht');
const stiekem = await api('PATCH', `/api/taken/${prive.json.id}`, { gedeeldMet: [] });
ok('assistente kan de deel-kring NIET wijzigen (genegeerd)', stiekem.status === 200 && stiekem.json?.gedeeldMet?.[0] === assistent?.id, JSON.stringify(stiekem.json?.gedeeldMet));
ok('assistente mag de gedeelde privé-taak NIET verwijderen', (await api('DELETE', `/api/taken/${prive.json.id}`)).status === 403);
cookie = adminCookie;
ok('eigenaar trekt delen in', (await api('PATCH', `/api/taken/${prive.json.id}`, { gedeeldMet: [] })).json?.gedeeldMet?.length === 0);
await login('assistente-taak@keyservice.nl', 'assist123');
ok('na intrekken ziet de assistente de taak niet meer', (await api('PATCH', `/api/taken/${prive.json.id}`, { titel: 'x' })).status === 404);
cookie = adminCookie;
await api('POST', '/api/users', { name: 'Monteur Taak', email: 'monteur-taak@keyservice.nl', password: 'monteur123', role: 'monteur' });
await login('monteur-taak@keyservice.nl', 'monteur123');
ok('monteur: geen toegang tot taken', (await api('GET', '/api/taken')).status === 403);
cookie = adminCookie;

console.log('\n== Verwijderen ==');
ok('verwijderen', (await api('DELETE', `/api/taken/${nieuw.json.id}`)).status === 200);
ok('is weg', !(await api('GET', '/api/taken')).json.some((t) => t.id === nieuw.json.id));

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
