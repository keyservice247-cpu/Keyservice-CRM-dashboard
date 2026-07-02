// Automatische ontvangstbevestiging naar de klant bij een nieuwe e-mail-aanvraag.
// Vraagt alvast om foto's + adres, zodat het team sneller verder kan zodra iemand vrij is.
import { db, now, saveSoon, logActivity } from './db.js';
import { getAutoReply, getEmailSignature } from './settings.js';
import { sendMail, smtpConfigured } from './connectors/email-smtp.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function maybeSendAutoReply(result) {
  const cfg = getAutoReply();
  if (!cfg.enabled) { console.log('[bevestiging] uit — ontvangstbevestiging staat niet aan'); return; }
  if (!smtpConfigured()) { console.log('[bevestiging] SMTP niet geconfigureerd — kan niet versturen'); return; }
  const review = result && result.review;
  // ALLEEN bij een echt NIEUWE aanvraag (nieuwe kaart) via e-mail. Niet wanneer een
  // bericht aan een bestaande, lopende kaart hangt (klant is dan al in behandeling/
  // offerte) — dan is "bedankt voor uw aanvraag, stuur foto's" niet meer passend.
  if (!review) { console.log('[bevestiging] bericht hing aan bestaande kaart (terugkerende klant) — overgeslagen'); return; }
  if (review.status !== 'pending') { console.log(`[bevestiging] review-status '${review.status}' (geen nieuwe aanvraag) — overgeslagen`); return; }
  if (review.channel !== 'email') { console.log(`[bevestiging] kanaal '${review.channel}' (geen e-mail/website) — overgeslagen`); return; }
  const s = review.suggestion || {};
  const messageId = review.messageId;
  const email = (s.customerEmail || '').trim();
  if (!email || !EMAIL_RE.test(email)) { console.log('[bevestiging] geen geldig klant-e-mailadres gevonden — overgeslagen'); return; }

  // Niet dubbel sturen: max 1 ontvangstbevestiging per klant per 7 dagen.
  const cust = db().customers.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase());
  if (cust && cust.autoRepliedAt && (Date.now() - new Date(cust.autoRepliedAt).getTime()) < 7 * 86400000) { console.log(`[bevestiging] klant kreeg al een bevestiging <7 dagen geleden (${email}) — overgeslagen`); return; }

  const sig = getEmailSignature();
  const text = sig ? `${cfg.body}\n\n${sig}` : cfg.body;
  try {
    await sendMail({ to: email, subject: cfg.subject, text });
    if (cust) cust.autoRepliedAt = now();
    // Markeer het bericht; de bevestiging komt in de historie zodra de kaart is aangemaakt.
    const msg = db().messages.find((m) => m.id === messageId);
    if (msg) msg.autoReplied = { at: now(), to: email, subject: cfg.subject, body: text };
    logActivity('systeem', 'automatische ontvangstbevestiging verstuurd', email);
    console.log(`[bevestiging] verstuurd naar ${email}`);
    saveSoon();
  } catch (e) {
    console.error('[bevestiging] versturen mislukt:', e.message);
  }
}
