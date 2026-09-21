// Test: PUSHMELDINGEN PER ROL (21 sep 2026). Deel 1 (zonder server): kiesToestellen —
// wie krijgt wat. Deel 2 (server op PORT=3141): aanmelden als monteur/assistente,
// status per rol, testmelding alleen naar jezelf, dispatch/afspraak breken niet.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'crm-pushtest-'));
const { kiesToestellen } = await import('../server/push.js');

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

console.log('\n== kiesToestellen: wie krijgt wat ==');
const users = [
  { id: 'u-adm', role: 'admin' }, { id: 'u-ass', role: 'assistent' },
  { id: 'u-m1', role: 'monteur', monteurId: 'mont-1' }, { id: 'u-m2', role: 'monteur', monteurId: 'mont-2' },
];
const subs = [
  { endpoint: 'e-adm', userId: 'u-adm' }, { endpoint: 'e-ass', userId: 'u-ass' },
  { endpoint: 'e-m1', userId: 'u-m1' }, { endpoint: 'e-m1b', userId: 'u-m1' }, { endpoint: 'e-m2', userId: 'u-m2' },
  { endpoint: 'e-oud' }, // toestel van vóór de rolregel (geen gebruiker) = kantoor
  { endpoint: 'e-weg', userId: 'u-verwijderd' }, // gebruiker bestaat niet meer
];
const ids = (aan) => kiesToestellen(aan, subs, users).map((s) => s.endpoint).sort().join(',');
ok('standaard (leeg) = kantoor: admin + assistent + oud toestel + wees, GEEN monteurs', ids(undefined) === 'e-adm,e-ass,e-oud,e-weg', ids(undefined));
ok("'kantoor' = zelfde als standaard", ids('kantoor') === ids(undefined));
ok("'admin' = alleen beheerder + oud toestel zonder gebruiker", ids('admin') === 'e-adm,e-oud', ids('admin'));
ok("'iedereen' = alle 7", kiesToestellen('iedereen', subs, users).length === 7);
ok('{ monteurId } = alleen de toestellen van díe monteur (2 van monteur 1)', ids({ monteurId: 'mont-1' }) === 'e-m1,e-m1b', ids({ monteurId: 'mont-1' }));
ok('{ monteurId } onbekend = niemand', ids({ monteurId: 'mont-x' }) === '');
ok('{ userIds } = precies die gebruikers', ids({ userIds: ['u-ass', 'u-m2'] }) === 'e-ass,e-m2', ids({ userIds: ['u-ass', 'u-m2'] }));
ok('{ userIds } pakt nooit een oud toestel zonder gebruiker', !ids({ userIds: ['u-adm'] }).includes('e-oud'));
ok('rol wordt LIVE opgezocht: assistente die admin wordt telt bij admin', kiesToestellen('admin', subs, users.map((u) => (u.id === 'u-ass' ? { ...u, role: 'admin' } : u))).some((s) => s.endpoint === 'e-ass'));

console.log('\n== Server: aanmelden per rol, status, testmelding ==');
const BASE = 'http://localhost:3141';
let cookie = '';
async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie'); if (setC) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}
const nepSub = (n) => ({ endpoint: `https://127.0.0.1:9/push/${n}`, keys: { p256dh: 'BPx', auth: 'aa' }, expirationTime: null });
await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });
const admCookie = cookie;
const mont = (await api('POST', '/api/monteurs', { name: 'Push Monteur', phone: '0611112222', waGroup: 'push groep' })).json;
const montId = mont?.id || mont?.monteur?.id;
await api('POST', '/api/users', { name: 'Push Monteur', email: 'pushmont@keyservice.nl', password: 'mont12345', role: 'monteur', monteurId: montId });
await api('POST', '/api/users', { name: 'Push Assistente', email: 'pushass@keyservice.nl', password: 'ass12345', role: 'assistent' });
ok('admin meldt toestel aan', (await api('POST', '/api/push/subscribe', nepSub('adm'))).status === 200);
const stAdm0 = (await api('GET', '/api/push/status')).json;
ok('status admin: 1 toestel, van mij 1, per rol admin 1', stAdm0.devices === 1 && stAdm0.mine === 1 && stAdm0.perRol && stAdm0.perRol.admin === 1, JSON.stringify(stAdm0));

cookie = '';
await api('POST', '/api/login', { email: 'pushmont@keyservice.nl', password: 'mont12345' });
const montCookie = cookie;
ok('monteur mag aanmelden', (await api('POST', '/api/push/subscribe', nepSub('m1'))).status === 200);
const stM = (await api('GET', '/api/push/status')).json;
ok('status monteur: alleen eigen toestellen (1), geen teamtotaal/perRol', stM.devices === 1 && stM.mine === 1 && !stM.perRol, JSON.stringify(stM));
const tM = (await api('POST', '/api/push/test', {})).json;
ok('testmelding monteur: 1 doel (alleen zijn eigen toestel; verzending naar nep-endpoint faalt stil)', tM && tM.doelen === 1, JSON.stringify(tM));

cookie = '';
await api('POST', '/api/login', { email: 'pushass@keyservice.nl', password: 'ass12345' });
ok('assistente mag aanmelden', (await api('POST', '/api/push/subscribe', nepSub('ass'))).status === 200);
const tA = (await api('POST', '/api/push/test', {})).json;
ok('testmelding assistente: 1 doel (niet de beheerder of de monteur)', tA && tA.doelen === 1, JSON.stringify(tA));
const stA = (await api('GET', '/api/push/status')).json;
ok('status assistente: teamtotaal 3, per rol admin 1 / assistent 1 / monteur 1', stA.devices === 3 && stA.perRol.admin === 1 && stA.perRol.assistent === 1 && stA.perRol.monteur === 1, JSON.stringify(stA));

console.log('\n== Server: dispatch en afspraak sturen een monteur-melding zonder te breken ==');
cookie = admCookie;
const ord = (await api('POST', '/api/orders', { title: 'Rhenen — pushtest slot', status: 'nieuw', description: 'test', customerName: 'Push Klant', customerPhone: '0655551111' })).json;
const ordId = ord?.id || ord?.order?.id;
ok('opdracht aangemaakt', !!ordId);
const disp = await api('POST', `/api/orders/${ordId}/send-monteur`, { monteurId: montId });
ok('handmatige dispatch naar monteur → 200 (push naar monteur gaat stil mee)', disp.status === 200, JSON.stringify(disp.json).slice(0, 150));
const appt = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
const p1 = await api('PATCH', `/api/orders/${ordId}`, { appointmentAt: appt });
ok('afspraak inplannen op kaart met monteur → 200', p1.status === 200, JSON.stringify(p1.json?.error));
const p2 = await api('PATCH', `/api/orders/${ordId}`, { appointmentAt: '' });
ok('afspraak annuleren → 200', p2.status === 200, JSON.stringify(p2.json?.error));
// Toestel afmelden werkt voor de monteur zelf.
cookie = montCookie;
ok('monteur meldt zijn toestel af', (await api('POST', '/api/push/unsubscribe', { endpoint: nepSub('m1').endpoint })).status === 200 && (await api('GET', '/api/push/status')).json.mine === 0);

console.log(`\n==========\nPush-test: ${passed} geslaagd, ${failed} gefaald`);
if (failed) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
