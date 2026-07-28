// Test: de SQLite-opslag. Bewaakt precies de gevaarlijke kant van een database-
// migratie — dat er geen record verdwijnt, dat de VOLGORDE klopt (inbox, historie en
// dedup rekenen daarop), dat verwijderen echt verwijdert, dat db.json als terugvalpunt
// blijft werken en dat een back-up terugzetten nog steeds werkt. Zonder server.
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = mkdtempSync(join(tmpdir(), 'crm-opslag-'));
process.env.DATA_DIR = DIR;
process.env.STORAGE = 'sqlite';

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

const mod = await import('../server/db.js');
const { db, save, load, id, storageEngine, snapshotJson, backupNow, listBackups, restoreBackup } = mod;

console.log('\n== Opstarten op SQLite ==');
load();
ok('motor is sqlite', storageEngine() === 'sqlite', storageEngine());
ok('database-bestand aangemaakt', existsSync(join(DIR, 'db.sqlite')));

console.log('\n== Records bewaren, wijzigen en verwijderen ==');
const d = db();
for (let i = 0; i < 50; i++) d.customers.push({ id: 'cus_' + i, name: 'Klant ' + i, phone: '06' + i });
for (let i = 0; i < 20; i++) d.orders.push({ id: 'ord_' + i, customerId: 'cus_' + i, title: 'Kaart ' + i, status: 'nieuw', thread: [{ id: 't' + i, body: 'bericht ' + i }] });
// Berichten met unshift: nieuwste vooraan — die volgorde MOET bewaard blijven.
for (let i = 0; i < 10; i++) d.messages.unshift({ id: 'msg_' + i, body: 'Bericht ' + i, receivedAt: new Date().toISOString() });
d.settings.testWaarde = 'blijft bewaard';
d.sessions.push({ token: 'abc', userId: 'u1' }); // records ZONDER id (vangnet-pad)
save();

// Alles opnieuw inlezen alsof de server herstart is.
const herlaad = async () => { const m = await import(`../server/db.js?herstart=${Math.random()}`); m.load(); return m; };
let m2 = await herlaad();
const d2 = m2.db();
ok('alle klanten terug na herstart', d2.customers.length === 50, String(d2.customers.length));
ok('alle kaarten terug, mét gesprekshistorie', d2.orders.length === 20 && d2.orders[3].thread[0].body === 'bericht 3');
ok('VOLGORDE van berichten exact bewaard (nieuwste eerst)', d2.messages.map((m) => m.id).join(',') === Array.from({ length: 10 }, (_, i) => 'msg_' + (9 - i)).join(','), d2.messages.slice(0, 3).map((m) => m.id).join(','));
ok('instellingen bewaard', d2.settings.testWaarde === 'blijft bewaard');
ok('lijst zonder ids (sessies) ook bewaard', (d2.sessions || []).length === 1 && d2.sessions[0].token === 'abc');

console.log('\n== Wijzigen en verwijderen werkt echt door ==');
d2.orders[0].status = 'afgerond';
d2.orders[0].price = '€ 250,00';
d2.customers.splice(10, 1);          // klant verwijderen
d2.messages.unshift({ id: 'msg_new', body: 'Nieuwste bericht' });
m2.save();
const m3 = await herlaad();
const d3 = m3.db();
ok('gewijzigde kaart bewaard (status + prijs)', d3.orders[0].status === 'afgerond' && d3.orders[0].price === '€ 250,00');
ok('verwijderde klant is ECHT weg (geen spook-record)', d3.customers.length === 49 && !d3.customers.some((c) => c.id === 'cus_10'));
ok('nieuw bericht staat vooraan', d3.messages[0].id === 'msg_new' && d3.messages.length === 11);

console.log('\n== Terugvalpunt: db.json blijft een volledige kopie ==');
m3.snapshotJson();
ok('db.json geschreven als momentopname', existsSync(join(DIR, 'db.json')));
const snap = JSON.parse(readFileSync(join(DIR, 'db.json'), 'utf8'));
ok('momentopname bevat alle klanten/kaarten/berichten', snap.customers.length === 49 && snap.orders.length === 20 && snap.messages.length === 11);
ok('momentopname bewaart de volgorde ook', snap.messages[0].id === 'msg_new');

console.log('\n== Noodrem: STORAGE=json leest diezelfde momentopname ==');
process.env.STORAGE = 'json';
const mJson = await import(`../server/db.js?json=${Math.random()}`);
mJson.load();
ok('terugvallen op JSON geeft exact dezelfde data', mJson.storageEngine() === 'json' && mJson.db().customers.length === 49 && mJson.db().orders[0].status === 'afgerond');
process.env.STORAGE = 'sqlite';

console.log('\n== Back-up maken en terugzetten ==');
const b = m3.backupNow('test');
ok('back-up aangemaakt', !!b && m3.listBackups().length >= 1);
d3.customers.push({ id: 'cus_na_backup', name: 'Na de back-up' });
m3.save();
const naam = m3.listBackups()[0].name;
const r = m3.restoreBackup(naam);
ok('back-up teruggezet', r.ok === true && r.customers === 49, JSON.stringify(r));
const m4 = await herlaad();
ok('na herstart staat de teruggezette stand er ook echt', m4.db().customers.length === 49 && !m4.db().customers.some((c) => c.id === 'cus_na_backup'), String(m4.db().customers.length));

console.log('\n== Migratie vanuit een bestaande db.json ==');
const DIR2 = mkdtempSync(join(tmpdir(), 'crm-migratie-'));
const bestaand = {
  customers: Array.from({ length: 120 }, (_, i) => ({ id: 'c' + i, name: 'Bestaande klant ' + i })),
  orders: Array.from({ length: 60 }, (_, i) => ({ id: 'o' + i, title: 'Bestaande kaart ' + i, status: 'nieuw' })),
  messages: Array.from({ length: 200 }, (_, i) => ({ id: 'm' + i, body: 'oud bericht ' + i })),
  invoices: [{ id: 'i1', number: '2026-0001', totalIncl: 121 }],
  settings: { bewaard: true },
};
const { writeFileSync } = await import('node:fs');
writeFileSync(join(DIR2, 'db.json'), JSON.stringify(bestaand, null, 2));
process.env.DATA_DIR = DIR2;
const mMig = await import(`../server/db.js?mig=${Math.random()}`);
mMig.load();
const dm = mMig.db();
ok('migratie: alle klanten mee', dm.customers.length === 120, String(dm.customers.length));
ok('migratie: alle kaarten, berichten en facturen mee', dm.orders.length === 60 && dm.messages.length === 200 && dm.invoices.length === 1);
ok('migratie: volgorde en instellingen behouden', dm.messages[0].id === 'm0' && dm.messages[199].id === 'm199' && dm.settings.bewaard === true);
ok('migratie: db.json blijft ONAANGEROERD als vangnet', JSON.parse(readFileSync(join(DIR2, 'db.json'), 'utf8')).customers.length === 120);
const mMig2 = await import(`../server/db.js?mig2=${Math.random()}`);
mMig2.load();
ok('tweede start leest uit SQLite (migreert niet nog eens)', mMig2.db().customers.length === 120 && mMig2.storageEngine() === 'sqlite');

try { rmSync(DIR, { recursive: true, force: true }); rmSync(DIR2, { recursive: true, force: true }); } catch { /* opruimen best-effort */ }
console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
