// Test: OFFERTE ONLINE GOEDKEUREN — de akkoordknop (27 nov 2026, voorstel 2, akkoord eigenaar).
// Bewaakt de vaste afspraken uit server/offerte-akkoord.js:
//   1. schakelaar standaard UIT: dan staat de link nergens in;
//   2. aan: de link staat in de offerte-mail (als groene knop), het WhatsApp-bericht, de
//      herinnering en de downloadpagina;
//   3. de link OPENEN keurt niets goed — alleen de knop (POST);
//   4. akkoord = offerte Goedgekeurd + factuur-concept + regel in de opdracht + "klant reageerde"
//      + klaarstaande herinneringen ingetrokken; twee keer tikken doet niets dubbel;
//   5. geknoeide link, factuur, afgekeurde of verlopen offerte: niet goed te keuren.
// Start ZELF een nep-mailserver (2661) en de CRM-server (3161). Er gaat niets naar buiten.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { akkoordStaat, geldigTot } from '../server/offerte-akkoord.js';

const schoneOmgeving = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SMTP_|IMAP_|SENT_IMAP_|WHATSAPP_|GOOGLE_|ANTHROPIC_|DATA_DIR$|OMGEVING$|APP_URL$|LINK_SECRET$)/.test(k)));
const PORT = 3161;
const SMTP_PORT = 2661;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'test123';
const DIR = mkdtempSync(join(tmpdir(), 'crm-akkoord-'));

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
  env: { ...schoneOmgeving(), APP_URL: BASE, AKKOORD_TEST: '1', DATA_DIR: DIR, INGEST_TOKEN: TOKEN, SESSION_SECRET: 'test', PORT: String(PORT), SMTP_HOST: '127.0.0.1', SMTP_PORT: String(SMTP_PORT), SMTP_USER: 'test@keyservice247.nl', SMTP_PASSWORD: 'x', SMTP_FROM: 'test@keyservice247.nl' },
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

const sigVoor = (id) => crypto.createHmac('sha256', 'test').update(`akkoord:${id}`).digest('hex').slice(0, 24);

// ---------- Deel 1: rekenregels (zonder server) ----------
console.log('\n== Rekenregels ==');
const NU = new Date('2026-11-27T12:00:00Z').getTime();
const verstuurd = { type: 'offerte', status: 'verzonden', sentAt: '2026-11-20T10:00:00Z' };
ok('verstuurde offerte binnen de geldigheid = open', akkoordStaat(verstuurd, { quoteValidDays: 30, nu: NU }) === 'open');
ok('na de geldigheid = verlopen (zelfde datum als op de PDF)', akkoordStaat({ ...verstuurd, sentAt: '2026-10-01T10:00:00Z' }, { quoteValidDays: 30, nu: NU }) === 'verlopen' && geldigTot({ sentAt: '2026-10-01T10:00:00Z' }, 30).toISOString().startsWith('2026-10-31'));
ok('goedgekeurd = al; concept, afgekeurd en factuur = gesloten', akkoordStaat({ ...verstuurd, status: 'goedgekeurd' }) === 'al' && akkoordStaat({ ...verstuurd, status: 'concept' }) === 'gesloten' && akkoordStaat({ ...verstuurd, status: 'afgekeurd' }) === 'gesloten' && akkoordStaat({ ...verstuurd, type: 'factuur' }) === 'gesloten');

try {
  console.log('\n== Deel 2: een echte offerte, per mail ==');
  ok('inloggen', (await api('POST', '/api/login', { email: 'admin@keyservice.nl', password: 'admin123' })).status === 200);
  const klant = (await api('POST', '/api/customers', { name: 'Akkoord Klant', email: 'akkoord@example.nl', phone: '0612341234', address: 'Laan 2, Rhenen' })).json;
  const order = (await api('POST', '/api/orders', { customerId: klant.id, title: 'Rhenen — schuifpui loopt zwaar', status: 'offerte_verzonden' })).json;
  const haal = async (id) => { const j = (await api('GET', `/api/invoices/${id}`)).json; return j.invoice || j; };
  const maakOfferte = async (prijs, metOpdracht = true) => {
    const r = (await api('POST', '/api/invoices', { customerId: klant.id, ...(metOpdracht ? { orderId: order.id } : {}), type: 'offerte' })).json;
    const inv = r.invoice || r;
    await api('PATCH', `/api/invoices/${inv.id}`, { lines: [{ description: 'Schuifpui afstellen', qty: 1, priceExcl: prijs }], btwPct: 21, note: '' });
    return haal(inv.id);
  };
  const laatsteMail = () => decodeer(mails[mails.length - 1] || '');
  const heleWachtrij = async () => (await api('GET', '/api/whatsapp/outbox-status?full=1')).json || [];

  // 1. standaard uit
  ok('schakelaar staat standaard UIT', (await api('GET', '/api/settings')).json.offerteAkkoord?.aan === false);
  const oA = await maakOfferte(100, false);
  const sA = await api('POST', `/api/invoices/${oA.id}/send`, {});
  await slaap(300);
  ok('UIT: offerte-mail gaat zoals altijd, zonder akkoordlink', sA.status === 200 && /offerte/i.test(laatsteMail()) && !/\/akkoord\//.test(laatsteMail()) && /Reageer op deze e-mail of bel ons/.test(laatsteMail()), JSON.stringify(sA.json).slice(0, 160));

  // 2. aanzetten (alleen met het recht Instellingen)
  const aan = await api('POST', '/api/offerte-akkoord/instelling', { aan: true });
  ok('beheerder zet de akkoordknop aan', aan.status === 200 && aan.json.aan === true && (await api('GET', '/api/settings')).json.offerteAkkoord.aan === true);
  ok('zonder aan/uit → 400', (await api('POST', '/api/offerte-akkoord/instelling', {})).status === 400);

  const oB = await maakOfferte(250);
  mails.length = 0;
  await api('POST', `/api/invoices/${oB.id}/send`, {});
  await slaap(300);
  const mailB = laatsteMail();
  const link = (mailB.match(/https?:\/\/[^\s"<]+\/akkoord\/[\w-]+\/[0-9a-f]{24}/) || [''])[0];
  ok('AAN: de offerte-mail bevat de akkoordlink van DEZE offerte', !!link && link.includes(`/akkoord/${oB.id}/`), mailB.slice(0, 300));
  ok('in de opgemaakte mail is het een groene knop "Ja, ik ga akkoord met de offerte"', /Content-Type: text\/html/i.test(mails[0] || '') && /Ja, ik ga akkoord met de offerte/.test(mailB) && new RegExp(`href="${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(mailB));
  const pad = link.replace(/^https?:\/\/[^/]+/, '');

  // 3. link openen keurt niets goed
  const g = await fetch(BASE + pad);
  const gHtml = await g.text();
  ok('de pagina toont nummer, bedrag, geldigheid en één knop', g.status === 200 && gHtml.includes(oB.number) && /302,50/.test(gHtml) && /geldig tot/.test(gHtml) && /Ja, ik ga akkoord met deze offerte/.test(gHtml) && /method="post"/.test(gHtml), gHtml.slice(0, 300));
  ok('de pagina is niet vindbaar en heeft strikte beveiligingskoppen', /noindex/.test(g.headers.get('x-robots-tag') || '') && /default-src 'none'/.test(g.headers.get('content-security-policy') || ''));
  ok('de link OPENEN keurt niets goed (mailscanners)', (await haal(oB.id)).status === 'verzonden');
  const bon = await (await fetch(`${BASE}${(gHtml.match(/\/bon\/[\w-]+\/[0-9a-f]{24}/) || [''])[0]}`)).text();
  ok('ook op de downloadpagina van de offerte staat de knop', /Ja, ik ga akkoord met de offerte/.test(bon) && bon.includes(`/akkoord/${oB.id}/`));

  // 5a. geknoeide link / factuur
  ok('geknoeide link → 404, niets gewijzigd', (await fetch(`${BASE}/akkoord/${oB.id}/${'a'.repeat(24)}`, { method: 'POST' })).status === 404 && (await haal(oB.id)).status === 'verzonden');
  const fac = (await api('POST', '/api/invoices', { customerId: klant.id, type: 'factuur' })).json; const facId = (fac.invoice || fac).id;
  ok('een FACTUUR kan nooit via deze route (ook niet met een geldige handtekening)', (await fetch(`${BASE}/akkoord/${facId}/${sigVoor(facId)}`, { method: 'POST' })).status === 404);

  // 4. akkoord geven
  const aantalVoor = ((await api('GET', '/api/invoices')).json || []).length;
  const p = await fetch(BASE + pad, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'naam=Jan%20Proef' });
  const pHtml = await p.text();
  const naB = await haal(oB.id);
  ok('de knop: bedankpagina en de offerte staat op Goedgekeurd, met wie en wanneer', p.status === 200 && /Bedankt, u bent akkoord/.test(pHtml) && naB.status === 'goedgekeurd' && !!naB.acceptedAt && naB.akkoordKlant?.naam === 'Jan Proef' && naB.akkoordKlant?.via === 'link', JSON.stringify({ s: naB.status, a: naB.akkoordKlant }));
  ok('het factuur-concept staat klaar (zoals bij de knop Goedgekeurd in het CRM)', !!naB.convertedInvoiceId && (await haal(naB.convertedInvoiceId)).status === 'concept');
  const naOrder = (await api('GET', `/api/orders/${order.id}`)).json;
  const ord = naOrder.order || naOrder;
  ok('lopende opdracht: GEEN nieuwe opdracht erbij, het bericht komt in de bestaande', !((await api('GET', '/api/orders')).json || []).some((o) => /Akkoord offerte/.test(o.title || '')) && naB.orderId === order.id);
  ok('in de opdracht: regel "ging online akkoord" + "klant reageerde"', (ord.thread || []).some((t) => /online akkoord met offerte/.test(t.body || '') && /Jan Proef/.test(t.body || '')) && ord.customerReplied === true, JSON.stringify((ord.thread || []).slice(-1)));
  ok('logboek: "offerte goedgekeurd via de akkoordknop"', ((await api('GET', '/api/activity')).json || []).some((a) => /akkoordknop/.test(`${a.action || ''} ${a.what || ''} ${a.detail || ''} ${JSON.stringify(a)}`)));
  const p2 = await (await fetch(BASE + pad, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'naam=Nog%20eens' })).text();
  ok('nog een keer tikken: nette bevestiging, geen tweede factuur, naam blijft', /al|akkoord/i.test(p2) && ((await api('GET', '/api/invoices')).json || []).length === aantalVoor + 1 && (await haal(oB.id)).akkoordKlant.naam === 'Jan Proef');
  ok('daarna toont de link "u bent akkoord"', /Bedankt, u bent akkoord/.test(await (await fetch(BASE + pad)).text()));

  console.log('\n== Herinnering en WhatsApp ==');
  const oC = await maakOfferte(80);
  await api('POST', `/api/invoices/${oC.id}/send`, {});
  mails.length = 0;
  const fu = await api('POST', `/api/invoices/${oC.id}/quote-followup`, {});
  await slaap(300);
  ok('offerte-herinnering per mail bevat de akkoordlink', fu.status === 200 && laatsteMail().includes(`/akkoord/${oC.id}/`), JSON.stringify(fu.json).slice(0, 160));
  const app = (await heleWachtrij()).find((o) => o.by === 'offerte-opvolging' && o.status === 'queued' && (o.text || '').includes(`/akkoord/${oC.id}/`));
  ok('de herinnering via WhatsApp bevat de akkoordlink', !!app, JSON.stringify((await heleWachtrij()).filter((o) => o.by === 'offerte-opvolging').map((o) => o.text)));
  await fetch(`${BASE}/akkoord/${oC.id}/${sigVoor(oC.id)}`, { method: 'POST' });
  const kort = (await api('GET', '/api/whatsapp/outbox-status')).json || [];
  ok('na het akkoord wordt die klaarstaande herinnering ingetrokken (staat niet meer klaar, met reden)', !!app && !(await heleWachtrij()).some((o) => o.id === app.id) && kort.some((o) => o.id === app.id && o.status === 'failed' && /ingetrokken: klant ging online akkoord/.test(o.lastResult)), JSON.stringify(kort.filter((o) => o.id === app?.id)));

  const oD = await maakOfferte(60);
  const wa = await api('POST', `/api/invoices/${oD.id}/send-whatsapp`, {});
  ok('offerte via WhatsApp: het bericht bevat de akkoordlink', wa.status === 200 && (await heleWachtrij()).some((o) => o.by === 'offerte-whatsapp' && (o.text || '').includes(`/akkoord/${oD.id}/`)), JSON.stringify(wa.json).slice(0, 160));

  console.log('\n== Niet goed te keuren ==');
  const oE = await maakOfferte(70);
  await api('POST', `/api/invoices/${oE.id}/send`, {});
  await api('POST', `/api/invoices/${oE.id}/status`, { status: 'afgekeurd' });
  const e1 = await (await fetch(`${BASE}/akkoord/${oE.id}/${sigVoor(oE.id)}`, { method: 'POST' })).text();
  ok('afgekeurde offerte: "kan niet meer online", status blijft afgekeurd', /kan niet meer online/.test(e1) && (await haal(oE.id)).status === 'afgekeurd');
  const oF = await maakOfferte(70);
  ok('concept (nooit verstuurd): niet goed te keuren', /kan niet meer online/.test(await (await fetch(`${BASE}/akkoord/${oF.id}/${sigVoor(oF.id)}`, { method: 'POST' })).text()) && (await haal(oF.id)).status === 'concept');

  console.log('\n== Zichtbaar in het CRM: Start, opdracht, Facturen ==');
  const punt = async () => ((await api('GET', '/api/overview')).json.eerstDoen || []).find((p) => p.sleutel === 'akkoord');
  const q1 = await punt();
  ok('Start: rood punt "ging akkoord met een offerte" bovenaan (twee offertes op deze opdracht)', !!q1 && q1.ernst === 'rood' && q1.aantal === 2 && /gingen akkoord met een offerte/.test(q1.titel) && /Plan de afspraak in/.test(q1.uitleg) && q1.afvinkbaar === true && ((await api('GET', '/api/overview')).json.eerstDoen || [])[0]?.sleutel === 'akkoord', JSON.stringify(q1));
  const ordNu = (await api('GET', `/api/orders/${order.id}`)).json; const o2 = ordNu.order || ordNu;
  ok('de opdracht draagt het akkoord (label op de kaart, balk in het venster)', !!o2.offerteAkkoord && [oB.number, oC.number].includes(o2.offerteAkkoord.nummer), JSON.stringify(o2.offerteAkkoord));
  // een losse offerte (zonder opdracht)
  // (een andere klant: een afspraak van DEZELFDE klant telt terecht als "al ingepland")
  const klantH = (await api('POST', '/api/customers', { name: 'Losse Klant', email: 'los@example.nl', phone: '0612349876' })).json;
  const rH = (await api('POST', '/api/invoices', { customerId: klantH.id, type: 'offerte' })).json; const oHid = (rH.invoice || rH).id;
  await api('PATCH', `/api/invoices/${oHid}`, { lines: [{ description: 'Cilinder', qty: 1, priceExcl: 120 }], btwPct: 21, note: '' });
  const oH = await haal(oHid);
  await api('POST', `/api/invoices/${oH.id}/send`, {});
  await fetch(`${BASE}/akkoord/${oH.id}/${sigVoor(oH.id)}`, { method: 'POST' });
  const q2 = await punt();
  ok('drie offertes: het punt gaat naar Facturen met het filter "online akkoord"', q2.aantal === 3 && q2.ga.view === 'invoices' && q2.ga.invFilter === 'akkoord', JSON.stringify(q2));
  const morgen = new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T10:00';
  const plan = await api('PATCH', `/api/orders/${order.id}`, { status: 'afspraak_ingepland', appointmentAt: morgen });
  const q3 = await punt();
  // De losse offerte kreeg een NIEUWE opdracht (wens eigenaar 27 nov).
  const alle = (await api('GET', '/api/orders')).json || [];
  const nieuwO = (Array.isArray(alle) ? alle : alle.orders || []).find((o) => /Akkoord offerte/.test(o.title || '') && (o.title || '').includes(oH.number));
  ok('losse offerte → NIEUWE opdracht in de eerste kolom met "Akkoord offerte <nummer>" in de titel', !!nieuwO && nieuwO.status === 'open' && nieuwO.source === 'Offerte akkoord (online)' && nieuwO.customerId === klantH.id, JSON.stringify(nieuwO && [nieuwO.title, nieuwO.status, nieuwO.source]));
  const vol = nieuwO ? ((await api('GET', `/api/orders/${nieuwO.id}`)).json) : {}; const nO = vol.order || vol;
  ok('met de klantgegevens, het afgesproken werk, het bedrag en de offerte als PDF', nO.intake?.phone === '0612349876' && nO.intake?.email === 'los@example.nl' && /Cilinder/.test(nO.description || '') && /145,20/.test(nO.description || '') && (nO.attachments || []).length === 1 && /pdf/i.test(nO.attachments[0].mime || '') && nO.attachments[0].filename.includes(oH.number), JSON.stringify({ i: nO.intake, d: nO.description, a: (nO.attachments || []).map((a) => a.filename) }));
  ok('de opdracht toont "nieuw bericht": systeemregel in het gesprek, klant reageerde, label offerte akkoord', (nO.thread || []).some((t) => /ging online akkoord/.test(t.body || '')) && nO.customerReplied === true && nO.unreadReplies >= 1 && nO.offerteAkkoord?.nummer === oH.number);
  const oHna = await haal(oH.id);
  ok('offerte en factuur-concept hangen aan de nieuwe opdracht', oHna.orderId === nO.id && !!oHna.convertedInvoiceId && (await haal(oHna.convertedInvoiceId)).orderId === nO.id && nO.invoiceId === oHna.convertedInvoiceId, JSON.stringify({ o: oHna.orderId, c: oHna.convertedInvoiceId, i: nO.invoiceId }));
  ok('afspraak ingepland op de eerste opdracht → die offertes vallen weg; de nieuwe blijft en opent die opdracht', plan.status === 200 && q3 && q3.aantal === 1 && q3.ga.open === nO.id && /ging akkoord met offerte/.test(q3.titel), JSON.stringify(q3));
  ok('GEEN herinnering meer na een akkoord: de knop weigert en er staat niets klaar', (await api('POST', `/api/invoices/${oH.id}/quote-followup`, {})).status === 400 && !(await heleWachtrij()).some((o) => ['offerte-opvolging', 'follow-up'].includes(o.by)));
  // Offerte hoort bij een opdracht die al is afgerond → ook een nieuwe opdracht (vervolg).
  const dicht = (await api('POST', '/api/orders', { customerId: klantH.id, title: 'Rhenen — oude klus', status: 'afgerond' })).json;
  const rI = (await api('POST', '/api/invoices', { customerId: klantH.id, orderId: dicht.id, type: 'offerte' })).json; const oIid = (rI.invoice || rI).id;
  await api('PATCH', `/api/invoices/${oIid}`, { lines: [{ description: 'Nieuwe loopwagens', qty: 2, priceExcl: 50 }], btwPct: 21, note: '' });
  await api('POST', `/api/invoices/${oIid}/send`, {});
  await fetch(`${BASE}/akkoord/${oIid}/${sigVoor(oIid)}`, { method: 'POST' });
  const alle2 = (await api('GET', '/api/orders')).json || [];
  const oI = await haal(oIid);
  const vervolg = (Array.isArray(alle2) ? alle2 : alle2.orders || []).find((o) => o.id === oI.orderId);
  ok('offerte bij een AFGERONDE opdracht → nieuwe opdracht; de oude blijft afgerond', !!vervolg && vervolg.id !== dicht.id && /Akkoord offerte/.test(vervolg.title) && vervolg.status === 'open' && ((await api('GET', `/api/orders/${dicht.id}`)).json.order || (await api('GET', `/api/orders/${dicht.id}`)).json).status === 'afgerond', JSON.stringify(vervolg && [vervolg.title, vervolg.status]));
  await api('POST', '/api/start/afvinken', { sleutel: 'akkoord', ids: [oIid] });
  ok('in de titel staat de naam van de klant en het offertenummer', q3 && q3.titel.includes('Losse Klant') && q3.titel.includes(oH.number), q3 && q3.titel);
  const af = await api('POST', '/api/start/afvinken', { sleutel: 'akkoord', ids: [oH.id] });
  ok('afvinken op Start haalt het punt weg', af.status === 200 && !(await punt()), JSON.stringify(af.json));

  console.log('\n== Eenmalige inhaalslag: eerder goedgekeurd zonder opdracht ==');
  // Nabootsen: de opdracht van de losse offerte is weg (zoals bij een akkoord van vóór deze versie).
  await api('DELETE', `/api/orders/${nO.id}`);
  const telAkkoord = async () => { const l = (await api('GET', '/api/orders')).json || []; return (Array.isArray(l) ? l : l.orders || []).filter((o) => (o.title || '').includes(`Akkoord offerte ${oH.number}`)); };
  ok('uitgangspunt: er staat geen opdracht meer voor die offerte op het bord', (await telAkkoord()).length === 0);
  await api('POST', '/api/offerte-akkoord/inhaal-test', {});
  const naInhaal = await telAkkoord();
  const volI = naInhaal[0] ? (await api('GET', `/api/orders/${naInhaal[0].id}`)).json : {}; const oI2 = volI.order || volI;
  ok('de inhaalslag zet er alsnog één opdracht voor neer, met het bericht, de PDF en de factuur eraan', naInhaal.length === 1 && (oI2.thread || []).some((t) => /ging online akkoord/.test(t.body || '')) && (oI2.attachments || []).length === 1 && oI2.offerteAkkoord?.nummer === oH.number && (await haal(oH.id)).orderId === oI2.id && !!oI2.invoiceId, JSON.stringify({ n: naInhaal.length, i: oI2.invoiceId }));
  await api('POST', '/api/offerte-akkoord/inhaal-test', {});
  ok('nog een keer draaien maakt geen tweede opdracht', (await telAkkoord()).length === 1);

  console.log('\n== Weer uit ==');
  await api('POST', '/api/offerte-akkoord/instelling', { aan: false });
  const oG = await maakOfferte(90);
  mails.length = 0;
  await api('POST', `/api/invoices/${oG.id}/send`, {});
  await slaap(300);
  ok('UIT: nieuwe offerte zonder link; een eerder verstuurde link blijft werken', !/\/akkoord\//.test(laatsteMail()) && (await fetch(`${BASE}/akkoord/${oG.id}/${sigVoor(oG.id)}`)).status === 200);
  const ass = await api('POST', '/api/users', { name: 'Assist Proef', email: 'assist@akkoord.test', password: 'assist-12345', role: 'assistent' });
  await api('POST', '/api/login', { email: 'assist@akkoord.test', password: 'assist-12345' });
  ok('assistente zonder recht Instellingen mag de schakelaar niet omzetten', ass.status === 200 && [401, 403].includes((await api('POST', '/api/offerte-akkoord/instelling', { aan: true })).status));
} catch (e) {
  failed++; bad.push(`test brak af: ${e.message}`); console.log(e.stack); console.log(log.slice(-1500));
} finally {
  proc.kill('SIGTERM'); smtp.close();
}
console.log(`\n========== OFFERTE-AKKOORD: ${passed} geslaagd, ${failed} gefaald ==========`);
if (bad.length) { console.log('Gefaald:', bad.join(' | ')); process.exit(1); }
process.exit(0);
