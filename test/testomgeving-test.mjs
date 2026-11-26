// Test: de TESTOMGEVING (OMGEVING=test) en de eerste beheerder uit de omgeving.
// Aanleiding: audit 20 nov 2026 — er was geen plek om een update eerst te bekijken, en
// een nieuwe installatie kon alleen met bekende voorbeeldwachtwoorden worden geopend.
// De test start de server ZELF (poort 3147), met een schone, minimale omgeving, en
// bewaakt de hardste regel: een testomgeving mag NOOIT met de buitenwereld praten, ook
// niet als iemand de sleutels van productie erin zet.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3147;
const BASE = `http://localhost:${PORT}`;
let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, cookie = '') {
  const headers = { 'content-type': 'application/json' }; if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const c = (r.headers.get('set-cookie') || '').split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json, cookie: c };
}
const login = (email, password) => api('POST', '/api/login', { email, password });

let proc = null;
// Bewust GEEN ...process.env: de server krijgt alleen wat hier staat (plus PATH/HOME).
async function start(dir, extra) {
  proc = spawn(process.execPath, ['server/index.js'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME || '', TZ: 'Europe/Amsterdam', DATA_DIR: dir, PORT: String(PORT), ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/login.html'); return () => log; } catch { await slaap(500); } }
  throw new Error('server start mislukt:\n' + log);
}
async function stop() {
  if (!proc) return; const p = proc; proc = null;
  const klaar = new Promise((r) => p.on('exit', r)); p.kill('SIGTERM');
  await Promise.race([klaar, slaap(8000)]); if (p.exitCode === null) p.kill('SIGKILL');
}
const takenVan = (j) => (Array.isArray(j) ? j : (j?.taken || j?.items || []));
const wachtOp = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await slaap(400); } return false; };

const D1 = mkdtempSync(join(tmpdir(), 'crm-testomg-a-'));
const D2 = mkdtempSync(join(tmpdir(), 'crm-testomg-b-'));
const D3 = mkdtempSync(join(tmpdir(), 'crm-testomg-c-'));
const WW = 'proef-wachtwoord-2026';
try {
  console.log('\n== 1. Testomgeving: koppelingen hard uit, ook met (nep)sleutels van "productie" ==');
  let log = await start(D1, {
    OMGEVING: 'test', ADMIN_EMAIL: 'eigenaar@voorbeeld.test', ADMIN_PASSWORD: WW,
    SMTP_HOST: 'smtp.nep.test', SMTP_USER: 'x', SMTP_PASSWORD: 'y', IMAP_HOST: 'imap.nep.test', IMAP_USER: 'x', IMAP_PASSWORD: 'y',
    IMAP_INGEST_ACCOUNTS: 'a@nep.test:ww', WHATSAPP_CLOUD_TOKEN: 'nep', WHATSAPP_PHONE_ID: '1', WHATSAPP_APP_SECRET: 'nep',
    GOOGLE_CLIENT_ID: 'nep', GOOGLE_CLIENT_SECRET: 'nep', ANTHROPIC_API_KEY: 'nep',
  });
  const me = await api('GET', '/api/me');
  ok('scherm weet dat dit de testomgeving is (meta.omgeving)', me.json?.meta?.omgeving === 'test');
  ok('AI staat uit (demo-modus), ondanks een sleutel in de omgeving', me.json?.meta?.aiMode === 'demo', me.json?.meta?.aiMode);
  ok('mail versturen staat uit, ondanks SMTP-instellingen', me.json?.meta?.canSendEmail === false);
  ok('opstartlog meldt: mail niet geconfigureerd', /SMTP\): niet geconfigureerd/.test(log()) && /IMAP\): niet geconfigureerd/.test(log()), log().slice(0, 300));
  ok('officiële WhatsApp-webhook bestaat niet (404) — geen app-secret', (await api('POST', '/api/ingest/whatsapp/cloud', { object: 'x' })).status === 404);

  const a = await login('eigenaar@voorbeeld.test', WW);
  ok('eigen beheerder uit ADMIN_EMAIL/ADMIN_PASSWORD kan inloggen', a.status === 200 && a.json?.user?.role === 'admin');
  const health = await api('GET', '/api/health', null, a.cookie);
  ok('systeemcheck: mail "niet ingesteld"', /Niet ingesteld/.test(JSON.stringify(health.json?.smtp || {})) && /Niet ingesteld/.test(JSON.stringify(health.json?.imap || {})), JSON.stringify(health.json).slice(0, 200));
  for (const [e, w] of [['admin@keyservice.nl', 'admin123'], ['sara@keyservice.nl', 'sara123'], ['ahmed@keyservice.nl', 'ahmed123']]) {
    ok(`voorbeeldaccount ${e.split('@')[0]} werkt hier NIET`, (await login(e, w)).status === 401);
  }
  const ass = await login('assistente@keyservice.test', WW);
  const mon = await login('monteur@keyservice.test', WW);
  ok('proefaccount assistente en monteur bestaan (zelfde wachtwoord)', ass.status === 200 && ass.json?.user?.role === 'assistent' && mon.status === 200 && mon.json?.user?.role === 'monteur');

  console.log('\n== 2. Verzonnen gegevens ==');
  ok('testgegevens zijn gevuld', await wachtOp(async () => takenVan((await api('GET', '/api/taken', null, a.cookie)).json).length >= 3));
  const orders = (await api('GET', '/api/orders', null, a.cookie)).json; const lijst = Array.isArray(orders) ? orders : orders.orders;
  ok('15 opdrachten in alle kolommen', lijst.length === 15 && new Set(lijst.map((o) => o.status)).size >= 5, `${lijst.length}`);
  ok('alle telefoonnummers zijn nepnummers (0611000…)', lijst.every((o) => !o.customer?.phone || /^0611000\d{3}$/.test(o.customer.phone)), lijst.map((o) => o.customer?.phone).join(','));
  const rv = (await api('GET', '/api/reviews?status=pending', null, a.cookie)).json;
  ok('inbox heeft aanvragen om te beoordelen', (rv.items || []).length >= 4, String((rv.items || []).length));
  const taken = takenVan((await api('GET', '/api/taken', null, a.cookie)).json);
  ok('de eigen starttaken van de eigenaar staan er NIET in (alleen 3 proeftaken)', taken.length === 3, taken.map((t) => t.titel).join(' | '));
  const mo = (await api('GET', '/api/orders', null, mon.cookie)).json; const ml = Array.isArray(mo) ? mo : mo.orders;
  ok('proefmonteur is gekoppeld en ziet alleen eigen opdrachten', ml.length >= 4 && ml.length < lijst.length && ml.every((o) => o.monteur?.name === 'Sam'), `${ml.length}`);
  const ob = (await api('GET', '/api/whatsapp/outbox-status?full=1', null, a.cookie)).json;
  ok('niets in een uitgaande wachtrij naar een klant', !(ob.items || ob.queue || []).some((i) => i.group === '__klant_dm__'), JSON.stringify(ob).slice(0, 160));
  ok('opstartlog noemt de testomgeving', /TESTOMGEVING: alle koppelingen staan uit/.test(log()));
  await stop();

  console.log('\n== 3. Gewone installatie, nieuw en leeg: geen voorbeeldaccounts meer ==');
  log = await start(D2, { SESSION_SECRET: 'een-echt-geheim-van-de-server', INGEST_TOKEN: 'x'.repeat(30) });
  ok('scherm zegt NIET testomgeving', (await api('GET', '/api/me')).json?.meta?.omgeving === '');
  for (const [e, w] of [['admin@keyservice.nl', 'admin123'], ['sara@keyservice.nl', 'sara123'], ['ahmed@keyservice.nl', 'ahmed123']]) {
    const r = await login(e, w); ok(`voorbeeldaccount ${e.split('@')[0]} bestaat niet / werkt niet`, r.status === 401 || r.status === 403, String(r.status));
  }
  ok('log legt uit hoe je de eerste beheerder maakt', /ADMIN_EMAIL en ADMIN_PASSWORD/.test(log()));
  await stop();

  console.log('\n== 4. Eerste beheerder uit de omgeving; bestaand wachtwoord wordt nooit overschreven ==');
  await start(D2, { SESSION_SECRET: 'een-echt-geheim-van-de-server', INGEST_TOKEN: 'x'.repeat(30), ADMIN_EMAIL: 'Baas@Voorbeeld.test', ADMIN_PASSWORD: WW });
  const b = await login('baas@voorbeeld.test', WW);
  ok('beheerder aangemaakt (e-mail in kleine letters)', b.status === 200 && b.json?.user?.role === 'admin');
  ok('geen proefaccounts buiten de testomgeving', (await login('assistente@keyservice.test', WW)).status === 401);
  // Campagnes staan op een echte installatie UIT tot de beheerder ze zelf aanzet (27 nov 2026).
  const meB = await api('GET', '/api/me', null, b.cookie);
  const cmpB = await api('GET', '/api/campagnes', null, b.cookie);
  ok('echte installatie: Campagnes staan standaard UIT (menu weg, route weigert)', meB.json?.meta?.campagnes === false && cmpB.status === 403 && cmpB.json?.uit === true, JSON.stringify([meB.json?.meta?.campagnes, cmpB.status]));
  const aanB = await api('POST', '/api/campagnes/aan', { aan: true }, b.cookie);
  ok('de beheerder zet ze zelf aan; daarna werkt het scherm', aanB.status === 200 && aanB.json.aan === true && (await api('GET', '/api/campagnes', null, b.cookie)).status === 200 && (await api('GET', '/api/me', null, b.cookie)).json.meta.campagnes === true);
  await api('POST', '/api/campagnes/aan', { aan: false }, b.cookie);
  await stop();
  await start(D2, { SESSION_SECRET: 'een-echt-geheim-van-de-server', INGEST_TOKEN: 'x'.repeat(30), ADMIN_EMAIL: 'baas@voorbeeld.test', ADMIN_PASSWORD: 'heel-ander-wachtwoord-1' });
  ok('de keuze "Campagnes uit" overleeft een herstart', (await api('GET', '/api/me', null, (await login('baas@voorbeeld.test', WW)).cookie)).json?.meta?.campagnes === false);
  ok('ander ADMIN_PASSWORD na herstart verandert het bestaande wachtwoord NIET', (await login('baas@voorbeeld.test', WW)).status === 200 && (await login('baas@voorbeeld.test', 'heel-ander-wachtwoord-1')).status === 401);
  await stop();
  log = await start(D3, { SESSION_SECRET: 'een-echt-geheim-van-de-server', INGEST_TOKEN: 'x'.repeat(30), ADMIN_EMAIL: 'baas@voorbeeld.test', ADMIN_PASSWORD: 'kort' });
  ok('te kort wachtwoord: geen beheerder, duidelijke melding', /korter dan 10 tekens/.test(log()) && (await login('baas@voorbeeld.test', 'kort')).status === 401);
  await stop();

  console.log('\n== 5. Lokale testrunner (SESSION_SECRET=test): voorbeeldaccounts blijven werken ==');
  const D4 = mkdtempSync(join(tmpdir(), 'crm-testomg-d-'));
  await start(D4, { SESSION_SECRET: 'test', INGEST_TOKEN: 'test123' });
  ok('admin-voorbeeldaccount werkt in de testrunner', (await login('admin@keyservice.nl', 'admin123')).status === 200);
  await stop(); rmSync(D4, { recursive: true, force: true });

  console.log('\n== 6. Bestanden ==');
  const idx = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  ok('omgeving.js is de EERSTE import van index.js', idx.indexOf("from './omgeving.js'") > 0 && idx.indexOf("from './omgeving.js'") < idx.indexOf("from 'express'"));
  const yml = readFileSync(new URL('../render.test.yaml', import.meta.url), 'utf8');
  ok('render.test.yaml: testdienst, eigen branch, geen schijf, geen sleutels van koppelingen', /name: keyservice-crm-test/.test(yml) && /branch: test/.test(yml) && /key: OMGEVING\s+value: test/.test(yml) && !/^\s*disk:/m.test(yml) && !/SMTP_|IMAP_|WHATSAPP_|ANTHROPIC_|GOOGLE_/.test(yml));
  ok('inlogpagina kan de testomgeving tonen', /testNoot/.test(readFileSync(new URL('../public/login.html', import.meta.url), 'utf8')));
} catch (e) {
  failed++; bad.push('onverwachte fout: ' + e.message); console.error(e);
} finally {
  await stop();
  for (const d of [D1, D2, D3]) rmSync(d, { recursive: true, force: true });
}
console.log(`\n========== TESTOMGEVING: ${passed} geslaagd, ${failed} gefaald ==========`);
if (failed) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
