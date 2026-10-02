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

console.log('\n== Bijlage-opslag: één bestand per inhoud, ontdubbelen op schijf, wezen (16 sep 2026) ==');
process.env.DATA_DIR = DIR;
const st = await import(`../server/storage.js?opslag=${Math.random()}`);
const foto = Buffer.from('fotoinhoud-' + 'x'.repeat(500));
const a1 = st.saveBuffer(foto, { mime: 'image/jpeg', filename: 'a.jpg' });
const a2 = st.saveBuffer(foto, { mime: 'image/jpeg', filename: 'b.jpg' });
ok('tweede keer dezelfde inhoud → zelfde bestand, eigen id, vlag hergebruikt', a1.file === a2.file && a1.id !== a2.id && a2.hergebruikt === true);
const samen = st.mergeAttachments([a1], [a2]);
ok('mergeAttachments slaat het dubbel over en laat het gedeelde bestand STAAN', samen.length === 1 && st.fileExists(a1.file));
// Oude situatie nabootsen: twee losse bestanden met identieke inhoud, zonder hash.
const { writeFileSync: wf } = await import('node:fs');
const oud1 = 'att_1000_aaaaaa.jpg'; const oud2 = 'att_2000_bbbbbb.jpg';
wf(join(st.UPLOAD_DIR, oud1), foto); wf(join(st.UPLOAD_DIR, oud2), foto);
const refA = { id: 'x1', file: oud1, url: '/uploads/' + oud1 }; const refB = { id: 'x2', file: oud2, url: '/uploads/' + oud2 }; const refC = { id: 'x3', file: oud2, url: '/uploads/' + oud2 };
const droog = st.ontdubbelOpSchijf([refA, refB, refC], { dryRun: true });
ok('dryRun telt 1 dubbel bestand en verandert niets', droog.dubbeleBestanden === 1 && st.fileExists(oud2) && refB.file === oud2, JSON.stringify(droog));
const echt = st.ontdubbelOpSchijf([refA, refB, refC]);
ok('ontdubbelen: oudste bestand blijft, verwijzingen herschreven, dubbel weg', echt.dubbeleBestanden === 1 && echt.herschreven === 2 && refB.file === oud1 && refC.url === '/uploads/' + oud1 && st.fileExists(oud1) && !st.fileExists(oud2), JSON.stringify(echt));
ok('hash aangevuld op oude verwijzingen', !!refA.hash && refA.hash === refB.hash);
const wees = 'att_3000_cccccc.jpg'; wf(join(st.UPLOAD_DIR, wees), Buffer.from('wees'));
const { utimesSync } = await import('node:fs'); const oudTijd = new Date(Date.now() - 2 * 3600000); utimesSync(join(st.UPLOAD_DIR, wees), oudTijd, oudTijd);
const w1 = st.weesBestanden([refA, refB, refC, a1]);
ok('weesbestand (geen verwijzing, ouder dan 1 uur) wordt geteld', w1.n === 1 && w1.bytes === 4, JSON.stringify(w1));
st.weesBestanden([refA, refB, refC, a1], { verwijder: true });
ok('weesbestand verwijderd; bestanden mét verwijzing blijven', !st.fileExists(wees) && st.fileExists(oud1) && st.fileExists(a1.file));

console.log('\n== Schrijfronde in stukjes: tussendoor wijzigen is veilig (28 sep 2026, audit server#2/#4) ==');
const DIR3 = mkdtempSync(join(tmpdir(), 'crm-stukjes-'));
process.env.DATA_DIR = DIR3;
process.env.DB_BLOK_MS = '0'; // pauze na élk record, zodat we er "tussendoor" bij kunnen
const mS = await import(`../server/db.js?stukjes=${Math.random()}`);
mS.load();
const dS = mS.db();
for (let i = 0; i < 30; i++) dS.orders.push({ id: 'o' + i, title: 'Kaart ' + i, status: 'nieuw' });
for (let i = 0; i < 5; i++) dS.customers.push({ id: 'k' + i, name: 'Klant ' + i });
mS.save();
const herlaadS = async () => { const m = await import(`../server/db.js?s=${Math.random()}`); m.load(); return m.db(); };
mS.markAllDirty();
const ronde = mS.persistInStukjes(); // staat nu stil na het eerste record
const weg = dS.orders.splice(5, 1)[0]; weg.deletedAt = new Date().toISOString(); dS.trash.push(weg);
const halverwege = await herlaadS();
ok('tijdens de ronde is er nog NIETS half weggeschreven (kaart staat precies één keer op schijf)', halverwege.orders.filter((o) => o.id === 'o5').length + halverwege.trash.filter((o) => o.id === 'o5').length === 1);
dS.orders.find((o) => o.id === 'o20').status = 'afgerond';
mS.save(); // een synchrone opslag van een andere route, midden in de ronde
dS.orders.push({ id: 'o_nieuw', title: 'Nieuw tussendoor' });
dS.orders.find((o) => o.id === 'o7').title = 'Gewijzigd na de opslag';
await ronde;
mS.save();
const naRonde = await herlaadS();
ok('verplaatste kaart staat op schijf ALLEEN in de prullenbak', !naRonde.orders.some((o) => o.id === 'o5') && naRonde.trash.filter((o) => o.id === 'o5').length === 1);
ok('alle tussentijdse wijzigingen bewaard, volgorde exact gelijk', JSON.stringify(naRonde.orders) === JSON.stringify(dS.orders) && JSON.stringify(naRonde.trash) === JSON.stringify(dS.trash));

console.log('\n== Back-up en momentopname: compact, compleet, via .tmp (28 sep 2026, audit server#2/#3) ==');
const { readdirSync, writeFileSync: wf3, utimesSync: ut3 } = await import('node:fs');
const bS = mS.backupNow('test');
const bTekst = readFileSync(bS.file, 'utf8');
const bData = JSON.parse(bTekst);
const gelijkAanGeheugen = (x) => Object.keys(JSON.parse(JSON.stringify(dS))).every((k) => JSON.stringify(x[k]) === JSON.stringify(dS[k]));
ok('back-up bevat exact de gegevens uit het geheugen', gelijkAanGeheugen(bData));
ok('back-up zonder inspringing (kleiner) en zonder achtergebleven .tmp', !bTekst.includes('\n') && !readdirSync(join(DIR3, 'backups')).some((f) => f.endsWith('.tmp')));
ok('db.json (terugvalpunt) is daarna identiek aan de back-up', readFileSync(join(DIR3, 'db.json'), 'utf8') === bTekst);
const ref = dS.orders[0];
mS.save();
ref.title = 'Stil gewijzigd (zonder db()-aanraking)'; // alleen de controleronde ziet dit
await new Promise((r) => setTimeout(r, 5)); // andere tijdstempel voor de bestandsnaam
const bA = await mS.backupNowAsync('test-async');
const bAData = JSON.parse(readFileSync(bA.file, 'utf8'));
ok('achtergrond-back-up bevat ook een wijziging die de proxy niet zag', bAData.orders[0].title === 'Stil gewijzigd (zonder db()-aanraking)' && gelijkAanGeheugen(bAData));
process.env.STORAGE = 'json';
const mJson2 = await import(`../server/db.js?jsonterug2=${Math.random()}`);
mJson2.load();
ok('noodrem STORAGE=json leest de nieuwe compacte db.json', mJson2.storageEngine() === 'json' && mJson2.db().orders.length === dS.orders.length && mJson2.db().orders[0].title === ref.title);
process.env.STORAGE = 'sqlite';

console.log('\n== Nood-opruimronde maakt echt ruimte vrij (28 sep 2026, audit server GEMIST 2) ==');
for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 3)); mS.backupNow('vul'); }
const bDir = join(DIR3, 'backups');
const jong = join(bDir, 'db-jong.json.tmp'); const oud = join(bDir, 'db-oud.json.tmp');
wf3(jong, 'x'); wf3(oud, 'x'); const lang = new Date(Date.now() - 3600000); ut3(oud, lang, lang);
const voorNood = mS.listBackups().length;
const n1 = mS.noodOpruimronde('test');
ok('eerste noodronde: terug naar 3 kopieën + hooguit één nood-back-up', voorNood >= 8 && mS.listBackups().length === 4 && n1.backup === true && n1.removed >= voorNood - 3, `${voorNood} -> ${mS.listBackups().length} ${JSON.stringify(n1)}`);
ok('oud .tmp-restant opgeruimd, een lopend (jong) .tmp-bestand niet', !existsSync(oud) && existsSync(jong));
const n2 = mS.noodOpruimronde('test');
ok('tweede noodronde binnen het uur: géén nieuwe back-up, 3 kopieën', n2.backup === false && mS.listBackups().length === 3, JSON.stringify(n2));
delete process.env.DB_BLOK_MS;

try { rmSync(DIR, { recursive: true, force: true }); rmSync(DIR2, { recursive: true, force: true }); rmSync(DIR3, { recursive: true, force: true }); } catch { /* opruimen best-effort */ }
console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
