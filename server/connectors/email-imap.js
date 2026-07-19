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

// Extra postbussen die ALLEEN MEELEZEN (zelfde IMAP-host als het hoofdaccount),
// bijv. contact@keyservice247.nl. Formaat van de env-var IMAP_INGEST_ACCOUNTS:
//   "user:pass,user2:pass2"  (komma-gescheiden accounts).
// We splitsen per account op de EERSTE dubbele punt, want een wachtwoord mag zelf
// ':' bevatten. Witruimte trimmen en lege stukjes negeren.
function extraIngestAccounts() {
  const list = [];
  for (const entry of String(process.env.IMAP_INGEST_ACCOUNTS || '').split(',')) {
    const t = entry.trim();
    if (!t) continue;
    const i = t.indexOf(':');
    if (i <= 0) continue;
    const user = t.slice(0, i).trim();
    const pass = t.slice(i + 1).trim();
    if (user && pass) list.push({ user, pass });
  }
  return list;
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

  const lookbackDays = Math.max(1, Number(process.env.IMAP_LOOKBACK_DAYS || 5));
  const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);

  try {
    // 1) HOOFDACCOUNT: exact zoals voorheen — inkomende mail (INBOX) én de
    //    Verzonden-map. De Verzonden-map lezen we BEWUST alleen voor het hoofd-
    //    account (daar verstuurt het dashboard vandaan).
    const mainClient = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
    // BELANGRIJK: ImapFlow is een EventEmitter. Zonder 'error'-listener gooit Node
    // een verbindingsfout (bv. 'NoConnection') als uncaughtException -> de hele app
    // crasht. Deze listener vangt dat netjes op.
    mainClient.on('error', (e) => console.error('  IMAP client-fout:', e?.message || e));
    try {
      await mainClient.connect();
      await processInbox(mainClient, simpleParser, since); // hoofdaccount -> mailbox '' (ongewijzigd)
      await processSent(mainClient, simpleParser, since).catch((e) => console.error('  IMAP (Verzonden):', e.message));
    } catch (e) {
      // Valt het hoofdaccount uit, dan behouden we exact de oude logregel; de extra
      // postbussen hieronder krijgen dankzij deze catch tóch nog hun beurt.
      console.error('  IMAP-fout:', e.message);
    } finally {
      try { await mainClient.logout(); } catch { /* negeren */ }
    }

    // 2) EXTRA POSTBUSSEN: alleen INKOMENDE mail meelezen. Elk account krijgt een
    //    eigen client mét try/catch-isolatie: een kapot extra account mag het hoofd-
    //    account en de andere extra accounts nooit blokkeren (fout loggen, doorgaan).
    for (const acc of extraIngestAccounts()) {
      const client = new ImapFlow({ host, port, secure: true, auth: { user: acc.user, pass: acc.pass }, logger: false });
      client.on('error', (e) => console.error(`  IMAP client-fout (${acc.user}):`, e?.message || e));
      try {
        await client.connect();
        await processInbox(client, simpleParser, since, acc.user); // bron-markering op het bericht
      } catch (e) {
        console.error(`  IMAP: extra postbus ${acc.user} overgeslagen door fout:`, e.message);
      } finally {
        try { await client.logout(); } catch { /* negeren */ }
      }
    }
  } finally {
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

// Herkent en normaliseert een FormSubmit-mail (het formulier van de website wordt
// via FormSubmit naar de mailbox gestuurd). FormSubmit levert de velden als een
// tabel die mailparser platslaat tot label/waarde-tekst; we halen de vaste velden
// er tolerant uit (label mag door ':' óf gewoon witruimte/nieuwe regel gevolgd
// worden, hoofdletter-ongevoelig; ontbrekende velden laten we leeg).
//
// De genormaliseerde body begint bewust met "Nieuwe aanvraag via de website ..." —
// daarop draaien de website-herkenning en de site+mail-ontdubbeling in de pipeline.
// Zet HTML-mail om naar leesbare tekst. FormSubmit (en veel formulieren) sturen de
// velden als een HTML-TABEL; de platte-tekstversie is dan vaak leeg. We maken van
// "<td>label</td><td>waarde</td>" -> "label: waarde" en van rij/blok-einden nieuwe
// regels, zodat de veld-parser hieronder er gewoon "Naam: ...", "Telefoon: ..." uit
// haalt. Zonder deze stap parste een HTML-only FormSubmit-mail leeg (geen telefoon/
// e-mail -> geen ontdubbeling -> een tweede, lege "Form"-kaart).
export function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ': ')       // tussen twee cellen: "label: waarde"
    .replace(/<\/(tr|table|div|p|h\d|li|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&#0?39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseFormSubmit(text, subject) {
  const t = String(text || '');
  // Alle bekende labels (mét spellingvarianten én de ENGELSE veldnamen die het
  // website-formulier aan FormSubmit meegeeft — in de praktijk kwam de mail met
  // "name/phone/email/…" binnen en viel het Nederlandse parsen droog), zodat we per
  // veld tot het VOLGENDE label kunnen doorlezen (meerregelige velden).
  const labelSrc = [
    'naam', 'name', 'tele(?:foon)?(?:nummer)?', 'phone', 'tel',
    'e-?mail(?:adres)?', 'woonplaats', 'plaats', 'city', 'stad', 'adres', 'address',
    'postcode', 'zip', 'type\\s*schuifpui', 'onderwerp', 'subject', 'type',
    'probleem', 'problem', 'bericht', 'message', 'comment', 'toelichting',
  ];
  // De grens waar een veldwaarde stopt: het volgende bekende label OF de vaste
  // FormSubmit-voettekst (anders bloedt die boilerplate in het laatste veld door).
  const nextLabel = '(?:\\n|^)[ \\t>*|]*(?:' + labelSrc.concat(['you are receiving this', 'submitted your form on']).join('|') + ')\\b\\s*:?';
  const grab = (labelPat) => {
    const re = new RegExp('(?:\\n|^)[ \\t>*|]*(?:' + labelPat + ')\\b[ \\t]*:?[ \\t]*([\\s\\S]*?)(?=' + nextLabel + '|$)', 'i');
    const m = t.match(re);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  };

  const naam = grab('naam|name');
  const telefoon = grab('tele(?:foon)?(?:nummer)?|phone|tel');
  const email = grab('e-?mail(?:adres)?');
  const woonplaats = grab('woonplaats|plaats|city|stad|adres|address');
  const type = grab('type\\s*schuifpui|onderwerp|subject');
  const probleem = grab('probleem|problem|bericht|message|comment');
  const toelichting = grab('toelichting');

  // Sitenaam uit het onderwerp als die tussen haakjes staat, bv.
  //   "Offerte-aanvraag schuifpui (schuifpuiservice.com)" -> "schuifpuiservice.com".
  const siteM = String(subject || '').match(/\(([^)]+)\)/);
  const site = siteM ? siteM[1].trim() : '';

  const lines = [`Nieuwe aanvraag via de website${site ? ' ' + site : ''} (FormSubmit-mail).`];
  if (naam) lines.push(`Naam: ${naam}`);
  if (telefoon) lines.push(`Telefoon: ${telefoon}`);
  if (email) lines.push(`E-mail: ${email}`);
  if (woonplaats) lines.push(`Adres: ${woonplaats}`);
  if (type) lines.push(`Onderwerp: ${type}`);
  const tail = [probleem, toelichting].filter(Boolean);
  if (tail.length) lines.push('', ...tail);
  // VANGNET: de ruwe mailtekst gaat er ALTIJD onder mee. Zelfs als FormSubmit z'n
  // labels ooit weer wijzigt en het parsen niets vindt, staan telefoon/e-mail dan
  // tóch in de body — dus de site+mail-ontdubbeling blijft werken en een mens ziet
  // altijd de complete aanvraag. (Zonder dit vangnet werd één website-test op 19 jul
  // twee losse kaarten: de mail had Engelse labels en parste leeg.)
  const rawTail = t.trim().slice(0, 4000);
  if (rawTail) lines.push('', '— Originele FormSubmit-mail —', rawTail);
  return lines.join('\n');
}

// Verwerk inkomende mail: op datum (laatste X dagen), ontdubbeld op messageId.
// mailbox = bron-markering die aan ingestMessage wordt meegegeven; leeg voor het
// hoofdaccount (bestaand gedrag/weergave), de user-naam voor extra postbussen.
async function processInbox(client, simpleParser, since, mailbox = '') {
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
        // FormSubmit-mail herkennen aan de afzender, het onderwerp óf de bekende
        // FormSubmit-zin in de tekst. Zo ja: de ruwe mailtekst vervangen door een
        // genormaliseerde body (nette velden), zodat naam/tel/e-mail/adres
        // betrouwbaar worden opgeslagen en de website-herkenning aanslaat.
        // Altijd een leesbare tekst hebben: platte tekst als die er is, anders de
        // HTML omgezet naar tekst (FormSubmit-mails zijn vaak HTML-only).
        const rawText = ((parsed.text || '').toString() || htmlToText(parsed.html)).slice(0, 12000);
        const fromText = (parsed.from?.text || '').toLowerCase();
        const isFormSubmit = fromText.includes('formsubmit')
          || /offerte-?aanvraag/i.test(parsed.subject || '')
          || /submitted your form on/i.test(rawText)
          || /nieuwe aanvraag via de website/i.test(rawText);
        const body = isFormSubmit
          ? parseFormSubmit(rawText, parsed.subject || '')
          : rawText.slice(0, 8000);

        const result = await ingestMessage({
          channel: 'email',
          sender: parsed.from?.text || '',
          subject: parsed.subject || '',
          body,
          externalId: mid,
          attachments,
          mailbox,
          // Thread-header: is dit een ANTWOORD in een bestaande mailwisseling? Dan
          // hoort het in de gesprekshistorie van de kaart, nooit als nieuwe aanvraag.
          inReplyTo: parsed.inReplyTo || '',
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
