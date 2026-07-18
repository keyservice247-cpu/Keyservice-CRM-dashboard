// Gezondheidscheck: test of de belangrijkste koppelingen nog werken
// (database-schrijfactie, AI, SMTP-verbinding, IMAP-instellingen) en bewaart
// het laatste resultaat zodat het dashboard het kan tonen.
import { db, save } from './db.js';
import { aiMode } from './ai/categorizer.js';
import { smtpConfigured } from './connectors/email-smtp.js';

let lastResult = null;

async function checkAI() {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: true, mode: 'demo', detail: 'Demo-modus (geen AI-sleutel) — regels actief' };
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
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
  if (!smtpConfigured()) return { ok: true, configured: false, detail: 'Niet ingesteld (versturen uit)' };
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

async function checkIMAP() {
  const on = !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
  if (!on) return { ok: true, configured: false, detail: 'Niet ingesteld (ontvangen uit)' };
  // Ook de vulgraad van de mailbox meten: een volle mailbox weigert inkomende
  // klantmail en blokkeert versturen — dat is een ECHTE storing, dus rood.
  try {
    const { checkMailboxQuota } = await import('./connectors/email-imap.js');
    const q = await checkMailboxQuota();
    if (q && q.supported) {
      const parts = (q.boxes || []).filter((b) => b.supported)
        .map((b) => `${b.user} ${b.pct}% vol (${b.usedMB}/${b.limitMB} MB)`);
      const full = (q.boxes || []).filter((b) => b.supported && b.pct >= 90);
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

export function lastHealth() { return lastResult; }

// Periodieke check (elke 6 uur) + één keer kort na opstarten.
export function startHealthMonitor() {
  setTimeout(() => runHealthCheck().catch(() => {}), 15000);
  setInterval(() => runHealthCheck().catch(() => {}), 6 * 60 * 60 * 1000);
}
