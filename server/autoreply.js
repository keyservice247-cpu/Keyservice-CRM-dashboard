// Automatische ontvangstbevestiging naar de klant bij een nieuwe e-mail-aanvraag.
// Vraagt alvast om foto's + adres, zodat het team sneller verder kan zodra iemand vrij is.
import { db, now, saveSoon, logActivity } from './db.js';
import { getAutoReply, getEmailSignature } from './settings.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function maybeSendAutoReply(result) {
  const cfg = getAutoReply();
  if (!cfg.enabled || !smtpConfigured()) return;
  const review = result && result.review;
  // Geval 1: nieuwe klant -> pending review via e-mail.
  // Geval 2: terugkerende klant -> bericht hangt aan bestaande kaart (mergedIntoOrder),
  //          maar alleen als het een ECHTE aanvraag is (s.relevant), geen kort "bedankt".
  let s = null; let messageId = null; let channel = null;
  if (review && review.status === 'pending') {
    s = review.suggestion || {}; messageId = review.messageId; channel = review.channel;
  } else if (result && result.mergedIntoOrder && result.suggestion?.relevant) {
    s = result.suggestion; messageId = result.message?.id; channel = result.message?.channel;
  }
  if (!s || channel !== 'email') return;
  const email = (s.customerEmail || '').trim();
  if (!email || !EMAIL_RE.test(email)) return;

  // Niet dubbel sturen: max 1 ontvangstbevestiging per klant per 7 dagen.
  const cust = db().customers.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase());
  if (cust && cust.autoRepliedAt && (Date.now() - new Date(cust.autoRepliedAt).getTime()) < 7 * 86400000) return;

  const sig = getEmailSignature();
  const text = sig ? `${cfg.body}\n\n${sig}` : cfg.body;
  try {
    await sendMail({ to: email, subject: cfg.subject, text });
    if (cust) cust.autoRepliedAt = now();
    // Nieuwe klant: markeer het bericht; de bevestiging komt in de historie bij goedkeuren.
    const msg = db().messages.find((m) => m.id === messageId);
    if (msg) msg.autoReplied = { at: now(), to: email, subject: cfg.subject, body: text };
    // Terugkerende klant: kaart bestaat al -> bevestiging meteen in de historie zetten.
    if (result && result.mergedIntoOrder) {
      const ord = db().orders.find((o) => o.id === result.mergedIntoOrder);
      if (ord) {
        ord.thread = ord.thread || [];
        ord.thread.push({ id: 'thr_' + Math.random().toString(36).slice(2, 10), channel: 'email', outgoing: true, autoReply: true, sender: 'Keyservice (automatische bevestiging)', subject: cfg.subject, body: text, at: now() });
        ord.autoReplied = { at: now() };
      }
    }
    logActivity('systeem', 'automatische ontvangstbevestiging verstuurd', email);
    saveSoon();
  } catch (e) {
    console.error('Auto-ontvangstbevestiging mislukt:', e.message);
  }
}
