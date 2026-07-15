// Ingebouwde e-mailkoppeling (IMAP) — haalt zelf nieuwe e-mails op uit je
// mailbox (bijv. TransIP) en zet ze in de verwerking. Geen externe dienst nodig.
//
// Aanzetten: vul in .env de variabelen IMAP_HOST, IMAP_USER en IMAP_PASSWORD in.
// Staat dat er niet, dan slaat deze koppeling zichzelf netjes over.
//
// BELANGRIJK: we halen mails op op basis van DATUM (laatste X dagen) en
// ontdubbelen op messageId — NIET op de "ongelezen"-vlag. Zo verdwijnt een
// binnengekomen opdracht niet als iemand de mail eerst in webmail/Outlook opent.
import { db, id, now, saveSoon, logActivity } from '../db.js';
import { ingestMessage, findCustomer } from '../pipeline.js';
import { saveBuffer } from '../storage.js';
import { maybeSendAutoReply } from '../autoreply.js';

let polling = false;

export function startEmailPoller() {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;

  if (!host || !user || !pass) {
    console.log('  E-mail (IMAP): niet geconfigureerd — vul IMAP_* in .env om aan te zetten.');
    return;
  }

  const port = Number(process.env.IMAP_PORT || 993);
  const intervalSec = Math.max(20, Number(process.env.IMAP_POLL_SECONDS || 60));

  console.log(`  E-mail (IMAP): actief — controleert ${host} elke ${intervalSec}s`);

  const run = () => poll({ host, port, user, pass }).catch((e) => console.error('  IMAP-fout:', e.message));
  run();
  setInterval(run, intervalSec * 1000);
}

async function poll({ host, port, user, pass }) {
  if (polling) return; // voorkom overlappende rondes
  polling = true;

  // Dynamische import zodat het ontbreken van de pakketten de rest van de app niet breekt.
  let ImapFlow, simpleParser;
  try {
    ({ ImapFlow } = await import('imapflow'));
    ({ simpleParser } = await import('mailparser'));
  } catch (e) {
    console.error('  IMAP: pakketten ontbreken. Voer "npm install" uit. (' + e.message + ')');
    polling = false;
    return;
  }

  const client = new ImapFlow({
    host, port, secure: true,
    auth: { user, pass },
    logger: false,
  });
  // BELANGRIJK: ImapFlow is een EventEmitter. Zonder 'error'-listener gooit Node
  // een verbindingsfout (bv. 'NoConnection') als uncaughtException -> de hele app
  // crasht. Deze listener vangt dat netjes op.
  client.on('error', (e) => console.error('  IMAP client-fout:', e?.message || e));

  const lookbackDays = Math.max(1, Number(process.env.IMAP_LOOKBACK_DAYS || 5));
  const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);

  try {
    await client.connect();
    // 1) INKOMENDE mail verwerken (INBOX).
    await processInbox(client, simpleParser, since);
    // 2) UITGAANDE mail (Verzonden-map) ophalen, zodat antwoorden die buiten het
    //    dashboard om zijn verstuurd toch in de gesprekshistorie komen.
    await processSent(client, simpleParser, since).catch((e) => console.error('  IMAP (Verzonden):', e.message));
  } finally {
    try { await client.logout(); } catch { /* negeren */ }
    polling = false;
  }
}

// Zet een via SMTP verstuurde mail ook in de IMAP Verzonden-map, zodat je 'm in
// TransIP/Outlook terugziet bij "Verzonden". Best-effort: faalt stil als IMAP uit
// staat of er geen Verzonden-map is. (SMTP slaat zelf niets op in je mailbox.)
export async function appendSentMail({ from, to, subject, text }) {
  // Optioneel een APARTE mailbox voor de Verzonden-map (bv. info@) via SENT_IMAP_*.
  // Anders dezelfde mailbox als waaruit we lezen (IMAP_*, meestal crm@).
  const host = process.env.SENT_IMAP_HOST || process.env.IMAP_HOST;
  const user = process.env.SENT_IMAP_USER || process.env.IMAP_USER;
  const pass = process.env.SENT_IMAP_PASSWORD || process.env.IMAP_PASSWORD;
  if (!host || !user || !pass || !to) return;
  let ImapFlow;
  try { ({ ImapFlow } = await import('imapflow')); } catch { return; }
  const port = Number(process.env.SENT_IMAP_PORT || process.env.IMAP_PORT || 993);
  const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
  client.on('error', (e) => console.error('  IMAP (append) fout:', e?.message || e));
  try {
    await client.connect();
    const boxes = await client.list();
    let sentPath = null;
    for (const box of boxes || []) {
      const flags = box.flags || new Set();
      const hasSentFlag = (flags.has && flags.has('\\Sent')) || box.specialUse === '\\Sent';
      if (hasSentFlag || /sent|verzonden/i.test(box.path || box.name || '')) { sentPath = box.path; break; }
    }
    if (!sentPath) return;
    const raw = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject || 'Keyservice'}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      text || '',
    ].join('\r\n');
    await client.append(sentPath, raw, ['\\Seen']);
  } catch (e) {
    console.error('  Kon verzonden mail niet in Verzonden-map zetten:', e.message);
  } finally {
    try { await client.logout(); } catch { /* negeren */ }
  }
}

// Verwerk inkomende mail: op datum (laatste X dagen), ontdubbeld op messageId.
async function processInbox(client, simpleParser, since) {
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ since }, { uid: true });
    for (const uid of uids || []) {
      // Eerst goedkoop de envelope ophalen om messageId te kennen.
      let head;
      try { head = await client.fetchOne(uid, { envelope: true }, { uid: true }); } catch { continue; }
      const mid = head?.envelope?.messageId || `imap-${uid}`;
      // Al verwerkt? Dan overslaan (geen dubbel werk, geen dubbele kaarten).
      if (db().messages.find((m) => m.externalId && m.externalId === mid)) continue;

      // BELANGRIJK: één kapotte/rare e-mail mag NIET de hele ronde afbreken — anders
      // worden alle NIEUWERE mails (hogere UID) nooit meer verwerkt. Dus per bericht
      // afvangen en doorgaan; de rotte mail wordt gemarkeerd zodat we 'm niet blijven
      // herproberen (en er komt een regel in het logboek).
      try {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const attachments = [];
        for (const att of parsed.attachments || []) {
          if (!att.content || !att.content.length) continue; // inline-logo's e.d. overslaan
          const saved = saveBuffer(att.content, { mime: att.contentType, filename: att.filename });
          if (saved) attachments.push(saved);
        }
        const result = await ingestMessage({
          channel: 'email',
          sender: parsed.from?.text || '',
          subject: parsed.subject || '',
          body: (parsed.text || parsed.html || '').toString().slice(0, 8000),
          externalId: mid,
          attachments,
        });
        // Automatische ontvangstbevestiging naar de klant (indien aangezet).
        await maybeSendAutoReply(result).catch(() => {});
      } catch (e) {
        console.error(`  IMAP: e-mail (uid ${uid}) overgeslagen door fout:`, e.message);
        // Markeer als 'gezien' zodat deze rotte mail de volgende rondes niet blijft
        // blokkeren/herproberen. Geen kaart, maar wel geregistreerd.
        try {
          db().messages.push({ id: id('msg'), externalId: mid, channel: 'email', skipped: true, error: String(e.message).slice(0, 200), at: now() });
          logActivity('systeem', 'e-mail overgeslagen (verwerkingsfout)', String(e.message).slice(0, 120));
          saveSoon();
        } catch { /* registratie best-effort */ }
      }
    }
  } finally {
    lock.release();
  }
}

// Zoekt de "Verzonden"-map (naam verschilt per provider) en hangt verstuurde
// antwoorden aan de bijbehorende klant-opdracht. Faalt veilig als er geen
// Verzonden-map is.
async function processSent(client, simpleParser, since) {
  // Vind de verzonden-map via special-use '\Sent' of op naam.
  // client.list() levert een array op -> gewone for-of (geen for await!).
  const boxes = await client.list();
  let sentPath = null;
  for (const box of boxes || []) {
    const flags = box.flags || new Set();
    const hasSentFlag = (flags.has && flags.has('\\Sent')) || box.specialUse === '\\Sent';
    if (hasSentFlag || /sent|verzonden/i.test(box.path || box.name || '')) { sentPath = box.path; break; }
  }
  if (!sentPath) return;

  const lock = await client.getMailboxLock(sentPath);
  try {
    const uids = await client.search({ since }, { uid: true });
    for (const uid of uids || []) {
      let head;
      try { head = await client.fetchOne(uid, { envelope: true }, { uid: true }); } catch { continue; }
      const mid = head?.envelope?.messageId || `sent-${uid}`;
      const threadKey = 'sent:' + mid;
      // Al toegevoegd aan een kaart? Overslaan.
      if (db().orders.some((o) => (o.thread || []).some((t) => t.externalId === threadKey))) continue;

      const to = head?.envelope?.to?.[0]?.address || '';
      if (!to) continue;
      // Bij welke klant/opdracht hoort dit verstuurde antwoord?
      const customer = findCustomer({ email: to });
      if (!customer) continue;
      const order = db().orders.find((o) =>
        o.customerId === customer.id && !o.archivedWeek &&
        !['afgerond', 'geannuleerd'].includes(o.status));
      if (!order) continue;

      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const sentBody = (parsed.text || parsed.html || '').toString().slice(0, 8000);
      // Al verstuurd via het dashboard (zelf-antwoord, follow-up, auto-bevestiging)? Dan
      // staat dit bericht al in de historie -> niet nóg een keer toevoegen.
      const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 160).toLowerCase();
      const newNorm = norm(sentBody);
      const alreadyInThread = (order.thread || []).some((t) => t.outgoing && newNorm && norm(t.body) === newNorm);
      if (alreadyInThread) continue;
      order.thread = order.thread || [];
      order.thread.push({
        id: id('thr'),
        channel: 'email',
        sender: parsed.from?.text || 'Keyservice',
        subject: parsed.subject || '',
        body: sentBody,
        at: (parsed.date || new Date()).toISOString(),
        outgoing: true,            // rechts/blauw in de chat (uitgaand)
        externalId: threadKey,     // ontdubbeling
      });
      order.lastReplyAt = now();
      order.updatedAt = now();
      saveSoon();
      logActivity('systeem', 'verzonden e-mail gekoppeld aan kaart', `${customer.name}: ${order.title}`);
    }
  } finally {
    lock.release();
  }
}

// ---------- Mailbox-quotum (hoe vol zitten de mailboxen?) ----------
// Vraagt de mailserver hoe vol elke bewaakte mailbox zit (IMAP QUOTA, ondersteund
// door TransIP). Een volle mailbox = versturen mislukt én inkomende klantmail wordt
// geweigerd — dus daar willen we VOORAF voor waarschuwen.
//
// Bewaakte mailboxen: de hoofdbox (IMAP_USER) + extra boxen via de Render-variabele
//   IMAP_EXTRA_ACCOUNTS="crm@keyservice247.nl:WACHTWOORD,contact@keyservice247.nl:WACHTWOORD"
// (zelfde mailserver/host als de hoofdbox). Resultaat komt in db()._mailboxQuota.
function quotaWatchAccounts() {
  const list = [];
  if (process.env.IMAP_USER && process.env.IMAP_PASSWORD) {
    list.push({ user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD });
  }
  for (const pair of String(process.env.IMAP_EXTRA_ACCOUNTS || '').split(',')) {
    const t = pair.trim();
    const i = t.indexOf(':');
    if (i > 0) list.push({ user: t.slice(0, i).trim(), pass: t.slice(i + 1).trim() });
  }
  return list;
}

async function quotaForAccount(host, port, { user, pass }) {
  let client;
  try {
    const { ImapFlow } = await import('imapflow');
    client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
    await client.connect();
    const q = await client.getQuota('INBOX');
    await client.logout().catch(() => {});
    const used = q && q.storage && (q.storage.usage ?? q.storage.used);
    const limit = q && q.storage && q.storage.limit;
    if (!limit) return { user, supported: false };
    return {
      user, supported: true,
      pct: Math.min(100, Math.round((used / limit) * 100)),
      usedMB: Math.round(used / 1048576), limitMB: Math.round(limit / 1048576),
    };
  } catch (e) {
    try { if (client) await client.logout(); } catch { /* al dicht */ }
    console.error(`[mailbox-quotum] check van ${user} mislukt:`, e.message);
    return { user, supported: false, error: e.message };
  }
}

export async function checkMailboxQuota() {
  const host = process.env.IMAP_HOST;
  if (!host) return null;
  const accounts = quotaWatchAccounts();
  if (!accounts.length) return null;
  const port = Number(process.env.IMAP_PORT || 993);
  const boxes = [];
  for (const acc of accounts) boxes.push(await quotaForAccount(host, port, acc));
  const measured = boxes.filter((b) => b.supported);
  const worst = measured.length ? measured.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
  const rec = {
    supported: !!worst, boxes, at: now(),
    pct: worst ? worst.pct : undefined,
    worstUser: worst ? worst.user : undefined,
    usedMB: worst ? worst.usedMB : undefined,
    limitMB: worst ? worst.limitMB : undefined,
  };
  if (db()._mailboxQuota && db()._mailboxQuota.alertedOn) rec.alertedOn = db()._mailboxQuota.alertedOn;
  db()._mailboxQuota = rec;
  saveSoon();
  return rec;
}
