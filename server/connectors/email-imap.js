// Ingebouwde e-mailkoppeling (IMAP) — haalt zelf nieuwe e-mails op uit je
// mailbox (bijv. TransIP) en zet ze in de verwerking. Geen externe dienst nodig.
//
// Aanzetten: vul in .env de variabelen IMAP_HOST, IMAP_USER en IMAP_PASSWORD in.
// Staat dat er niet, dan slaat deze koppeling zichzelf netjes over.
import { ingestMessage } from '../pipeline.js';
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

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Alleen ongelezen berichten ophalen.
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of uids || []) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        // Bijlagen opslaan (foto's/video's/pdf's die de klant meestuurt).
        const attachments = [];
        for (const att of parsed.attachments || []) {
          // sla inline-handtekeninglogo's e.d. zonder content over
          if (!att.content || !att.content.length) continue;
          const saved = saveBuffer(att.content, { mime: att.contentType, filename: att.filename });
          if (saved) attachments.push(saved);
        }
        await ingestMessage({
          channel: 'email',
          sender: parsed.from?.text || '',
          subject: parsed.subject || '',
          body: (parsed.text || parsed.html || '').toString().slice(0, 8000),
          externalId: parsed.messageId || `imap-${uid}`,
          attachments,
        });
        // Markeer als gelezen zodat we hem niet opnieuw verwerken.
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* negeren */ }
    polling = false;
  }
}
