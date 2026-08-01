// Test: Google Agenda-koppeling — sync-filter (alleen Abdel Rafour + schuifpui),
// alarm-beslissing bij een stil verbroken koppeling, en veilig gedrag (geen crash,
// kaart onaangeraakt) als Google niet verbonden is. Draait ZONDER server en zonder
// echte Google-API: alleen de pure logica.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'crm-gtest-'));
delete process.env.GOOGLE_CLIENT_ID; // niet geconfigureerd -> sync moet no-op zijn
delete process.env.GOOGLE_CLIENT_SECRET;
const { shouldSyncToGoogle, calendarAlarmDecision, syncOrderToGoogle, isConnected } = await import('../server/google.js');

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

console.log('\n== Sync-filter in de SMALLE modus (het oude gedrag, nu een keuze) ==');
// Sinds 1 aug is de standaard "alles" — deze vier bewaken de smalle modus, die je
// in Instellingen kunt kiezen als je juist NIET alles in je agenda wilt.
const dbmod0 = await import('../server/db.js');
dbmod0.db().settings.googleSync = { mode: 'monteurs+schuifpui', monteurIds: [], keywords: 'schuifpui, schuifdeur, schuifwand, schuifsysteem' };
ok('monteur Abdel Rafour -> wél syncen', shouldSyncToGoogle({ title: 'Cilinders vervangen' }, { name: 'Abdel Rafour' }) === true);
ok('monteur Youssef, gewone klus -> niet syncen', shouldSyncToGoogle({ title: 'Achterdeur gaat niet open' }, { name: 'Youssef' }) === false);
ok('schuifpui-klus zonder monteur -> wél syncen', shouldSyncToGoogle({ title: 'Schuifpui klemt', description: '' }, null) === true);
ok('gewone klus zonder monteur -> niet syncen', shouldSyncToGoogle({ title: 'Slot vervangen', description: '' }, null) === false);
delete dbmod0.db().settings.googleSync;

console.log('\n== Alarm-beslissing: stil verbroken koppeling ==');
ok('verbroken + nog niet gemeld -> ALARM', calendarAlarmDecision({ disconnectReason: 'token ingetrokken', alerted: false }).alert === true);
ok('verbroken + al gemeld -> geen tweede alarm', calendarAlarmDecision({ disconnectReason: 'token ingetrokken', alerted: true }).alert === false);
ok('weer verbonden na alarm -> herstelmelding', calendarAlarmDecision({ disconnectReason: '', alerted: true }).recover === true);
ok('alles goed -> stil', (() => { const d = calendarAlarmDecision({ disconnectReason: '', alerted: false }); return !d.alert && !d.recover; })());

console.log('\n== Niet verbonden -> sync is een veilige no-op ==');
ok('isConnected() is false zonder configuratie', isConnected() === false);
const order = { id: 'ord_test', title: 'Schuifpui klemt', appointmentAt: '2099-01-01T10:00', status: 'open' };
await syncOrderToGoogle(order);
ok('kaart onaangeraakt (geen event, geen fout)', !order.googleEvent && !order.googleSyncError, JSON.stringify(order));

console.log('\n== Instelbare sync-regel (klacht 1 aug: "soms wel, soms niet") ==');
// Stond hardcoded op "alleen monteur Abdel of schuifpui". Nu instelbaar; standaard alles.
const dbmod = await import('../server/db.js');
const zetRegel = (r) => { dbmod.db().settings.googleSync = r; };
const kaartYoussef = { id: 'o1', title: 'Cilinderslot vervangen', description: '', appointmentAt: '2026-08-05T10:00', monteurId: 'm_you' };
const kaartSchuif = { id: 'o2', title: 'Hefschuifpui loopt zwaar', description: '', appointmentAt: '2026-08-05T10:00', monteurId: 'm_you' };
const you = { id: 'm_you', name: 'Youssef' };
const abd = { id: 'm_abd', name: 'Abdel Rafour' };
zetRegel({ mode: 'alles', monteurIds: [], keywords: 'schuifpui' });
ok('mode "alles": elke afspraak gaat naar Google', shouldSyncToGoogle(kaartYoussef, you) === true && shouldSyncToGoogle(kaartSchuif, abd) === true);
zetRegel({ mode: 'schuifpui', monteurIds: [], keywords: 'schuifpui, schuifdeur' });
ok('mode "schuifpui": alleen schuifpui-klussen', shouldSyncToGoogle(kaartSchuif, you) === true && shouldSyncToGoogle(kaartYoussef, you) === false);
zetRegel({ mode: 'monteurs', monteurIds: ['m_you'], keywords: 'schuifpui' });
ok('mode "monteurs": alleen de gekozen monteur', shouldSyncToGoogle(kaartYoussef, you) === true);
zetRegel({ mode: 'monteurs', monteurIds: ['m_abd'], keywords: 'schuifpui' });
ok('andere monteur wordt dan overgeslagen', shouldSyncToGoogle(kaartYoussef, you) === false);
zetRegel({ mode: 'monteurs+schuifpui', monteurIds: ['m_abd'], keywords: 'schuifpui' });
ok('oude gedrag blijft beschikbaar (monteur OF schuifpui)', shouldSyncToGoogle(kaartSchuif, you) === true && shouldSyncToGoogle(kaartYoussef, you) === false);
delete dbmod.db().settings.googleSync;
ok('zonder instelling: standaard ALLES (niets valt meer stil weg)', shouldSyncToGoogle(kaartYoussef, you) === true);

console.log(`\n========== RESULTAAT: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
