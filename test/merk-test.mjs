// MERK PER OPDRACHT (24 nov 2026). Zonder server: vaste regels (server/merk.js).
// Bewaakt: keuze van een mens wint, dan de website, dan het soort werk; de reviewlink
// volgt het merk en valt terug op de algemene link.   node test/merk-test.mjs
import { merkVan, merkVanFactuur, reviewLinkVoor, MERKEN, merkNaam, isMerk } from '../server/merk.js';

let pass = 0, fail = 0;
const ok = (naam, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${naam}`); } else { fail++; console.log(`  ✗ FAIL: ${naam} ${extra}`); } };
const m = (o) => { const r = merkVan(o); return `${r.key}/${r.bron}`; };

console.log('\n== Welk merk hoort bij een opdracht? ==');
ok('twee merken, met leesbare naam', MERKEN.length === 2 && merkNaam('schuifpui') === 'Schuifpuiservice' && merkNaam('keyservice') === 'Key Service 24/7' && merkNaam('onzin') === 'Key Service 24/7' && isMerk('schuifpui') && !isMerk('x'));
ok('gewone slotenklus zonder website = Key Service', m({ title: 'Rhenen — cilinder vervangen', source: 'DRS WhatsApp groep' }) === 'keyservice/standaard');
ok('aanvraag via schuifpuiservice.com = Schuifpuiservice', m({ title: 'Ede — deur klemt', source: 'Website', thread: [{ body: 'Nieuwe aanvraag via de website schuifpuiservice.com (contact).\nNaam: Proef' }] }) === 'schuifpui/website');
ok('aanvraag via een stadssite = Schuifpuiservice', m({ title: 'Breda — rail', thread: [{ subject: 'Nieuwe aanvraag', body: 'via schuifpuireparatie-breda.nl' }] }) === 'schuifpui/website' && m({ thread: [{ body: 'schuifpuireparatie-almere.pages.dev' }] }) === 'schuifpui/website');
ok('aanvraag via keyservice247.nl blijft Key Service, ook als het over een schuifpui gaat', m({ title: 'Tiel — schuifpui loopt zwaar', thread: [{ body: 'Nieuwe aanvraag via de website keyservice247.nl' }] }) === 'keyservice/website');
ok('geen website bekend: het soort werk beslist', m({ title: 'Zaandijk — hefschuifpui slot kapot' }) === 'schuifpui/werk' && m({ title: 'Ede — klus', description: 'loopwagens vervangen' }) === 'schuifpui/werk' && m({ title: 'Ede — klus', intake: { problem: 'kiep-schuifdeur sluit niet' } }) === 'schuifpui/werk');
ok('een later bericht in het gesprek verandert het merk niet (alleen de eerste twee tellen)', m({ title: 'Ede — cilinder', thread: [{ body: 'Hallo' }, { body: 'Dank' }, { body: 'Ik zag ook schuifpuiservice.com' }] }) === 'keyservice/standaard');
ok('wat een mens kiest wint altijd', m({ merk: 'keyservice', title: 'Schuifpui', thread: [{ body: 'schuifpuiservice.com' }] }) === 'keyservice/gekozen' && m({ merk: 'schuifpui', title: 'Cilinder' }) === 'schuifpui/gekozen');
ok('onbekende waarde in order.merk wordt genegeerd; lege opdracht geeft geen fout', m({ merk: 'iets', title: 'Cilinder' }) === 'keyservice/standaard' && m(null) === 'keyservice/standaard');

console.log('\n== Losse factuur ==');
ok('factuurregels over schuifpui-werk = Schuifpuiservice, anders Key Service', merkVanFactuur({ lines: [{ description: 'Loopwagens (2x)' }, { description: 'Arbeid' }] }).key === 'schuifpui' && merkVanFactuur({ lines: [{ description: 'Cilinder SKG3' }] }).key === 'keyservice' && merkVanFactuur(null).key === 'keyservice');

console.log('\n== Reviewlink per merk ==');
const cfg = { link: 'https://voorbeeld.test/review-key', links: { schuifpui: 'https://voorbeeld.test/review-schuif', keyservice: '' } };
ok('Schuifpuiservice krijgt zijn eigen link', reviewLinkVoor('schuifpui', cfg) === 'https://voorbeeld.test/review-schuif');
ok('Key Service zonder eigen link gebruikt de algemene link', reviewLinkVoor('keyservice', cfg) === 'https://voorbeeld.test/review-key');
ok('nog geen link per merk ingevuld = alles blijft zoals het was', reviewLinkVoor('schuifpui', { link: 'https://voorbeeld.test/een' }) === 'https://voorbeeld.test/een' && reviewLinkVoor('schuifpui', {}) === '' && reviewLinkVoor('schuifpui', null) === '');

console.log(`\n========== MERK: ${pass} geslaagd, ${fail} gefaald ==========`);
process.exit(fail ? 1 : 0);
