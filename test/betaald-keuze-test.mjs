// Test: BETAALD-KEUZE BIJ VERSTUREN (3 okt 2026, wens eigenaar: "facturen staan standaard
// op betaald, maar dat is niet altijd zo"). Het verstuur-venster vraagt bij elke factuur
// "Kan deze factuur als betaald worden verstuurd?" en stuurt betaald: true|false mee.
// Deze test start ZELF een nep-mailserver (SMTP) + de CRM-server (poort 3143), zodat
// ook de e-mailroute echt doorlopen wordt: mailtekst, status, paidAt, de automatische
// omzet-boeking in Cijfers en het terugzetten als versturen mislukt.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3143;
const SMTP_PORT = 2643;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'test123';
const DIR = mkdtempSync(join(tmpdir(), 'crm-betaald-'));

let passed = 0, failed = 0; const bad = [];
function ok(name, cond, extra = '') { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; bad.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); } }
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Nep-SMTP: accepteert alles, bewaart de berichten; kan ook weigeren ----------
const mails = []; const enveloppen = [];
let weigerOntvanger = false;
const smtp = createServer((sock) => {
  let data = false; let buf = ''; let huidig = ''; let rcpt = [];
  sock.write('220 nep-smtp klaar\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const regel = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (regel === '.') { data = false; mails.push(huidig); enveloppen.push(rcpt); rcpt = []; huidig = ''; sock.write('250 OK opgeslagen\r\n'); }
        else huidig += regel.replace(/^\.\./, '.') + '\n';
        continue;
      }
      const cmd = regel.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') sock.write('250-nep-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
      else if (cmd === 'HELO') sock.write('250 nep-smtp\r\n');
      else if (cmd === 'AUTH') {
        if (/PLAIN\s+\S+/i.test(regel)) sock.write('235 OK\r\n');
        else if (/PLAIN/i.test(regel)) sock.write('334 \r\n');
        else if (/LOGIN/i.test(regel)) { sock.write('334 VXNlcm5hbWU6\r\n'); sock._login = 1; }
      } else if (sock._login === 1) { sock._login = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }
      else if (sock._login === 2) { sock._login = 0; sock.write('235 OK\r\n'); }
      else if (cmd === 'MAIL') sock.write('250 OK\r\n');
      else if (cmd === 'RCPT') { rcpt.push(regel.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, '$1').toLowerCase()); sock.write(weigerOntvanger ? '550 5.1.1 recipient rejected\r\n' : '250 OK\r\n'); }
      else if (cmd === 'DATA') { data = true; sock.write('354 ga je gang\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 doei\r\n'); sock.end(); }
      else if (cmd === 'RSET' || cmd === 'NOOP') sock.write('250 OK\r\n');
      else if (regel.length && !sock._login) sock.write('235 OK\r\n'); // base64-antwoord na "334 " (AUTH PLAIN)
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => smtp.listen(SMTP_PORT, r));

let cookie = '';
async function api(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get('set-cookie'); if (setC) cookie = setC.split(';')[0];
  let json = null; try { json = await r.json(); } catch { /* leeg */ }
  return { status: r.status, json };
}

const proc = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATA_DIR: DIR, INGEST_TOKEN: TOKEN, SESSION_SECRET: 'test', PORT: String(PORT), SMTP_HOST: '127.0.0.1', SMTP_PORT: String(SMTP_PORT), SMTP_USER: 'test@keyservice247.nl', SMTP_PASSWORD: 'x', SMTP_FROM: 'test@keyservice247.nl' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
let gestart = false;
for (let i = 0; i < 60 && !gestart; i++) { try { await fetch(BASE + '/login.html'); gestart = true; } catch { await slaap(500); } }
if (!gestart) { console.log('server start mislukt:\n' + log); process.exit(1); }

const decodeer = (raw) => {
  // quoted-printable grof terugzetten zodat we op tekst kunnen zoeken
  return raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
};

try {
  ok('inloggen', (await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' })).status === 200);
  const klant = (await api('POST', '/api/customers', { name: 'Betaal Klant', email: 'betaal@example.nl', phone: '0612340000', address: 'Laan 1, Rhenen' })).json;
  const order = (await api('POST', '/api/orders', { customerId: klant.id, title: 'Rhenen — slot vervangen', status: 'afgerond' })).json;
  const maakFactuur = async (prijs) => {
    const r = (await api('POST', '/api/invoices', { customerId: klant.id, orderId: order.id, type: 'factuur' })).json;
    const inv = r.invoice || r;
    await api('PATCH', `/api/invoices/${inv.id}`, { lines: [{ description: 'Cilinder vervangen', qty: 1, priceExcl: prijs }], btwPct: 21, note: '' });
    return (await api('GET', `/api/invoices/${inv.id}`)).json.invoice || (await api('GET', `/api/invoices/${inv.id}`)).json;
  };
  const haal = async (id) => { const j = (await api('GET', `/api/invoices/${id}`)).json; return j.invoice || j; };
  const maand = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 7);
  const omzetVoor = async (id) => ((await api('GET', `/api/finance?month=${maand}`)).json.report.entries || []).filter((e) => e.sourceRef === `inv:${id}`);

  console.log('\n== 1. Standaard betaald, verstuurd als NOG NIET BETAALD (e-mail) ==');
  const f1 = await maakFactuur(100);
  ok('nieuwe factuur staat standaard op betaald', f1.status === 'betaald' && !!f1.paidAt, JSON.stringify({ s: f1.status }));
  await api('POST', '/api/finance/autosync', {});
  ok('omzet automatisch geboekt (standaard betaald)', (await omzetVoor(f1.id)).length === 1);
  const s1 = await api('POST', `/api/invoices/${f1.id}/send`, { betaald: false });
  ok('versturen lukt', s1.status === 200, JSON.stringify(s1.json).slice(0, 200));
  const f1na = await haal(f1.id);
  ok('status nu Verzonden (open), betaaldatum weg', f1na.status === 'verzonden' && !f1na.paidAt && !!f1na.sentAt, JSON.stringify({ s: f1na.status, p: f1na.paidAt }));
  ok('keuze vastgelegd op de factuur', f1na.betaaldKeuze && f1na.betaaldKeuze.betaald === false);
  ok('automatische omzet-boeking teruggedraaid', (await omzetVoor(f1.id)).length === 0);
  const m1 = decodeer(mails[mails.length - 1] || '');
  ok('mail vraagt om betaling (geen "voldaan")', /graag betalen binnen/i.test(m1) && !/al voldaan/i.test(m1), m1.slice(0, 300));
  await api('POST', '/api/finance/autosync', {});
  ok('volgende autosync boekt hem NIET opnieuw (niet betaald)', (await omzetVoor(f1.id)).length === 0);
  // Later toch betaald → knop ✓ Betaald → telt weer mee.
  await api('POST', `/api/invoices/${f1.id}/status`, { status: 'betaald' });
  await api('POST', '/api/finance/autosync', {});
  ok('na ✓ Betaald telt de omzet weer mee', (await omzetVoor(f1.id)).length === 1);

  console.log('\n== 2. Verstuurd als BETAALD (e-mail) ==');
  const f2 = await maakFactuur(200);
  const s2 = await api('POST', `/api/invoices/${f2.id}/send`, { betaald: true });
  const f2na = await haal(f2.id);
  ok('blijft betaald + verstuurd (vergrendeld)', s2.status === 200 && f2na.status === 'betaald' && !!f2na.paidAt && !!f2na.sentAt);
  const m2 = decodeer(mails[mails.length - 1] || '');
  ok('mail zegt "al voldaan"', /al voldaan/i.test(m2) && !/graag betalen binnen/i.test(m2), m2.slice(0, 300));

  console.log('\n== 3. Concept (niet standaard betaald) verstuurd als BETAALD ==');
  await api('PATCH', '/api/settings', { invoiceSettings: { standaardBetaald: false } });
  const f3 = await maakFactuur(50);
  ok('met de instelling uit: nieuwe factuur = concept', f3.status === 'concept', f3.status);
  await api('POST', `/api/invoices/${f3.id}/send`, { betaald: true });
  const f3na = await haal(f3.id);
  ok('concept → betaald + betaaldatum bij versturen als betaald', f3na.status === 'betaald' && !!f3na.paidAt && !!f3na.sentAt, JSON.stringify({ s: f3na.status }));
  await api('POST', '/api/finance/autosync', {});
  ok('en telt dan mee als omzet', (await omzetVoor(f3.id)).length === 1);
  const f3b = await maakFactuur(60);
  await api('POST', `/api/invoices/${f3b.id}/send`, { betaald: false });
  ok('concept verstuurd als nog niet betaald → Verzonden', (await haal(f3b.id)).status === 'verzonden');
  await api('PATCH', '/api/settings', { invoiceSettings: { standaardBetaald: true } });

  console.log('\n== 4. Versturen MISLUKT → keuze teruggezet ==');
  const f4 = await maakFactuur(80);
  weigerOntvanger = true;
  const s4 = await api('POST', `/api/invoices/${f4.id}/send`, { betaald: false });
  weigerOntvanger = false;
  const f4na = await haal(f4.id);
  ok('mislukte verzending geeft een fout', s4.status >= 400, JSON.stringify(s4));
  ok('status + betaaldatum onveranderd (nog steeds betaald, niet verstuurd)', f4na.status === 'betaald' && !!f4na.paidAt && !f4na.sentAt, JSON.stringify({ s: f4na.status, p: f4na.paidAt, sent: f4na.sentAt }));

  console.log('\n== 5. WhatsApp: keuze gaat mee in tekst en status ==');
  const f5 = await maakFactuur(120);
  const w5 = await api('POST', `/api/invoices/${f5.id}/send-whatsapp`, { betaald: false });
  const f5na = await haal(f5.id);
  ok('WhatsApp als nog niet betaald → Verzonden, geen betaaldatum', w5.status === 200 && w5.json.status === 'verzonden' && f5na.status === 'verzonden' && !f5na.paidAt, JSON.stringify(w5.json));
  const ob = (await api('GET', '/api/whatsapp/outbox-status?full=1')).json || [];
  const item5 = (Array.isArray(ob) ? ob : ob.items || []).find((x) => x.invoiceId === f5.id);
  ok('WhatsApp-tekst zegt NIET dat hij voldaan is', item5 && !/voldaan/i.test(item5.text || ''), item5 && item5.text);
  const f6 = await maakFactuur(130);
  await api('POST', `/api/invoices/${f6.id}/send-whatsapp`, { betaald: true });
  const ob2 = (await api('GET', '/api/whatsapp/outbox-status?full=1')).json || [];
  const item6 = (Array.isArray(ob2) ? ob2 : ob2.items || []).find((x) => x.invoiceId === f6.id);
  ok('WhatsApp als betaald → tekst "al voldaan", status betaald', item6 && /voldaan/i.test(item6.text || '') && (await haal(f6.id)).status === 'betaald', item6 && item6.text);

  console.log('\n== 6. Zonder keuze (oud scherm) en offerte: gedrag ongewijzigd ==');
  const f7 = await maakFactuur(70);
  await api('POST', `/api/invoices/${f7.id}/send`, {});
  ok('zonder betaald-veld blijft een betaalde factuur betaald', (await haal(f7.id)).status === 'betaald');
  const off = ((await api('POST', '/api/invoices', { customerId: klant.id, orderId: order.id, type: 'offerte' })).json);
  const offId = (off.invoice || off).id;
  await api('PATCH', `/api/invoices/${offId}`, { lines: [{ description: 'Offerte slot', qty: 1, priceExcl: 99 }], btwPct: 21, note: '' });
  await api('POST', `/api/invoices/${offId}/send`, { betaald: true });
  ok('offerte negeert het betaald-veld (wordt gewoon Verzonden)', (await haal(offId)).status === 'verzonden');

  console.log('\n== 7. Verstuurde betaalde factuur opnieuw sturen als nog niet betaald (assistente) ==');
  await api('POST', '/api/users', { name: 'Assistente Betaal', email: 'assist-betaal@keyservice.nl', password: 'assist123', role: 'assistent' });
  const adminCookie = cookie; cookie = '';
  await api('POST', '/api/login', { email: 'assist-betaal@keyservice.nl', password: 'assist123' });
  const s8 = await api('POST', `/api/invoices/${f2.id}/send`, { to: 'betaal@example.nl', betaald: false });
  const f2b = await haal(f2.id);
  ok('assistente mag het (zelfde recht als "Nog niet betaald")', s8.status === 200 && f2b.status === 'verzonden' && !f2b.paidAt, JSON.stringify({ st: s8.status, s: f2b.status }));
  cookie = adminCookie;

  console.log('\n== 8. Opnieuw versturen als nog niet betaald: termijn begint NU (audit 3 okt) ==');
  const lijst8 = (await api('GET', '/api/invoices')).json;
  const f2lijst = lijst8.find((i) => i.id === f2.id);
  const f2c = await haal(f2.id);
  ok('betaalStart gezet bij betaald → open van een al verstuurde factuur', !!f2c.betaalStart && f2c.remindCount === 0, JSON.stringify({ bs: f2c.betaalStart, rc: f2c.remindCount }));
  ok('vervaldatum in het overzicht ligt in de toekomst (niet VERLOPEN)', f2lijst && f2lijst.dueAt && new Date(f2lijst.dueAt).getTime() > Date.now(), f2lijst && f2lijst.dueAt);
  // Zelfde via de knop "Nog niet betaald" op een als betaald verstuurde factuur.
  const f9 = await maakFactuur(90);
  await api('POST', `/api/invoices/${f9.id}/send`, { betaald: true });
  await api('POST', `/api/invoices/${f9.id}/status`, { status: 'verzonden' });
  ok('knop "Nog niet betaald" op een verstuurde factuur zet ook betaalStart', !!(await haal(f9.id)).betaalStart);

  console.log('\n== 9. WhatsApp-terugmelding van de bridge (audit 3 okt) ==');
  const TOK = { 'content-type': 'application/json', 'x-ingest-token': TOKEN };
  const done = (id, body) => fetch(`${BASE}/api/outbox/${id}/done`, { method: 'POST', headers: TOK, body: JSON.stringify(body) });
  const itemVoor = async (invId) => { const ob = (await api('GET', '/api/whatsapp/outbox-status?full=1')).json || []; return (Array.isArray(ob) ? ob : ob.items || []).filter((x) => x.invoiceId === invId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]; };
  // a) eerste verzending mislukt bij de bridge → terug naar concept
  const fa = await maakFactuur(55);
  await api('POST', `/api/invoices/${fa.id}/send-whatsapp`, { betaald: false });
  await done((await itemVoor(fa.id)).id, { ok: false, detail: 'nummer bestaat niet op WhatsApp' });
  const faNa = await haal(fa.id);
  ok('bridge meldt mislukt → factuur terug naar concept, niet meer "verzonden"', faNa.status === 'concept' && !faNa.sentAt, JSON.stringify({ s: faNa.status, sent: faNa.sentAt }));
  // b) eerst gelukt, daarna een herverzending die mislukt → niets terugdraaien
  const fb = await maakFactuur(66);
  await api('POST', `/api/invoices/${fb.id}/send-whatsapp`, { betaald: false });
  await done((await itemVoor(fb.id)).id, { ok: true });
  const fbVoor = await haal(fb.id);
  await api('POST', `/api/invoices/${fb.id}/send-whatsapp`, { betaald: false });
  await done((await itemVoor(fb.id)).id, { ok: false, detail: 'bridge-fout' });
  const fbNa = await haal(fb.id);
  ok('mislukte HERverzending laat de eerder bezorgde factuur staan (status + datum)', fbNa.status === 'verzonden' && fbNa.sentAt === fbVoor.sentAt, JSON.stringify({ s: fbNa.status, voor: fbVoor.sentAt, na: fbNa.sentAt }));

  console.log('\n== 10. Automatisch goedgekeurde website-lead krijgt de ontvangstbevestiging ==');
  await api('PATCH', '/api/settings', { aiAutoApproveThreshold: 0.5, autoReply: { enabled: true } });
  const voorMails = mails.length;
  const lead = await fetch(`${BASE}/api/ingest/form?token=${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Lisa Lead', phone: '0677788899', email: 'lisa.lead@example.nl', message: 'Mijn schuifpui loopt heel zwaar, kunnen jullie langskomen?', formType: 'offerte', site: 'schuifpuiservice.com' }) }).then((r) => r.json());
  await slaap(1500);
  const bevestiging = mails.slice(voorMails).map(decodeer).find((m) => /lisa\.lead@example\.nl/i.test(m));
  ok('lead automatisch goedgekeurd', lead.status === 'auto_approved', JSON.stringify(lead));
  ok('en de klant krijgt de ontvangstbevestiging (niet onterecht "al in behandeling")', !!bevestiging, `mails erbij: ${mails.length - voorMails}`);

  console.log('\n== 11. Trustpilot-uitnodiging: alleen als jij het kiest (5 okt 2026) ==');
  const TP = 'schuifpuiservice.com+test123@invite.trustpilot.com';
  const fout = await api('PATCH', '/api/settings', { trustpilot: { bcc: 'iemand@gmail.com' } });
  ok('geen Trustpilot-adres → geweigerd met uitleg', fout.status === 400 && /invite\.trustpilot\.com/.test(fout.json?.error || ''), JSON.stringify(fout.json));
  await api('PATCH', '/api/settings', { trustpilot: { bcc: TP, standaardAan: false } });
  const meTp = (await api('GET', '/api/me')).json.meta.trustpilot;
  ok('scherm weet dat Trustpilot aan staat (zonder het adres te tonen)', meTp && meTp.aan === true && !JSON.stringify(meTp).includes('invite'), JSON.stringify(meTp));
  const fT1 = await maakFactuur(150);
  let n = enveloppen.length;
  await api('POST', `/api/invoices/${fT1.id}/send`, { betaald: true });
  ok('factuurmail ZONDER vinkje → geen Trustpilot in BCC', enveloppen.length === n + 1 && !enveloppen[n].includes(TP.toLowerCase()), JSON.stringify(enveloppen[n]));
  const fT2 = await maakFactuur(160);
  n = enveloppen.length;
  const sT2 = await api('POST', `/api/invoices/${fT2.id}/send`, { betaald: true, trustpilot: true });
  ok('factuurmail MET vinkje → Trustpilot in BCC (en klant als ontvanger)', sT2.json?.trustpilot === true && enveloppen[n].includes(TP.toLowerCase()) && enveloppen[n].includes('betaal@example.nl'), JSON.stringify(enveloppen[n]));
  ok('BCC staat niet zichtbaar in de mail zelf', !/invite\.trustpilot/i.test(mails[mails.length - 1] || ''));
  ok('uitnodiging vastgelegd op klant en opdracht', !!(await haal(fT2.id)).trustpilotAt);
  const offTp = ((await api('POST', '/api/invoices', { customerId: klant.id, orderId: order.id, type: 'offerte' })).json);
  const offTpId = (offTp.invoice || offTp).id;
  await api('PATCH', `/api/invoices/${offTpId}`, { lines: [{ description: 'Offerte', qty: 1, priceExcl: 99 }], btwPct: 21, note: '' });
  n = enveloppen.length;
  await api('POST', `/api/invoices/${offTpId}/send`, { trustpilot: true });
  ok('offerte nooit met Trustpilot', !enveloppen[n].includes(TP.toLowerCase()));
  // Knop op de opdracht: bedankmailtje + BCC; tweede keer → 409 tenzij force.
  const o2 = (await api('POST', '/api/orders', { customerId: klant.id, title: 'Rhenen — trustpilot test', status: 'afgerond' })).json;
  const kl2 = (await api('POST', '/api/customers', { name: 'Tina Trust', email: 'tina@example.nl' })).json;
  const o3 = (await api('POST', '/api/orders', { customerId: kl2.id, title: 'Ede — trustpilot knop', status: 'afgerond' })).json;
  n = enveloppen.length;
  const k1 = await api('POST', `/api/orders/${o3.id}/trustpilot`, {});
  ok('knop Trustpilot op afgeronde opdracht: bedankmail aan de klant met Trustpilot in BCC', k1.status === 200 && enveloppen[n] && enveloppen[n].includes('tina@example.nl') && enveloppen[n].includes(TP.toLowerCase()) && /Trustpilot/.test(decodeer(mails[mails.length - 1])) && /Tina Trust/.test(decodeer(mails[mails.length - 1])), JSON.stringify({ st: k1.status, env: enveloppen[n] }));
  const k2 = await api('POST', `/api/orders/${o3.id}/trustpilot`, {});
  ok('tweede keer: eerst waarschuwen (409 "al uitgenodigd")', k2.status === 409 && /al uitgenodigd/.test(k2.json?.error || ''), JSON.stringify(k2.json));
  const kl3 = (await api('POST', '/api/customers', { name: 'Zonder Mail', phone: '0611112222' })).json;
  const o4 = (await api('POST', '/api/orders', { customerId: kl3.id, title: 'Tiel — geen mail', status: 'afgerond' })).json;
  const k3 = await api('POST', `/api/orders/${o4.id}/trustpilot`, {});
  ok('klant zonder e-mail: nette uitleg', k3.status === 400 && /e-mailadres/.test(k3.json?.error || ''), JSON.stringify(k3.json));
  const oThread = ((await api('GET', `/api/orders/${o3.id}`)).json.thread || []);
  ok('kaart-historie toont dat de uitnodiging is meegestuurd', oThread.some((t) => /Trustpilot-uitnodiging meegestuurd/.test(t.body || '')));
  // Knop Trustpilot vanaf een FACTUUR (6 okt 2026): ook bij een losse factuur, BCC in de envelop.
  const kl5 = (await api('POST', '/api/customers', { name: 'Frida Factuur', email: 'frida@example.nl' })).json;
  const fF = (await api('POST', '/api/invoices', { customerId: kl5.id, type: 'factuur' })).json;
  const fFid = (fF.invoice || fF).id;
  await api('PATCH', `/api/invoices/${fFid}`, { lines: [{ description: 'Cilinder', qty: 1, priceExcl: 80 }], btwPct: 21, note: '' });
  n = enveloppen.length;
  const kf1 = await api('POST', `/api/invoices/${fFid}/trustpilot`, {});
  ok('knop Trustpilot op een (losse) factuur: bedankmail aan de klant met Trustpilot in BCC', kf1.status === 200 && kf1.json?.to === 'frida@example.nl' && enveloppen[n] && enveloppen[n].includes('frida@example.nl') && enveloppen[n].includes(TP.toLowerCase()) && /Frida Factuur/.test(decodeer(mails[mails.length - 1])), JSON.stringify({ st: kf1.status, j: kf1.json, env: enveloppen[n] }));
  ok('… vastgelegd op de factuur (✓ op de knop)', !!(await haal(fFid)).trustpilotAt && !!kf1.json?.trustpilotAt);
  const kf2 = await api('POST', `/api/invoices/${fFid}/trustpilot`, {});
  ok('factuur: tweede keer eerst waarschuwen (409)', kf2.status === 409 && /al uitgenodigd/.test(kf2.json?.error || ''), JSON.stringify(kf2.json));
  n = enveloppen.length;
  const kf3 = await api('POST', `/api/invoices/${fFid}/trustpilot`, { force: true });
  ok('factuur: bewust nog een keer (force) → verstuurd', kf3.status === 200 && enveloppen.length === n + 1);
  const kf4 = await api('POST', `/api/invoices/${offTpId}/trustpilot`, {});
  ok('offerte: geen Trustpilot-knop (400)', kf4.status === 400, JSON.stringify(kf4.json));
  void o2;
} finally {
  proc.kill('SIGTERM');
  smtp.close();
}
console.log(`\n========== BETAALD-KEUZE: ${passed} geslaagd, ${failed} gefaald ==========`);
if (failed) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
