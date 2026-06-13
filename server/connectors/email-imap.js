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

      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const attachments = [];
      for (const att of parsed.attachments || []) {
        if (!att.content || !att.content.length) continue; // inline-logo's e.d. overslaan
        const saved = saveBuffer(att.content, { mime: att.contentType, filename: att.filename });
        if (saved) attachments.push(saved);
      }
      await ingestMessage({
        channel: 'email',
        sender: parsed.from?.text || '',
        subject: parsed.subject || '',
        body: (parsed.text || parsed.html || '').toString().slice(0, 8000),
        externalId: mid,
        attachments,
      });
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
  let sentPath = null;
  for await (const box of client.list()) {
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
      order.thread = order.thread || [];
      order.thread.push({
        id: id('thr'),
        channel: 'email',
        sender: parsed.from?.text || 'Keyservice',
        subject: parsed.subject || '',
        body: (parsed.text || parsed.html || '').toString().slice(0, 8000),
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
