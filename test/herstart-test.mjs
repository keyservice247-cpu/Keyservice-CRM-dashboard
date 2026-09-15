// Test: wat gebeurt er met de uitgaande wachtrij bij een HERSTART van het CRM?
// Casus Leenhuis/Den Haag (15 sep 2026): een opdracht stond twee keer in de wachtrij;
// het tweede exemplaar werd netjes als "dubbel" gemarkeerd, maar de herstelronde bij
// het opstarten zette dat dubbel bij de volgende deploy weer op queued — de monteur
// kreeg de opdracht een dag later nogmaals in zijn groep. Deze test start de server
// ZELF (poort 3135), maakt de situatie na, herstart de server op dezelfde database en
// controleert dat het dubbel niet terugkomt.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3135;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'test123';
const DIR = mkdtempSync(join(tmpdir(), 'crm-herstart-'));

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }

let cookie = '';
async function api(method, path, body, useToken = false) {
  const headers = { 'content-type': 'application/json' };
  if (useToken) headers['x-ingest-token'] = TOKEN;
  if (cookie && !useToken) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  let json = null;
  try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
async function startServer() {
  proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, DATA_DIR: DIR, INGEST_TOKEN: TOKEN, SESSION_SECRET: 'test', PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE + '/login.html'); return () => log; } catch { await slaap(500); }
  }
  throw new Error('server start mislukt:\n' + log);
}
async function stopServer() {
  if (!proc) return;
  const p = proc; proc = null;
  const klaar = new Promise((r) => p.on('exit', r));
  p.kill('SIGTERM');
  await Promise.race([klaar, slaap(8000)]);
  if (p.exitCode === null) p.kill('SIGKILL');
  cookie = '';
}

try {
  console.log('\n== Eerste start: dubbele opdracht in de wachtrij ==');
  let getLog = await startServer();
  const login = await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });
  ok('inloggen', login.status === 200);
  const mont = await api('POST', '/api/monteurs', { name: 'Oualid', phone: '0687654321', waGroup: 'Oualid key service / DRS opdrachten' });
  ok('monteur met groep aangemaakt', mont.status === 200 || mont.status === 201, String(mont.status));
  const cust = await api('POST', '/api/customers', { name: 'Leenhuis', phone: '0652470013', address: 'Het Hoenstraat 2596 HZ Den Haag' });
  const ord = await api('POST', '/api/orders', { title: 'Den Haag — buitengesloten', customerId: cust.json?.id, status: 'open', monteurId: mont.json?.id });
  ok('kaart aangemaakt', ord.status === 200 || ord.status === 201, JSON.stringify(ord.json).slice(0, 120));
  const oid = ord.json?.id;
  const d1 = await api('POST', `/api/orders/${oid}/send-monteur`, { monteurId: mont.json?.id });
  const d2 = await api('POST', `/api/orders/${oid}/send-monteur`, { monteurId: mont.json?.id });
  ok('twee keer naar de monteur gezet (twee wachtrij-items)', d1.status === 200 && d2.status === 200, `${d1.status}/${d2.status}`);
  const volledig = (await api('GET', '/api/whatsapp/outbox-status?full=1')).json || [];
  const items = volledig.filter((o) => o.orderId === oid);
  ok('beide items staan klaar', items.length === 2, String(items.length));

  // De bridge haalt de wachtrij op: één gaat mee, de ander wordt "dubbel".
  const ronde = (await api('GET', '/api/outbox', null, true)).json || [];
  ok('bridge krijgt maar ÉÉN exemplaar', ronde.filter((o) => o.orderId === oid).length === 1, String(ronde.length));
  const meegegeven = ronde.find((o) => o.orderId === oid);
  await api('POST', `/api/outbox/${meegegeven.id}/done`, { ok: true, detail: 'groep' }, true);
  const status1 = (await api('GET', '/api/whatsapp/outbox-status')).json || [];
  const dubbel = status1.find((o) => o.id !== meegegeven.id && /dubbel/i.test(o.lastResult || ''));
  ok('tweede exemplaar staat als MISLUKT "dubbel"', !!dubbel && dubbel.status === 'failed', JSON.stringify(status1.map((o) => [o.status, o.lastResult])));
  const dubbelId = dubbel?.id;

  console.log('\n== Herstart van het CRM op dezelfde database ==');
  await stopServer();
  getLog = await startServer();
  await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' });
  const naHerstart = (await api('GET', '/api/whatsapp/outbox-status')).json || [];
  const dubbel2 = naHerstart.find((o) => o.id === dubbelId);
  ok('dubbel blijft na herstart MISLUKT (niet opnieuw in de wachtrij)', !!dubbel2 && dubbel2.status === 'failed', JSON.stringify(dubbel2));
  const klaarNa = (await api('GET', '/api/whatsapp/outbox-status?full=1')).json || [];
  ok('geen enkel item voor deze kaart staat opnieuw klaar', klaarNa.filter((o) => o.orderId === oid).length === 0, String(klaarNa.length));
  const ronde2 = (await api('GET', '/api/outbox', null, true)).json || [];
  ok('de bridge krijgt de opdracht NIET nogmaals', ronde2.filter((o) => o.orderId === oid).length === 0);
  ok('herstelronde meldt geen herkansing in de log', !/mislukte groeps-bericht\(en\) terug in de wachtrij/.test(getLog()));
  const eerste = naHerstart.find((o) => o.id === meegegeven.id);
  ok('het verstuurde exemplaar blijft "verstuurd"', !!eerste && eerste.status === 'sent', JSON.stringify(eerste));
} catch (e) {
  failed++; bad.push('onverwachte fout: ' + e.message); console.error(e);
} finally {
  await stopServer();
  try { rmSync(DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

console.log(`\n========== HERSTART: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
