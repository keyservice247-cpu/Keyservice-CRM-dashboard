// Gezondheidscheck: test of de belangrijkste koppelingen nog werken
// (database-schrijfactie, AI, SMTP-verbinding, IMAP-instellingen) en bewaart
// het laatste resultaat zodat het dashboard het kan tonen.
import { db, save, saveSoonQuiet } from './db.js';
import { TEST } from './omgeving.js';
import { aiMode, MODELLEN, effortVoor } from './ai/categorizer.js';
import { smtpConfigured } from './connectors/email-smtp.js';

let lastResult = null;

// EERLIJKE CONTROLE (audit E5, 23 nov 2026): "niet ingesteld" telde als groen. Raakte een
// instelling op de server kwijt (bijvoorbeeld bij een wijziging in Render), dan stond er
// "Alle systemen werken" terwijl er geen mail meer binnenkwam. Nu onthoudt het systeem per
// koppeling dat hij ooit werkte; is hij daarna ineens "niet ingesteld", dan is dat ROOD.
// (Niet in de testomgeving: daar staan de koppelingen bewust uit.)
function gezien(naam, isIngesteld) {
  if (TEST) return false;
  const s = db().settings; s._koppelGezien = s._koppelGezien || {};
  if (isIngesteld) { if (!s._koppelGezien[naam]) { s._koppelGezien[naam] = new Date().toISOString(); saveSoonQuiet(); } return false; }
  return !!s._koppelGezien[naam];
}
const KWIJT = 'WAS ingesteld en is dat nu niet meer — de instelling ontbreekt op de server (Render → Environment).';

async function checkAI() {
  if (!process.env.ANTHROPIC_API_KEY) {
    if (gezien('ai', false)) return { ok: false, mode: 'demo', detail: `AI ${KWIJT}` };
    return { ok: true, mode: 'demo', detail: 'Demo-modus (geen AI-sleutel) — regels actief' };
  }
  gezien('ai', true);
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      // Zelfde model als de inbox-indeling (Haiku 5.5 denkt eerst: ruimere limiet, effort low).
      body: JSON.stringify((() => { const model = process.env.ANTHROPIC_MODEL || MODELLEN.snel; return { model, max_tokens: 64, ...effortVoor(model, 'low'), messages: [{ role: 'user', content: 'ping' }] }; })()),
    });
    if (resp.ok) return { ok: true, mode: 'ai', detail: 'Claude API reageert' };
    if (resp.status === 401) return { ok: false, mode: 'ai', detail: 'AI-sleutel ongeldig (401)' };
    if (resp.status === 429) return { ok: false, mode: 'ai', detail: 'AI-tegoed op of limiet bereikt (429)' };
    return { ok: false, mode: 'ai', detail: `AI gaf status ${resp.status}` };
  } catch (e) {
    return { ok: false, mode: 'ai', detail: 'Geen verbinding met AI: ' + e.message };
  }
}

async function checkSMTP() {
  if (!smtpConfigured()) {
    if (gezien('smtp', false)) return { ok: false, configured: false, detail: `E-mail versturen ${KWIJT}` };
    return { ok: true, configured: false, detail: 'Niet ingesteld (versturen uit)' };
  }
  gezien('smtp', true);
  try {
    const nodemailer = (await import('nodemailer')).default;
    const port = Number(process.env.SMTP_PORT || 465);
    const tx = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
    await tx.verify();
    return { ok: true, configured: true, detail: 'SMTP-login werkt' };
  } catch (e) {
    return { ok: false, configured: true, detail: 'SMTP-fout: ' + e.message };
  }
}

function checkDB() {
  try {
    const before = db()._healthPing || 0;
    db()._healthPing = before + 1;
    // LET OP: save() gooit geen fout maar geeft false terug bij een schrijffout
    // (bv. schijf vol). Dat resultaat MOET gecheckt worden — anders bleef de
    // systeemcheck groen terwijl wijzigingen alleen in het geheugen leefden en bij
    // een herstart verloren gingen (zo verdwenen op 18 jul ingeplande afspraken).
    const ok = save();
    if (!ok) return { ok: false, detail: 'Database schrijven MISLUKT — mogelijk schijf vol. Wijzigingen leven nu alleen in het geheugen en gaan bij een herstart verloren!' };
    return { ok: true, detail: 'Database schrijven werkt' };
  } catch (e) {
    return { ok: false, detail: 'Database-fout: ' + e.message };
  }
}

// "Ingesteld" is niet hetzelfde als "werkt" (audit 18 aug). De poller zet na elke geslaagde
// ronde een tijdstempel; blijft die langer dan 3 uur uit terwijl de server al zo lang
// draait, dan komt er géén mail meer binnen — en dat is rood.
function imapStilstand() {
  try {
    const laatst = db()._imapLaatstOk ? new Date(db()._imapLaatstOk).getTime() : 0;
    const draaitSinds = Number(process.uptime()) * 1000;
    if (draaitSinds > 3 * 3600000 && Date.now() - laatst > 3 * 3600000) {
      return { ok: false, configured: true, detail: `E-mail ONTVANGEN werkt niet: al ${laatst ? Math.round((Date.now() - laatst) / 3600000) + ' uur' : 'sinds de start'} geen geslaagde mailronde (${process.env.IMAP_HOST}). Controleer wachtwoord/mailbox.` };
    }
  } catch { /* nooit de check zelf laten omvallen */ }
  return null;
}

async function checkIMAP() {
  const on = !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
  if (!on) {
    if (gezien('imap', false)) return { ok: false, configured: false, detail: `E-mail ontvangen ${KWIJT}` };
    return { ok: true, configured: false, detail: 'Niet ingesteld (ontvangen uit)' };
  }
  gezien('imap', true);
  // EERST kijken of er nog mail wordt opgehaald (audit E-F18): de vulgraad-meting hieronder
  // gaf "Actief" terug vóórdat deze controle aan de beurt kwam, waardoor een mailronde die
  // al uren niet meer lukte toch groen bleef.
  const stil = imapStilstand();
  if (stil) return stil;
  // Ook de vulgraad van de mailbox meten: een volle mailbox weigert inkomende
  // klantmail en blokkeert versturen — dat is een ECHTE storing, dus rood.
  try {
    const { checkMailboxQuota } = await import('./connectors/email-imap.js');
    const q = await checkMailboxQuota();
    if (q && q.supported) {
      const parts = (q.boxes || []).filter((b) => b.supported)
        .map((b) => `${b.user} ${b.pct}% vol (${b.usedMB}/${b.limitMB} MB)`);
      // Postbussen waarvan de vulgraad NIET te meten is óók noemen — anders lijkt
      // "alles groen" terwijl een mailbox ongemerkt volloopt.
      for (const b of (q.boxes || []).filter((x) => !x.supported)) parts.push(`${b.user}: vulgraad niet meetbaar${b.error ? ` (${String(b.error).slice(0, 50)})` : ''}`);
      const full = (q.boxes || []).filter((b) => b.supported && b.pct >= 85);
      if (full.length) return { ok: false, configured: true, detail: `MAILBOX BIJNA VOL: ${parts.join(' · ')} — ruim op, anders mislukken mails!` };
      if (parts.length) return { ok: true, configured: true, detail: `Actief (${process.env.IMAP_HOST}) · ${parts.join(' · ')}` };
    }
  } catch { /* quotum niet opvraagbaar — val terug op de simpele melding */ }
  return { ok: true, configured: true, detail: `Actief (${process.env.IMAP_HOST})` };
}

export async function runHealthCheck() {
  const [ai, smtp, imap] = await Promise.all([checkAI(), checkSMTP(), checkIMAP()]);
  const result = {
    at: new Date().toISOString(),
    database: checkDB(),
    imap,
    smtp,
    ai,
  };
  result.allOk = [result.database, result.imap, result.smtp, result.ai].every((c) => c.ok);
  lastResult = result;
  return result;
}

// LICHTE RONDE (audit E5): zonder verbinding naar buiten en zonder AI-kosten. Kijkt elke
// 10 minuten of de database nog schrijft, of er nog mail wordt opgehaald en of er een
// instelling is weggevallen. De volledige ronde (SMTP-login, vulgraad mailbox, AI) blijft
// elke 6 uur draaien.
export function runLichteCheck() {
  if (!lastResult) return null;
  const r = { ...lastResult, at: new Date().toISOString(), database: checkDB() };
  const imapAan = !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
  if (imapAan) { const stil = imapStilstand(); if (stil) r.imap = stil; else if (r.imap && !r.imap.ok && /geen geslaagde mailronde/.test(r.imap.detail || '')) r.imap = { ok: true, configured: true, detail: `Actief (${process.env.IMAP_HOST})` }; }
  else if (gezien('imap', false)) r.imap = { ok: false, configured: false, detail: `E-mail ontvangen ${KWIJT}` };
  if (!smtpConfigured() && gezien('smtp', false)) r.smtp = { ok: false, configured: false, detail: `E-mail versturen ${KWIJT}` };
  if (!process.env.ANTHROPIC_API_KEY && gezien('ai', false)) r.ai = { ok: false, mode: 'demo', detail: `AI ${KWIJT}` };
  r.allOk = [r.database, r.imap, r.smtp, r.ai].every((c) => c && c.ok);
  lastResult = r;
  return r;
}

export function lastHealth() { return lastResult; }

// Periodieke check (elke 6 uur) + één keer kort na opstarten.
export function startHealthMonitor() {
  setTimeout(() => runHealthCheck().catch(() => {}), 15000);
  setInterval(() => runHealthCheck().catch(() => {}), 6 * 60 * 60 * 1000);
  setInterval(() => { try { runLichteCheck(); } catch { /* nooit laten omvallen */ } }, 10 * 60 * 1000);
}
